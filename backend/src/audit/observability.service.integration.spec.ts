import { Test } from "@nestjs/testing";
import { ConfigModule } from "@nestjs/config";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { nanoid } from "nanoid";
import {
  AppointmentStatus,
  AuditEventCategory,
  DoctorStatus,
  HospitalStatus,
  IntegrationOperationStatus,
  IntegrationOperationType,
  OperationalEventType,
  ReconciliationOutcome,
  UserRole,
} from "@ai-prof/shared";
import { PrismaModule } from "../prisma/prisma.module";
import { PrismaService } from "../prisma/prisma.service";
import { AuditModule } from "./audit.module";
import { ObservabilityService } from "./observability.service";
import { RequestUser } from "../common/types";

describe("ObservabilityService (integration)", () => {
  let moduleRef: import("@nestjs/testing").TestingModule;
  let prisma: PrismaService;
  let observability: ObservabilityService;

  const suffix = nanoid(6);
  const correlationId = `corr-obs-${suffix}`;
  let hospitalId: string;
  let otherHospitalId: string;
  let doctorId: string;
  let calendarId: string;
  let patientId: string;
  let appointmentId: string;
  let admin: RequestUser;
  let otherAdmin: RequestUser;
  let platform: RequestUser;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, AuditModule],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    observability = moduleRef.get(ObservabilityService);

    const hospital = await prisma.hospital.create({
      data: { name: `Obs Hospital ${suffix}`, slug: `obs-hosp-${suffix}`, status: HospitalStatus.APPROVED },
    });
    hospitalId = hospital.id;
    const other = await prisma.hospital.create({
      data: { name: `Obs Other ${suffix}`, slug: `obs-other-${suffix}`, status: HospitalStatus.APPROVED },
    });
    otherHospitalId = other.id;

    const doctorUser = await prisma.user.create({
      data: { email: `doc-obs-${suffix}@test.local`, passwordHash: "x", role: UserRole.DOCTOR },
    });
    const doctor = await prisma.doctor.create({
      data: { userId: doctorUser.id, hospitalId, name: "Dr. Obs", status: DoctorStatus.ACTIVE },
    });
    doctorId = doctor.id;
    const calendar = await prisma.calendar.create({ data: { doctorId, hospitalId } });
    calendarId = calendar.id;

    const adminUser = await prisma.user.create({
      data: { email: `admin-obs-${suffix}@test.local`, passwordHash: "x", role: UserRole.HOSPITAL_ADMIN },
    });
    await prisma.hospitalStaff.create({ data: { userId: adminUser.id, hospitalId, name: "Admin Obs" } });
    admin = { userId: adminUser.id, role: UserRole.HOSPITAL_ADMIN, hospitalId };

    const otherAdminUser = await prisma.user.create({
      data: { email: `admin-obs2-${suffix}@test.local`, passwordHash: "x", role: UserRole.HOSPITAL_ADMIN },
    });
    await prisma.hospitalStaff.create({ data: { userId: otherAdminUser.id, hospitalId: otherHospitalId, name: "Admin Other" } });
    otherAdmin = { userId: otherAdminUser.id, role: UserRole.HOSPITAL_ADMIN, hospitalId: otherHospitalId };

    const platformUser = await prisma.user.create({
      data: { email: `plat-obs-${suffix}@test.local`, passwordHash: "x", role: UserRole.PLATFORM_ADMIN },
    });
    platform = { userId: platformUser.id, role: UserRole.PLATFORM_ADMIN };

    const patUser = await prisma.user.create({
      data: { email: `pat-obs-${suffix}@test.local`, passwordHash: "x", role: UserRole.PATIENT },
    });
    const patient = await prisma.patient.create({ data: { userId: patUser.id, name: "Obs Patient" } });
    patientId = patient.id;

    const appointment = await prisma.appointment.create({
      data: {
        hospitalId,
        doctorId,
        calendarId,
        patientId,
        slotStart: new Date("2031-01-07T09:00:00.000Z"),
        slotEnd: new Date("2031-01-07T09:30:00.000Z"),
        status: AppointmentStatus.RECONCILIATION_REQUIRED,
        idempotencyKey: `obs-${suffix}`,
        correlationId,
      },
    });
    appointmentId = appointment.id;

    await prisma.appointmentStatusHistory.create({
      data: {
        appointmentId,
        fromStatus: AppointmentStatus.PENDING,
        toStatus: AppointmentStatus.RECONCILIATION_REQUIRED,
        actor: "system",
        reason: "timeout",
      },
    });

    await prisma.auditEvent.create({
      data: {
        category: AuditEventCategory.APPOINTMENT_OPERATION,
        action: "appointment.created",
        actorUserId: admin.userId,
        hospitalId,
        targetType: "Appointment",
        targetId: appointmentId,
        correlationId,
      },
    });
    await prisma.auditEvent.create({
      data: {
        category: AuditEventCategory.ADMINISTRATIVE_ACTION,
        action: "hospital.secret",
        hospitalId: otherHospitalId,
        targetType: "Hospital",
        targetId: otherHospitalId,
      },
    });
    await prisma.operationalEvent.create({
      data: {
        type: OperationalEventType.RECONCILIATION_REQUIRED,
        severity: "WARNING",
        hospitalId,
        correlationId,
      },
    });
    await prisma.operationalEvent.create({
      data: {
        type: OperationalEventType.HUMAN_ESCALATION,
        severity: "CRITICAL",
        hospitalId,
        correlationId,
      },
    });
    await prisma.integrationOperation.create({
      data: {
        hospitalId,
        appointmentId,
        type: IntegrationOperationType.APPOINTMENT_CREATE,
        status: IntegrationOperationStatus.UNKNOWN,
        correlationId,
      },
    });
    await prisma.reconciliationRecord.create({
      data: {
        hospitalId,
        appointmentId,
        outcome: ReconciliationOutcome.PENDING,
        attempts: 1,
      },
    });
    await prisma.capabilityExecution.create({
      data: {
        capabilityName: "book_appointment",
        input: {},
        success: true,
        latencyMs: 40,
        correlationId,
      },
    });
  });

  afterAll(async () => {
    await prisma.capabilityExecution.deleteMany({ where: { correlationId } });
    await prisma.reconciliationRecord.deleteMany({ where: { hospitalId: { in: [hospitalId, otherHospitalId] } } });
    await prisma.integrationOperation.deleteMany({ where: { hospitalId: { in: [hospitalId, otherHospitalId] } } });
    await prisma.operationalEvent.deleteMany({ where: { hospitalId: { in: [hospitalId, otherHospitalId] } } });
    await prisma.auditEvent.deleteMany({ where: { hospitalId: { in: [hospitalId, otherHospitalId] } } });
    await prisma.appointmentStatusHistory.deleteMany({ where: { appointmentId } });
    await prisma.appointment.deleteMany({ where: { hospitalId } });
    await prisma.calendar.deleteMany({ where: { hospitalId } });
    await prisma.doctor.deleteMany({ where: { hospitalId } });
    await prisma.hospitalStaff.deleteMany({ where: { hospitalId: { in: [hospitalId, otherHospitalId] } } });
    await prisma.patient.delete({ where: { id: patientId } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { email: { endsWith: `${suffix}@test.local` } } });
    await prisma.hospital.deleteMany({ where: { id: { in: [hospitalId, otherHospitalId] } } });
    await moduleRef.close();
  });

  it("hospital admins cannot read another hospital's audit events", async () => {
    const mine = await observability.listAudit(admin, {});
    expect(mine.some((row) => row.action === "appointment.created")).toBe(true);
    expect(mine.some((row) => row.action === "hospital.secret")).toBe(false);

    await expect(observability.listAudit(admin, { hospitalId: otherHospitalId })).rejects.toBeInstanceOf(ForbiddenException);

    const other = await observability.listAudit(otherAdmin, {});
    expect(other.some((row) => row.action === "hospital.secret")).toBe(true);
    expect(other.some((row) => row.action === "appointment.created")).toBe(false);
  });

  it("platform admin can see both hospitals and scoped metrics", async () => {
    const all = await observability.listAudit(platform, {});
    expect(all.some((row) => row.action === "appointment.created")).toBe(true);
    expect(all.some((row) => row.action === "hospital.secret")).toBe(true);

    const metrics = await observability.metrics(admin);
    expect(metrics.appointments.total).toBeGreaterThanOrEqual(1);
    expect(metrics.appointments.reconciliationRequired).toBeGreaterThanOrEqual(1);
    expect(metrics.openReconciliation).toBeGreaterThanOrEqual(1);
    expect(metrics.escalations).toBeGreaterThanOrEqual(1);
    expect(metrics.hospitals).toBeUndefined();

    const platformMetrics = await observability.metrics(platform);
    expect(platformMetrics.hospitals).toBeDefined();
  });

  it("traces a booking across audit, integration, capabilities, and appointment history", async () => {
    const traced = await observability.trace(admin, correlationId);
    expect(traced.appointments[0]?.id).toBe(appointmentId);
    expect(traced.auditEvents.some((row) => row.action === "appointment.created")).toBe(true);
    expect(traced.integrationOperations).toHaveLength(1);
    expect(traced.capabilityExecutions[0]?.capabilityName).toBe("book_appointment");
    expect(traced.timeline.length).toBeGreaterThan(1);

    await expect(observability.trace(otherAdmin, correlationId)).rejects.toBeInstanceOf(NotFoundException);

    const escalations = await observability.listEscalations(admin);
    expect(escalations.reconciliation).toHaveLength(1);
    expect(escalations.operational.some((row) => row.type === OperationalEventType.HUMAN_ESCALATION)).toBe(true);
  });
});
