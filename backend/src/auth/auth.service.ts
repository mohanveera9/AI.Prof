import { ConflictException, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcrypt";
import { AuditEventCategory, DoctorStatus, UserRole } from "@ai-prof/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { RequestUser } from "../common/types";
import { RegisterPatientDto } from "./dto/register-patient.dto";
import { LoginDto } from "./dto/login.dto";

const SALT_ROUNDS = 10;

export interface AuthResult {
  accessToken: string;
  user: {
    id: string;
    email: string;
    role: UserRole;
    name: string;
    hospitalId?: string;
    doctorId?: string;
    patientId?: string;
  };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly audit: AuditService,
  ) {}

  async registerPatient(dto: RegisterPatientDto): Promise<AuthResult> {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) {
      throw new ConflictException("An account with this email already exists.");
    }

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash,
        role: UserRole.PATIENT,
        patient: {
          create: {
            name: dto.name,
            phone: dto.phone,
            preferredLanguage: dto.preferredLanguage,
            preference: { create: { data: {} } },
          },
        },
      },
      include: { patient: true },
    });

    return this.buildAuthResult(user.id);
  }

  async login(dto: LoginDto): Promise<AuthResult> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user || !user.isActive) {
      throw new UnauthorizedException("Invalid credentials.");
    }

    const passwordMatches = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException("Invalid credentials.");
    }

    // First successful login moves an invited doctor into the active state
    // (PRD §6 doctor lifecycle: Invited -> Active -> Inactive/Suspended).
    if (user.role === UserRole.DOCTOR) {
      const doctor = await this.prisma.doctor.findUnique({ where: { userId: user.id } });
      if (doctor && doctor.status === DoctorStatus.INVITED) {
        await this.prisma.doctor.update({ where: { id: doctor.id }, data: { status: DoctorStatus.ACTIVE } });
      }
    }

    const requestUser = await this.loadRequestUser(user.id);
    await this.audit.recordAudit({
      category: AuditEventCategory.LOGIN_ACCESS,
      action: "auth.login",
      actorUserId: user.id,
      hospitalId: requestUser.hospitalId,
      targetType: "User",
      targetId: user.id,
    });

    return this.buildAuthResult(user.id);
  }

  /** Rebuilds the full RequestUser fresh from the DB — never trusts a cached JWT claim for tenant scoping. */
  async loadRequestUser(userId: string): Promise<RequestUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { hospitalStaff: true, doctor: true, patient: true },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException("Account not found or inactive.");
    }

    return {
      userId: user.id,
      role: user.role,
      hospitalId: user.hospitalStaff?.hospitalId ?? user.doctor?.hospitalId ?? undefined,
      doctorId: user.doctor?.id ?? undefined,
      patientId: user.patient?.id ?? undefined,
    };
  }

  /** Public wrapper so other modules (e.g. hospital/doctor onboarding) can mint a session after creating a user. */
  async authResultForUser(userId: string): Promise<AuthResult> {
    return this.buildAuthResult(userId);
  }

  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, SALT_ROUNDS);
  }

  private async buildAuthResult(userId: string): Promise<AuthResult> {
    const requestUser = await this.loadRequestUser(userId);
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { hospitalStaff: true, doctor: true, patient: true },
    });

    const accessToken = this.jwtService.sign({ sub: user.id });
    const name = user.hospitalStaff?.name ?? user.doctor?.name ?? user.patient?.name ?? user.email;

    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        name,
        hospitalId: requestUser.hospitalId,
        doctorId: requestUser.doctorId,
        patientId: requestUser.patientId,
      },
    };
  }
}
