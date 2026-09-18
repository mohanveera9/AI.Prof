import { AddressInfo } from "net";
import type { Server } from "http";
import { PrismaClient } from "@prisma/client";
import { ConfigService } from "@nestjs/config";
import { nanoid } from "nanoid";
import {
  AppointmentStatus,
  DoctorStatus,
  HospitalStatus,
  ReconciliationOutcome,
  UserRole,
} from "@ai-prof/shared";
import { createMockEhrApp } from "../../../mock-ehr/src/app";
import { AuditService } from "../audit/audit.service";
import { IdentifierMappingService } from "./identifier-mapping.service";
import { ConnectorFactory } from "./connector.factory";
import { AppointmentExternalSync } from "./appointment-external-sync";
import { IntegrationService } from "./integration.service";
import { ReconciliationService } from "../reconciliation/reconciliation.service";
import { ReconciliationScheduler } from "../reconciliation/reconciliation.scheduler";
import { MockEhrConnector } from "./mock-ehr.connector";

/**
 * Checkpoint for Chunk 4 (PRD §12/§28):
 *   - happy path create → verify → sync
 *   - Option A: timeout without write → retry → verify → recovered
 *   - Option B: timeout after write → re-query finds it, no duplicate
 *   - Option C: persistent outage → reconciliation record → human escalation
 */

const API_KEY = "chunk4-test-key";

function testConfig(baseUrl: string, extras: Record<string, string | number> = {}): ConfigService {
  const values: Record<string, string | number> = {
    MOCK_EHR_BASE_URL: baseUrl,
    MOCK_EHR_API_KEY: API_KEY,
    MOCK_EHR_TIMEOUT_MS: 250,
    INTEGRATION_MAX_RETRIES: 2,
    INTEGRATION_RETRY_BASE_MS: 20,
    RECONCILIATION_MAX_ATTEMPTS: 1,
    RECONCILIATION_AUTO_RUN: "false",
    ...extras,
  };
  return {
    get: (key: string, defaultValue?: unknown) => values[key] ?? defaultValue ?? process.env[key],
  } as unknown as ConfigService;
}

describe("Integration create→verify→sync + failure scenarios", () => {
  const prisma = new PrismaClient();
  const { app, store } = createMockEhrApp({ apiKey: API_KEY, seed: true });
  let server: Server;
  let baseUrl: string;
  let ehr: MockEhrConnector;

  const suffix = nanoid(6);
  let hospitalId: string;
  let doctorId: string;
  let patientId: string;
  let calendarId: string;

  const appointmentIds: string[] = [];

  function services(config: ConfigService) {
    const audit = new AuditService(prisma as any);
    const mapping = new IdentifierMappingService(prisma as any);
    const factory = new ConnectorFactory(prisma as any, config);
    const sync = new AppointmentExternalSync(prisma as any, audit, mapping);
    const reconciliation = new ReconciliationService(prisma as any, audit, factory, sync, config);
    const scheduler = { schedule: async () => undefined } as unknown as ReconciliationScheduler;
    const integration = new IntegrationService(prisma as any, audit, mapping, factory, sync, scheduler, config);
    return { integration, reconciliation, factory };
  }

  async function newAppointment(idempotencyKey: string) {
    const slotStart = new Date(`2031-06-01T${String(9 + appointmentIds.length).padStart(2, "0")}:00:00.000Z`);
    const slotEnd = new Date(slotStart.getTime() + 30 * 60_000);
    const appointment = await prisma.appointment.create({
      data: {
        hospitalId,
        doctorId,
        calendarId,
        patientId,
        slotStart,
        slotEnd,
        status: AppointmentStatus.PENDING,
        idempotencyKey,
        correlationId: `corr-${idempotencyKey}`,
      },
    });
    appointmentIds.push(appointment.id);
    return appointment;
  }

  beforeAll(async () => {
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
    ehr = new MockEhrConnector({ baseUrl, apiKey: API_KEY, timeoutMs: 250 });

    const hospital = await prisma.hospital.create({
      data: { name: `EHR Hospital ${suffix}`, slug: `ehr-hosp-${suffix}`, status: HospitalStatus.APPROVED },
    });
    hospitalId = hospital.id;
    await prisma.healthcareSystemConnection.create({
      data: {
        hospitalId,
        connectorType: "MOCK_EHR",
        baseUrl,
        apiKeyRef: "MOCK_EHR_API_KEY",
      },
    });

    const doctorUser = await prisma.user.create({
      data: { email: `doc-${suffix}@test.local`, passwordHash: "x", role: UserRole.DOCTOR },
    });
    const doctor = await prisma.doctor.create({
      data: { userId: doctorUser.id, hospitalId, name: "Dr. Integration", status: DoctorStatus.ACTIVE },
    });
    doctorId = doctor.id;
    const calendar = await prisma.calendar.create({ data: { doctorId, hospitalId } });
    calendarId = calendar.id;

    const patientUser = await prisma.user.create({
      data: { email: `pat-${suffix}@test.local`, passwordHash: "x", role: UserRole.PATIENT },
    });
    const patient = await prisma.patient.create({ data: { userId: patientUser.id, name: "Pat Integration" } });
    patientId = patient.id;
  });

  afterAll(async () => {
    await prisma.integrationVerification.deleteMany({ where: { integrationOperation: { hospitalId } } });
    await prisma.integrationOperation.deleteMany({ where: { hospitalId } });
    await prisma.reconciliationRecord.deleteMany({ where: { hospitalId } });
    await prisma.appointmentStatusHistory.deleteMany({ where: { appointment: { hospitalId } } });
    await prisma.slotReservation.deleteMany({ where: { appointment: { hospitalId } } });
    await prisma.appointment.deleteMany({ where: { hospitalId } });
    await prisma.externalIdentifierMapping.deleteMany({ where: { hospitalId } });
    await prisma.healthcareSystemConnection.deleteMany({ where: { hospitalId } });
    await prisma.auditEvent.deleteMany({ where: { hospitalId } });
    await prisma.operationalEvent.deleteMany({ where: { hospitalId } });
    await prisma.calendar.deleteMany({ where: { hospitalId } });
    await prisma.doctor.deleteMany({ where: { hospitalId } });
    await prisma.patient.delete({ where: { id: patientId } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { email: { endsWith: `${suffix}@test.local` } } });
    await prisma.hospital.delete({ where: { id: hospitalId } }).catch(() => undefined);
    await prisma.$disconnect();
    await ehr.resetChaos();
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  });

  beforeEach(async () => {
    await ehr.resetStore();
    await ehr.resetChaos();
    await prisma.externalIdentifierMapping.deleteMany({ where: { hospitalId } });
    await prisma.patient.update({ where: { id: patientId }, data: { externalPatientId: null } });
    await prisma.doctor.update({ where: { id: doctorId }, data: { externalProviderId: null } });
  });

  it("happy path: create → verify → sync confirms the appointment", async () => {
    const { integration } = services(testConfig(baseUrl));
    const appointment = await newAppointment(`idem-happy-${suffix}`);

    const result = await integration.createVerifyAndSync({
      hospitalId,
      appointmentId: appointment.id,
      patientId,
      doctorId,
      slotStart: appointment.slotStart,
      slotEnd: appointment.slotEnd,
      idempotencyKey: appointment.idempotencyKey,
      correlationId: appointment.correlationId,
    });

    expect(result.outcome).toBe("CONFIRMED");
    expect(result.appointment.status).toBe(AppointmentStatus.CONFIRMED);
    expect(result.appointment.externalAppointmentId).toBeTruthy();
    expect(store.appointments.size).toBe(1);
  });

  it("Option A: timeout without write, retry succeeds, then verify/sync", async () => {
    await ehr.setChaos({ mode: "timeout_no_create", remainingHits: 1, scope: "appointment_create", timeoutMs: 1200 });
    const { integration } = services(testConfig(baseUrl));
    const appointment = await newAppointment(`idem-a-${suffix}`);

    const result = await integration.createVerifyAndSync(
      {
        hospitalId,
        appointmentId: appointment.id,
        patientId,
        doctorId,
        slotStart: appointment.slotStart,
        slotEnd: appointment.slotEnd,
        idempotencyKey: appointment.idempotencyKey,
        correlationId: appointment.correlationId,
      },
      { maxRetries: 2, retryBaseMs: 20 },
    );

    expect(result.outcome).toBe("CONFIRMED");
    expect(result.appointment.status).toBe(AppointmentStatus.CONFIRMED);
    expect(store.appointments.size).toBe(1);
  }, 15000);

  it("Option B: timeout after write, re-query finds it, no duplicate", async () => {
    await ehr.setChaos({ mode: "timeout_with_create", remainingHits: 5, scope: "appointment_create", timeoutMs: 1200 });
    const { integration, reconciliation } = services(testConfig(baseUrl));
    const appointment = await newAppointment(`idem-b-${suffix}`);

    const result = await integration.createVerifyAndSync(
      {
        hospitalId,
        appointmentId: appointment.id,
        patientId,
        doctorId,
        slotStart: appointment.slotStart,
        slotEnd: appointment.slotEnd,
        idempotencyKey: appointment.idempotencyKey,
        correlationId: appointment.correlationId,
      },
      { maxRetries: 0 },
    );

    expect(result.outcome).toBe("RECONCILIATION_REQUIRED");
    expect(store.appointments.size).toBe(1);

    await ehr.resetChaos();
    const recon = await reconciliation.reconcileAppointment(appointment.id);
    expect(recon?.outcome).toBe(ReconciliationOutcome.FOUND_SYNCED);

    const updated = await prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
    expect(updated.status).toBe(AppointmentStatus.CONFIRMED);
    expect(updated.externalAppointmentId).toBeTruthy();
    expect(store.appointments.size).toBe(1);
  }, 15000);

  it("Option C: persistent outage escalates to a human", async () => {
    await ehr.setChaos({ mode: "error_500", remainingHits: 99, scope: "appointment_create" });
    const { integration, reconciliation } = services(testConfig(baseUrl));
    const appointment = await newAppointment(`idem-c-${suffix}`);

    const result = await integration.createVerifyAndSync(
      {
        hospitalId,
        appointmentId: appointment.id,
        patientId,
        doctorId,
        slotStart: appointment.slotStart,
        slotEnd: appointment.slotEnd,
        idempotencyKey: appointment.idempotencyKey,
        correlationId: appointment.correlationId,
      },
      { maxRetries: 0 },
    );

    expect(result.outcome).toBe("RECONCILIATION_REQUIRED");
    expect(store.appointments.size).toBe(0);

    const recon = await reconciliation.reconcileAppointment(appointment.id);
    expect(recon?.outcome).toBe(ReconciliationOutcome.ESCALATED);

    const events = await prisma.operationalEvent.findMany({
      where: { hospitalId, type: "HUMAN_ESCALATION" },
    });
    expect(events.length).toBeGreaterThan(0);
  });
});
