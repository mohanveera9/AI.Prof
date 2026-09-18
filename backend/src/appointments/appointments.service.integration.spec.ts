import { AddressInfo } from "net";
import type { Server } from "http";
import { BadRequestException } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { ConfigService } from "@nestjs/config";
import { nanoid } from "nanoid";
import { AppointmentStatus, DoctorStatus, HospitalStatus, UserRole } from "@ai-prof/shared";
import { createMockEhrApp } from "../../../mock-ehr/src/app";
import { AuditService } from "../audit/audit.service";
import { SchedulingService } from "../scheduling/scheduling.service";
import { IdentifierMappingService } from "../integration/identifier-mapping.service";
import { ConnectorFactory } from "../integration/connector.factory";
import { AppointmentExternalSync } from "../integration/appointment-external-sync";
import { IntegrationService } from "../integration/integration.service";
import { ReconciliationScheduler } from "../reconciliation/reconciliation.scheduler";
import { ReconciliationService } from "../reconciliation/reconciliation.service";
import { MockEhrConnector } from "../integration/mock-ehr.connector";
import { AppointmentsService } from "./appointments.service";
import { RequestUser } from "../common/types";

/**
 * Checkpoint for Chunk 5: full patient-facing booking orchestration —
 * revalidated real availability, transactional double-booking prevention,
 * EHR create/verify/sync, reschedule (old slot released, new slot held),
 * and cancellation (slot freed, best-effort EHR cancel).
 */
describe("AppointmentsService (integration)", () => {
  const prisma = new PrismaClient();
  const { app, store } = createMockEhrApp({ apiKey: "chunk5-test-key", seed: false });
  let server: Server;
  let baseUrl: string;
  let ehr: MockEhrConnector;
  let appointments: AppointmentsService;
  let reconciliation: ReconciliationService;

  const suffix = nanoid(6);
  let hospitalId: string;
  let doctorId: string;
  let patientId: string;
  let patientUser: RequestUser;
  let doctorActor: RequestUser;

  function testConfig(): ConfigService {
    const values: Record<string, string | number> = {
      MOCK_EHR_BASE_URL: baseUrl,
      MOCK_EHR_API_KEY: "chunk5-test-key",
      MOCK_EHR_TIMEOUT_MS: 1000,
      INTEGRATION_MAX_RETRIES: 1,
      INTEGRATION_RETRY_BASE_MS: 10,
      RECONCILIATION_MAX_ATTEMPTS: 1,
      RECONCILIATION_AUTO_RUN: "false",
    };
    return { get: (key: string, def?: unknown) => values[key] ?? def } as unknown as ConfigService;
  }

  beforeAll(async () => {
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
    ehr = new MockEhrConnector({ baseUrl, apiKey: "chunk5-test-key", timeoutMs: 1000 });

    const hospital = await prisma.hospital.create({
      data: { name: `Appt Hospital ${suffix}`, slug: `appt-hosp-${suffix}`, status: HospitalStatus.APPROVED },
    });
    hospitalId = hospital.id;
    await prisma.healthcareSystemConnection.create({
      data: { hospitalId, connectorType: "MOCK_EHR", baseUrl, apiKeyRef: "MOCK_EHR_API_KEY" },
    });

    const doctorUser = await prisma.user.create({
      data: { email: `doc-appt-${suffix}@test.local`, passwordHash: "x", role: UserRole.DOCTOR },
    });
    const doctor = await prisma.doctor.create({
      data: { userId: doctorUser.id, hospitalId, name: "Dr. Appointments", status: DoctorStatus.ACTIVE },
    });
    doctorId = doctor.id;
    doctorActor = { userId: doctorUser.id, role: UserRole.DOCTOR, hospitalId, doctorId };

    const scheduling = new SchedulingService(prisma as any);
    await scheduling.createCalendarForDoctor(doctorId, hospitalId);
    const calendar = await prisma.calendar.findFirstOrThrow({ where: { doctorId } });
    await prisma.workingHour.create({
      data: { calendarId: calendar.id, dayOfWeek: 1, startMinute: 9 * 60, endMinute: 17 * 60 },
    });

    const patUser = await prisma.user.create({
      data: { email: `pat-appt-${suffix}@test.local`, passwordHash: "x", role: UserRole.PATIENT },
    });
    const patient = await prisma.patient.create({ data: { userId: patUser.id, name: "Appt Patient" } });
    patientId = patient.id;
    patientUser = { userId: patUser.id, role: UserRole.PATIENT, patientId };

    const audit = new AuditService(prisma as any);
    const mapping = new IdentifierMappingService(prisma as any);
    const factory = new ConnectorFactory(prisma as any, testConfig());
    const sync = new AppointmentExternalSync(prisma as any, audit, mapping);
    const reconciliationScheduler = { schedule: async () => undefined } as unknown as ReconciliationScheduler;
    reconciliation = new ReconciliationService(prisma as any, audit, factory, sync, testConfig());
    const integrationService = new IntegrationService(
      prisma as any,
      audit,
      mapping,
      factory,
      sync,
      reconciliationScheduler,
      testConfig(),
    );
    appointments = new AppointmentsService(prisma as any, audit, scheduling, integrationService);
  });

  afterAll(async () => {
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
    await prisma.$disconnect();
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  });

  function nextMonday9am(weeksAhead = 1): Date {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + ((1 + 7 - d.getUTCDay()) % 7 || 7) + (weeksAhead - 1) * 7);
    d.setUTCHours(9, 0, 0, 0);
    return d;
  }

  it("books a real available slot end-to-end and confirms it", async () => {
    const slotStart = nextMonday9am(1);
    const slotEnd = new Date(slotStart.getTime() + 30 * 60_000);

    const result = await appointments.create(patientId, patientUser, {
      doctorId,
      slotStart: slotStart.toISOString(),
      slotEnd: slotEnd.toISOString(),
    });

    expect(result.status).toBe(AppointmentStatus.CONFIRMED);
    expect(result.externalAppointmentId).toBeTruthy();

    const reservation = await prisma.slotReservation.findUnique({ where: { appointmentId: result.id } });
    expect(reservation).not.toBeNull();
  });

  it("replays the same idempotency key without creating a duplicate", async () => {
    const slotStart = nextMonday9am(2);
    const slotEnd = new Date(slotStart.getTime() + 30 * 60_000);
    const idempotencyKey = `idem-replay-${suffix}`;

    const first = await appointments.create(patientId, patientUser, {
      doctorId,
      slotStart: slotStart.toISOString(),
      slotEnd: slotEnd.toISOString(),
      idempotencyKey,
    });
    const second = await appointments.create(patientId, patientUser, {
      doctorId,
      slotStart: slotStart.toISOString(),
      slotEnd: slotEnd.toISOString(),
      idempotencyKey,
    });

    expect(second.id).toBe(first.id);
    // Only one internal appointment row exists for this idempotency key.
    const rows = await prisma.appointment.findMany({ where: { idempotencyKey } });
    expect(rows).toHaveLength(1);
  });

  it("only lets one of two concurrent bookings for the same slot succeed", async () => {
    const slotStart = nextMonday9am(3);
    const slotEnd = new Date(slotStart.getTime() + 30 * 60_000);

    const results = await Promise.allSettled([
      appointments.create(patientId, patientUser, {
        doctorId,
        slotStart: slotStart.toISOString(),
        slotEnd: slotEnd.toISOString(),
      }),
      appointments.create(patientId, patientUser, {
        doctorId,
        slotStart: slotStart.toISOString(),
        slotEnd: slotEnd.toISOString(),
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(BadRequestException);
  });

  it("reschedules a confirmed appointment: old slot freed, new slot held", async () => {
    const originalStart = nextMonday9am(4);
    const originalEnd = new Date(originalStart.getTime() + 30 * 60_000);
    const booked = await appointments.create(patientId, patientUser, {
      doctorId,
      slotStart: originalStart.toISOString(),
      slotEnd: originalEnd.toISOString(),
    });
    expect(booked.status).toBe(AppointmentStatus.CONFIRMED);

    const newStart = new Date(originalStart.getTime() + 30 * 60_000);
    const newEnd = new Date(newStart.getTime() + 30 * 60_000);

    const rescheduled = await appointments.reschedule(booked.id, patientUser, {
      newSlotStart: newStart.toISOString(),
      newSlotEnd: newEnd.toISOString(),
    });

    expect(rescheduled.status).toBe(AppointmentStatus.CONFIRMED);
    expect(rescheduled.slotStart).toBe(newStart.toISOString());

    const oldSlotFree = await appointments.create(patientId, patientUser, {
      doctorId,
      slotStart: originalStart.toISOString(),
      slotEnd: originalEnd.toISOString(),
    });
    expect(oldSlotFree.status).toBe(AppointmentStatus.CONFIRMED);
  });

  it("cancels an appointment: slot freed and EHR record cancelled", async () => {
    const slotStart = nextMonday9am(5);
    const slotEnd = new Date(slotStart.getTime() + 30 * 60_000);
    const booked = await appointments.create(patientId, patientUser, {
      doctorId,
      slotStart: slotStart.toISOString(),
      slotEnd: slotEnd.toISOString(),
    });

    const cancelled = await appointments.cancel(booked.id, patientUser, { reason: "changed my mind" });
    expect(cancelled.status).toBe(AppointmentStatus.CANCELLED);

    const reservation = await prisma.slotReservation.findUnique({ where: { appointmentId: booked.id } });
    expect(reservation).toBeNull();

    const externalRecord = [...store.appointments.values()].find((a) => a.id === cancelled.externalAppointmentId);
    expect(externalRecord?.status).toBe("cancelled");

    const rebooked = await appointments.create(patientId, patientUser, {
      doctorId,
      slotStart: slotStart.toISOString(),
      slotEnd: slotEnd.toISOString(),
    });
    expect(rebooked.status).toBe(AppointmentStatus.CONFIRMED);
  });

  it("refuses to reschedule a cancelled appointment", async () => {
    const slotStart = nextMonday9am(6);
    const slotEnd = new Date(slotStart.getTime() + 30 * 60_000);
    const booked = await appointments.create(patientId, patientUser, {
      doctorId,
      slotStart: slotStart.toISOString(),
      slotEnd: slotEnd.toISOString(),
    });
    await appointments.cancel(booked.id, patientUser, { reason: "never mind" });

    await expect(
      appointments.reschedule(booked.id, patientUser, {
        newSlotStart: new Date(slotStart.getTime() + 30 * 60_000).toISOString(),
        newSlotEnd: new Date(slotStart.getTime() + 60 * 60_000).toISOString(),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("replays a cancel idempotency key without double-cancelling side effects", async () => {
    const slotStart = nextMonday9am(7);
    const slotEnd = new Date(slotStart.getTime() + 30 * 60_000);
    const booked = await appointments.create(patientId, patientUser, {
      doctorId,
      slotStart: slotStart.toISOString(),
      slotEnd: slotEnd.toISOString(),
    });
    const first = await appointments.cancel(booked.id, patientUser, { reason: "first", idempotencyKey: `cancel-${suffix}` });
    const second = await appointments.cancel(booked.id, patientUser, { reason: "second", idempotencyKey: `cancel-${suffix}` });
    expect(first.status).toBe(AppointmentStatus.CANCELLED);
    expect(second.id).toBe(first.id);
    const history = await prisma.appointmentStatusHistory.findMany({
      where: { appointmentId: booked.id, toStatus: AppointmentStatus.CANCELLED },
    });
    expect(history).toHaveLength(1);
  });

  it("lets the doctor complete an appointment and keeps the original correlation id", async () => {
    const slotStart = nextMonday9am(8);
    const slotEnd = new Date(slotStart.getTime() + 30 * 60_000);
    const booked = await appointments.create(patientId, patientUser, {
      doctorId,
      slotStart: slotStart.toISOString(),
      slotEnd: slotEnd.toISOString(),
    });
    const before = await prisma.appointment.findUniqueOrThrow({ where: { id: booked.id } });

    const completed = await appointments.complete(booked.id, doctorActor, "visit finished");
    expect(completed.status).toBe(AppointmentStatus.COMPLETED);

    const after = await prisma.appointment.findUniqueOrThrow({ where: { id: booked.id } });
    expect(after.correlationId).toBe(before.correlationId);

    const reservation = await prisma.slotReservation.findUnique({ where: { appointmentId: booked.id } });
    expect(reservation).toBeNull();
  });

  it("lets the doctor mark a no-show", async () => {
    const slotStart = nextMonday9am(9);
    const slotEnd = new Date(slotStart.getTime() + 30 * 60_000);
    const booked = await appointments.create(patientId, patientUser, {
      doctorId,
      slotStart: slotStart.toISOString(),
      slotEnd: slotEnd.toISOString(),
    });
    const marked = await appointments.markNoShow(booked.id, doctorActor);
    expect(marked.status).toBe(AppointmentStatus.NO_SHOW);
  });

  it("recovers Option B timeout_with_create through booking without duplicating the EHR row", async () => {
    const slotStart = nextMonday9am(10);
    const slotEnd = new Date(slotStart.getTime() + 30 * 60_000);
    const before = store.appointments.size;

    await ehr.setChaos({
      mode: "timeout_with_create",
      remainingHits: 5,
      timeoutMs: 1500,
      scope: "appointment_create",
    });

    try {
      const booked = await appointments.create(patientId, patientUser, {
        doctorId,
        slotStart: slotStart.toISOString(),
        slotEnd: slotEnd.toISOString(),
        reasonNote: "option-b isolation test",
      });
      expect(booked.status).toBe(AppointmentStatus.RECONCILIATION_REQUIRED);
      expect(store.appointments.size).toBe(before + 1);

      const hold = await prisma.slotReservation.findUnique({ where: { appointmentId: booked.id } });
      expect(hold).not.toBeNull();
    } finally {
      await ehr.resetChaos();
    }

    const pending = await prisma.appointment.findFirstOrThrow({
      where: { hospitalId, status: AppointmentStatus.RECONCILIATION_REQUIRED },
      orderBy: { createdAt: "desc" },
    });
    await reconciliation.reconcileAppointment(pending.id);

    const recovered = await prisma.appointment.findUniqueOrThrow({ where: { id: pending.id } });
    expect(recovered.status).toBe(AppointmentStatus.CONFIRMED);
    expect(recovered.externalAppointmentId).toBeTruthy();
    expect(store.appointments.size).toBe(before + 1);
  }, 20_000);
});
