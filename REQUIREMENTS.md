# Requirements

Specification for the autonomous multi-hospital patient intake, scheduling, and pre-visit voice agent. This describes what the current codebase implements.

## 1. System requirements

Listed in compact form in [requirements.txt](./requirements.txt).

| Kind | Requirement |
| --- | --- |
| Runtime | Node.js 20 or newer, npm 10 or newer |
| Database | PostgreSQL 16 |
| Cache / queues | Redis 7 optional; in-process fallback when Redis is down |
| Local infra | Docker Compose for Postgres and Redis |
| LLM (optional for APIs) | OpenAI API key for text agent and Realtime voice |
| Browsers | Modern Chromium/Firefox/Safari with WebRTC for live voice |

Application libraries are **not** listed here. Install them with `npm install` from the workspace `package.json` files (`shared`, `mock-ehr`, `backend`, `frontend`).

## 2. Actors and tenancy

| Actor | Must be able to |
| --- | --- |
| Patient | Register, search approved hospitals/doctors, book/reschedule/cancel, complete questionnaires, talk to the agent (text/voice) |
| Doctor | See own calendar and appointments; complete visits; mark no-shows |
| Hospital admin | Manage doctors, working hours, questionnaires, workflows; see only that hospital’s data |
| Platform admin | Review/approve/suspend hospitals; observe all tenants; run chaos and the failure-recovery demo |

**FR-T1.** Hospital A must never read Hospital B’s private data (appointments, questionnaires, observability, staff-only doctor lists). Cross-tenant access returns **403**.

**FR-T2.** Patients act only on their own records. Doctors act only on their own schedule unless a hospital/platform admin is in scope.

**FR-T3.** Platform admins may operate across hospitals.

## 3. Hospital onboarding

**FR-H1.** A hospital can submit an application (draft → submitted → under review → approved / rejected).

**FR-H2.** Approved hospitals can be suspended and reactivated by the platform.

**FR-H3.** Only approved hospitals appear in patient/AI discovery.

## 4. Scheduling and appointments

**FR-S1.** Bookable slots come from doctor working hours minus leave, blocked periods, and appointments in active states (`REQUESTED`, `PENDING`, `CONFIRMED`, `SYNCHRONIZATION_PENDING`, `RECONCILIATION_REQUIRED`).

**FR-S2.** Availability is revalidated immediately before booking.

**FR-S3.** Concurrent booking of the same doctor+start time allows only one winner (unique `SlotReservation`).

**FR-S4.** Booking is idempotent: the same `idempotencyKey` does not create a second internal appointment.

**FR-S5.** Reschedule releases the old slot and holds the new one. Cancel frees the slot.

**FR-S6.** Doctors can mark `COMPLETED` or `NO_SHOW`. Terminal states cannot be rescheduled.

## 5. External EHR integration

**FR-E1.** Creates use **create → verify → sync**. Success is not reported until the external record is verified.

**FR-E2.** Every create uses a stable idempotency key. Retries and reconciliation never issue a **new** key for the same booking.

**FR-E3.** Timeout with no write: retry same key, or mark failed and free the slot.

**FR-E4.** Timeout after write (unknown outcome): `RECONCILIATION_REQUIRED`, keep the slot hold.

**FR-E5.** Reconciliation re-queries by external id or original idempotency key:

- Found → sync to `CONFIRMED` (`FOUND_SYNCED`)
- Not found → retry create with the **same** key
- Exhausted / unrecoverable → escalate (`ESCALATED`)

**FR-E6.** A failure-recovery demo must show mid-booking chaos, recovery to `CONFIRMED`, and **no duplicate** EHR row.

**FR-E7.** Mock EHR supports injected failures: `timeout_no_create`, `timeout_with_create`, `error_500`, `outage`, `slot_conflict`, plus auth/rate-limit/validation modes.

## 6. AI agent

**FR-A1.** The model may invoke only the controlled capability list (17 tools). Unknown tool names are rejected and never reach Prisma or the EHR.

**FR-A2.** Authorization is taken from the authenticated patient, not from ids the model invents (`lookup_patient` always resolves to the current user).

**FR-A3.** Text chat uses tool-calling. Voice uses browser WebRTC; tool execution stays on the backend.

**FR-A4.** Telephone is out of scope for the live demo (simulate endpoint only).

**FR-A5.** Each capability execution is recorded with success, error, `latencyMs`, and correlation id.

## 7. Questionnaires and workflows

**FR-Q1.** Hospitals define templates. Matching prefers doctor → appointment type → specialty → generic.

**FR-Q2.** Patients can load pending questionnaires and submit answers incrementally until complete.

**FR-W1.** Appointment confirmed can start configured workflows (e.g. questionnaire + reminders).

**FR-W2.** Workflow steps run on BullMQ when Redis is up, otherwise on in-process timers.

## 8. Observability and audit

**FR-O1.** Separate streams: audit (“who did what”) and operational events (“system health”).

**FR-O2.** Platform and hospital dashboards show metrics, audit, operational events, escalations, and a correlation-id trace.

**FR-O3.** Audit metadata must not store raw clinical content.

## 9. Non-functional

| ID | Requirement |
| --- | --- |
| NFR-1 | JWT authentication; role-based authorization on mutating and tenant-scoped reads |
| NFR-2 | Request validation (whitelist, reject unknown fields) |
| NFR-3 | HTTP security headers (Helmet) |
| NFR-4 | Rate limit: 120 requests / minute globally; 10 / minute on login and patient register |
| NFR-5 | `JWT_SECRET` required at boot; production secret must be at least 32 characters |
| NFR-6 | Voice tool HTTP responses include `latencyMs`; warn when over 1500 ms |
| NFR-7 | Integration tests cover booking, Option B timeout recovery, tenant isolation, capabilities, workflows, observability |

## 10. Out of scope (this prototype)

- Production Epic/Cerner connectors (interface exists; only mock EHR is implemented)
- Real PSTN / telephone carrier
- Per-hospital timezone slot math (calendars store timezone; computation is UTC)
- Railway/production container deploy (Compose covers local Postgres/Redis only)
