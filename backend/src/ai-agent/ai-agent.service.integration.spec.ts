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
import { AuditService } from "../audit/audit.service";
import { AuthModule } from "../auth/auth.module";
import { HospitalsModule } from "../hospitals/hospitals.module";
import { DoctorsModule } from "../doctors/doctors.module";
import { PatientsModule } from "../patients/patients.module";
import { SchedulingModule } from "../scheduling/scheduling.module";
import { SchedulingService } from "../scheduling/scheduling.service";
import { IntegrationModule } from "../integration/integration.module";
import { AppointmentsModule } from "../appointments/appointments.module";
import { CapabilitiesModule } from "../capabilities/capabilities.module";
import { CapabilitiesService } from "../capabilities/capabilities.service";
import { RequestUser } from "../common/types";
import { AiAgentService } from "./ai-agent.service";
import { parseLastToolOutput, ScriptedLlmClient, toolCall } from "./scripted-llm";

/**
 * Chunk 7 checkpoint: a full booking flow driven by the text agent, which
 * may only call the controlled capability layer. OpenAI is replaced by a
 * scripted LLM so the test is deterministic and needs no API key.
 */
describe("AiAgentService (scripted text conversations)", () => {
  const API_KEY = "dev-shared-secret";
  const { app: ehrApp } = createMockEhrApp({ apiKey: API_KEY, seed: false });
  let server: Server;
  let moduleRef: import("@nestjs/testing").TestingModule;
  let prisma: PrismaService;
  let capabilities: CapabilitiesService;
  let audit: AuditService;

  const suffix = nanoid(6);
  let hospitalId: string;
  let doctorId: string;
  let patientId: string;
  let patientUser: RequestUser;

  beforeAll(async () => {
    server = ehrApp.listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    const { port } = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${port}`;

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

    prisma = moduleRef.get(PrismaService);
    capabilities = moduleRef.get(CapabilitiesService);
    audit = moduleRef.get(AuditService);

    const hospital = await prisma.hospital.create({
      data: {
        name: `Agent Hospital ${suffix}`,
        slug: `agent-hosp-${suffix}`,
        city: "Riverside",
        status: HospitalStatus.APPROVED,
      },
    });
    hospitalId = hospital.id;
    await prisma.healthcareSystemConnection.create({
      data: { hospitalId, connectorType: "MOCK_EHR", baseUrl, apiKeyRef: "MOCK_EHR_API_KEY" },
    });

    const doctorUser = await prisma.user.create({
      data: { email: `doc-agent-${suffix}@test.local`, passwordHash: "x", role: UserRole.DOCTOR },
    });
    const doctor = await prisma.doctor.create({
      data: { userId: doctorUser.id, hospitalId, name: "Dr. Rivera", status: DoctorStatus.ACTIVE },
    });
    doctorId = doctor.id;
    const scheduling = moduleRef.get(SchedulingService);
    await scheduling.createCalendarForDoctor(doctorId, hospitalId);
    const calendar = await prisma.calendar.findFirstOrThrow({ where: { doctorId } });
    await prisma.workingHour.createMany({
      data: [
        { calendarId: calendar.id, dayOfWeek: 1, startMinute: 9 * 60, endMinute: 17 * 60 },
        { calendarId: calendar.id, dayOfWeek: 5, startMinute: 9 * 60, endMinute: 17 * 60 },
      ],
    });

    const patUser = await prisma.user.create({
      data: { email: `pat-agent-${suffix}@test.local`, passwordHash: "x", role: UserRole.PATIENT },
    });
    const patient = await prisma.patient.create({ data: { userId: patUser.id, name: "Agent Patient" } });
    patientId = patient.id;
    patientUser = { userId: patUser.id, role: UserRole.PATIENT, patientId };
  });

  afterAll(async () => {
    const conversations = await prisma.aIConversation.findMany({ where: { patientId } });
    const conversationIds = conversations.map((c) => c.id);
    await prisma.aIEvaluation.deleteMany({ where: { conversationId: { in: conversationIds } } });
    await prisma.capabilityExecution.deleteMany({ where: { conversationId: { in: conversationIds } } });
    await prisma.aIMessage.deleteMany({ where: { conversationId: { in: conversationIds } } });
    await prisma.aIContext.deleteMany({ where: { conversationId: { in: conversationIds } } });
    await prisma.aIConversation.deleteMany({ where: { patientId } });
    await prisma.questionnaireAnswer.deleteMany({ where: { response: { appointment: { hospitalId } } } });
    await prisma.questionnaireResponse.deleteMany({ where: { appointment: { hospitalId } } });
    await prisma.questionnaireQuestion.deleteMany({ where: { questionnaire: { hospitalId } } });
    await prisma.questionnaire.deleteMany({ where: { hospitalId } });
    await prisma.notification.deleteMany({ where: { appointment: { hospitalId } } });
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
    await prisma.workingHour.deleteMany({ where: { calendar: { hospitalId } } });
    await prisma.calendar.deleteMany({ where: { hospitalId } });
    await prisma.healthcareSystemConnection.deleteMany({ where: { hospitalId } });
    await prisma.doctor.deleteMany({ where: { hospitalId } });
    await prisma.patient.delete({ where: { id: patientId } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { email: { endsWith: `${suffix}@test.local` } } });
    await prisma.hospital.delete({ where: { id: hospitalId } }).catch(() => undefined);
    await moduleRef.close();
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  });

  function agentWith(llm: ScriptedLlmClient) {
    return new AiAgentService(prisma as any, audit, capabilities, llm);
  }

  function nextWeekday(dayOfWeek: number, weeksAhead = 1): Date {
    const d = new Date();
    const delta = (dayOfWeek + 7 - d.getUTCDay()) % 7 || 7;
    d.setUTCDate(d.getUTCDate() + delta + (weeksAhead - 1) * 7);
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }

  async function recordEval(conversationId: string, scenarioKey: string, input: string, passed: boolean, actual: unknown) {
    await prisma.aIEvaluation.create({
      data: {
        conversationId,
        scenarioKey,
        input,
        expectedOutcome: { passed: true },
        actualOutcome: actual as object,
        passed,
      },
    });
  }

  it("drives a full booking flow via text: search → availability → create", async () => {
    const llm = new ScriptedLlmClient([
      { toolCalls: [toolCall("search_doctors", { query: "Rivera", limit: 5 })] },
      (messages) => {
        const output = parseLastToolOutput<{ doctors: Array<{ id: string }> }>(messages);
        const monday = nextWeekday(1, 2);
        const tuesday = new Date(monday.getTime() + 86_400_000);
        return {
          content: null,
          toolCalls: [
            toolCall("check_availability", {
              doctorId: output?.doctors[0].id,
              dateFrom: monday.toISOString(),
              dateTo: tuesday.toISOString(),
              limit: 5,
            }),
          ],
        };
      },
      (messages) => {
        const output = parseLastToolOutput<{ slots: Array<{ doctorId: string; start: string; end: string }> }>(messages);
        const slot = output!.slots[0];
        return {
          content: null,
          toolCalls: [
            toolCall("create_appointment", {
              doctorId: slot.doctorId,
              slotStart: slot.start,
              slotEnd: slot.end,
              idempotencyKey: `agent-book-${suffix}`,
            }),
          ],
        };
      },
      { content: "You're booked with Dr. Rivera. The hospital system has confirmed the appointment." },
    ]);

    const agent = agentWith(llm);
    const conversation = await agent.startConversation(patientUser);
    const turn = await agent.sendMessage(conversation.id, patientUser, "I need an appointment with Dr. Rivera");

    expect(turn.toolTrace.map((t) => t.name)).toEqual(["search_doctors", "check_availability", "create_appointment"]);
    expect(turn.toolTrace.every((t) => t.success)).toBe(true);
    expect(turn.reply).toMatch(/booked|confirmed/i);

    const appointment = await prisma.appointment.findFirst({ where: { patientId, hospitalId } });
    expect(appointment?.status).toBe(AppointmentStatus.CONFIRMED);
    expect(appointment?.externalAppointmentId).toBeTruthy();

    const context = await prisma.aIContext.findUnique({ where: { conversationId: conversation.id } });
    expect(context?.currentAppointmentId).toBe(appointment?.id);
    expect(context?.selectedDoctorId).toBe(doctorId);

    await recordEval(conversation.id, "booking_happy_path", "I need an appointment with Dr. Rivera", true, {
      tools: turn.toolTrace.map((t) => t.name),
      appointmentId: appointment?.id,
    });
  });

  it("resolves 'book that for Friday' from retained context instead of guessing a slot", async () => {
    const llm = new ScriptedLlmClient([
      { toolCalls: [toolCall("get_context", {})] },
      (messages) => {
        const ctx = parseLastToolOutput<{ selectedDoctorId: string | null }>(messages);
        const friday = nextWeekday(5, 1);
        const saturday = new Date(friday.getTime() + 86_400_000);
        return {
          content: null,
          toolCalls: [
            toolCall("check_availability", {
              doctorId: ctx?.selectedDoctorId,
              dateFrom: friday.toISOString(),
              dateTo: saturday.toISOString(),
              limit: 5,
            }),
          ],
        };
      },
      (messages) => {
        const output = parseLastToolOutput<{ slots: Array<{ doctorId: string; start: string; end: string }> }>(messages);
        const slot = output!.slots[0];
        return {
          content: null,
          toolCalls: [
            toolCall("create_appointment", {
              doctorId: slot.doctorId,
              slotStart: slot.start,
              slotEnd: slot.end,
              idempotencyKey: `agent-friday-${suffix}`,
            }),
          ],
        };
      },
      { content: "Booked for Friday with the doctor you already selected." },
    ]);

    const agent = agentWith(llm);
    const conversation = await agent.startConversation(patientUser);
    await prisma.aIContext.update({
      where: { conversationId: conversation.id },
      data: { selectedDoctorId: doctorId, selectedHospitalId: hospitalId, intent: "book_appointment" },
    });

    const turn = await agent.sendMessage(conversation.id, patientUser, "book that for Friday");
    expect(turn.toolTrace.map((t) => t.name)).toEqual(["get_context", "check_availability", "create_appointment"]);
    expect(turn.toolTrace.every((t) => t.success)).toBe(true);

    const created = await prisma.appointment.findFirst({
      where: { patientId, idempotencyKey: `agent-friday-${suffix}` },
    });
    expect(created?.status).toBe(AppointmentStatus.CONFIRMED);
    expect(created?.slotStart.getUTCDay()).toBe(5);

    await recordEval(conversation.id, "context_friday", "book that for Friday", true, {
      tools: turn.toolTrace.map((t) => t.name),
    });
  });

  it("asks for clarification instead of inventing a booking", async () => {
    const llm = new ScriptedLlmClient([
      { content: "Which hospital or doctor should I look at? I don't want to guess." },
    ]);
    const agent = agentWith(llm);
    const conversation = await agent.startConversation(patientUser);
    const before = await prisma.appointment.count({ where: { patientId } });
    const turn = await agent.sendMessage(conversation.id, patientUser, "book me something");
    const after = await prisma.appointment.count({ where: { patientId } });

    expect(turn.toolTrace).toEqual([]);
    expect(turn.reply).toMatch(/hospital|doctor/i);
    expect(after).toBe(before);
    await recordEval(conversation.id, "clarification", "book me something", true, { reply: turn.reply });
  });

  it("refuses a clinical request without calling any booking capability", async () => {
    const llm = new ScriptedLlmClient([
      {
        content:
          "I can't give medical or medication advice. I can help you book an administrative appointment, or transfer you to a human.",
      },
    ]);
    const agent = agentWith(llm);
    const conversation = await agent.startConversation(patientUser);
    const turn = await agent.sendMessage(conversation.id, patientUser, "What antibiotic should I take for this pain?");

    expect(turn.toolTrace).toEqual([]);
    expect(turn.reply).toMatch(/medical|medication|administrative|human/i);
    await recordEval(conversation.id, "safety_refusal", "What antibiotic should I take", true, { reply: turn.reply });
  });

  it("rejects an unsupported tool name instead of executing it", async () => {
    const llm = new ScriptedLlmClient([
      { toolCalls: [toolCall("prescribe_medication", { drug: "amoxicillin" })] },
      { content: "I can only help with scheduling. Would you like me to transfer you to a human?" },
    ]);
    const agent = agentWith(llm);
    const conversation = await agent.startConversation(patientUser);
    const turn = await agent.sendMessage(conversation.id, patientUser, "prescribe me something");

    expect(turn.toolTrace[0]).toEqual({ name: "prescribe_medication", success: false, error: "Unknown capability: prescribe_medication" });
    const executions = await prisma.capabilityExecution.findMany({
      where: { conversationId: conversation.id, capabilityName: "prescribe_medication" },
    });
    expect(executions).toHaveLength(0);
    await recordEval(conversation.id, "invalid_tool", "prescribe me something", true, { trace: turn.toolTrace });
  });

  it("runs a mock telephone call through the same agent core", async () => {
    const llm = new ScriptedLlmClient([
      { toolCalls: [toolCall("search_doctors", { query: "Rivera", limit: 5 })] },
      (messages) => {
        const output = parseLastToolOutput<{ doctors: Array<{ id: string }> }>(messages);
        const monday = nextWeekday(1, 3);
        const tuesday = new Date(monday.getTime() + 86_400_000);
        return {
          content: null,
          toolCalls: [
            toolCall("check_availability", {
              doctorId: output?.doctors[0].id,
              dateFrom: monday.toISOString(),
              dateTo: tuesday.toISOString(),
              limit: 3,
            }),
          ],
        };
      },
      (messages) => {
        const output = parseLastToolOutput<{ slots: Array<{ doctorId: string; start: string; end: string }> }>(messages);
        const slot = output!.slots[0];
        return {
          content: null,
          toolCalls: [
            toolCall("create_appointment", {
              doctorId: slot.doctorId,
              slotStart: slot.start,
              slotEnd: slot.end,
              idempotencyKey: `agent-phone-${suffix}`,
            }),
          ],
        };
      },
      { content: "Your appointment is confirmed. Thank you for calling." },
    ]);
    const agent = agentWith(llm);
    const call = await agent.simulateTelephone(patientUser, ["Hi, I need an appointment with Dr. Rivera please"]);
    expect(call.channel).toBe("telephone");
    expect(call.turns[0].toolTrace.map((t) => t.name)).toContain("create_appointment");
    const booked = await prisma.appointment.findFirst({ where: { idempotencyKey: `agent-phone-${suffix}` } });
    expect(booked?.status).toBe(AppointmentStatus.CONFIRMED);
  });
});
