import { z } from "zod";
import { CapabilityName, NotificationType } from "./enums";

/**
 * These are the ONLY actions the AI agent may invoke. Every schema here is
 * the contract enforced server-side by the capabilities module — the AI
 * never touches the database or the EHR directly (PRD §10/§20).
 */

const isoDateTime = z.string().datetime({ offset: true });

export const HospitalSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  city: z.string().optional(),
  departments: z.array(z.string()).optional(),
  specialties: z.array(z.string()).optional(),
});

export const DoctorSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  hospitalId: z.string(),
  specialty: z.string().optional(),
  department: z.string().optional(),
  languages: z.array(z.string()).optional(),
  consultationTypes: z.array(z.string()).optional(),
});

export const SlotSummarySchema = z.object({
  doctorId: z.string(),
  start: isoDateTime,
  end: isoDateTime,
  appointmentTypeId: z.string().optional(),
});

export const AppointmentSummarySchema = z.object({
  id: z.string(),
  status: z.string(),
  doctorId: z.string(),
  hospitalId: z.string(),
  patientId: z.string(),
  slotStart: isoDateTime,
  slotEnd: isoDateTime,
  externalAppointmentId: z.string().nullable().optional(),
});

// ---- search_hospitals ----
export const SearchHospitalsInput = z.object({
  query: z.string().optional(),
  specialty: z.string().optional(),
  department: z.string().optional(),
  city: z.string().optional(),
  limit: z.number().int().min(1).max(20).default(5),
});
export const SearchHospitalsOutput = z.object({
  hospitals: z.array(HospitalSummarySchema),
});

// ---- search_doctors ----
export const SearchDoctorsInput = z.object({
  hospitalId: z.string().optional(),
  specialty: z.string().optional(),
  department: z.string().optional(),
  query: z.string().optional(),
  language: z.string().optional(),
  limit: z.number().int().min(1).max(20).default(5),
});
export const SearchDoctorsOutput = z.object({
  doctors: z.array(DoctorSummarySchema),
});

// ---- check_availability ----
export const CheckAvailabilityInput = z.object({
  doctorId: z.string(),
  appointmentTypeId: z.string().optional(),
  dateFrom: z.string(),
  dateTo: z.string().optional(),
  limit: z.number().int().min(1).max(50).default(10),
});
export const CheckAvailabilityOutput = z.object({
  slots: z.array(SlotSummarySchema),
});

// ---- lookup_patient ----
export const LookupPatientInput = z.object({
  patientId: z.string().optional(),
});
export const LookupPatientOutput = z.object({
  patient: z
    .object({
      id: z.string(),
      name: z.string(),
      communicationPreference: z.string().optional(),
    })
    .nullable(),
});

// ---- get_appointment ----
export const GetAppointmentInput = z.object({
  appointmentId: z.string().optional(),
  latestForPatient: z.boolean().optional(),
});
export const GetAppointmentOutput = z.object({
  appointment: AppointmentSummarySchema.nullable(),
});

// ---- create_appointment ----
export const CreateAppointmentInput = z.object({
  doctorId: z.string(),
  slotStart: isoDateTime,
  slotEnd: isoDateTime,
  appointmentTypeId: z.string().optional(),
  reasonNote: z.string().max(500).optional(),
  idempotencyKey: z.string(),
});
export const CreateAppointmentOutput = z.object({
  appointment: AppointmentSummarySchema,
});

// ---- reschedule_appointment ----
export const RescheduleAppointmentInput = z.object({
  appointmentId: z.string(),
  newSlotStart: isoDateTime,
  newSlotEnd: isoDateTime,
  idempotencyKey: z.string(),
});
export const RescheduleAppointmentOutput = z.object({
  appointment: AppointmentSummarySchema,
});

// ---- cancel_appointment ----
export const CancelAppointmentInput = z.object({
  appointmentId: z.string(),
  reason: z.string().max(500).optional(),
  idempotencyKey: z.string(),
});
export const CancelAppointmentOutput = z.object({
  appointment: AppointmentSummarySchema,
});

// ---- get_questionnaire ----
export const GetQuestionnaireInput = z.object({
  appointmentId: z.string().optional(),
  questionnaireId: z.string().optional(),
});
export const GetQuestionnaireOutput = z.object({
  questionnaire: z
    .object({
      id: z.string(),
      title: z.string(),
      questions: z.array(
        z.object({
          id: z.string(),
          prompt: z.string(),
          type: z.string(),
          options: z.array(z.string()).optional(),
          required: z.boolean().optional(),
        }),
      ),
    })
    .nullable(),
  responseId: z.string().nullable(),
  responseStatus: z.string().nullable(),
});

// ---- submit_questionnaire ----
export const SubmitQuestionnaireInput = z.object({
  questionnaireResponseId: z.string(),
  answers: z.array(
    z.object({
      questionId: z.string(),
      value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]),
    }),
  ),
});
export const SubmitQuestionnaireOutput = z.object({
  responseId: z.string(),
  status: z.literal("recorded"),
});

// ---- send_notification ----
const notificationTypeValues = Object.values(NotificationType) as [
  NotificationType,
  ...NotificationType[],
];
export const SendNotificationInput = z.object({
  type: z.enum(notificationTypeValues),
  recipientPatientId: z.string().optional(),
  appointmentId: z.string().optional(),
  message: z.string().max(1000).optional(),
});
export const SendNotificationOutput = z.object({
  notificationId: z.string(),
  status: z.string(),
});

// ---- start_workflow ----
export const StartWorkflowInput = z.object({
  workflowKey: z.string(),
  appointmentId: z.string().optional(),
  params: z.record(z.unknown()).optional(),
});
export const StartWorkflowOutput = z.object({
  workflowExecutionId: z.string(),
  status: z.string(),
});

// ---- get_context ----
export const GetContextInput = z.object({});
export const GetContextOutput = z.object({
  intent: z.string().nullable(),
  selectedHospitalId: z.string().nullable(),
  selectedDoctorId: z.string().nullable(),
  selectedSlot: SlotSummarySchema.nullable(),
  currentAppointmentId: z.string().nullable(),
  workflowState: z.record(z.unknown()).nullable(),
});

// ---- update_preferences ----
export const UpdatePreferencesInput = z.object({
  communicationPreference: z.string().optional(),
  preferredLanguage: z.string().optional(),
  other: z.record(z.unknown()).optional(),
});
export const UpdatePreferencesOutput = z.object({
  preferences: z.record(z.unknown()),
});

// ---- verify_external_appointment ----
export const VerifyExternalAppointmentInput = z.object({
  appointmentId: z.string(),
});
export const VerifyExternalAppointmentOutput = z.object({
  verified: z.boolean(),
  externalStatus: z.string().optional(),
});

// ---- synchronize_state ----
export const SynchronizeStateInput = z.object({
  appointmentId: z.string(),
});
export const SynchronizeStateOutput = z.object({
  appointment: AppointmentSummarySchema,
});

// ---- transfer_to_human ----
export const TransferToHumanInput = z.object({
  reason: z.string(),
  urgency: z.enum(["low", "medium", "high"]).default("medium"),
});
export const TransferToHumanOutput = z.object({
  escalationId: z.string(),
  status: z.string(),
});

export const CapabilitySchemas: Record<
  CapabilityName,
  { input: z.ZodTypeAny; output: z.ZodTypeAny; description: string }
> = {
  [CapabilityName.SEARCH_HOSPITALS]: {
    input: SearchHospitalsInput,
    output: SearchHospitalsOutput,
    description: "Find approved hospitals matching a specialty, department, city, or free-text query.",
  },
  [CapabilityName.SEARCH_DOCTORS]: {
    input: SearchDoctorsInput,
    output: SearchDoctorsOutput,
    description: "Find active doctors, optionally scoped to a hospital, specialty, department, or language.",
  },
  [CapabilityName.CHECK_AVAILABILITY]: {
    input: CheckAvailabilityInput,
    output: CheckAvailabilityOutput,
    description: "Get real bookable slots for a doctor within a date range. Never invent slots.",
  },
  [CapabilityName.LOOKUP_PATIENT]: {
    input: LookupPatientInput,
    output: LookupPatientOutput,
    description: "Look up the authenticated patient's own profile summary.",
  },
  [CapabilityName.GET_APPOINTMENT]: {
    input: GetAppointmentInput,
    output: GetAppointmentOutput,
    description: "Retrieve a specific appointment or the patient's latest appointment.",
  },
  [CapabilityName.CREATE_APPOINTMENT]: {
    input: CreateAppointmentInput,
    output: CreateAppointmentOutput,
    description: "Book a real, previously-checked available slot. Requires an idempotency key.",
  },
  [CapabilityName.RESCHEDULE_APPOINTMENT]: {
    input: RescheduleAppointmentInput,
    output: RescheduleAppointmentOutput,
    description: "Move an existing appointment to a new real available slot.",
  },
  [CapabilityName.CANCEL_APPOINTMENT]: {
    input: CancelAppointmentInput,
    output: CancelAppointmentOutput,
    description: "Cancel an existing appointment.",
  },
  [CapabilityName.GET_QUESTIONNAIRE]: {
    input: GetQuestionnaireInput,
    output: GetQuestionnaireOutput,
    description: "Fetch the pre-visit questionnaire assigned to an appointment.",
  },
  [CapabilityName.SUBMIT_QUESTIONNAIRE]: {
    input: SubmitQuestionnaireInput,
    output: SubmitQuestionnaireOutput,
    description: "Record structured answers collected conversationally for a questionnaire.",
  },
  [CapabilityName.SEND_NOTIFICATION]: {
    input: SendNotificationInput,
    output: SendNotificationOutput,
    description: "Send a configured notification to a patient or related party.",
  },
  [CapabilityName.START_WORKFLOW]: {
    input: StartWorkflowInput,
    output: StartWorkflowOutput,
    description: "Kick off an asynchronous workflow (e.g. reminder sequence) for an appointment.",
  },
  [CapabilityName.GET_CONTEXT]: {
    input: GetContextInput,
    output: GetContextOutput,
    description: "Read the current conversation's retained context (selected hospital/doctor/slot/appointment).",
  },
  [CapabilityName.UPDATE_PREFERENCES]: {
    input: UpdatePreferencesInput,
    output: UpdatePreferencesOutput,
    description: "Update the patient's communication/appointment preferences.",
  },
  [CapabilityName.VERIFY_EXTERNAL_APPOINTMENT]: {
    input: VerifyExternalAppointmentInput,
    output: VerifyExternalAppointmentOutput,
    description: "Verify an appointment against the external healthcare system before confirming success.",
  },
  [CapabilityName.SYNCHRONIZE_STATE]: {
    input: SynchronizeStateInput,
    output: SynchronizeStateOutput,
    description: "Synchronize internal appointment state with the verified external record.",
  },
  [CapabilityName.TRANSFER_TO_HUMAN]: {
    input: TransferToHumanInput,
    output: TransferToHumanOutput,
    description: "Escalate the conversation to a human when the AI cannot safely proceed.",
  },
};
