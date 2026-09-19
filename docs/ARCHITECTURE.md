# Architecture

How AI.Prof is put together: processes, data, booking/EHR, AI, and tenancy.

## 1. System context

```
Patient / Doctor / Hospital admin / Platform admin
                 │
                 ▼
        React + Vite  :5173
                 │  JWT
                 ▼
        NestJS API    :4000
           │    │    │
           │    │    └── OpenAI (chat + Realtime session mint)
           │    └── mock EHR :4100  (create / verify / chaos)
           └── PostgreSQL
                Redis? ── BullMQ workflows + reconciliation
                     └── if down: in-process timers
```

Telephone is **not** a live carrier. `POST /api/ai/telephone/simulate` replays spoken turns through the same text agent.

## 2. Workspaces

| Package | Responsibility |
| --- | --- |
| `shared/` | Enums (roles, appointment states, capability names) and Zod input/output for every AI tool |
| `mock-ehr/` | In-memory EHR: patients, providers, appointments, idempotency, chaos engine |
| `backend/` | Auth, hospitals, doctors, scheduling, appointments, integration, capabilities, AI, questionnaires, workflows, observability |
| `frontend/` | Role-routed dashboards; chat + WebRTC voice on the patient home |

The backend never lets the LLM touch Prisma or HTTP to the EHR. The model only names a capability; `CapabilitiesService` runs it.

## 3. Backend modules

```
AppModule
  Auth          JWT login / register / me
  Hospitals     onboarding + platform review
  Doctors       roster + public search of ACTIVE at APPROVED hospitals
  Patients      self profile / preferences
  Scheduling    working hours, leave, blocks, slot math, SlotReservation
  Appointments  state machine + book / reschedule / cancel
  Integration   MockEhrConnector, identifier mapping, create-verify-sync
  Reconciliation  Found→sync / NotFound→same-key retry / else escalate
  Capabilities  sole AI surface (17 named tools)
  AiAgent       text loop + voice mint + telephone stub
  Questionnaires  templates + matching + answers
  Workflows     triggers after CONFIRMED (queue or in-process)
  Notifications in-app (and log) messages
  Audit         AuditEvent + OperationalEvent + observability APIs
  Demo          platform failure-recovery script
```

Global: `PrismaModule`, `ThrottlerGuard` (120/min; login/register 10/min), Helmet, `ValidationPipe` whitelist.

## 4. Identity and tenancy

JWT carries `userId`, `role`, and optional `hospitalId` / `doctorId` / `patientId`.

Helpers in `backend/src/common/tenant.ts`:

- `assertHospitalScope` — hospital admin/doctor stay inside their hospital; platform admin bypasses
- `assertSelfPatient` / `assertSelfDoctor` — own records only

Hospital A calling Hospital B appointments, questionnaires, metrics, or staff doctor lists gets **403**.

## 5. Appointment state

```
REQUESTED → PENDING (slot reserved)
    → CONFIRMED                 EHR create+verify succeeded
    → RECONCILIATION_REQUIRED   write may have happened; outcome unknown
    → FAILED                    definitive failure; slot freed
    → RESCHEDULED / CANCELLED / COMPLETED / NO_SHOW
```

Active states that still occupy a slot: `REQUESTED`, `PENDING`, `CONFIRMED`, `SYNCHRONIZATION_PENDING`, `RECONCILIATION_REQUIRED`.

`SlotReservation` is unique on `(doctorId, slotStart)` so two concurrent books cannot both win.

## 6. Booking and EHR path

```
Patient / AI create_appointment
        │
        ▼
Revalidate slot (working hours, leave, busy)
        │
        ▼
Transaction: Appointment REQUESTED→PENDING + SlotReservation
        │
        ▼
Integration.createVerifyAndSync
  map patient/doctor/facility ids
  POST EHR /appointments  (idempotencyKey)
  GET  verify
  pull + sync → CONFIRMED
        │
        ├── timeout / unknown → RECONCILIATION_REQUIRED (hold kept)
        └── hard failure      → FAILED (hold released)
```

Reconciliation **never** mints a new idempotency key. It looks up by external id or the original key, then syncs or retries the same key.

Chaos modes on the mock EHR (`appointment_create` scope): `timeout_no_create`, `timeout_with_create`, `error_500`, `outage`, `slot_conflict`, plus auth/rate-limit/validation. Platform **Run failure demo** scripts Option B (`timeout_with_create`) through `AppointmentsService.create` and then reconcile.

## 7. AI runtime

Two channels, one capability layer:

| Channel | Model | How tools run |
| --- | --- | --- |
| Text | `OPENAI_CHAT_MODEL` (default `gpt-4o-mini`), temperature 0.2 | Up to 8 tool rounds in `AiAgentService.sendMessage` |
| Voice | `OPENAI_REALTIME_MODEL` (default `gpt-4o-realtime-preview`) | Browser WebRTC; each function call hits `POST /api/ai/conversations/:id/tools` |
| Phone stub | same text agent | `simulateTelephone` feeds strings as user turns |

Shared system prompt: `buildSystemPrompt()` in `backend/src/ai-agent/system-prompt.ts` (see [AI_PROMPTS.md](./AI_PROMPTS.md)).

Tool schemas: `shared/src/capabilities.ts` → OpenAI function tools in `backend/src/ai-agent/tools.ts` (see [AI_TOOLS.md](./AI_TOOLS.md)).

Conversation context (`AIContext`) remembers selected hospital/doctor/slot/appointment and questionnaire/workflow ids so the model can call `get_context` instead of asking the patient to repeat themselves.

## 8. Frontend routing

| Path | Role |
| --- | --- |
| `/login`, `/register`, `/register-hospital` | public |
| `/app` | PATIENT |
| `/doctor` | DOCTOR |
| `/hospital`, `/hospital/observability` | HOSPITAL_ADMIN |
| `/platform`, `/platform/observability` | PLATFORM_ADMIN |

## 9. Data stores (Prisma)

Logical groups in `backend/prisma/schema.prisma`:

- **Identity:** User, Hospital, Doctor, Patient, HospitalStaff
- **Scheduling:** Calendar, WorkingHour, BlockedSlot, LeaveDay, SlotReservation
- **Clinical-admin:** Appointment, AppointmentStatusHistory, AppointmentType, Questionnaire*
- **AI:** AIConversation, AIMessage, AIContext, CapabilityExecution
- **Integration:** HealthcareSystemConnection, ExternalIdentifierMapping, IntegrationOperation, IntegrationVerification, ReconciliationRecord
- **Ops:** AuditEvent, OperationalEvent, Workflow, WorkflowExecution, Notification

Transactional state, conversation state, user context, workflows, integration, and operational events are separate tables — not one JSON blob.

## 10. Observability

- **Audit:** who did what (`appointment.requested`, `capability.*`, `ai.turn_completed`, `demo.failure_recovery`, …)
- **Operational:** timeouts, escalations, reconciliation
- **Trace:** `GET /api/platform/trace/:correlationId` (or hospital-scoped) stitches appointments, audit, integration, capabilities, workflows

Hospital admins only see their `hospitalId` slice.

## 11. What is not in this prototype

- Epic/Cerner connectors (same `IntegrationConnector` interface; only mock EHR is wired)
- Real PSTN
- Per-hospital timezone slot math (timezone stored; math is UTC)
- Production host Dockerfiles / Railway (Compose is local Postgres + Redis only)
