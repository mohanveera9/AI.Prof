import { AddressInfo } from "net";
import type { Server } from "http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createMockEhrApp } from "./app";

const API_KEY = "test-key";

async function listen(app: ReturnType<typeof createMockEhrApp>["app"]): Promise<{ server: Server; baseUrl: string }> {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const { port } = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

describe("mock-ehr service", () => {
  const { app, store } = createMockEhrApp({ apiKey: API_KEY, seed: true });
  let server: Server;
  let baseUrl: string;

  async function req(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    headers.set("x-api-key", API_KEY);
    if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
    return fetch(`${baseUrl}${path}`, { ...init, headers });
  }

  beforeAll(async () => {
    ({ server, baseUrl } = await listen(app));
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  });

  beforeEach(async () => {
    await req("/admin/reset", { method: "POST" });
  });

  it("rejects missing API keys", async () => {
    const res = await fetch(`${baseUrl}/patients`);
    expect(res.status).toBe(401);
  });

  it("looks up seeded patients and creates new ones", async () => {
    const listed = await req("/patients?name=Jane");
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as { patients: { id: string }[] };
    expect(body.patients.length).toBeGreaterThan(0);

    const created = await req("/patients", {
      method: "POST",
      body: JSON.stringify({ name: "Sam Patient", dob: "1985-01-01" }),
    });
    expect(created.status).toBe(201);
  });

  it("creates an appointment once per idempotency key", async () => {
    const first = await req("/appointments", {
      method: "POST",
      body: JSON.stringify({
        externalPatientId: "pat_jane",
        externalProviderId: "prv_chen",
        externalFacilityId: "fac_riverside",
        start: "2031-01-06T09:00:00.000Z",
        end: "2031-01-06T09:30:00.000Z",
        idempotencyKey: "idem-1",
      }),
    });
    expect(first.status).toBe(201);
    const created = (await first.json()) as { id: string };

    const replay = await req("/appointments", {
      method: "POST",
      body: JSON.stringify({
        externalPatientId: "pat_jane",
        externalProviderId: "prv_chen",
        start: "2031-01-06T09:00:00.000Z",
        end: "2031-01-06T09:30:00.000Z",
        idempotencyKey: "idem-1",
      }),
    });
    expect(replay.status).toBe(200);
    const replayed = (await replay.json()) as { id: string };
    expect(replayed.id).toBe(created.id);
    expect(store.appointments.size).toBe(1);
  });

  it("verifies an appointment that exists", async () => {
    const createdRes = await req("/appointments", {
      method: "POST",
      body: JSON.stringify({
        externalPatientId: "pat_jane",
        externalProviderId: "prv_chen",
        start: "2031-01-07T10:00:00.000Z",
        end: "2031-01-07T10:30:00.000Z",
        idempotencyKey: "idem-verify",
      }),
    });
    const created = (await createdRes.json()) as { id: string };
    const verify = await req(`/appointments/${created.id}/verify`);
    const body = (await verify.json()) as { verified: boolean; exists: boolean };
    expect(body.verified).toBe(true);
    expect(body.exists).toBe(true);
  });

  it("injects a 500 without creating an appointment", async () => {
    await req("/chaos", {
      method: "POST",
      body: JSON.stringify({ mode: "error_500", remainingHits: 1, scope: "appointment_create" }),
    });
    const res = await req("/appointments", {
      method: "POST",
      body: JSON.stringify({
        externalPatientId: "pat_jane",
        externalProviderId: "prv_chen",
        start: "2031-01-08T10:00:00.000Z",
        end: "2031-01-08T10:30:00.000Z",
        idempotencyKey: "idem-500",
      }),
    });
    expect(res.status).toBe(500);
    expect(store.appointments.size).toBe(0);
  });

  it("timeout_with_create writes the appointment before hanging", async () => {
    await req("/chaos", {
      method: "POST",
      body: JSON.stringify({
        mode: "timeout_with_create",
        remainingHits: 1,
        scope: "appointment_create",
        timeoutMs: 40,
      }),
    });
    const res = await req("/appointments", {
      method: "POST",
      body: JSON.stringify({
        externalPatientId: "pat_jane",
        externalProviderId: "prv_chen",
        start: "2031-01-09T10:00:00.000Z",
        end: "2031-01-09T10:30:00.000Z",
        idempotencyKey: "idem-timeout-create",
      }),
    });
    expect(res.status).toBe(201);
    expect(store.appointments.size).toBe(1);
  });
});
