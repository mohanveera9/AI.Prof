import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import {
  AppointmentStatus,
  IntegrationOperationStatus,
  ReconciliationOutcome,
  UserRole,
} from "@ai-prof/shared";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { RequestUser } from "../common/types";
import { AuditQueryDto, OperationalQueryDto } from "./dto/observability-query.dto";

const LIST_TAKE = 80;

@Injectable()
export class ObservabilityService {
  constructor(private readonly prisma: PrismaService) {}

  async metrics(user: RequestUser, requestedHospitalId?: string) {
    const hospitalId = this.scopedHospitalId(user, requestedHospitalId);
    const appointmentWhere: Prisma.AppointmentWhereInput = hospitalId ? { hospitalId } : {};
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [appointmentGroups, bookedLast7Days, openReconciliation, escalations, integrationGroups, operationalGroups, hospitalGroups, conversations] =
      await Promise.all([
        this.prisma.appointment.groupBy({
          by: ["status"],
          where: appointmentWhere,
          _count: { status: true },
        }),
        this.prisma.appointment.count({
          where: { ...appointmentWhere, createdAt: { gte: since } },
        }),
        this.prisma.reconciliationRecord.count({
          where: {
            outcome: { in: [ReconciliationOutcome.PENDING, ReconciliationOutcome.ESCALATED] },
            ...(hospitalId ? { hospitalId } : {}),
          },
        }),
        this.prisma.operationalEvent.count({
          where: {
            type: "HUMAN_ESCALATION",
            ...(hospitalId ? { hospitalId } : {}),
          },
        }),
        this.prisma.integrationOperation.groupBy({
          by: ["status"],
          where: hospitalId ? { hospitalId } : {},
          _count: { status: true },
        }),
        this.prisma.operationalEvent.groupBy({
          by: ["severity"],
          where: {
            createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
            ...(hospitalId ? { hospitalId } : {}),
          },
          _count: { severity: true },
        }),
        user.role === UserRole.PLATFORM_ADMIN && !hospitalId
          ? this.prisma.hospital.groupBy({ by: ["status"], _count: { status: true } })
          : Promise.resolve([]),
        this.countConversations(hospitalId),
      ]);

    const appointments = Object.fromEntries(appointmentGroups.map((row) => [row.status, row._count.status]));
    const integration = Object.fromEntries(integrationGroups.map((row) => [row.status, row._count.status]));
    const operationalLast24h = Object.fromEntries(operationalGroups.map((row) => [row.severity, row._count.severity]));
    const hospitals = Object.fromEntries(hospitalGroups.map((row) => [row.status, row._count.status]));

    const capabilityWhere: Prisma.CapabilityExecutionWhereInput = hospitalId
      ? { correlationId: { in: await this.correlationIdsForHospital(hospitalId) } }
      : {};
    const capabilityAgg = await this.prisma.capabilityExecution.aggregate({
      where: capabilityWhere,
      _avg: { latencyMs: true },
      _count: { _all: true },
    });
    const capabilityFailed = await this.prisma.capabilityExecution.count({
      where: { ...capabilityWhere, success: false },
    });

    return {
      scope: hospitalId ?? "platform",
      appointments: {
        total: Object.values(appointments).reduce((sum, n) => sum + n, 0),
        confirmed: appointments[AppointmentStatus.CONFIRMED] ?? 0,
        cancelled: appointments[AppointmentStatus.CANCELLED] ?? 0,
        completed: appointments[AppointmentStatus.COMPLETED] ?? 0,
        noShow: appointments[AppointmentStatus.NO_SHOW] ?? 0,
        failed: appointments[AppointmentStatus.FAILED] ?? 0,
        reconciliationRequired: appointments[AppointmentStatus.RECONCILIATION_REQUIRED] ?? 0,
        pending: (appointments[AppointmentStatus.PENDING] ?? 0) + (appointments[AppointmentStatus.REQUESTED] ?? 0),
        bookedLast7Days,
      },
      integration: {
        verified: integration[IntegrationOperationStatus.VERIFIED] ?? 0,
        success: integration[IntegrationOperationStatus.SUCCESS] ?? 0,
        failed: integration[IntegrationOperationStatus.FAILED] ?? 0,
        pending: integration[IntegrationOperationStatus.PENDING] ?? 0,
        unknown: integration[IntegrationOperationStatus.UNKNOWN] ?? 0,
      },
      openReconciliation,
      escalations,
      ai: {
        conversations,
        capabilityCalls: capabilityAgg._count._all,
        capabilityFailed,
        avgLatencyMs: Math.round(capabilityAgg._avg.latencyMs ?? 0),
      },
      operationalLast24h: {
        info: operationalLast24h.INFO ?? 0,
        warning: operationalLast24h.WARNING ?? 0,
        critical: operationalLast24h.CRITICAL ?? 0,
      },
      hospitals: user.role === UserRole.PLATFORM_ADMIN && !hospitalId ? hospitals : undefined,
    };
  }

  async listAudit(user: RequestUser, query: AuditQueryDto) {
    const hospitalId = this.scopedHospitalId(user, query.hospitalId);
    return this.prisma.auditEvent.findMany({
      where: {
        ...(hospitalId ? { hospitalId } : {}),
        ...(query.category ? { category: query.category } : {}),
        ...(query.correlationId ? { correlationId: query.correlationId } : {}),
      },
      include: {
        actorUser: { select: { id: true, email: true, role: true } },
        hospital: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: LIST_TAKE,
    });
  }

  async listOperational(user: RequestUser, query: OperationalQueryDto) {
    const hospitalId = this.scopedHospitalId(user, query.hospitalId);
    return this.prisma.operationalEvent.findMany({
      where: {
        ...(hospitalId ? { hospitalId } : {}),
        ...(query.type ? { type: query.type } : {}),
        ...(query.severity ? { severity: query.severity } : {}),
        ...(query.correlationId ? { correlationId: query.correlationId } : {}),
      },
      include: { hospital: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
      take: LIST_TAKE,
    });
  }

  async listEscalations(user: RequestUser, requestedHospitalId?: string) {
    const hospitalId = this.scopedHospitalId(user, requestedHospitalId);
    const [reconciliation, operational] = await Promise.all([
      this.prisma.reconciliationRecord.findMany({
        where: {
          outcome: { in: [ReconciliationOutcome.PENDING, ReconciliationOutcome.ESCALATED] },
          ...(hospitalId ? { hospitalId } : {}),
        },
        include: {
          appointment: {
            select: {
              id: true,
              status: true,
              correlationId: true,
              slotStart: true,
              doctor: { select: { name: true } },
              patient: { select: { name: true } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: LIST_TAKE,
      }),
      this.prisma.operationalEvent.findMany({
        where: {
          type: "HUMAN_ESCALATION",
          ...(hospitalId ? { hospitalId } : {}),
        },
        include: { hospital: { select: { id: true, name: true } } },
        orderBy: { createdAt: "desc" },
        take: LIST_TAKE,
      }),
    ]);
    return { reconciliation, operational };
  }

  async trace(user: RequestUser, correlationId: string, requestedHospitalId?: string) {
    const hospitalId = this.scopedHospitalId(user, requestedHospitalId);
    const scope = hospitalId ? { hospitalId } : {};

    const [appointments, auditEvents, operationalEvents, integrationOperations, capabilityExecutions, workflowExecutions] =
      await Promise.all([
        this.prisma.appointment.findMany({
          where: { correlationId, ...scope },
          select: {
            id: true,
            status: true,
            slotStart: true,
            slotEnd: true,
            hospitalId: true,
            correlationId: true,
            doctor: { select: { name: true } },
            patient: { select: { name: true } },
            hospital: { select: { name: true } },
            statusHistory: { orderBy: { createdAt: "asc" }, select: { fromStatus: true, toStatus: true, reason: true, actor: true, createdAt: true } },
          },
        }),
        this.prisma.auditEvent.findMany({
          where: { correlationId, ...(hospitalId ? { hospitalId } : {}) },
          include: { actorUser: { select: { email: true, role: true } } },
          orderBy: { createdAt: "asc" },
        }),
        this.prisma.operationalEvent.findMany({
          where: { correlationId, ...(hospitalId ? { hospitalId } : {}) },
          orderBy: { createdAt: "asc" },
        }),
        this.prisma.integrationOperation.findMany({
          where: { correlationId, ...scope },
          select: {
            id: true,
            type: true,
            status: true,
            failureType: true,
            retryCount: true,
            hospitalId: true,
            appointmentId: true,
            createdAt: true,
            verifications: { select: { verified: true, externalStatus: true, checkedAt: true } },
          },
          orderBy: { createdAt: "asc" },
        }),
        this.prisma.capabilityExecution.findMany({
          where: { correlationId },
          select: {
            id: true,
            capabilityName: true,
            success: true,
            errorMessage: true,
            latencyMs: true,
            createdAt: true,
          },
          orderBy: { createdAt: "asc" },
        }),
        this.prisma.workflowExecution.findMany({
          where: {
            correlationId,
            ...(hospitalId ? { workflow: { hospitalId } } : {}),
          },
          select: {
            id: true,
            status: true,
            attempt: true,
            error: true,
            createdAt: true,
            workflow: { select: { name: true, key: true, hospitalId: true } },
          },
          orderBy: { createdAt: "asc" },
        }),
      ]);

    const scopedCapabilities =
      hospitalId && appointments.length === 0 && auditEvents.length === 0 && integrationOperations.length === 0
        ? []
        : capabilityExecutions;

    const empty =
      appointments.length === 0 &&
      auditEvents.length === 0 &&
      operationalEvents.length === 0 &&
      integrationOperations.length === 0 &&
      scopedCapabilities.length === 0 &&
      workflowExecutions.length === 0;

    if (empty) {
      throw new NotFoundException("No events found for that correlation id.");
    }

    const timeline = [
      ...auditEvents.map((row) => ({ at: row.createdAt, kind: "audit" as const, label: row.action, detail: row.category })),
      ...operationalEvents.map((row) => ({ at: row.createdAt, kind: "operational" as const, label: row.type, detail: row.severity })),
      ...integrationOperations.map((row) => ({ at: row.createdAt, kind: "integration" as const, label: row.type, detail: row.status })),
      ...scopedCapabilities.map((row) => ({
        at: row.createdAt,
        kind: "capability" as const,
        label: row.capabilityName,
        detail: row.success ? "success" : "failed",
      })),
      ...workflowExecutions.map((row) => ({ at: row.createdAt, kind: "workflow" as const, label: row.workflow.name, detail: row.status })),
      ...appointments.flatMap((appt) =>
        appt.statusHistory.map((h) => ({
          at: h.createdAt,
          kind: "appointment" as const,
          label: `${h.fromStatus ?? "none"} → ${h.toStatus}`,
          detail: h.actor ?? "system",
        })),
      ),
    ].sort((a, b) => a.at.getTime() - b.at.getTime());

    return {
      correlationId,
      appointments,
      auditEvents,
      operationalEvents,
      integrationOperations,
      capabilityExecutions: scopedCapabilities,
      workflowExecutions,
      timeline,
    };
  }

  private scopedHospitalId(user: RequestUser, requested?: string): string | undefined {
    if (user.role === UserRole.PLATFORM_ADMIN) return requested || undefined;
    if (user.role === UserRole.HOSPITAL_ADMIN) {
      if (!user.hospitalId) throw new ForbiddenException("This account is not linked to a hospital.");
      if (requested && requested !== user.hospitalId) {
        throw new ForbiddenException("You do not have access to this hospital's data.");
      }
      return user.hospitalId;
    }
    throw new ForbiddenException("You do not have access to observability data.");
  }

  private async correlationIdsForHospital(hospitalId: string): Promise<string[]> {
    const rows = await this.prisma.appointment.findMany({
      where: { hospitalId },
      select: { correlationId: true },
      take: 500,
    });
    const ids = [...new Set(rows.map((row) => row.correlationId).filter(Boolean))];
    return ids.length ? ids : ["__none__"];
  }

  private async countConversations(hospitalId?: string): Promise<number> {
    if (!hospitalId) return this.prisma.aIConversation.count();
    const patientIds = await this.prisma.appointment.findMany({
      where: { hospitalId },
      select: { patientId: true },
      distinct: ["patientId"],
    });
    if (!patientIds.length) return 0;
    return this.prisma.aIConversation.count({
      where: { patientId: { in: patientIds.map((row) => row.patientId) } },
    });
  }
}
