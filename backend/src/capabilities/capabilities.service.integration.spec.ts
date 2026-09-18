import { AddressInfo } from "net";
import type { Server } from "http";
import { Test } from "@nestjs/testing";
import { ConfigModule } from "@nestjs/config";
import { nanoid } from "nanoid";
import { AppointmentStatus, DoctorStatus, HospitalStatus, UserRole } from "@ai-prof/shared";
import { createMockEhrApp } from "../../../mock-ehr/src/app";
import { PrismaModule } from "../prisma/prisma.module";
import { PrismaService } from "../prisma/prisma.service";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { HospitalsModule } from "../hospitals/hospitals.module";
import { DoctorsModule } from "../doctors/doctors.module";
import { PatientsModule } from "../patients/patients.module";
import { SchedulingModule } from "../scheduling/scheduling.module";
import { IntegrationModule } from "../integration/integration.module";
import { AppointmentsModule } from "../appointments/appointments.module";
import { CapabilitiesModule } from "./capabilities.module";
import { CapabilitiesService } from "./capabilities.service";
import { SchedulingService } from "../scheduling/scheduling.service";
import { RequestUser } from "../common/types";

/**
 * Checkpoint for Chunk 6: the AI's only surface. Boots the real Nest DI
 * graph (same modules as the app) against a real Postgres + a real mock-EHR
 * HTTP server, and drives capabilities exactly as the AI agent will.
 */
describe("CapabilitiesService (integration)", () => {
  const API_KEY = "dev-shared-secret"; // matches backend/.env MOCK_EHR_API_KEY loaded by jest-env.ts
  const { app: ehrApp, store } = createMockEhrApp({ apiKey: API_KEY, seed: false });
  let server: Server;
  let baseUrl: string;

  let moduleRef: import("@nestjs/testing").TestingModule;
  let capabilities: CapabilitiesService;
  let prisma: PrismaService;

  const suffix = nanoid(6);
  let hospitalId: string;
  let doctorId: string;
  let patientId: string;
  let patientUser: RequestUser;

  beforeAll(async () => {
    server = ehrApp.listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;

    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        AuditModule,
        AuthModule,
        HospitalsModule,
        DoctorsModule,
        PatientsModule,
        SchedulingModule,
        IntegrationModule,
        AppointmentsModule,
        CapabilitiesModule,
      ],
    }).compile();
    await moduleRef.init();

    capabilities = moduleRef.get(CapabilitiesService);
    prisma = moduleRef.get(PrismaService);

    const hospital = await prisma.hospital.create({
      data: {
        name: `Capability Hospital ${suffix}`,
        slug: `cap-hosp-${suffix}`,
        city: "Testville",
        status: HospitalStatus.APPROVED,
      },
    });
    hospitalId = hospital.id;
    await prisma.department.create({ data: { hospitalId, name: "General Medicine" } });
    await prisma.specialty.create({ data: { hospitalId, name: "Shoulder" } });
    await prisma.healthcareSystemConnection.create({
      data: { hospitalId, connectorType: "MOCK_EHR", baseUrl, apiKeyRef: "MOCK_EHR_API_KEY" },
    });

    const doctorUser = await prisma.user.create({
      data: { email: `doc-cap-${suffix}@test.local`, passwordHash: "x", role: UserRole.DOCTOR },
    });
    const doctor = await prisma.doctor.create({
      data: { userId: doctorUser.id, hospitalId, name: "Dr. Capability", status: DoctorStatus.ACTIVE },
    });
    doctorId = doctor.id;
    const scheduling = moduleRef.get(SchedulingService);
    await scheduling.createCalendarForDoctor(doctorId, hospitalId);
    const calendar = await prisma.calendar.findFirstOrThrow({ where: { doctorId } });
    await prisma.workingHour.create({
      data: { calendarId: calendar.id, dayOfWeek: 1, startMinute: 9 * 60, endMinute: 17 * 60 },
    });

    const patUser = await prisma.user.create({
      data: { email: `pat-cap-${suffix}@test.local`, passwordHash: "x", role: UserRole.PATIENT },
    });
    const patient = await prisma.patient.create({ data: { userId: patUser.id, name: "Capability Patient" } });
    patientId = patient.id;
    patientUser = { userId: patUser.id, role: UserRole.PATIENT, patientId };
  });

  afterAll(async () => {
    // CapabilityExecution rows are left as harmless test debris (no FK back to hospital/patient to scope a delete by).
    await prisma.notification.deleteMany({ where: { recipientUserId: patientUser.userId } });
    await prisma.questionnaireAnswer.deleteMany({ where: { response: { appointment: { hospitalId } } } });
    await prisma.questionnaireResponse.deleteMany({ where: { appointment: { hospitalId } } });
    await prisma.questionnaireQuestion.deleteMany({ where: { questionnaire: { hospitalId } } });
    await prisma.questionnaire.deleteMany({ where: { hospitalId } });
    await prisma.workflowExecution.deleteMany({ where: { workflow: { hospitalId } } });
    await prisma.workflow.deleteMany({ where: { hospitalId } });
    await prisma.appointmentStatusHistory.deleteMany({ where: { appointment: { hospitalId } } });
    await prisma.slotReservation.deleteMany({ where: { appointment: { hospitalId } } });
    await prisma.integrationVerification.deleteMany({ where: { integrationOperation: { hospitalId } } });
    await prisma.integrationOperation.deleteMany({ where: { hospitalId } });
    await prisma.reconciliationRecord.deleteMany({ where: { hospitalId } });
    await prisma.appointment.deleteMany({ where: { hospitalId } });
    await prisma.externalIdentifierMapping.deleteMany({ where: { hospitalId } });
    await prisma.auditEvent.deleteMany({ where: { hospitalId } });
    await prisma.operationalEvent.deleteMany({ where: { hospitalId } });
    await prisma.userPreference.deleteMany({ where: { patientId } });
    await prisma.workingHour.deleteMany({ where: { calendar: { hospitalId } } });
    await prisma.calendar.deleteMany({ where: { hospitalId } });
    await prisma.healthcareSystemConnection.deleteMany({ where: { hospitalId } });
    await prisma.doctor.deleteMany({ where: { hospitalId } });
    await prisma.specialty.deleteMany({ where: { hospitalId } });
    await prisma.department.deleteMany({ where: { hospitalId } });
    await prisma.patient.delete({ where: { id: patientId } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { email: { endsWith: `${suffix}@test.local` } } });
    await prisma.hospital.delete({ where: { id: hospitalId } }).catch(() => undefined);
    await moduleRef.close();
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  });

  function ctx() {
    return { patientId, requester: patientUser, correlationId: `corr-${nanoid(8)}` };
  }

  function nextMonday9am(weeksAhead: number): Date {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + ((1 + 7 - d.getUTCDay()) % 7 || 7) + (weeksAhead - 1) * 7);
    d.setUTCHours(9, 0, 0, 0);
    return d;
  }

  it("rejects an unknown capability name without throwing", async () => {
    const result = await capabilities.execute("delete_everything", {}, ctx());
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Unknown capability/);
  });

  it("rejects input that fails the schema", async () => {
    const result = await capabilities.execute("check_availability", { doctorId }, ctx());
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Invalid input/);
  });

  it("search_hospitals and search_doctors find the seeded records", async () => {
    const hospitalsResult = await capabilities.execute("search_hospitals", { city: "Testville" }, ctx());
    expect(hospitalsResult.success).toBe(true);
    expect((hospitalsResult.output as any).hospitals[0].id).toBe(hospitalId);

    const doctorsResult = await capabilities.execute("search_doctors", { hospitalId }, ctx());
    expect(doctorsResult.success).toBe(true);
    expect((doctorsResult.output as any).doctors[0].id).toBe(doctorId);
  });

  it("lookup_patient always resolves to the authenticated patient, ignoring any other id in input", async () => {
    const correlationId = `corr-latency-${suffix}`;
    const result = await capabilities.execute("lookup_patient", { patientId: "someone-elses-id" }, {
      ...ctx(),
      correlationId,
    });
    expect(result.success).toBe(true);
    expect((result.output as any).patient.id).toBe(patientId);

    const execution = await prisma.capabilityExecution.findFirst({
      where: { capabilityName: "lookup_patient", correlationId },
    });
    expect(execution).toBeTruthy();
    expect(execution!.latencyMs).toBeGreaterThanOrEqual(0);
    expect(execution!.latencyMs).toBeLessThan(1500);
  });

  it("drives a full booking lifecycle through the capability surface: check -> create -> get -> reschedule -> cancel", async () => {
    const dateFrom = nextMonday9am(6);
    const dateTo = new Date(dateFrom.getTime() + 86_400_000);

    const availability = await capabilities.execute(
      "check_availability",
      { doctorId, dateFrom: dateFrom.toISOString(), dateTo: dateTo.toISOString(), limit: 2 },
      ctx(),
    );
    expect(availability.success).toBe(true);
    const slots = (availability.output as any).slots;
    expect(slots.length).toBeGreaterThanOrEqual(2);

    const created = await capabilities.execute(
      "create_appointment",
      { doctorId, slotStart: slots[0].start, slotEnd: slots[0].end, idempotencyKey: `cap-int-${suffix}` },
      ctx(),
    );
    expect(created.success).toBe(true);
    const appointment = (created.output as any).appointment;
    expect(appointment.status).toBe(AppointmentStatus.CONFIRMED);
    expect(appointment.externalAppointmentId).toBeTruthy();

    const fetched = await capabilities.execute("get_appointment", { latestForPatient: true }, ctx());
    expect(fetched.success).toBe(true);
    expect((fetched.output as any).appointment.id).toBe(appointment.id);

    const verify = await capabilities.execute("verify_external_appointment", { appointmentId: appointment.id }, ctx());
    expect(verify.success).toBe(true);
    expect((verify.output as any).verified).toBe(true);

    const rescheduled = await capabilities.execute(
      "reschedule_appointment",
      {
        appointmentId: appointment.id,
        newSlotStart: slots[1].start,
        newSlotEnd: slots[1].end,
        idempotencyKey: `cap-int-resched-${suffix}`,
      },
      ctx(),
    );
    expect(rescheduled.success).toBe(true);
    expect((rescheduled.output as any).appointment.slotStart).toBe(slots[1].start);
    expect((rescheduled.output as any).appointment.status).toBe(AppointmentStatus.CONFIRMED);

    const cancelled = await capabilities.execute(
      "cancel_appointment",
      { appointmentId: appointment.id, reason: "capability test", idempotencyKey: `cap-int-cancel-${suffix}` },
      ctx(),
    );
    expect(cancelled.success).toBe(true);
    expect((cancelled.output as any).appointment.status).toBe(AppointmentStatus.CANCELLED);

    const executions = await prisma.capabilityExecution.findMany({
      where: { capabilityName: "create_appointment" },
      orderBy: { createdAt: "desc" },
      take: 5,
    });
    expect(executions.some((e) => e.success)).toBe(true);

    const workflowRuns = await prisma.workflowExecution.findMany({ where: { appointmentId: appointment.id } });
    expect(workflowRuns.length).toBeGreaterThan(0);
  });

  it("send_notification, update_preferences, and transfer_to_human all round-trip", async () => {
    const notification = await capabilities.execute(
      "send_notification",
      { type: "IMPORTANT_UPDATE", message: "hello from a test" },
      ctx(),
    );
    expect(notification.success).toBe(true);
    expect((notification.output as any).notificationId).toBeTruthy();

    const prefs = await capabilities.execute(
      "update_preferences",
      { communicationPreference: "SMS", other: { likesReminders: true } },
      ctx(),
    );
    expect(prefs.success).toBe(true);
    expect((prefs.output as any).preferences.communicationPreference).toBe("SMS");
    expect((prefs.output as any).preferences.likesReminders).toBe(true);

    const escalation = await capabilities.execute(
      "transfer_to_human",
      { reason: "test escalation", urgency: "high" },
      ctx(),
    );
    expect(escalation.success).toBe(true);
    expect((escalation.output as any).status).toBe("escalated");
  });

  it("get_questionnaire returns null when no template exists; submit and unknown workflows fail safely", async () => {
    const questionnaire = await capabilities.execute("get_questionnaire", {}, ctx());
    expect(questionnaire.success).toBe(true);
    expect((questionnaire.output as any).questionnaire).toBeNull();
    expect((questionnaire.output as any).responseId).toBeNull();

    const submit = await capabilities.execute("submit_questionnaire", {
      questionnaireResponseId: "missing",
      answers: [{ questionId: "q1", value: "yes" }],
    }, ctx());
    expect(submit.success).toBe(false);

    const workflow = await capabilities.execute("start_workflow", { workflowKey: "does-not-exist" }, ctx());
    expect(workflow.success).toBe(false);
  });
});
