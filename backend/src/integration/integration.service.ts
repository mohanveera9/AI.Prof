import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  AppointmentStatus,
  AuditEventCategory,
  ExternalEntityType,
  IntegrationFailureType,
  IntegrationOperationStatus,
  IntegrationOperationType,
  OperationalEventType,
  ReconciliationOutcome,
} from "@ai-prof/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { IdentifierMappingService } from "./identifier-mapping.service";
import { ConnectorFactory } from "./connector.factory";
import { AppointmentExternalSync } from "./appointment-external-sync";
import { ConnectorError, isRetryableFailure } from "./connector.types";
import type { ExternalAppointmentRecord } from "./connector.types";
import type { IntegrationConnector } from "./connector.interface";
import { ReconciliationScheduler } from "../reconciliation/reconciliation.scheduler";

export interface PushAppointmentInput {
  hospitalId: string;
  appointmentId: string;
  patientId: string;
  doctorId: string;
  slotStart: Date;
  slotEnd: Date;
  idempotencyKey: string;
  correlationId: string;
}

export interface CreateVerifySyncOptions {
  maxRetries?: number;
  retryBaseMs?: number;
}

export type BookingIntegrationOutcome = "CONFIRMED" | "RECONCILIATION_REQUIRED" | "FAILED";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

@Injectable()
export class IntegrationService {
  private readonly logger = new Logger(IntegrationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mapping: IdentifierMappingService,
    private readonly connectors: ConnectorFactory,
    private readonly sync: AppointmentExternalSync,
    private readonly reconciliation: ReconciliationScheduler,
    private readonly config: ConfigService,
  ) {}

  defaultMaxRetries(): number {
    return Number(this.config.get("INTEGRATION_MAX_RETRIES") ?? 2);
  }

  defaultRetryBaseMs(): number {
    return Number(this.config.get("INTEGRATION_RETRY_BASE_MS") ?? 200);
  }

  /**
   * Push an internal PENDING appointment to the EHR, verify it exists, then
   * synchronize. On timeout/unknown outcome the appointment is marked
   * RECONCILIATION_REQUIRED and a reconciliation job is scheduled — never a
   * blind second create with a new idempotency key.
   */
  async createVerifyAndSync(
    input: PushAppointmentInput,
    options: CreateVerifySyncOptions = {},
  ): Promise<{ outcome: BookingIntegrationOutcome; appointment: { id: string; status: AppointmentStatus; externalAppointmentId: string | null } }> {
    const appointment = await this.prisma.appointment.findUnique({ where: { id: input.appointmentId } });
    if (!appointment) throw new NotFoundException("Appointment not found.");

    const existingOp = await this.prisma.integrationOperation.findFirst({
      where: { idempotencyKey: input.idempotencyKey, type: IntegrationOperationType.APPOINTMENT_CREATE },
      orderBy: { createdAt: "desc" },
    });
    if (
      existingOp &&
      (existingOp.status === IntegrationOperationStatus.SUCCESS || existingOp.status === IntegrationOperationStatus.VERIFIED) &&
      appointment.externalAppointmentId
    ) {
      return {
        outcome: "CONFIRMED",
        appointment: {
          id: appointment.id,
          status: appointment.status,
          externalAppointmentId: appointment.externalAppointmentId,
        },
      };
    }

    const { connector } = await this.connectors.forHospital(input.hospitalId);
    const ids = await this.resolveExternalIds(connector, input);

    const operation = existingOp
      ? existingOp
      : await this.prisma.integrationOperation.create({
          data: {
            hospitalId: input.hospitalId,
            appointmentId: input.appointmentId,
            type: IntegrationOperationType.APPOINTMENT_CREATE,
            status: IntegrationOperationStatus.PENDING,
            requestPayload: {
              ...ids,
              start: input.slotStart.toISOString(),
              end: input.slotEnd.toISOString(),
            },
            idempotencyKey: input.idempotencyKey,
            correlationId: input.correlationId,
          },
        });

    const maxRetries = options.maxRetries ?? this.defaultMaxRetries();
    const retryBaseMs = options.retryBaseMs ?? this.defaultRetryBaseMs();

    const push = await this.createWithRetry(connector, input, ids, operation.id, maxRetries, retryBaseMs);

    if (push.record) {
      const verified = await this.sync.verifyAndSync(
        connector,
        operation.id,
        input.appointmentId,
        push.record,
        input.correlationId,
      );
      if (verified.verified && verified.appointment) {
        return {
          outcome: "CONFIRMED",
          appointment: {
            id: verified.appointment.id,
            status: verified.appointment.status,
            externalAppointmentId: verified.appointment.externalAppointmentId,
          },
        };
      }
      return this.markReconciliationRequired(input, operation.id, IntegrationFailureType.UNKNOWN_OUTCOME, "Verification did not confirm the external appointment");
    }

    if (push.failureType && !isRetryableFailure(push.failureType)) {
      return this.markFailed(input, operation.id, push.failureType, push.message);
    }

    return this.markReconciliationRequired(
      input,
      operation.id,
      push.failureType ?? IntegrationFailureType.UNKNOWN_OUTCOME,
      push.message ?? "Unknown outcome creating external appointment",
    );
  }

  /**
   * Pushes a new time to the EHR for an already-confirmed appointment and
   * re-verifies. Internal slotStart/slotEnd must already be updated by the
   * caller (Appointments module) before this runs — this method only
   * touches the EHR-side record and the externalAppointmentId/status via
   * AppointmentExternalSync.
   *
   * Unlike create, a failed reschedule push does NOT fall into the
   * create-oriented reconciliation "safe retry" (that would blind-create a
   * duplicate). Instead it flags a reconciliation record for a human/admin
   * to reconcile the EHR-side time manually — a documented scope
   * simplification for this prototype.
   */
  async rescheduleAndSync(input: {
    hospitalId: string;
    appointmentId: string;
    externalAppointmentId: string;
    newSlotStart: Date;
    newSlotEnd: Date;
    correlationId: string;
  }): Promise<{ outcome: BookingIntegrationOutcome; appointment: { id: string; status: AppointmentStatus; externalAppointmentId: string | null } }> {
    const { connector } = await this.connectors.forHospital(input.hospitalId);
    const maxRetries = this.defaultMaxRetries();
    const retryBaseMs = this.defaultRetryBaseMs();

    const operation = await this.prisma.integrationOperation.create({
      data: {
        hospitalId: input.hospitalId,
        appointmentId: input.appointmentId,
        type: IntegrationOperationType.APPOINTMENT_UPDATE,
        status: IntegrationOperationStatus.PENDING,
        requestPayload: { start: input.newSlotStart.toISOString(), end: input.newSlotEnd.toISOString() },
        correlationId: input.correlationId,
      },
    });

    let lastError: ConnectorError | undefined;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) await sleep(retryBaseMs * 2 ** (attempt - 1));
      try {
        const record = await connector.updateAppointment(input.externalAppointmentId, {
          start: input.newSlotStart.toISOString(),
          end: input.newSlotEnd.toISOString(),
        });
        await this.prisma.integrationOperation.update({
          where: { id: operation.id },
          data: { status: IntegrationOperationStatus.SUCCESS, responsePayload: record as object, retryCount: attempt },
        });
        const verified = await this.sync.verifyAndSync(connector, operation.id, input.appointmentId, record, input.correlationId);
        if (verified.verified && verified.appointment) {
          return {
            outcome: "CONFIRMED",
            appointment: {
              id: verified.appointment.id,
              status: verified.appointment.status,
              externalAppointmentId: verified.appointment.externalAppointmentId,
            },
          };
        }
        lastError = new ConnectorError(IntegrationFailureType.UNKNOWN_OUTCOME, "Reschedule verification did not confirm the external appointment");
        break;
      } catch (err) {
        lastError = err instanceof ConnectorError ? err : new ConnectorError(IntegrationFailureType.UNKNOWN_OUTCOME, String(err));
        this.logger.warn(`EHR reschedule attempt ${attempt} failed (${lastError.failureType}): ${lastError.message}`);
        if (!isRetryableFailure(lastError.failureType)) break;
      }
    }

    const failureType = lastError?.failureType ?? IntegrationFailureType.UNKNOWN_OUTCOME;
    await this.prisma.integrationOperation.update({
      where: { id: operation.id },
      data: { status: IntegrationOperationStatus.UNKNOWN, failureType },
    });
    await this.prisma.reconciliationRecord.create({
      data: {
        hospitalId: input.hospitalId,
        appointmentId: input.appointmentId,
        outcome: ReconciliationOutcome.PENDING,
        details: { failureType, message: lastError?.message, operationId: operation.id, kind: "reschedule_desync" },
      },
    });
    await this.transition(input.appointmentId, AppointmentStatus.RECONCILIATION_REQUIRED, "reschedule_ehr_desync");
    await this.audit.recordOperational({
      type: OperationalEventType.RECONCILIATION_REQUIRED,
      severity: "WARNING",
      hospitalId: input.hospitalId,
      correlationId: input.correlationId,
      metadata: { appointmentId: input.appointmentId, failureType, operationId: operation.id, kind: "reschedule_desync" },
    });
    const appointment = await this.prisma.appointment.findUniqueOrThrow({ where: { id: input.appointmentId } });
    return {
      outcome: "RECONCILIATION_REQUIRED",
      appointment: { id: appointment.id, status: appointment.status, externalAppointmentId: appointment.externalAppointmentId },
    };
  }

  /**
   * Best-effort EHR-side cancellation. The patient's cancellation always
   * succeeds internally regardless of this outcome (the caller cancels the
   * internal appointment first) — we never make a patient wait on the
   * external system to honor their own cancellation request. A failure here
   * only raises a reconciliation record for admin follow-up.
   */
  async cancelBestEffort(input: {
    hospitalId: string;
    appointmentId: string;
    externalAppointmentId: string;
    correlationId: string;
  }): Promise<void> {
    const { connector } = await this.connectors.forHospital(input.hospitalId);
    const operation = await this.prisma.integrationOperation.create({
      data: {
        hospitalId: input.hospitalId,
        appointmentId: input.appointmentId,
        type: IntegrationOperationType.APPOINTMENT_CANCEL,
        status: IntegrationOperationStatus.PENDING,
        correlationId: input.correlationId,
      },
    });

    try {
      const record = await connector.cancelAppointment(input.externalAppointmentId);
      await this.prisma.integrationOperation.update({
        where: { id: operation.id },
        data: { status: IntegrationOperationStatus.SUCCESS, responsePayload: record as object },
      });
      await this.audit.recordAudit({
        category: AuditEventCategory.INTEGRATION_OPERATION,
        action: "appointment.ehr_cancelled",
        hospitalId: input.hospitalId,
        targetType: "Appointment",
        targetId: input.appointmentId,
        correlationId: input.correlationId,
      });
    } catch (err) {
      const failureType = err instanceof ConnectorError ? err.failureType : IntegrationFailureType.UNKNOWN_OUTCOME;
      await this.prisma.integrationOperation.update({
        where: { id: operation.id },
        data: { status: IntegrationOperationStatus.FAILED, failureType },
      });
      await this.prisma.reconciliationRecord.create({
        data: {
          hospitalId: input.hospitalId,
          appointmentId: input.appointmentId,
          outcome: ReconciliationOutcome.PENDING,
          details: { failureType, operationId: operation.id, kind: "cancel_desync" },
        },
      });
      await this.audit.recordOperational({
        type: OperationalEventType.RECONCILIATION_REQUIRED,
        severity: "WARNING",
        hospitalId: input.hospitalId,
        correlationId: input.correlationId,
        metadata: { appointmentId: input.appointmentId, failureType, operationId: operation.id, kind: "cancel_desync" },
      });
    }
  }

  /** Ad-hoc on-demand verification (e.g. patient/AI asking "is this really confirmed?"). */
  async verifyExternalAppointment(hospitalId: string, externalAppointmentId: string) {
    const { connector } = await this.connectors.forHospital(hospitalId);
    const result = await connector.verifyAppointment(externalAppointmentId);
    return { verified: Boolean(result.verified && result.exists), externalStatus: result.status };
  }

  /** Pulls the latest external record into internal state without a full create/verify cycle. */
  async pullLatestAndSync(hospitalId: string, appointmentId: string, externalAppointmentId: string, correlationId: string) {
    const { connector } = await this.connectors.forHospital(hospitalId);
    const record = await connector.retrieveAppointment(externalAppointmentId);
    if (!record) return null;
    return this.sync.synchronize(appointmentId, record, correlationId);
  }

  private async createWithRetry(
    connector: IntegrationConnector,
    input: PushAppointmentInput,
    ids: { externalPatientId: string; externalProviderId: string; externalFacilityId?: string },
    operationId: string,
    maxRetries: number,
    retryBaseMs: number,
  ): Promise<{ record?: ExternalAppointmentRecord; failureType?: IntegrationFailureType; message?: string }> {
    let lastError: ConnectorError | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        await this.audit.recordOperational({
          type: OperationalEventType.INTEGRATION_RETRY,
          hospitalId: input.hospitalId,
          correlationId: input.correlationId,
          metadata: { appointmentId: input.appointmentId, attempt, operationId },
        });
        await this.prisma.integrationOperation.update({
          where: { id: operationId },
          data: { retryCount: attempt },
        });
        await sleep(retryBaseMs * 2 ** (attempt - 1));
      }

      try {
        const record = await connector.createAppointment({
          ...ids,
          start: input.slotStart.toISOString(),
          end: input.slotEnd.toISOString(),
          idempotencyKey: input.idempotencyKey,
        });
        await this.prisma.integrationOperation.update({
          where: { id: operationId },
          data: {
            status: IntegrationOperationStatus.SUCCESS,
            failureType: null,
            responsePayload: record as object,
            retryCount: attempt,
          },
        });
        await this.transition(input.appointmentId, AppointmentStatus.SYNCHRONIZATION_PENDING, "ehr_create_succeeded");
        await this.mapping.upsert(input.hospitalId, ExternalEntityType.APPOINTMENT, input.appointmentId, record.id);
        await this.audit.recordOperational({
          type: OperationalEventType.INTEGRATION_OUTCOME,
          hospitalId: input.hospitalId,
          correlationId: input.correlationId,
          metadata: { appointmentId: input.appointmentId, status: "SUCCESS", externalId: record.id },
        });
        return { record };
      } catch (err) {
        lastError = err instanceof ConnectorError ? err : new ConnectorError(IntegrationFailureType.UNKNOWN_OUTCOME, String(err));
        this.logger.warn(
          `EHR create attempt ${attempt} failed (${lastError.failureType}): ${lastError.message}`,
        );
        if (!isRetryableFailure(lastError.failureType)) break;
      }
    }

    const failureType = lastError?.failureType ?? IntegrationFailureType.UNKNOWN_OUTCOME;
    const status =
      failureType === IntegrationFailureType.TIMEOUT || failureType === IntegrationFailureType.UNKNOWN_OUTCOME
        ? IntegrationOperationStatus.UNKNOWN
        : IntegrationOperationStatus.FAILED;

    await this.prisma.integrationOperation.update({
      where: { id: operationId },
      data: {
        status,
        failureType,
        responsePayload: lastError?.body ? (lastError.body as object) : { message: lastError?.message },
      },
    });
    await this.audit.recordOperational({
      type: OperationalEventType.INTEGRATION_OUTCOME,
      severity: "WARNING",
      hospitalId: input.hospitalId,
      correlationId: input.correlationId,
      metadata: { appointmentId: input.appointmentId, status, failureType },
    });
    return { failureType, message: lastError?.message };
  }

  async resolveExternalIds(connector: IntegrationConnector, input: PushAppointmentInput) {
    const [patient, doctor, hospital] = await Promise.all([
      this.prisma.patient.findUnique({ where: { id: input.patientId } }),
      this.prisma.doctor.findUnique({ where: { id: input.doctorId } }),
      this.prisma.hospital.findUnique({ where: { id: input.hospitalId } }),
    ]);
    if (!patient || !doctor || !hospital) {
      throw new ConnectorError(IntegrationFailureType.MAPPING_ERROR, "Cannot map identifiers; related records missing");
    }

    try {
      const externalPatientId = await this.mapping.getOrCreate(
        input.hospitalId,
        ExternalEntityType.PATIENT,
        patient.id,
        async () => {
          const created = await connector.createPatient({
            name: patient.name,
            dob: patient.dateOfBirth?.toISOString().slice(0, 10),
            phone: patient.phone ?? undefined,
          });
          await this.prisma.patient.update({ where: { id: patient.id }, data: { externalPatientId: created.id } });
          return created.id;
        },
      );
      const externalProviderId = await this.mapping.getOrCreate(
        input.hospitalId,
        ExternalEntityType.DOCTOR,
        doctor.id,
        async () => {
          const created = await connector.createProvider({ name: doctor.name });
          await this.prisma.doctor.update({ where: { id: doctor.id }, data: { externalProviderId: created.id } });
          return created.id;
        },
      );
      const externalFacilityId = await this.mapping.getOrCreate(
        input.hospitalId,
        ExternalEntityType.FACILITY,
        hospital.id,
        async () => {
          const created = await connector.createFacility({ name: hospital.name });
          return created.id;
        },
      );
      return { externalPatientId, externalProviderId, externalFacilityId };
    } catch (err) {
      if (err instanceof ConnectorError) throw err;
      throw new ConnectorError(IntegrationFailureType.MAPPING_ERROR, "Failed to resolve external identifiers", {
        cause: err,
      });
    }
  }

  private async markReconciliationRequired(
    input: PushAppointmentInput,
    operationId: string,
    failureType: IntegrationFailureType,
    message: string,
  ): Promise<{ outcome: BookingIntegrationOutcome; appointment: { id: string; status: AppointmentStatus; externalAppointmentId: string | null } }> {
    await this.transition(input.appointmentId, AppointmentStatus.RECONCILIATION_REQUIRED, message);
    const openReconId = await this.findOpenReconId(input.appointmentId);
    if (openReconId) {
      await this.prisma.reconciliationRecord.update({
        where: { id: openReconId },
        data: { details: { failureType, message, operationId } },
      });
    } else {
      await this.prisma.reconciliationRecord.create({
        data: {
          hospitalId: input.hospitalId,
          appointmentId: input.appointmentId,
          outcome: ReconciliationOutcome.PENDING,
          details: { failureType, message, operationId },
        },
      });
    }
    await this.audit.recordOperational({
      type: OperationalEventType.RECONCILIATION_REQUIRED,
      severity: "WARNING",
      hospitalId: input.hospitalId,
      correlationId: input.correlationId,
      metadata: { appointmentId: input.appointmentId, failureType, operationId },
    });
    await this.reconciliation.schedule(input.appointmentId);
    const appointment = await this.prisma.appointment.findUniqueOrThrow({ where: { id: input.appointmentId } });
    return {
      outcome: "RECONCILIATION_REQUIRED",
      appointment: {
        id: appointment.id,
        status: appointment.status,
        externalAppointmentId: appointment.externalAppointmentId,
      },
    };
  }

  private async markFailed(
    input: PushAppointmentInput,
    operationId: string,
    failureType: IntegrationFailureType,
    message?: string,
  ): Promise<{ outcome: BookingIntegrationOutcome; appointment: { id: string; status: AppointmentStatus; externalAppointmentId: string | null } }> {
    await this.transition(input.appointmentId, AppointmentStatus.FAILED, message ?? failureType);
    await this.audit.recordAudit({
      category: AuditEventCategory.INTEGRATION_OPERATION,
      action: "appointment.ehr_create_failed",
      hospitalId: input.hospitalId,
      targetType: "Appointment",
      targetId: input.appointmentId,
      correlationId: input.correlationId,
      metadata: { failureType, operationId },
    });
    const appointment = await this.prisma.appointment.findUniqueOrThrow({ where: { id: input.appointmentId } });
    return {
      outcome: "FAILED",
      appointment: {
        id: appointment.id,
        status: appointment.status,
        externalAppointmentId: appointment.externalAppointmentId,
      },
    };
  }

  private async findOpenReconId(appointmentId: string): Promise<string | null> {
    const open = await this.prisma.reconciliationRecord.findFirst({
      where: { appointmentId, outcome: ReconciliationOutcome.PENDING },
    });
    return open?.id ?? null;
  }

  private async transition(appointmentId: string, toStatus: AppointmentStatus, reason: string) {
    const current = await this.prisma.appointment.findUnique({ where: { id: appointmentId } });
    if (!current || current.status === toStatus) return current;
    const updated = await this.prisma.appointment.update({
      where: { id: appointmentId },
      data: { status: toStatus },
    });
    await this.prisma.appointmentStatusHistory.create({
      data: {
        appointmentId,
        fromStatus: current.status,
        toStatus,
        reason,
        actor: "system",
      },
    });
    return updated;
  }
}
