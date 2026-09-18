import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { AuditEventCategory, DoctorStatus, HospitalStatus, UserRole } from "@ai-prof/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuthService } from "../auth/auth.service";
import { AuditService } from "../audit/audit.service";
import { SchedulingService } from "../scheduling/scheduling.service";
import { RequestUser } from "../common/types";
import { assertHospitalScope, assertSelfDoctor } from "../common/tenant";
import { CreateDoctorDto } from "./dto/create-doctor.dto";
import { UpdateDoctorDto } from "./dto/update-doctor.dto";

@Injectable()
export class DoctorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    private readonly auditService: AuditService,
    private readonly schedulingService: SchedulingService,
  ) {}

  async create(hospitalId: string, user: RequestUser, dto: CreateDoctorDto) {
    assertHospitalScope(user, hospitalId);
    const hospital = await this.prisma.hospital.findUnique({ where: { id: hospitalId } });
    if (!hospital) throw new NotFoundException("Hospital not found.");

    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException("An account with this email already exists.");

    const passwordHash = await this.authService.hashPassword(dto.password);

    const doctor = await this.prisma.$transaction(async (tx) => {
      const doctorUser = await tx.user.create({
        data: { email: dto.email, passwordHash, role: UserRole.DOCTOR },
      });

      return tx.doctor.create({
        data: {
          userId: doctorUser.id,
          hospitalId,
          departmentId: dto.departmentId,
          name: dto.name,
          invitedEmail: dto.email,
          qualifications: dto.qualifications,
          experienceYears: dto.experienceYears,
          languages: dto.languages ?? [],
          consultationTypes: dto.consultationTypes ?? [],
          defaultAppointmentDurationMinutes: dto.defaultAppointmentDurationMinutes ?? 30,
          externalProviderId: dto.externalProviderId,
          status: DoctorStatus.INVITED,
          specialties: dto.specialtyIds?.length
            ? { create: dto.specialtyIds.map((specialtyId) => ({ specialtyId })) }
            : undefined,
        },
        include: { specialties: true },
      });
    });

    await this.schedulingService.createCalendarForDoctor(doctor.id, hospitalId);

    await this.auditService.recordAudit({
      category: AuditEventCategory.ADMINISTRATIVE_ACTION,
      action: "doctor.created",
      actorUserId: user.userId,
      hospitalId,
      targetType: "Doctor",
      targetId: doctor.id,
    });

    return doctor;
  }

  async listForHospital(hospitalId: string, requester?: RequestUser) {
    if (requester && (requester.role === UserRole.HOSPITAL_ADMIN || requester.role === UserRole.DOCTOR)) {
      assertHospitalScope(requester, hospitalId);
    }
    const canSeeAllStatuses =
      requester &&
      (requester.role === UserRole.PLATFORM_ADMIN ||
        ((requester.role === UserRole.HOSPITAL_ADMIN || requester.role === UserRole.DOCTOR) &&
          requester.hospitalId === hospitalId));

    return this.prisma.doctor.findMany({
      where: { hospitalId, status: canSeeAllStatuses ? undefined : DoctorStatus.ACTIVE },
      include: { specialties: { include: { specialty: true } }, department: true },
      orderBy: { name: "asc" },
    });
  }

  /** Cross-hospital discovery for patients/AI (PRD §9 search_doctors) — active doctors at approved hospitals only. */
  async search(filters: {
    hospitalId?: string;
    specialty?: string;
    department?: string;
    query?: string;
    language?: string;
    limit?: number;
  }) {
    return this.prisma.doctor.findMany({
      where: {
        hospitalId: filters.hospitalId,
        status: DoctorStatus.ACTIVE,
        hospital: { status: HospitalStatus.APPROVED },
        department: filters.department ? { name: { equals: filters.department, mode: "insensitive" } } : undefined,
        specialties: filters.specialty
          ? { some: { specialty: { name: { equals: filters.specialty, mode: "insensitive" } } } }
          : undefined,
        languages: filters.language ? { has: filters.language } : undefined,
        name: filters.query ? { contains: filters.query, mode: "insensitive" } : undefined,
      },
      include: { specialties: { include: { specialty: true } }, department: true, hospital: true },
      take: filters.limit ?? 5,
      orderBy: { name: "asc" },
    });
  }

  async getById(doctorId: string) {
    const doctor = await this.prisma.doctor.findUnique({
      where: { id: doctorId },
      include: { specialties: { include: { specialty: true } }, department: true, hospital: true },
    });
    if (!doctor) throw new NotFoundException("Doctor not found.");
    return doctor;
  }

  async update(doctorId: string, user: RequestUser, dto: UpdateDoctorDto) {
    const doctor = await this.getById(doctorId);
    if (user.role === UserRole.DOCTOR) {
      assertSelfDoctor(user, doctorId);
    } else {
      assertHospitalScope(user, doctor.hospitalId);
    }

    const updated = await this.prisma.doctor.update({
      where: { id: doctorId },
      data: {
        name: dto.name,
        departmentId: dto.departmentId,
        qualifications: dto.qualifications,
        experienceYears: dto.experienceYears,
        languages: dto.languages,
        consultationTypes: dto.consultationTypes,
        defaultAppointmentDurationMinutes: dto.defaultAppointmentDurationMinutes,
        photoUrl: dto.photoUrl,
      },
    });

    if (dto.specialtyIds) {
      await this.prisma.doctorSpecialty.deleteMany({ where: { doctorId } });
      if (dto.specialtyIds.length) {
        await this.prisma.doctorSpecialty.createMany({
          data: dto.specialtyIds.map((specialtyId) => ({ doctorId, specialtyId })),
        });
      }
    }

    await this.auditService.recordAudit({
      category: AuditEventCategory.CONFIGURATION_CHANGE,
      action: "doctor.updated",
      actorUserId: user.userId,
      hospitalId: doctor.hospitalId,
      targetType: "Doctor",
      targetId: doctorId,
    });

    return updated;
  }

  async activate(doctorId: string, user: RequestUser) {
    const doctor = await this.getById(doctorId);
    assertHospitalScope(user, doctor.hospitalId);

    if (doctor.hospital.status !== HospitalStatus.APPROVED) {
      throw new BadRequestException("Only doctors at an approved hospital can be activated.");
    }

    return this.transition(doctor.id, user, DoctorStatus.ACTIVE, "doctor.activated");
  }

  async suspend(doctorId: string, user: RequestUser) {
    const doctor = await this.getById(doctorId);
    assertHospitalScope(user, doctor.hospitalId);
    return this.transition(doctor.id, user, DoctorStatus.SUSPENDED, "doctor.suspended");
  }

  async deactivate(doctorId: string, user: RequestUser) {
    const doctor = await this.getById(doctorId);
    assertHospitalScope(user, doctor.hospitalId);
    return this.transition(doctor.id, user, DoctorStatus.INACTIVE, "doctor.deactivated");
  }

  async reactivate(doctorId: string, user: RequestUser) {
    const doctor = await this.getById(doctorId);
    assertHospitalScope(user, doctor.hospitalId);
    if (doctor.hospital.status !== HospitalStatus.APPROVED) {
      throw new BadRequestException("Only doctors at an approved hospital can be reactivated.");
    }
    return this.transition(doctor.id, user, DoctorStatus.ACTIVE, "doctor.reactivated");
  }

  private async transition(doctorId: string, user: RequestUser, status: DoctorStatus, action: string) {
    const updated = await this.prisma.doctor.update({ where: { id: doctorId }, data: { status } });
    await this.auditService.recordAudit({
      category: AuditEventCategory.ADMINISTRATIVE_ACTION,
      action,
      actorUserId: user.userId,
      hospitalId: updated.hospitalId,
      targetType: "Doctor",
      targetId: doctorId,
    });
    return updated;
  }
}
