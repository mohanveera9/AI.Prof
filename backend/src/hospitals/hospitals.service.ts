import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { AuditEventCategory, HospitalStatus, UserRole } from "@ai-prof/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { AuthService } from "../auth/auth.service";
import { RequestUser } from "../common/types";
import { assertHospitalScope } from "../common/tenant";
import { slugify } from "../common/slugify";
import { RegisterHospitalDto } from "./dto/register-hospital.dto";
import { UpdateHospitalDto } from "./dto/update-hospital.dto";

@Injectable()
export class HospitalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    private readonly auditService: AuditService,
  ) {}

  async registerHospital(dto: RegisterHospitalDto) {
    const existingEmail = await this.prisma.user.findUnique({ where: { email: dto.adminEmail } });
    if (existingEmail) {
      throw new ConflictException("An account with this email already exists.");
    }

    const baseSlug = slugify(dto.hospitalName) || "hospital";
    let slug = baseSlug;
    let suffix = 1;
    while (await this.prisma.hospital.findUnique({ where: { slug } })) {
      slug = `${baseSlug}-${++suffix}`;
    }

    const passwordHash = await this.authService.hashPassword(dto.adminPassword);

    const hospital = await this.prisma.hospital.create({
      data: {
        name: dto.hospitalName,
        slug,
        addressLine: dto.addressLine,
        city: dto.city,
        contactEmail: dto.contactEmail,
        contactPhone: dto.contactPhone,
        status: HospitalStatus.DRAFT,
        staff: {
          create: {
            name: dto.adminName,
            user: {
              create: {
                email: dto.adminEmail,
                passwordHash,
                role: UserRole.HOSPITAL_ADMIN,
              },
            },
          },
        },
      },
      include: { staff: true },
    });

    await this.auditService.recordAudit({
      category: AuditEventCategory.ADMINISTRATIVE_ACTION,
      action: "hospital.registered",
      hospitalId: hospital.id,
      targetType: "Hospital",
      targetId: hospital.id,
    });

    const auth = await this.authService.authResultForUser(hospital.staff[0].userId);
    return { hospital, auth };
  }

  async submit(hospitalId: string, user: RequestUser) {
    const hospital = await this.getOwnedHospitalOrThrow(hospitalId, user);
    if (hospital.status !== HospitalStatus.DRAFT) {
      throw new BadRequestException(`Cannot submit a hospital in status ${hospital.status}.`);
    }
    const updated = await this.prisma.hospital.update({
      where: { id: hospitalId },
      data: { status: HospitalStatus.SUBMITTED, submittedAt: new Date() },
    });
    await this.auditService.recordAudit({
      category: AuditEventCategory.ADMINISTRATIVE_ACTION,
      action: "hospital.submitted",
      actorUserId: user.userId,
      hospitalId,
    });
    return updated;
  }

  async update(hospitalId: string, user: RequestUser, dto: UpdateHospitalDto) {
    await this.getOwnedHospitalOrThrow(hospitalId, user);
    const updated = await this.prisma.hospital.update({
      where: { id: hospitalId },
      data: {
        name: dto.name,
        addressLine: dto.addressLine,
        city: dto.city,
        contactEmail: dto.contactEmail,
        contactPhone: dto.contactPhone,
        operatingHours: dto.operatingHours as any,
      },
    });
    await this.auditService.recordAudit({
      category: AuditEventCategory.CONFIGURATION_CHANGE,
      action: "hospital.profile_updated",
      actorUserId: user.userId,
      hospitalId,
    });
    return updated;
  }

  async getById(hospitalId: string, user?: RequestUser) {
    const hospital = await this.prisma.hospital.findUnique({
      where: { id: hospitalId },
      include: { departments: true, specialties: true },
    });
    if (!hospital) throw new NotFoundException("Hospital not found.");

    if (hospital.status !== HospitalStatus.APPROVED) {
      if (!user) throw new ForbiddenException("This hospital is not publicly visible.");
      assertHospitalScope(user, hospitalId);
    }
    return hospital;
  }

  /** Public/patient-facing discovery — approved hospitals only. */
  async listApproved(query?: { city?: string; specialty?: string }) {
    return this.prisma.hospital.findMany({
      where: {
        status: HospitalStatus.APPROVED,
        city: query?.city ? { equals: query.city, mode: "insensitive" } : undefined,
        specialties: query?.specialty
          ? { some: { name: { equals: query.specialty, mode: "insensitive" } } }
          : undefined,
      },
      include: { departments: true, specialties: true },
    });
  }

  async listForPlatformAdmin(status?: HospitalStatus) {
    return this.prisma.hospital.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: "desc" },
      include: { staff: true },
    });
  }

  async markUnderReview(hospitalId: string, user: RequestUser) {
    const hospital = await this.requireHospital(hospitalId);
    if (hospital.status !== HospitalStatus.SUBMITTED) {
      throw new BadRequestException(`Cannot review a hospital in status ${hospital.status}.`);
    }
    return this.transitionAndAudit(hospitalId, user, HospitalStatus.UNDER_REVIEW, "hospital.under_review");
  }

  async approve(hospitalId: string, user: RequestUser) {
    const hospital = await this.requireHospital(hospitalId);
    if (![HospitalStatus.SUBMITTED, HospitalStatus.UNDER_REVIEW].includes(hospital.status as any)) {
      throw new BadRequestException(`Cannot approve a hospital in status ${hospital.status}.`);
    }
    const updated = await this.prisma.hospital.update({
      where: { id: hospitalId },
      data: { status: HospitalStatus.APPROVED, reviewedAt: new Date(), reviewedByUserId: user.userId, rejectionReason: null },
    });
    await this.prisma.healthcareSystemConnection.upsert({
      where: { hospitalId_connectorType: { hospitalId, connectorType: "MOCK_EHR" } },
      create: {
        hospitalId,
        connectorType: "MOCK_EHR",
        baseUrl: process.env.MOCK_EHR_BASE_URL ?? "http://localhost:4100",
        apiKeyRef: "MOCK_EHR_API_KEY",
        isEnabled: true,
      },
      update: {},
    });
    await this.auditService.recordAudit({
      category: AuditEventCategory.ADMINISTRATIVE_ACTION,
      action: "hospital.approved",
      actorUserId: user.userId,
      hospitalId,
    });
    return updated;
  }

  async reject(hospitalId: string, user: RequestUser, reason?: string) {
    const hospital = await this.requireHospital(hospitalId);
    if (![HospitalStatus.SUBMITTED, HospitalStatus.UNDER_REVIEW].includes(hospital.status as any)) {
      throw new BadRequestException(`Cannot reject a hospital in status ${hospital.status}.`);
    }
    const updated = await this.prisma.hospital.update({
      where: { id: hospitalId },
      data: { status: HospitalStatus.REJECTED, reviewedAt: new Date(), reviewedByUserId: user.userId, rejectionReason: reason },
    });
    await this.auditService.recordAudit({
      category: AuditEventCategory.ADMINISTRATIVE_ACTION,
      action: "hospital.rejected",
      actorUserId: user.userId,
      hospitalId,
      metadata: reason ? { reason } : undefined,
    });
    return updated;
  }

  async requestCorrections(hospitalId: string, user: RequestUser, reason?: string) {
    const hospital = await this.requireHospital(hospitalId);
    if (![HospitalStatus.SUBMITTED, HospitalStatus.UNDER_REVIEW].includes(hospital.status as any)) {
      throw new BadRequestException(`Cannot request corrections for a hospital in status ${hospital.status}.`);
    }
    const updated = await this.prisma.hospital.update({
      where: { id: hospitalId },
      data: { status: HospitalStatus.DRAFT, rejectionReason: reason ?? "Corrections requested by platform admin." },
    });
    await this.auditService.recordAudit({
      category: AuditEventCategory.ADMINISTRATIVE_ACTION,
      action: "hospital.corrections_requested",
      actorUserId: user.userId,
      hospitalId,
      metadata: reason ? { reason } : undefined,
    });
    return updated;
  }

  async suspend(hospitalId: string, user: RequestUser, reason?: string) {
    await this.requireHospital(hospitalId);
    return this.transitionAndAudit(hospitalId, user, HospitalStatus.SUSPENDED, "hospital.suspended", reason);
  }

  async reactivate(hospitalId: string, user: RequestUser) {
    const hospital = await this.requireHospital(hospitalId);
    if (hospital.status !== HospitalStatus.SUSPENDED) {
      throw new BadRequestException("Only a suspended hospital can be reactivated.");
    }
    return this.transitionAndAudit(hospitalId, user, HospitalStatus.APPROVED, "hospital.reactivated");
  }

  // ---- Departments ----

  async addDepartment(hospitalId: string, user: RequestUser, name: string) {
    await this.getOwnedHospitalOrThrow(hospitalId, user);
    return this.prisma.department.create({ data: { hospitalId, name } });
  }

  async listDepartments(hospitalId: string) {
    return this.prisma.department.findMany({ where: { hospitalId } });
  }

  async removeDepartment(hospitalId: string, user: RequestUser, departmentId: string) {
    await this.getOwnedHospitalOrThrow(hospitalId, user);
    await this.prisma.department.delete({ where: { id: departmentId } });
  }

  // ---- Specialties ----

  async addSpecialty(hospitalId: string, user: RequestUser, name: string) {
    await this.getOwnedHospitalOrThrow(hospitalId, user);
    return this.prisma.specialty.create({ data: { hospitalId, name } });
  }

  async listSpecialties(hospitalId: string) {
    return this.prisma.specialty.findMany({ where: { hospitalId } });
  }

  async removeSpecialty(hospitalId: string, user: RequestUser, specialtyId: string) {
    await this.getOwnedHospitalOrThrow(hospitalId, user);
    await this.prisma.specialty.delete({ where: { id: specialtyId } });
  }

  // ---- Helpers ----

  private async requireHospital(hospitalId: string) {
    const hospital = await this.prisma.hospital.findUnique({ where: { id: hospitalId } });
    if (!hospital) throw new NotFoundException("Hospital not found.");
    return hospital;
  }

  private async getOwnedHospitalOrThrow(hospitalId: string, user: RequestUser) {
    const hospital = await this.requireHospital(hospitalId);
    assertHospitalScope(user, hospitalId);
    return hospital;
  }

  private async transitionAndAudit(
    hospitalId: string,
    user: RequestUser,
    status: HospitalStatus,
    action: string,
    reason?: string,
  ) {
    const updated = await this.prisma.hospital.update({ where: { id: hospitalId }, data: { status } });
    await this.auditService.recordAudit({
      category: AuditEventCategory.ADMINISTRATIVE_ACTION,
      action,
      actorUserId: user.userId,
      hospitalId,
      metadata: reason ? { reason } : undefined,
    });
    return updated;
  }
}
