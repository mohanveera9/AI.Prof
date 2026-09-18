import { Test } from "@nestjs/testing";
import { ConfigModule } from "@nestjs/config";
import { nanoid } from "nanoid";
import { AppointmentStatus, DoctorStatus, HospitalStatus, QuestionFieldType, UserRole } from "@ai-prof/shared";
import { PrismaModule } from "../prisma/prisma.module";
import { PrismaService } from "../prisma/prisma.service";
import { AuditModule } from "../audit/audit.module";
import { QuestionnairesModule } from "./questionnaires.module";
import { QuestionnairesService } from "./questionnaires.service";
import { RequestUser } from "../common/types";

describe("QuestionnairesService (integration)", () => {
  let moduleRef: import("@nestjs/testing").TestingModule;
  let prisma: PrismaService;
  let questionnaires: QuestionnairesService;

  const suffix = nanoid(6);
  let hospitalId: string;
  let otherHospitalId: string;
  let doctorId: string;
  let specialtyId: string;
  let calendarId: string;
  let patientId: string;
  let appointmentId: string;
  let admin: RequestUser;
  let otherAdmin: RequestUser;
  let patientUser: RequestUser;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, AuditModule, QuestionnairesModule],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    questionnaires = moduleRef.get(QuestionnairesService);

    const hospital = await prisma.hospital.create({
      data: { name: `Q Hospital ${suffix}`, slug: `q-hosp-${suffix}`, status: HospitalStatus.APPROVED },
    });
    hospitalId = hospital.id;
    const other = await prisma.hospital.create({
      data: { name: `Q Other ${suffix}`, slug: `q-other-${suffix}`, status: HospitalStatus.APPROVED },
    });
    otherHospitalId = other.id;

    const specialty = await prisma.specialty.create({ data: { hospitalId, name: "Cardiology" } });
    specialtyId = specialty.id;

    const doctorUser = await prisma.user.create({
      data: { email: `doc-q-${suffix}@test.local`, passwordHash: "x", role: UserRole.DOCTOR },
    });
    const doctor = await prisma.doctor.create({
      data: { userId: doctorUser.id, hospitalId, name: "Dr. Q", status: DoctorStatus.ACTIVE },
    });
    doctorId = doctor.id;
    await prisma.doctorSpecialty.create({ data: { doctorId, specialtyId } });
    const calendar = await prisma.calendar.create({ data: { doctorId, hospitalId } });
    calendarId = calendar.id;

    const adminUser = await prisma.user.create({
      data: { email: `admin-q-${suffix}@test.local`, passwordHash: "x", role: UserRole.HOSPITAL_ADMIN },
    });
    await prisma.hospitalStaff.create({ data: { userId: adminUser.id, hospitalId, name: "Admin Q" } });
    admin = { userId: adminUser.id, role: UserRole.HOSPITAL_ADMIN, hospitalId };

    const otherAdminUser = await prisma.user.create({
      data: { email: `admin-q2-${suffix}@test.local`, passwordHash: "x", role: UserRole.HOSPITAL_ADMIN },
    });
    await prisma.hospitalStaff.create({ data: { userId: otherAdminUser.id, hospitalId: otherHospitalId, name: "Admin Other" } });
    otherAdmin = { userId: otherAdminUser.id, role: UserRole.HOSPITAL_ADMIN, hospitalId: otherHospitalId };

    const patUser = await prisma.user.create({
      data: { email: `pat-q-${suffix}@test.local`, passwordHash: "x", role: UserRole.PATIENT },
    });
    const patient = await prisma.patient.create({ data: { userId: patUser.id, name: "Q Patient" } });
    patientId = patient.id;
    patientUser = { userId: patUser.id, role: UserRole.PATIENT, patientId };

    const appointment = await prisma.appointment.create({
      data: {
        hospitalId,
        doctorId,
        calendarId,
        patientId,
        slotStart: new Date("2030-01-07T09:00:00.000Z"),
        slotEnd: new Date("2030-01-07T09:30:00.000Z"),
        status: AppointmentStatus.CONFIRMED,
        idempotencyKey: `q-${suffix}`,
        correlationId: `corr-q-${suffix}`,
      },
    });
    appointmentId = appointment.id;
  });

  afterAll(async () => {
    await prisma.questionnaireAnswer.deleteMany({ where: { response: { appointment: { hospitalId } } } });
    await prisma.questionnaireResponse.deleteMany({ where: { appointment: { hospitalId } } });
    await prisma.questionnaireQuestion.deleteMany({ where: { questionnaire: { hospitalId } } });
    await prisma.questionnaire.deleteMany({ where: { hospitalId } });
    await prisma.appointment.deleteMany({ where: { hospitalId } });
    await prisma.calendar.deleteMany({ where: { hospitalId } });
    await prisma.doctorSpecialty.deleteMany({ where: { doctorId } });
    await prisma.doctor.deleteMany({ where: { hospitalId } });
    await prisma.specialty.deleteMany({ where: { hospitalId } });
    await prisma.hospitalStaff.deleteMany({ where: { hospitalId: { in: [hospitalId, otherHospitalId] } } });
    await prisma.auditEvent.deleteMany({ where: { hospitalId: { in: [hospitalId, otherHospitalId] } } });
    await prisma.patient.delete({ where: { id: patientId } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { email: { endsWith: `${suffix}@test.local` } } });
    await prisma.hospital.deleteMany({ where: { id: { in: [hospitalId, otherHospitalId] } } });
    await moduleRef.close();
  });

  it("hospital admins can build a template and patients cannot", async () => {
    const created = await questionnaires.createTemplate(hospitalId, admin, {
      title: "Pre-visit intake",
      questions: [
        { prompt: "Do you have chest pain?", type: QuestionFieldType.YES_NO, required: true },
        { prompt: "Allergies", type: QuestionFieldType.SHORT_TEXT, required: false },
      ],
    });
    expect(created.questions).toHaveLength(2);

    await expect(questionnaires.listTemplates(hospitalId, otherAdmin)).rejects.toThrow(/do not have access/);
    await expect(
      questionnaires.createTemplate(hospitalId, patientUser, { title: "Nope", questions: [] }),
    ).rejects.toThrow(/cannot manage/);
  });

  it("matches the most specific template and collects answers conversationally", async () => {
    await questionnaires.createTemplate(hospitalId, admin, {
      title: "Generic intake",
      questions: [{ prompt: "Generic?", type: QuestionFieldType.YES_NO }],
    });
    const specific = await questionnaires.createTemplate(hospitalId, admin, {
      title: "Cardiology visit",
      doctorId,
      questions: [
        { prompt: "Chest pain?", type: QuestionFieldType.YES_NO, required: true },
        { prompt: "Visit type", type: QuestionFieldType.CHOICE, options: ["new", "follow-up"], required: true },
      ],
    });

    const matched = await questionnaires.matchForAppointment(appointmentId);
    expect(matched?.id).toBe(specific.id);

    const payload = await questionnaires.getForPatient(patientId, patientUser, { appointmentId });
    expect(payload.questionnaire?.id).toBe(specific.id);
    expect(payload.responseId).toBeTruthy();

    const partial = await questionnaires.submitAnswers(payload.responseId!, patientUser, [
      { questionId: payload.questionnaire!.questions[0].id, value: true },
    ]);
    expect(partial.status).toBe("recorded");
    expect(partial.completionStatus).toBe("IN_PROGRESS");

    const done = await questionnaires.submitAnswers(payload.responseId!, patientUser, [
      { questionId: payload.questionnaire!.questions[1].id, value: "new" },
    ]);
    expect(done.completionStatus).toBe("COMPLETED");

    const pending = await questionnaires.pendingForPatient(patientId, patientUser);
    expect(pending).toBeNull();
  });
});
