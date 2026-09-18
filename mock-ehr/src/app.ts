import cors from "cors";
import express, { NextFunction, Request, Response } from "express";
import { ChaosEngine, ChaosHttpError } from "./chaos";
import { MemoryStore } from "./store";
import type { ChaosConfig, MockEhrAppOptions } from "./types";

export interface MockEhrApp {
  app: express.Express;
  store: MemoryStore;
  chaos: ChaosEngine;
}

function sendChaos(res: Response, err: ChaosHttpError) {
  res.status(err.status).json({ error: err.message, ...(err.body ?? {}) });
}

export function createMockEhrApp(options: MockEhrAppOptions = {}): MockEhrApp {
  const apiKey = options.apiKey ?? process.env.MOCK_EHR_API_KEY ?? "";
  const store = new MemoryStore();
  const chaos = new ChaosEngine();
  if (options.seed !== false) store.seed();

  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "mock-ehr" });
  });

  app.use((req, res, next) => {
    if (!apiKey) return next();
    const provided =
      (req.header("x-api-key") as string | undefined) ??
      (req.header("authorization")?.replace(/^Bearer\s+/i, "") as string | undefined);
    if (provided !== apiKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    return next();
  });

  // ---- Patients ----
  app.get("/patients", (req, res) => {
    const name = typeof req.query.name === "string" ? req.query.name : undefined;
    const dob = typeof req.query.dob === "string" ? req.query.dob : undefined;
    const phone = typeof req.query.phone === "string" ? req.query.phone : undefined;
    res.json({ patients: store.findPatient({ name, dob, phone }) });
  });

  app.get("/patients/:id", (req, res) => {
    const patient = store.patients.get(req.params.id);
    if (!patient) return res.status(404).json({ error: "Patient not found" });
    return res.json(patient);
  });

  app.post("/patients", (req, res) => {
    const name = req.body?.name;
    if (!name || typeof name !== "string") {
      return res.status(400).json({ error: "name is required" });
    }
    return res.status(201).json(store.createPatient({ name, dob: req.body.dob, phone: req.body.phone }));
  });

  // ---- Providers ----
  app.get("/providers", (req, res) => {
    const name = typeof req.query.name === "string" ? req.query.name : undefined;
    const specialty = typeof req.query.specialty === "string" ? req.query.specialty : undefined;
    res.json({ providers: store.findProvider({ name, specialty }) });
  });

  app.get("/providers/:id", (req, res) => {
    const provider = store.providers.get(req.params.id);
    if (!provider) return res.status(404).json({ error: "Provider not found" });
    return res.json(provider);
  });

  app.post("/providers", (req, res) => {
    const name = req.body?.name;
    if (!name || typeof name !== "string") {
      return res.status(400).json({ error: "name is required" });
    }
    return res.status(201).json(store.createProvider({ name, specialty: req.body.specialty }));
  });

  // ---- Facilities ----
  app.get("/facilities", (_req, res) => {
    res.json({ facilities: [...store.facilities.values()] });
  });

  app.get("/facilities/:id", (req, res) => {
    const facility = store.facilities.get(req.params.id);
    if (!facility) return res.status(404).json({ error: "Facility not found" });
    return res.json(facility);
  });

  app.post("/facilities", (req, res) => {
    const name = req.body?.name;
    if (!name || typeof name !== "string") {
      return res.status(400).json({ error: "name is required" });
    }
    return res.status(201).json(store.createFacility({ name }));
  });

  // ---- Calendar / availability (stubbed windows the connector can query) ----
  app.get("/calendars/:providerId", (req, res) => {
    const provider = store.providers.get(req.params.providerId);
    if (!provider) return res.status(404).json({ error: "Provider not found" });
    return res.json({
      providerId: provider.id,
      timezone: "UTC",
      workingHours: [{ dayOfWeek: 1, start: "09:00", end: "17:00" }],
    });
  });

  app.get("/availability", (req, res) => {
    const providerId = typeof req.query.providerId === "string" ? req.query.providerId : undefined;
    if (!providerId || !store.providers.has(providerId)) {
      return res.status(400).json({ error: "providerId is required and must exist" });
    }
    return res.json({
      providerId,
      slots: [],
      note: "Availability is owned by the platform scheduling service; this is a lookup stub.",
    });
  });

  // ---- Appointments ----
  app.post("/appointments", async (req, res) => {
    try {
      const instruction = await chaos.apply("appointment_create");
      const { externalPatientId, externalProviderId, externalFacilityId, start, end, idempotencyKey } = req.body ?? {};
      if (!externalPatientId || !externalProviderId || !start || !end || !idempotencyKey) {
        return res.status(400).json({
          error: "externalPatientId, externalProviderId, start, end, and idempotencyKey are required",
        });
      }
      if (!store.patients.has(externalPatientId)) {
        return res.status(404).json({ error: "Patient not found", code: "MISSING_ENTITY" });
      }
      if (!store.providers.has(externalProviderId)) {
        return res.status(404).json({ error: "Provider not found", code: "MISSING_ENTITY" });
      }

      let created: boolean;
      let appointment;
      try {
        ({ appointment, created } = store.createAppointment({
          externalPatientId,
          externalProviderId,
          externalFacilityId,
          start,
          end,
          idempotencyKey,
        }));
      } catch (err) {
        if ((err as { code?: string }).code === "SLOT_CONFLICT") {
          return res.status(409).json({ error: (err as Error).message, code: "SLOT_CONFLICT" });
        }
        throw err;
      }

      await chaos.delayIfNeeded(instruction);
      return res.status(created ? 201 : 200).json(appointment);
    } catch (err) {
      if (err instanceof ChaosHttpError) return sendChaos(res, err);
      throw err;
    }
  });

  app.get("/appointments", (req, res) => {
    const key = typeof req.query.idempotencyKey === "string" ? req.query.idempotencyKey : undefined;
    if (key) {
      const appointment = store.getAppointmentByIdempotency(key);
      if (!appointment) return res.status(404).json({ error: "Appointment not found" });
      return res.json(appointment);
    }
    return res.json({ appointments: [...store.appointments.values()] });
  });

  app.get("/appointments/:id", (req, res) => {
    const appointment = store.appointments.get(req.params.id);
    if (!appointment) return res.status(404).json({ error: "Appointment not found" });
    return res.json(appointment);
  });

  app.get("/appointments/:id/verify", (req, res) => {
    const appointment = store.appointments.get(req.params.id);
    if (!appointment) {
      return res.json({ exists: false, verified: false });
    }
    return res.json({
      exists: true,
      verified: true,
      status: appointment.status,
      start: appointment.start,
      end: appointment.end,
      appointment,
    });
  });

  app.patch("/appointments/:id", (req, res) => {
    const updated = store.updateAppointment(req.params.id, {
      start: req.body?.start,
      end: req.body?.end,
      status: req.body?.status,
    });
    if (!updated) return res.status(404).json({ error: "Appointment not found" });
    return res.json(updated);
  });

  app.post("/appointments/:id/cancel", (req, res) => {
    const updated = store.cancelAppointment(req.params.id);
    if (!updated) return res.status(404).json({ error: "Appointment not found" });
    return res.json(updated);
  });

  // ---- Chaos (used by the required failure/recovery demo) ----
  app.get("/chaos", (_req, res) => {
    res.json(chaos.get());
  });

  app.post("/chaos", (req, res) => {
    const body = (req.body ?? {}) as Partial<ChaosConfig>;
    res.json(chaos.set(body));
  });

  app.delete("/chaos", (_req, res) => {
    res.json(chaos.reset());
  });

  // ---- Admin ----
  app.post("/admin/reset", (_req, res) => {
    store.reset();
    store.seed();
    chaos.reset();
    res.json({ ok: true, stats: store.stats() });
  });

  app.get("/admin/stats", (_req, res) => {
    res.json(store.stats());
  });

  app.use(((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    // eslint-disable-next-line no-console
    console.error("[mock-ehr]", err);
    res.status(500).json({ error: err.message || "Internal error" });
  }) as express.ErrorRequestHandler);

  return { app, store, chaos };
}
