import { Injectable, NotFoundException } from "@nestjs/common";
import {
  AppointmentStatus,
  AuditEventCategory,
  ExternalEntityType,
  IntegrationOperationStatus,
} from "@ai-prof/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { IdentifierMappingService } from "./identifier-mapping.service";
import type { IntegrationConnector } from "./connector.interface";
import type { ExternalAppointmentRecord } from "./connector.types";

/**
 * Verify against the external system, then copy the verified identity into
 * internal appointment state. Confirmation is not allowed without this step
 * (PRD §12).
 */
@Injectable()
export class AppointmentExternalSync {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mapping: IdentifierMappingService,
  ) {}

  async verify(
    connector: IntegrationConnector,
    integrationOperationId: string,
    externalId: string,
  ): Promise<{ verified: boolean; externalStatus?: string; appointment?: ExternalAppointmentRecord }> {
    const result = await connector.verifyAppointment(externalId);
    await this.prisma.integrationVerification.create({
      data: {
        integrationOperationId,
        verified: result.verified && result.exists,
        externalStatus: result.status,
      },
    });
    if (result.verified && result.exists) {
      await this.prisma.integrationOperation.update({
        where: { id: integrationOperationId },
        data: { status: IntegrationOperationStatus.VERIFIED },
      });
    }
    return {
      verified: Boolean(result.verified && result.exists),
      externalStatus: result.status,
      appointment: result.appointment,
    };
  }

  async synchronize(
    appointmentId: string,
    external: ExternalAppointmentRecord,
    correlationId: string,
  ) {
    const appointment = await this.prisma.appointment.findUnique({ where: { id: appointmentId } });
    if (!appointment) throw new NotFoundException("Appointment not found.");

    await this.mapping.upsert(appointment.hospitalId, ExternalEntityType.APPOINTMENT, appointment.id, external.id);

    const nextStatus = this.mapExternalStatus(external.status, appointment.status);
    const updated = await this.prisma.appointment.update({
      where: { id: appointmentId },
      data: {
        externalAppointmentId: external.id,
        status: nextStatus,
      },
    });

    if (nextStatus !== appointment.status) {
      await this.prisma.appointmentStatusHistory.create({
        data: {
          appointmentId,
          fromStatus: appointment.status,
          toStatus: nextStatus,
          reason: "external_verification_sync",
          actor: "system",
        },
      });
    }

    await this.audit.recordAudit({
      category: AuditEventCategory.INTEGRATION_OPERATION,
      action: "appointment.synchronized",
      hospitalId: appointment.hospitalId,
      targetType: "Appointment",
      targetId: appointmentId,
      correlationId,
      metadata: { externalAppointmentId: external.id, externalStatus: external.status },
    });

    return updated;
  }

  async verifyAndSync(
    connector: IntegrationConnector,
    integrationOperationId: string,
    appointmentId: string,
    external: ExternalAppointmentRecord,
    correlationId: string,
  ) {
    const verification = await this.verify(connector, integrationOperationId, external.id);
    if (!verification.verified) {
      return { verified: false as const, appointment: null };
    }
    const synced = await this.synchronize(appointmentId, verification.appointment ?? external, correlationId);
    return { verified: true as const, appointment: synced };
  }

  private mapExternalStatus(
    externalStatus: ExternalAppointmentRecord["status"],
    current: AppointmentStatus,
  ): AppointmentStatus {
    if (externalStatus === "cancelled") return AppointmentStatus.CANCELLED;
    if (externalStatus === "updated") return AppointmentStatus.CONFIRMED;
    if (externalStatus === "booked") return AppointmentStatus.CONFIRMED;
    return current;
  }
}
