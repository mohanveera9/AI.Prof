# AI.Prof

Multi-tenant healthcare platform for patient intake, real-slot scheduling, EHR verify-then-sync, and a pre-visit AI agent (text + browser voice). Telephone calling is a stub.

**Stack:** NestJS + Prisma + PostgreSQL · React (Vite) · mock EHR (Express) · optional Redis/BullMQ · OpenAI Chat + Realtime WebRTC

```
frontend (:5173)  →  backend (:4000)  →  PostgreSQL
                                 ↘      mock EHR (:4100)
                                 ↘      Redis (:6379) — optional; jobs fall back in-process
```

## Requirements

| Doc | What it covers |
| --- | --- |
| [REQUIREMENTS.md](./REQUIREMENTS.md) | Functional and non-functional requirements |
| [requirements.txt](./requirements.txt) | Node / Postgres / Docker versions |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | Modules, booking/EHR path, tenancy, data |
| [docs/AI_TOOLS.md](./docs/AI_TOOLS.md) | All 17 capabilities, when to call them, HTTP paths |
| [docs/AI_PROMPTS.md](./docs/AI_PROMPTS.md) | System prompt, tool descriptions, fallbacks |

Application packages are in each workspace `package.json` and install with `npm install`.

| Tool | Version |
| --- | --- |
| Node.js | >= 20 |
| npm | >= 10 |
| PostgreSQL | 16 (Docker image below) |
| Redis | 7 (optional) |
| Docker | for local Postgres/Redis |

## Workspaces

| Package | Path | Role |
| --- | --- | --- |
| `@ai-prof/shared` | `shared/` | Roles, appointment states, capability Zod contracts |
| `@ai-prof/mock-ehr` | `mock-ehr/` | Standalone EHR + chaos modes (timeouts, 500s, conflicts) |
| `@ai-prof/backend` | `backend/` | Auth, RBAC, scheduling, integration, AI, workflows |
| `@ai-prof/frontend` | `frontend/` | Login + patient / doctor / hospital / platform UIs |

## Local setup

### 1. Clone and install

```bash
git clone https://github.com/mohanveera9/AI.Prof.git
cd AI.Prof
npm install
```

### 2. Environment

```bash
cp .env.example backend/.env
cp .env.example mock-ehr/.env
cp .env.example frontend/.env
```

Set at least:

- `JWT_SECRET` — required; production needs 32+ characters
- `DATABASE_URL` — must match Postgres (compose defaults to `postgresql://postgres:postgres@localhost:5432/ai_prof`)
- `OPENAI_API_KEY` — needed for text chat and live voice; booking APIs work without it
- `MOCK_EHR_API_KEY` — same value in backend and mock-EHR (example: `dev-shared-secret`)

Do not commit real `.env` files.

### 3. Database

```bash
docker compose up -d postgres redis
npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed
```

If you already have a local database user (for example `ai_prof` / `ai_prof_dev`), put that URL in `backend/.env` instead of the compose default.

Seed creates one account:

| Role | Email | Password |
| --- | --- | --- |
| Platform admin | `admin@ai-prof.dev` | `PlatformAdmin123!` |

Register patients at `/register` and hospitals at `/register-hospital`. Approve a hospital from the platform dashboard, then add doctors and working hours from the hospital dashboard.

### 4. Run the three app processes

Use three terminals:

```bash
npm run dev:mock-ehr
npm run dev:backend
npm run dev:frontend
```

| Service | URL |
| --- | --- |
| Frontend | http://localhost:5173 |
| Backend API | http://localhost:4000/api |
| Health | http://localhost:4000/api/health |
| Mock EHR | http://localhost:4100 |

Redis is optional. If `REDIS_URL` is down, reconciliation and workflows still run in-process.

## App routes

| Role | After login |
| --- | --- |
| Patient | `/app` — chat, voice, appointments, questionnaires |
| Doctor | `/doctor` — schedule and visit outcomes |
| Hospital admin | `/hospital` — doctors, calendar, questionnaires, workflows |
| Platform admin | `/platform` — hospital review, chaos, failure demo, operations |
| Observability | `/platform/observability` or `/hospital/observability` |

## How booking and EHR sync work

1. Availability is computed from working hours, leave, blocks, and held slots.
2. The chosen slot is revalidated, then reserved in a transaction (`SlotReservation` unique on doctor + start).
3. The appointment is pushed to the mock EHR with an **idempotency key**, verified, then marked `CONFIRMED`.
4. Timeouts after a write go to `RECONCILIATION_REQUIRED` (slot stays held). Reconcile finds the existing EHR row and syncs — it never creates a second appointment with a new key.
5. Confirmed bookings can start questionnaires and reminder workflows.

**Failure demo (platform dashboard):** **Run failure demo** injects `timeout_with_create`, books a real slot, then reconciles to `CONFIRMED` with no duplicate EHR row. The correlation id is on the result panel and in Observability → Trace.

## AI agent

The model may call only these server-side capabilities (never Prisma or the EHR directly):

`search_hospitals` · `search_doctors` · `check_availability` · `lookup_patient` · `get_appointment` · `create_appointment` · `reschedule_appointment` · `cancel_appointment` · `get_questionnaire` · `submit_questionnaire` · `send_notification` · `start_workflow` · `get_context` · `update_preferences` · `verify_external_appointment` · `synchronize_state` · `transfer_to_human`

- **Text:** OpenAI chat tool-calling at `/api/ai/conversations`
- **Voice:** browser WebRTC against OpenAI Realtime; tools execute on the backend and return `latencyMs` (warns if > 1500 ms)
- **Phone:** `/api/ai/telephone/simulate` stub only

## Security notes

- JWT + role guards; hospital staff cannot read another hospital’s appointments, questionnaires, metrics, or staff doctor lists (403)
- Patients and doctors are scoped to their own records
- Global rate limit 120 req/min; login and register 10 req/min
- Helmet, validation whitelist, no secrets in audit metadata

## Tests and build

```bash
npm test                 # backend Jest (integration + unit)
npm test -w mock-ehr     # mock EHR Vitest
npm run build            # shared → mock-ehr → backend → frontend
npm start -w backend     # serves dist/main.js after a backend build
```

Backend tests expect PostgreSQL (uses `backend/.env`).

## Mock EHR chaos

Platform admin can set chaos on `POST /api/platform/integration/chaos`:

`none` · `timeout_no_create` · `timeout_with_create` · `error_500` · `outage` · `slot_conflict`

`timeout_with_create` writes the appointment then hangs so the client times out — used by the failure-recovery demo.

## Project layout

```
shared/          contracts and enums
mock-ehr/        EHR simulator + chaos
backend/         Nest API, Prisma schema, tests
  prisma/        schema + migrations + seed
frontend/        Vite + React dashboards
docker-compose.yml
.env.example
```
