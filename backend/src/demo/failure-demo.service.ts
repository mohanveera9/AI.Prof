import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import {
  AppointmentStatus,
  AuditEventCategory,
  DoctorStatus,
  HospitalStatus,
  UserRole,
} from "@ai-prof/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { AppointmentsService } from "../appointments/appointments.service";
import { SchedulingService } from "../scheduling/scheduling.service";
import { ConnectorFactory } from "../integration/connector.factory";
import { ReconciliationService } from "../reconciliation/reconciliation.service";
import { RequestUser } from "../common/types";
import { newIdempotencyKey } from "../common/correlation";

export interface FailureDemoStep {
  name: string;
  ok: boolean;
  detail: string;
}

/**
 * Scripted Option B demo (PRD failure/recovery): mock-EHR writes the
 * appointment then times out, booking lands in RECONCILIATION_REQUIRED
 * with the slot still held, then verify-then-sync recovery confirms the
 * same external row — never a duplicate create.
 */
@Injectable()
export class FailureDemoService {
  private readonly logger = new Logger(FailureDemoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly appointments: AppointmentsService,
    private readonly scheduling: SchedulingService,
    private readonly connectors: ConnectorFactory,
    private readonly reconciliation: ReconciliationService,
  ) {}

  async runFailureRecovery(actor: RequestUser) {
    const doctor = await this.findBookableDoctor();
    if (!doctor) {
      throw new BadRequestException(
        "No approved hospital with an active doctor and working hours is available for the failure demo.",
      );
    }

    const patient = await this.ensureDemoPatient();
    await this.connectors.ensureConnection(doctor.hospitalId);

    const slots = await this.scheduling.checkAvailability(doctor.id, {
      dateFrom: new Date().toISOString(),
      dateTo: new Date(Date.now() + 14 * 86_400_000).toISOString(),
      limit: 20,
    });
    const slot = slots[0];
    if (!slot) {
      throw new BadRequestException(`No open slots on ${doctor.name}'s calendar for the next 14 days.`);
    }

    const ehr = await this.connectors.adminConnector();
    const steps: FailureDemoStep[] = [];
    const ehrCount = { before: 0, afterTimeout: 0, afterReconcile: 0 };

    try {
      ehrCount.before = (await ehr.listAppointments()).length;
      await ehr.setChaos({
        mode: "timeout_with_create",
        scope: "appointment_create",
        remainingHits: 8,
        timeoutMs: 8000,
      });
      steps.push({
        name: "chaos_injected",
        ok: true,
        detail: "timeout_with_create (write-then-hang) for the next EHR creates",
      });

      const booked = await this.appointments.create(patient.id, actor, {
        doctorId: doctor.id,
        slotStart: slot.start.toISOString(),
        slotEnd: slot.end.toISOString(),
        reasonNote: "Platform failure-recovery demo",
        idempotencyKey: `failure-demo-${newIdempotencyKey()}`,
      });

      ehrCount.afterTimeout = (await ehr.listAppointments()).length;
      const held = await this.prisma.slotReservation.findUnique({ where: { appointmentId: booked.id } });
      const timedOutAsExpected = booked.status === AppointmentStatus.RECONCILIATION_REQUIRED;
      steps.push({
        name: "booking_under_chaos",
        ok: timedOutAsExpected || booked.status === AppointmentStatus.CONFIRMED,
        detail: `appointment ${booked.id} → ${booked.status}; EHR rows ${ehrCount.before} → ${ehrCount.afterTimeout}`,
      });
      steps.push({
        name: "slot_held",
        ok: Boolean(held) || booked.status === AppointmentStatus.CONFIRMED,
        detail: held ? "slot reservation kept while outcome is unknown" : "slot already released or confirmed",
      });
      steps.push({
        name: "no_duplicate_on_timeout",
        ok: ehrCount.afterTimeout === ehrCount.before + 1,
        detail: `exactly one EHR appointment was written (count ${ehrCount.afterTimeout})`,
      });

      await ehr.resetChaos();
      steps.push({ name: "chaos_reset", ok: true, detail: "mock-EHR chaos cleared before reconciliation" });

      let reconOutcome: string | null = null;
      if (booked.status === AppointmentStatus.RECONCILIATION_REQUIRED) {
        const recon = await this.reconciliation.reconcileAppointment(booked.id);
        reconOutcome = recon?.outcome ?? null;
      }

      const finalAppointment = await this.prisma.appointment.findUniqueOrThrow({
        where: { id: booked.id },
        include: { doctor: true, hospital: true, patient: true },
      });
      ehrCount.afterReconcile = (await ehr.listAppointments()).length;
      const recovered = finalAppointment.status === AppointmentStatus.CONFIRMED && Boolean(finalAppointment.externalAppointmentId);
      steps.push({
        name: "reconciliation",
        ok: recovered,
        detail: reconOutcome
          ? `outcome ${reconOutcome}; appointment ${finalAppointment.status}`
          : `appointment already ${finalAppointment.status}`,
      });
      steps.push({
        name: "no_duplicate_after_recovery",
        ok: ehrCount.afterReconcile === ehrCount.afterTimeout && ehrCount.afterReconcile === ehrCount.before + 1,
        detail: `EHR still has ${ehrCount.afterReconcile} appointment(s); no second create`,
      });

      await this.audit.recordAudit({
        category: AuditEventCategory.ADMINISTRATIVE_ACTION,
        action: "demo.failure_recovery",
        actorUserId: actor.userId,
        hospitalId: doctor.hospitalId,
        targetType: "Appointment",
        targetId: finalAppointment.id,
        correlationId: finalAppointment.correlationId,
        metadata: {
          steps: steps.map((s) => s.name),
          ehrCount,
          recovered,
        },
      });

      const auditEvents = await this.prisma.auditEvent.findMany({
        where: { correlationId: finalAppointment.correlationId },
        orderBy: { createdAt: "asc" },
        select: { action: true, category: true, createdAt: true },
      });

      return {
        ok: steps.every((s) => s.ok) && recovered,
        scenario: "timeout_with_create",
        steps,
        ehrCount,
        duplicated: ehrCount.afterReconcile !== ehrCount.before + 1,
        appointment: {
          id: finalAppointment.id,
          status: finalAppointment.status,
          externalAppointmentId: finalAppointment.externalAppointmentId,
          slotStart: finalAppointment.slotStart.toISOString(),
          slotEnd: finalAppointment.slotEnd.toISOString(),
          hospitalName: finalAppointment.hospital.name,
          doctorName: finalAppointment.doctor.name,
          patientName: finalAppointment.patient.name,
        },
        correlationId: finalAppointment.correlationId,
        auditActions: auditEvents.map((e) => e.action),
      };
    } catch (err) {
      this.logger.error("Failure-recovery demo aborted", err as Error);
      throw err;
    } finally {
      await ehr.resetChaos().catch((err) => this.logger.warn(`Failed to reset chaos after demo: ${(err as Error).message}`));
    }
  }

  private async findBookableDoctor() {
    const preferred = await this.prisma.doctor.findFirst({
      where: {
        status: DoctorStatus.ACTIVE,
        name: { contains: "Anika", mode: "insensitive" },
        hospital: { status: HospitalStatus.APPROVED },
        calendars: { some: { isActive: true, workingHours: { some: {} } } },
      },
      include: { hospital: true },
    });
    if (preferred) return preferred;
    return this.prisma.doctor.findFirst({
      where: {
        status: DoctorStatus.ACTIVE,
        hospital: { status: HospitalStatus.APPROVED },
        calendars: { some: { isActive: true, workingHours: { some: {} } } },
      },
      include: { hospital: true },
    });
  }

  private async ensureDemoPatient() {
    const email = "failure-demo@ai-prof.dev";
    const existing = await this.prisma.user.findUnique({ where: { email }, include: { patient: true } });
    if (existing?.patient) return existing.patient;
    const created = await this.prisma.user.create({
      data: {
        email,
        passwordHash: "demo-not-for-login",
        role: UserRole.PATIENT,
        patient: { create: { name: "Failure Demo Patient" } },
      },
      include: { patient: true },
    });
    return created.patient!;
  }
}
