import { Test } from "@nestjs/testing";
import { ConfigModule } from "@nestjs/config";
import { ForbiddenException } from "@nestjs/common";
import { nanoid } from "nanoid";
import { AppointmentStatus, DoctorStatus, HospitalStatus, QuestionFieldType, UserRole } from "@ai-prof/shared";
import { PrismaModule } from "../prisma/prisma.module";
import { PrismaService } from "../prisma/prisma.service";
import { AuditModule } from "../audit/audit.module";
import { AppointmentsModule } from "../appointments/appointments.module";
import { AppointmentsService } from "../appointments/appointments.service";
import { QuestionnairesModule } from "../questionnaires/questionnaires.module";
import { QuestionnairesService } from "../questionnaires/questionnaires.service";
import { DoctorsModule } from "../doctors/doctors.module";
import { DoctorsService } from "../doctors/doctors.service";
import { ObservabilityService } from "../audit/observability.service";
import { RequestUser } from "../common/types";

/**
 * Chunk 12: Hospital A must never read Hospital B's private data.
 * Covers appointments, questionnaires, doctors (staff listing), and observability.
 */
describe("tenant isolation (integration)", () => {
  let moduleRef: import("@nestjs/testing").TestingModule;
  let prisma: PrismaService;
  let appointments: AppointmentsService;
  let questionnaires: QuestionnairesService;
  let doctors: DoctorsService;
  let observability: ObservabilityService;

  const suffix = nanoid(6);
  let hospitalA: string;
  let hospitalB: string;
  let doctorAId: string;
  let doctorBId: string;
  let calendarA: string;
  let calendarB: string;
  let patientAId: string;
  let appointmentBId: string;
  let adminA: RequestUser;
  let adminB: RequestUser;
  let doctorA: RequestUser;
  let patientA: RequestUser;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        AuditModule,
        AppointmentsModule,
        QuestionnairesModule,
        DoctorsModule,
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    appointments = moduleRef.get(AppointmentsService);
    questionnaires = moduleRef.get(QuestionnairesService);
    doctors = moduleRef.get(DoctorsService);
    observability = moduleRef.get(ObservabilityService);

    const a = await prisma.hospital.create({
      data: { name: `Iso A ${suffix}`, slug: `iso-a-${suffix}`, status: HospitalStatus.APPROVED },
    });
    const b = await prisma.hospital.create({
      data: { name: `Iso B ${suffix}`, slug: `iso-b-${suffix}`, status: HospitalStatus.APPROVED },
    });
    hospitalA = a.id;
    hospitalB = b.id;

    const docUserA = await prisma.user.create({
      data: { email: `doc-iso-a-${suffix}@test.local`, passwordHash: "x", role: UserRole.DOCTOR },
    });
    const docA = await prisma.doctor.create({
      data: { userId: docUserA.id, hospitalId: hospitalA, name: "Dr. Iso A", status: DoctorStatus.ACTIVE },
    });
    doctorAId = docA.id;
    doctorA = { userId: docUserA.id, role: UserRole.DOCTOR, hospitalId: hospitalA, doctorId: doctorAId };
    const calA = await prisma.calendar.create({ data: { doctorId: doctorAId, hospitalId: hospitalA } });
    calendarA = calA.id;

    const docUserB = await prisma.user.create({
      data: { email: `doc-iso-b-${suffix}@test.local`, passwordHash: "x", role: UserRole.DOCTOR },
    });
    const docB = await prisma.doctor.create({
      data: { userId: docUserB.id, hospitalId: hospitalB, name: "Dr. Iso B", status: DoctorStatus.ACTIVE },
    });
    doctorBId = docB.id;
    const calB = await prisma.calendar.create({ data: { doctorId: doctorBId, hospitalId: hospitalB } });
    calendarB = calB.id;

    const adminUserA = await prisma.user.create({
      data: { email: `admin-iso-a-${suffix}@test.local`, passwordHash: "x", role: UserRole.HOSPITAL_ADMIN },
    });
    await prisma.hospitalStaff.create({ data: { userId: adminUserA.id, hospitalId: hospitalA, name: "Admin Iso A" } });
    adminA = { userId: adminUserA.id, role: UserRole.HOSPITAL_ADMIN, hospitalId: hospitalA };

    const adminUserB = await prisma.user.create({
      data: { email: `admin-iso-b-${suffix}@test.local`, passwordHash: "x", role: UserRole.HOSPITAL_ADMIN },
    });
    await prisma.hospitalStaff.create({ data: { userId: adminUserB.id, hospitalId: hospitalB, name: "Admin Iso B" } });
    adminB = { userId: adminUserB.id, role: UserRole.HOSPITAL_ADMIN, hospitalId: hospitalB };

    const patUserA = await prisma.user.create({
      data: { email: `pat-iso-a-${suffix}@test.local`, passwordHash: "x", role: UserRole.PATIENT },
    });
    const patA = await prisma.patient.create({ data: { userId: patUserA.id, name: "Patient Iso A" } });
    patientAId = patA.id;
    patientA = { userId: patUserA.id, role: UserRole.PATIENT, patientId: patientAId };

    const patUserB = await prisma.user.create({
      data: { email: `pat-iso-b-${suffix}@test.local`, passwordHash: "x", role: UserRole.PATIENT },
    });
    const patB = await prisma.patient.create({ data: { userId: patUserB.id, name: "Patient Iso B" } });

    const slot = new Date("2099-06-01T10:00:00.000Z");
    await prisma.appointment.create({
      data: {
        hospitalId: hospitalA,
        doctorId: doctorAId,
        calendarId: calendarA,
        patientId: patientAId,
        slotStart: slot,
        slotEnd: new Date(slot.getTime() + 30 * 60_000),
        status: AppointmentStatus.CONFIRMED,
        idempotencyKey: `iso-a-${suffix}`,
        correlationId: `corr-iso-a-${suffix}`,
      },
    });
    const apptB = await prisma.appointment.create({
      data: {
        hospitalId: hospitalB,
        doctorId: doctorBId,
        calendarId: calendarB,
        patientId: patB.id,
        slotStart: new Date(slot.getTime() + 60 * 60_000),
        slotEnd: new Date(slot.getTime() + 90 * 60_000),
        status: AppointmentStatus.CONFIRMED,
        idempotencyKey: `iso-b-${suffix}`,
        correlationId: `corr-iso-b-${suffix}`,
      },
    });
    appointmentBId = apptB.id;

    await questionnaires.createTemplate(hospitalB, adminB, {
      title: "B intake",
      questions: [{ prompt: "Allergies?", type: QuestionFieldType.SHORT_TEXT, required: true }],
    });
  });

  afterAll(async () => {
    await prisma.questionnaireAnswer.deleteMany({
      where: { response: { appointment: { hospitalId: { in: [hospitalA, hospitalB] } } } },
    });
    await prisma.questionnaireResponse.deleteMany({
      where: { appointment: { hospitalId: { in: [hospitalA, hospitalB] } } },
    });
    await prisma.questionnaireQuestion.deleteMany({
      where: { questionnaire: { hospitalId: { in: [hospitalA, hospitalB] } } },
    });
    await prisma.questionnaire.deleteMany({ where: { hospitalId: { in: [hospitalA, hospitalB] } } });
    await prisma.appointmentStatusHistory.deleteMany({
      where: { appointment: { hospitalId: { in: [hospitalA, hospitalB] } } },
    });
    await prisma.slotReservation.deleteMany({ where: { appointment: { hospitalId: { in: [hospitalA, hospitalB] } } } });
    await prisma.appointment.deleteMany({ where: { hospitalId: { in: [hospitalA, hospitalB] } } });
    await prisma.calendar.deleteMany({ where: { hospitalId: { in: [hospitalA, hospitalB] } } });
    await prisma.doctor.deleteMany({ where: { hospitalId: { in: [hospitalA, hospitalB] } } });
    await prisma.hospitalStaff.deleteMany({ where: { hospitalId: { in: [hospitalA, hospitalB] } } });
    await prisma.auditEvent.deleteMany({ where: { hospitalId: { in: [hospitalA, hospitalB] } } });
    await prisma.operationalEvent.deleteMany({ where: { hospitalId: { in: [hospitalA, hospitalB] } } });
    await prisma.patient.deleteMany({ where: { user: { email: { endsWith: `${suffix}@test.local` } } } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { email: { endsWith: `${suffix}@test.local` } } });
    await prisma.hospital.deleteMany({ where: { id: { in: [hospitalA, hospitalB] } } });
    await moduleRef.close();
  });

  it("hospital A cannot list hospital B appointments", async () => {
    await expect(appointments.listForHospital(hospitalB, adminA)).rejects.toThrow(ForbiddenException);
    const own = await appointments.listForHospital(hospitalA, adminA);
    expect(own.every((row) => row.hospitalId === hospitalA)).toBe(true);
    expect(own.some((row) => row.id === appointmentBId)).toBe(false);
  });

  it("hospital A cannot read hospital B's appointment by id", async () => {
    await expect(appointments.getById(appointmentBId, adminA)).rejects.toThrow(ForbiddenException);
    await expect(appointments.getById(appointmentBId, patientA)).rejects.toThrow(ForbiddenException);
  });

  it("hospital A cannot list hospital B questionnaires", async () => {
    await expect(questionnaires.listTemplates(hospitalB, adminA)).rejects.toThrow(/do not have access/);
  });

  it("hospital A cannot list hospital B doctors as staff", async () => {
    await expect(doctors.listForHospital(hospitalB, adminA)).rejects.toThrow(ForbiddenException);
    await expect(doctors.listForHospital(hospitalB, doctorA)).rejects.toThrow(ForbiddenException);
    const publicList = await doctors.listForHospital(hospitalB);
    expect(publicList.some((d) => d.id === doctorBId)).toBe(true);
  });

  it("hospital A cannot read hospital B observability", async () => {
    await expect(observability.metrics(adminA, hospitalB)).rejects.toThrow(ForbiddenException);
    await expect(observability.listAudit(adminA, { hospitalId: hospitalB })).rejects.toThrow(ForbiddenException);
    await expect(observability.trace(adminA, `corr-iso-b-${suffix}`, hospitalB)).rejects.toThrow(ForbiddenException);
  });
});
