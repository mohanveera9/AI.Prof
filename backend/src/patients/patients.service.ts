import { Injectable, NotFoundException } from "@nestjs/common";
import { AuditEventCategory } from "@ai-prof/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { RequestUser } from "../common/types";
import { assertSelfPatient } from "../common/tenant";
import { UpdatePatientDto } from "./dto/update-patient.dto";
import { UpdatePreferencesDto } from "./dto/update-preferences.dto";

@Injectable()
export class PatientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async getById(patientId: string, requester: RequestUser) {
    assertSelfPatient(requester, patientId);
    const patient = await this.prisma.patient.findUnique({
      where: { id: patientId },
      include: { preference: true },
    });
    if (!patient) throw new NotFoundException("Patient not found.");

    await this.auditService.recordAudit({
      category: AuditEventCategory.PATIENT_DATA_ACCESS,
      action: "patient.profile_viewed",
      actorUserId: requester.userId,
      targetType: "Patient",
      targetId: patientId,
    });

    return patient;
  }

  async update(patientId: string, requester: RequestUser, dto: UpdatePatientDto) {
    assertSelfPatient(requester, patientId);
    return this.prisma.patient.update({
      where: { id: patientId },
      data: {
        name: dto.name,
        phone: dto.phone,
        dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : undefined,
        preferredLanguage: dto.preferredLanguage,
        communicationPreference: dto.communicationPreference,
      },
    });
  }

  /** Merges into existing preferences rather than replacing them wholesale. */
  async updatePreferences(patientId: string, requester: RequestUser, dto: UpdatePreferencesDto) {
    assertSelfPatient(requester, patientId);
    const existing = await this.prisma.userPreference.findUnique({ where: { patientId } });
    const merged = { ...((existing?.data as Record<string, unknown>) ?? {}), ...dto.data };
    return this.prisma.userPreference.upsert({
      where: { patientId },
      create: { patientId, data: merged as any },
      update: { data: merged as any },
    });
  }
}
