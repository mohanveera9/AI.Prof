import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  AppointmentStatus,
  AuditEventCategory,
  IntegrationFailureType,
  IntegrationOperationStatus,
  IntegrationOperationType,
  OperationalEventType,
  ReconciliationOutcome,
} from "@ai-prof/shared";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { ConnectorFactory } from "../integration/connector.factory";
import { AppointmentExternalSync } from "../integration/appointment-external-sync";
import { ConnectorError } from "../integration/connector.types";
import type { ExternalAppointmentRecord } from "../integration/connector.types";
import { decideReconciliationAction } from "./reconciliation.decision";

@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly connectors: ConnectorFactory,
    private readonly sync: AppointmentExternalSync,
    private readonly config: ConfigService,
  ) {}

  maxAttempts(): number {
    return Number(this.config.get("RECONCILIATION_MAX_ATTEMPTS") ?? 3);
  }

  async listOpen(hospitalId?: string) {
    return this.prisma.reconciliationRecord.findMany({
      where: {
        outcome: ReconciliationOutcome.PENDING,
        ...(hospitalId ? { hospitalId } : {}),
      },
      include: { appointment: true },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * Re-query the external system and either sync, safely retry with the
   * original idempotency key, or escalate. Never issues a new create with a
   * fresh key — that is how duplicates happen.
   */
  async reconcileAppointment(appointmentId: string) {
    const appointment = await this.prisma.appointment.findUnique({ where: { id: appointmentId } });
    if (!appointment) throw new NotFoundException("Appointment not found.");

    if (
      appointment.status === AppointmentStatus.CONFIRMED &&
      appointment.externalAppointmentId
    ) {
      return this.prisma.reconciliationRecord.findFirst({ where: { appointmentId } });
    }

    const record = await this.getOrCreateRecord(appointment.hospitalId, appointmentId);
    const operation = await this.prisma.integrationOperation.findFirst({
      where: { appointmentId, type: IntegrationOperationType.APPOINTMENT_CREATE },
      orderBy: { createdAt: "desc" },
    });

    const attempts = record.attempts + 1;
    await this.prisma.reconciliationRecord.update({
      where: { id: record.id },
      data: { attempts },
    });

    const { connector } = await this.connectors.forHospital(appointment.hospitalId);

    let found: ExternalAppointmentRecord | null = null;
    if (appointment.externalAppointmentId) {
      found = await connector.retrieveAppointment(appointment.externalAppointmentId);
    }
    if (!found && appointment.idempotencyKey) {
      found = await connector.retrieveAppointmentByIdempotencyKey(appointment.idempotencyKey);
    }

    const decision = decideReconciliationAction({
      found: Boolean(found),
      failureType: operation?.failureType ?? IntegrationFailureType.UNKNOWN_OUTCOME,
      attempts,
      maxAttempts: this.maxAttempts(),
    });

    this.logger.log(
      `Reconcile ${appointmentId}: found=${Boolean(found)} action=${decision.action} (${decision.reason})`,
    );

    if (decision.action === "SYNC" && found) {
      const opId = operation?.id;
      if (opId) {
        const verified = await this.sync.verifyAndSync(connector, opId, appointmentId, found, appointment.correlationId);
        if (!verified.verified) {
          return this.escalate(record.id, appointment.hospitalId, appointment.correlationId, "Found externally but verification failed");
        }
      } else {
        await this.sync.synchronize(appointmentId, found, appointment.correlationId);
      }
      return this.finish(record.id, ReconciliationOutcome.FOUND_SYNCED, {
        reason: decision.reason,
        externalId: found.id,
      });
    }

    if (decision.action === "SAFE_RETRY") {
      if (!operation?.idempotencyKey) {
        return this.escalate(record.id, appointment.hospitalId, appointment.correlationId, "No idempotency key available for a safe retry");
      }
      try {
        const payload = (operation.requestPayload ?? {}) as {
          externalPatientId?: string;
          externalProviderId?: string;
          externalFacilityId?: string;
        };
        const created = await connector.createAppointment({
          externalPatientId: payload.externalPatientId!,
          externalProviderId: payload.externalProviderId!,
          externalFacilityId: payload.externalFacilityId,
          start: appointment.slotStart.toISOString(),
          end: appointment.slotEnd.toISOString(),
          idempotencyKey: operation.idempotencyKey,
        });
        await this.prisma.integrationOperation.update({
          where: { id: operation.id },
          data: {
            status: IntegrationOperationStatus.SUCCESS,
            failureType: null,
            retryCount: { increment: 1 },
            responsePayload: created as object,
          },
        });
        const verified = await this.sync.verifyAndSync(
          connector,
          operation.id,
          appointmentId,
          created,
          appointment.correlationId,
        );
        if (!verified.verified) {
          return this.escalate(record.id, appointment.hospitalId, appointment.correlationId, "Safe retry wrote but verification failed");
        }
        return this.finish(record.id, ReconciliationOutcome.SAFELY_RETRIED, {
          reason: decision.reason,
          externalId: created.id,
        });
      } catch (err) {
        const failureType = err instanceof ConnectorError ? err.failureType : IntegrationFailureType.UNKNOWN_OUTCOME;
        await this.prisma.integrationOperation.update({
          where: { id: operation.id },
          data: { failureType, retryCount: { increment: 1 } },
        });
        const next = decideReconciliationAction({
          found: false,
          failureType,
          attempts,
          maxAttempts: this.maxAttempts(),
        });
        if (next.action === "ESCALATE") {
          return this.escalate(record.id, appointment.hospitalId, appointment.correlationId, `Safe retry failed: ${failureType}`);
        }
        return this.prisma.reconciliationRecord.findUnique({ where: { id: record.id } });
      }
    }

    return this.escalate(record.id, appointment.hospitalId, appointment.correlationId, decision.reason);
  }

  private async getOrCreateRecord(hospitalId: string, appointmentId: string) {
    const open = await this.prisma.reconciliationRecord.findFirst({
      where: { appointmentId, outcome: ReconciliationOutcome.PENDING },
    });
    if (open) return open;
    return this.prisma.reconciliationRecord.create({
      data: { hospitalId, appointmentId, outcome: ReconciliationOutcome.PENDING },
    });
  }

  private async finish(id: string, outcome: ReconciliationOutcome, details: Prisma.InputJsonValue) {
    return this.prisma.reconciliationRecord.update({
      where: { id },
      data: { outcome, details, resolvedAt: new Date() },
    });
  }

  private async escalate(id: string, hospitalId: string, correlationId: string, reason: string) {
    await this.audit.recordOperational({
      type: OperationalEventType.HUMAN_ESCALATION,
      severity: "CRITICAL",
      hospitalId,
      correlationId,
      metadata: { reconciliationRecordId: id, reason },
    });
    await this.audit.recordAudit({
      category: AuditEventCategory.INTEGRATION_OPERATION,
      action: "reconciliation.escalated",
      hospitalId,
      targetType: "ReconciliationRecord",
      targetId: id,
      correlationId,
      metadata: { reason },
    });
    const appointment = await this.prisma.reconciliationRecord.findUnique({ where: { id } });
    if (appointment) {
      await this.prisma.appointment.update({
        where: { id: appointment.appointmentId },
        data: { status: AppointmentStatus.RECONCILIATION_REQUIRED },
      });
    }
    return this.finish(id, ReconciliationOutcome.ESCALATED, { reason });
  }
}
