import { Test } from "@nestjs/testing";
import { ConfigModule } from "@nestjs/config";
import { nanoid } from "nanoid";
import {
  AppointmentStatus,
  DoctorStatus,
  HospitalStatus,
  NotificationType,
  QuestionFieldType,
  UserRole,
  WorkflowExecutionStatus,
} from "@ai-prof/shared";
import { PrismaModule } from "../prisma/prisma.module";
import { PrismaService } from "../prisma/prisma.service";
import { AuditModule } from "../audit/audit.module";
import { QuestionnairesModule } from "../questionnaires/questionnaires.module";
import { QuestionnairesService } from "../questionnaires/questionnaires.service";
import { NotificationsModule } from "../notifications/notifications.module";
import { WorkflowsModule } from "./workflows.module";
import { WorkflowsService } from "./workflows.service";
import { WORKFLOW_KEYS, WORKFLOW_TRIGGERS } from "./workflow.types";
import { RequestUser } from "../common/types";

describe("WorkflowsService (integration)", () => {
  let moduleRef: import("@nestjs/testing").TestingModule;
  let prisma: PrismaService;
  let workflows: WorkflowsService;
  let questionnaires: QuestionnairesService;

  const suffix = nanoid(6);
  let hospitalId: string;
  let doctorId: string;
  let patientId: string;
  let patientUserId: string;
  let appointmentId: string;
  let admin: RequestUser;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        AuditModule,
        QuestionnairesModule,
        NotificationsModule,
        WorkflowsModule,
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    workflows = moduleRef.get(WorkflowsService);
    questionnaires = moduleRef.get(QuestionnairesService);

    const hospital = await prisma.hospital.create({
      data: { name: `WF Hospital ${suffix}`, slug: `wf-hosp-${suffix}`, status: HospitalStatus.APPROVED },
    });
    hospitalId = hospital.id;

    const adminUser = await prisma.user.create({
      data: { email: `admin-wf-${suffix}@test.local`, passwordHash: "x", role: UserRole.HOSPITAL_ADMIN },
    });
    await prisma.hospitalStaff.create({ data: { userId: adminUser.id, hospitalId, name: "WF Admin" } });
    admin = { userId: adminUser.id, role: UserRole.HOSPITAL_ADMIN, hospitalId };

    const doctorUser = await prisma.user.create({
      data: { email: `doc-wf-${suffix}@test.local`, passwordHash: "x", role: UserRole.DOCTOR },
    });
    const doctor = await prisma.doctor.create({
      data: { userId: doctorUser.id, hospitalId, name: "Dr. WF", status: DoctorStatus.ACTIVE },
    });
    doctorId = doctor.id;
    const calendar = await prisma.calendar.create({ data: { doctorId, hospitalId } });

    const patUser = await prisma.user.create({
      data: { email: `pat-wf-${suffix}@test.local`, passwordHash: "x", role: UserRole.PATIENT },
    });
    patientUserId = patUser.id;
    const patient = await prisma.patient.create({ data: { userId: patUser.id, name: "WF Patient" } });
    patientId = patient.id;

    await questionnaires.createTemplate(hospitalId, admin, {
      title: "WF intake",
      questions: [{ prompt: "Fasting?", type: QuestionFieldType.YES_NO }],
    });

    const appointment = await prisma.appointment.create({
      data: {
        hospitalId,
        doctorId,
        calendarId: calendar.id,
        patientId,
        slotStart: new Date("2030-02-03T09:00:00.000Z"),
        slotEnd: new Date("2030-02-03T09:30:00.000Z"),
        status: AppointmentStatus.CONFIRMED,
        idempotencyKey: `wf-${suffix}`,
        correlationId: `corr-wf-${suffix}`,
      },
    });
    appointmentId = appointment.id;
  });

  afterAll(async () => {
    await prisma.questionnaireAnswer.deleteMany({ where: { response: { appointment: { hospitalId } } } });
    await prisma.questionnaireResponse.deleteMany({ where: { appointment: { hospitalId } } });
    await prisma.questionnaireQuestion.deleteMany({ where: { questionnaire: { hospitalId } } });
    await prisma.questionnaire.deleteMany({ where: { hospitalId } });
    await prisma.notification.deleteMany({ where: { recipientUserId: patientUserId } });
    await prisma.workflowExecution.deleteMany({ where: { workflow: { hospitalId } } });
    await prisma.workflow.deleteMany({ where: { hospitalId } });
    await prisma.appointment.deleteMany({ where: { hospitalId } });
    await prisma.calendar.deleteMany({ where: { hospitalId } });
    await prisma.doctor.deleteMany({ where: { hospitalId } });
    await prisma.hospitalStaff.deleteMany({ where: { hospitalId } });
    await prisma.auditEvent.deleteMany({ where: { hospitalId } });
    await prisma.operationalEvent.deleteMany({ where: { hospitalId } });
    await prisma.patient.delete({ where: { id: patientId } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { email: { endsWith: `${suffix}@test.local` } } });
    await prisma.hospital.delete({ where: { id: hospitalId } }).catch(() => undefined);
    await moduleRef.close();
  });

  it("runs the default post-booking workflow: assign questionnaire + send notifications", async () => {
    const execution = await workflows.startByTrigger(WORKFLOW_TRIGGERS.APPOINTMENT_CONFIRMED, appointmentId);
    expect(execution?.status).toBe(WorkflowExecutionStatus.COMPLETED);

    const responses = await prisma.questionnaireResponse.findMany({ where: { appointmentId } });
    expect(responses).toHaveLength(1);
    expect(responses[0].status).toBe("PENDING");

    const notes = await prisma.notification.findMany({ where: { recipientUserId: patientUserId } });
    const types = notes.map((n) => n.type).sort();
    expect(types).toEqual([NotificationType.APPOINTMENT_CONFIRMATION, NotificationType.QUESTIONNAIRE_REMINDER].sort());
  });

  it("start_workflow by key is idempotent while an execution is already complete (creates a new run only when none are in-flight)", async () => {
    const first = await workflows.startByKey(WORKFLOW_KEYS.POST_CANCEL, appointmentId);
    expect(first.status).toBe(WorkflowExecutionStatus.COMPLETED);
    const second = await workflows.startByKey(WORKFLOW_KEYS.POST_CANCEL, appointmentId);
    expect(second.id).not.toBe(first.id);
  });
});
