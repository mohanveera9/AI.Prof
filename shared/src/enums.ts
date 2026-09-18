// Enums are modeled as `as const` objects + derived union types (not TS
// `enum`) so their values are plain string literals — structurally
// assignable to/from Prisma's generated enum types with no casting at
// every call site where DB data flows into API/AI-layer types.

export const UserRole = {
  PLATFORM_ADMIN: "PLATFORM_ADMIN",
  HOSPITAL_ADMIN: "HOSPITAL_ADMIN",
  DOCTOR: "DOCTOR",
  PATIENT: "PATIENT",
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const HospitalStatus = {
  DRAFT: "DRAFT",
  SUBMITTED: "SUBMITTED",
  UNDER_REVIEW: "UNDER_REVIEW",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  SUSPENDED: "SUSPENDED",
} as const;
export type HospitalStatus = (typeof HospitalStatus)[keyof typeof HospitalStatus];

export const DoctorStatus = {
  INVITED: "INVITED",
  ACTIVE: "ACTIVE",
  INACTIVE: "INACTIVE",
  SUSPENDED: "SUSPENDED",
} as const;
export type DoctorStatus = (typeof DoctorStatus)[keyof typeof DoctorStatus];

export const AppointmentStatus = {
  REQUESTED: "REQUESTED",
  PENDING: "PENDING",
  CONFIRMED: "CONFIRMED",
  RESCHEDULED: "RESCHEDULED",
  CANCELLED: "CANCELLED",
  COMPLETED: "COMPLETED",
  NO_SHOW: "NO_SHOW",
  FAILED: "FAILED",
  SYNCHRONIZATION_PENDING: "SYNCHRONIZATION_PENDING",
  RECONCILIATION_REQUIRED: "RECONCILIATION_REQUIRED",
} as const;
export type AppointmentStatus = (typeof AppointmentStatus)[keyof typeof AppointmentStatus];

/** Terminal states an appointment cannot leave. */
export const APPOINTMENT_TERMINAL_STATES = new Set<AppointmentStatus>([
  AppointmentStatus.CANCELLED,
  AppointmentStatus.COMPLETED,
  AppointmentStatus.NO_SHOW,
]);

/** States that mean "the slot is still held" — must block a doctor+slot from being reused. */
export const APPOINTMENT_ACTIVE_STATES = new Set<AppointmentStatus>([
  AppointmentStatus.REQUESTED,
  AppointmentStatus.PENDING,
  AppointmentStatus.CONFIRMED,
  AppointmentStatus.SYNCHRONIZATION_PENDING,
  AppointmentStatus.RECONCILIATION_REQUIRED,
]);

export const QuestionFieldType = {
  YES_NO: "YES_NO",
  CHOICE: "CHOICE",
  MULTIPLE_CHOICE: "MULTIPLE_CHOICE",
  NUMERIC: "NUMERIC",
  DATE: "DATE",
  SHORT_TEXT: "SHORT_TEXT",
  LONG_TEXT: "LONG_TEXT",
  STRUCTURED: "STRUCTURED",
} as const;
export type QuestionFieldType = (typeof QuestionFieldType)[keyof typeof QuestionFieldType];

export const IntegrationFailureType = {
  TIMEOUT: "TIMEOUT",
  AUTH_FAILURE: "AUTH_FAILURE",
  AUTHZ_FAILURE: "AUTHZ_FAILURE",
  RATE_LIMITED: "RATE_LIMITED",
  OUTAGE: "OUTAGE",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  MAPPING_ERROR: "MAPPING_ERROR",
  MISSING_ENTITY: "MISSING_ENTITY",
  SLOT_CONFLICT: "SLOT_CONFLICT",
  DUPLICATE_REQUEST: "DUPLICATE_REQUEST",
  PARTIAL_SUCCESS: "PARTIAL_SUCCESS",
  UNKNOWN_OUTCOME: "UNKNOWN_OUTCOME",
} as const;
export type IntegrationFailureType = (typeof IntegrationFailureType)[keyof typeof IntegrationFailureType];

export const IntegrationOperationType = {
  PATIENT_LOOKUP: "PATIENT_LOOKUP",
  PROVIDER_LOOKUP: "PROVIDER_LOOKUP",
  FACILITY_LOOKUP: "FACILITY_LOOKUP",
  CALENDAR_LOOKUP: "CALENDAR_LOOKUP",
  AVAILABILITY_LOOKUP: "AVAILABILITY_LOOKUP",
  APPOINTMENT_CREATE: "APPOINTMENT_CREATE",
  APPOINTMENT_UPDATE: "APPOINTMENT_UPDATE",
  APPOINTMENT_CANCEL: "APPOINTMENT_CANCEL",
  APPOINTMENT_RETRIEVE: "APPOINTMENT_RETRIEVE",
  APPOINTMENT_VERIFY: "APPOINTMENT_VERIFY",
} as const;
export type IntegrationOperationType = (typeof IntegrationOperationType)[keyof typeof IntegrationOperationType];

export const IntegrationOperationStatus = {
  PENDING: "PENDING",
  SUCCESS: "SUCCESS",
  FAILED: "FAILED",
  UNKNOWN: "UNKNOWN",
  VERIFIED: "VERIFIED",
} as const;
export type IntegrationOperationStatus = (typeof IntegrationOperationStatus)[keyof typeof IntegrationOperationStatus];

export const ReconciliationOutcome = {
  PENDING: "PENDING",
  FOUND_SYNCED: "FOUND_SYNCED",
  SAFELY_RETRIED: "SAFELY_RETRIED",
  ESCALATED: "ESCALATED",
} as const;
export type ReconciliationOutcome = (typeof ReconciliationOutcome)[keyof typeof ReconciliationOutcome];

export const WorkflowExecutionStatus = {
  PENDING: "PENDING",
  RUNNING: "RUNNING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  RETRIED: "RETRIED",
} as const;
export type WorkflowExecutionStatus = (typeof WorkflowExecutionStatus)[keyof typeof WorkflowExecutionStatus];

export const NotificationType = {
  APPOINTMENT_CONFIRMATION: "APPOINTMENT_CONFIRMATION",
  APPOINTMENT_REMINDER: "APPOINTMENT_REMINDER",
  APPOINTMENT_CANCELLATION: "APPOINTMENT_CANCELLATION",
  APPOINTMENT_RESCHEDULED: "APPOINTMENT_RESCHEDULED",
  QUESTIONNAIRE_REMINDER: "QUESTIONNAIRE_REMINDER",
  IMPORTANT_UPDATE: "IMPORTANT_UPDATE",
  NEW_APPOINTMENT: "NEW_APPOINTMENT",
  APPLICATION_STATUS: "APPLICATION_STATUS",
  INTEGRATION_FAILURE: "INTEGRATION_FAILURE",
  OPERATIONAL_ALERT: "OPERATIONAL_ALERT",
} as const;
export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];

export const AuditEventCategory = {
  LOGIN_ACCESS: "LOGIN_ACCESS",
  APPOINTMENT_OPERATION: "APPOINTMENT_OPERATION",
  PATIENT_DATA_ACCESS: "PATIENT_DATA_ACCESS",
  AI_ACTION: "AI_ACTION",
  CAPABILITY_EXECUTION: "CAPABILITY_EXECUTION",
  INTEGRATION_OPERATION: "INTEGRATION_OPERATION",
  CONFIGURATION_CHANGE: "CONFIGURATION_CHANGE",
  ADMINISTRATIVE_ACTION: "ADMINISTRATIVE_ACTION",
} as const;
export type AuditEventCategory = (typeof AuditEventCategory)[keyof typeof AuditEventCategory];

export const OperationalEventType = {
  INTEGRATION_RETRY: "INTEGRATION_RETRY",
  INTEGRATION_OUTCOME: "INTEGRATION_OUTCOME",
  RECONCILIATION_REQUIRED: "RECONCILIATION_REQUIRED",
  WORKFLOW_STATE_CHANGE: "WORKFLOW_STATE_CHANGE",
  HUMAN_ESCALATION: "HUMAN_ESCALATION",
} as const;
export type OperationalEventType = (typeof OperationalEventType)[keyof typeof OperationalEventType];

export const ExternalEntityType = {
  PATIENT: "PATIENT",
  DOCTOR: "DOCTOR",
  APPOINTMENT: "APPOINTMENT",
  FACILITY: "FACILITY",
} as const;
export type ExternalEntityType = (typeof ExternalEntityType)[keyof typeof ExternalEntityType];

/**
 * Tool/function names exposed to the AI agent — kept lowercase snake_case
 * (matches the PRD's own naming and reads naturally as OpenAI tool names).
 * This is the ONLY vocabulary the AI is allowed to act through.
 */
export const CapabilityName = {
  SEARCH_HOSPITALS: "search_hospitals",
  SEARCH_DOCTORS: "search_doctors",
  CHECK_AVAILABILITY: "check_availability",
  LOOKUP_PATIENT: "lookup_patient",
  GET_APPOINTMENT: "get_appointment",
  CREATE_APPOINTMENT: "create_appointment",
  RESCHEDULE_APPOINTMENT: "reschedule_appointment",
  CANCEL_APPOINTMENT: "cancel_appointment",
  GET_QUESTIONNAIRE: "get_questionnaire",
  SUBMIT_QUESTIONNAIRE: "submit_questionnaire",
  SEND_NOTIFICATION: "send_notification",
  START_WORKFLOW: "start_workflow",
  GET_CONTEXT: "get_context",
  UPDATE_PREFERENCES: "update_preferences",
  VERIFY_EXTERNAL_APPOINTMENT: "verify_external_appointment",
  SYNCHRONIZE_STATE: "synchronize_state",
  TRANSFER_TO_HUMAN: "transfer_to_human",
} as const;
export type CapabilityName = (typeof CapabilityName)[keyof typeof CapabilityName];
