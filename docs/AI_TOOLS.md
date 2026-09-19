# AI tools and usage

The agent is not allowed to query the database or the EHR. It may only call the **17 capabilities** defined in `shared/src/capabilities.ts`. The backend validates arguments with Zod, runs the matching domain service as the **authenticated patient**, and writes a `CapabilityExecution` row (`success`, `latencyMs`, `correlationId`).

Unknown tool names are rejected in `AiAgentService.invokeCapability` and never reach Prisma.

Source of truth for names and schemas: `shared/src/capabilities.ts`  
OpenAI wrapping: `backend/src/ai-agent/tools.ts`  
Dispatch: `backend/src/capabilities/capabilities.service.ts`

## How a tool call happens

**Text (`POST /api/ai/conversations/:id/messages`)**

1. User message stored.
2. System prompt + last 40 user/assistant texts sent to chat completions with `tool_choice: auto`.
3. Each function call is executed via `CapabilitiesService.execute`.
4. Tool JSON is appended; the model may call again (max **8** rounds).
5. Final assistant text is stored; audit `ai.turn_completed`.

**Voice (`POST /api/ai/realtime/session` then browser WebRTC)**

1. Backend mints an ephemeral Realtime session with the **same** instructions and tools.
2. When the model emits `response.function_call_arguments.done`, `VoiceWidget` POSTs `/api/ai/conversations/:id/tools`.
3. Response is `{ ...capabilityResult, latencyMs }`. Warns in logs if latency > 1500 ms.
4. Widget sends `function_call_output` back to OpenAI and requests the next spoken reply.

**Phone stub:** `POST /api/ai/telephone/simulate` with `{ turns: string[] }` — each string is a text turn on channel `telephone`.

Patients only (`JwtAuthGuard` + `Roles(PATIENT)`). Platform admin can open an existing conversation for support, but cannot start one without a `patientId`.

## Tool catalog

Authorization: `patientId` always comes from the JWT / conversation, not from model-supplied ids (except where the input schema allows an optional id that is then ignored, e.g. `lookup_patient`).

### Discovery

| Tool | When to use | Important inputs | Returns |
| --- | --- | --- | --- |
| `search_hospitals` | Patient names a city, specialty, or hospital | `query`, `specialty`, `department`, `city`, `limit` | Approved hospitals only |
| `search_doctors` | After a hospital (or to find a doctor by name) | `hospitalId`, `specialty`, `department`, `query`, `language`, `limit` | Active doctors at approved hospitals |
| `check_availability` | Before offering any times | `doctorId`, `dateFrom`, `dateTo?`, `limit` | Real slots `{ start, end }` — **never invent** |

### Patient and appointment

| Tool | When to use | Important inputs | Returns |
| --- | --- | --- | --- |
| `lookup_patient` | Need the logged-in profile | `patientId` ignored | Current patient’s summary |
| `get_appointment` | “What’s my booking?” | `appointmentId` or `latestForPatient: true` | Appointment or null |
| `create_appointment` | Book a slot already returned by `check_availability` | `doctorId`, `slotStart`, `slotEnd`, **`idempotencyKey`** | Appointment; status `CONFIRMED` or `RECONCILIATION_REQUIRED` |
| `reschedule_appointment` | Move an existing booking | `appointmentId`, new slot, **`idempotencyKey`** | Updated appointment |
| `cancel_appointment` | Cancel | `appointmentId`, `reason?`, **`idempotencyKey`** | Cancelled appointment |

`idempotencyKey` must be unique per **intent**. Replaying the same key does not create a second row (internal or EHR).

### Questionnaires, notifications, workflows

| Tool | When to use | Important inputs | Returns |
| --- | --- | --- | --- |
| `get_questionnaire` | After a booking, or when the patient is ready for intake | `appointmentId?` | Template + `responseId` (or null) |
| `submit_questionnaire` | After asking questions conversationally | `questionnaireResponseId`, `answers[]` | `{ status: "recorded" }` |
| `send_notification` | Confirmation / reminder style messages | `type`, optional `message`, `appointmentId` | Notification id |
| `start_workflow` | Patient asks for a reminder sequence | `workflowKey`, `appointmentId?` | Workflow execution id |

`start_workflow` only when the patient asks or a named key is known. Booking itself can also trigger hospital workflows from `AppointmentsService` when status becomes `CONFIRMED`.

### Context and preferences

| Tool | When to use | Returns |
| --- | --- | --- |
| `get_context` | “Book that Friday” — recover hospital/doctor/slot already chosen | `intent`, selected hospital/doctor/slot, `currentAppointmentId`, `workflowState` |
| `update_preferences` | SMS vs email, language | Merged preference object |

Context is updated automatically after successful `search_doctors`, `check_availability`, `create_appointment`, `get_appointment`, cancel/reschedule, questionnaire, workflow, and `transfer_to_human`.

### Integration and escalation

| Tool | When to use | Returns |
| --- | --- | --- |
| `verify_external_appointment` | Confirm the EHR still has the booking | `{ verified, externalStatus? }` |
| `synchronize_state` | Pull latest EHR status into the internal appointment | Appointment summary |
| `transfer_to_human` | Clinical ask, unsafe ambiguity, or user requests a person | `{ escalationId, status: "escalated" }` — writes `HUMAN_ESCALATION` |

## Typical happy path

```
search_hospitals → search_doctors → check_availability
    → create_appointment (idempotencyKey)
    → get_questionnaire → (ask each question) → submit_questionnaire
    → send_notification   [optional]
    → start_workflow      [only if asked]
```

If the user says “that doctor on Friday”:

```
get_context → check_availability(doctorId from context, that Friday) → create_appointment
```

## What the model must not do

- Call tools that are not in this list
- Confirm a booking unless `create_appointment` returned `CONFIRMED` (or honestly explain `RECONCILIATION_REQUIRED`)
- Offer times that did not come from `check_availability`
- Pass another patient’s id and expect `lookup_patient` to honor it
- Give medical advice (prompt forbids it; `transfer_to_human` is the escape)

## Observability

Each call writes `CapabilityExecution` and audit `capability.<name>`. Voice also returns `latencyMs` on the HTTP tool response. Traces use the conversation `correlationId`.

## Tests

- `capabilities.service.integration.spec.ts` — unknown name, bad input, search, booking lifecycle, notifications, transfer
- `ai-agent.service.integration.spec.ts` — scripted LLM drives the same tools
- `voice.service.spec.ts` — session mint / missing API key

Tests use `ScriptedLlmClient` so they do not need a live OpenAI key.
