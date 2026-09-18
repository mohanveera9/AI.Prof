-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('PLATFORM_ADMIN', 'HOSPITAL_ADMIN', 'DOCTOR', 'PATIENT');

-- CreateEnum
CREATE TYPE "HospitalStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "DoctorStatus" AS ENUM ('INVITED', 'ACTIVE', 'INACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('REQUESTED', 'PENDING', 'CONFIRMED', 'RESCHEDULED', 'CANCELLED', 'COMPLETED', 'NO_SHOW', 'FAILED', 'SYNCHRONIZATION_PENDING', 'RECONCILIATION_REQUIRED');

-- CreateEnum
CREATE TYPE "QuestionFieldType" AS ENUM ('YES_NO', 'CHOICE', 'MULTIPLE_CHOICE', 'NUMERIC', 'DATE', 'SHORT_TEXT', 'LONG_TEXT', 'STRUCTURED');

-- CreateEnum
CREATE TYPE "ExternalEntityType" AS ENUM ('PATIENT', 'DOCTOR', 'APPOINTMENT', 'FACILITY');

-- CreateEnum
CREATE TYPE "IntegrationOperationType" AS ENUM ('PATIENT_LOOKUP', 'PROVIDER_LOOKUP', 'FACILITY_LOOKUP', 'CALENDAR_LOOKUP', 'AVAILABILITY_LOOKUP', 'APPOINTMENT_CREATE', 'APPOINTMENT_UPDATE', 'APPOINTMENT_CANCEL', 'APPOINTMENT_RETRIEVE', 'APPOINTMENT_VERIFY');

-- CreateEnum
CREATE TYPE "IntegrationOperationStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'UNKNOWN', 'VERIFIED');

-- CreateEnum
CREATE TYPE "IntegrationFailureType" AS ENUM ('TIMEOUT', 'AUTH_FAILURE', 'AUTHZ_FAILURE', 'RATE_LIMITED', 'OUTAGE', 'VALIDATION_ERROR', 'MAPPING_ERROR', 'MISSING_ENTITY', 'SLOT_CONFLICT', 'DUPLICATE_REQUEST', 'PARTIAL_SUCCESS', 'UNKNOWN_OUTCOME');

-- CreateEnum
CREATE TYPE "ReconciliationOutcome" AS ENUM ('PENDING', 'FOUND_SYNCED', 'SAFELY_RETRIED', 'ESCALATED');

-- CreateEnum
CREATE TYPE "WorkflowExecutionStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'RETRIED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('APPOINTMENT_CONFIRMATION', 'APPOINTMENT_REMINDER', 'APPOINTMENT_CANCELLATION', 'APPOINTMENT_RESCHEDULED', 'QUESTIONNAIRE_REMINDER', 'IMPORTANT_UPDATE', 'NEW_APPOINTMENT', 'APPLICATION_STATUS', 'INTEGRATION_FAILURE', 'OPERATIONAL_ALERT');

-- CreateEnum
CREATE TYPE "AuditEventCategory" AS ENUM ('LOGIN_ACCESS', 'APPOINTMENT_OPERATION', 'PATIENT_DATA_ACCESS', 'AI_ACTION', 'CAPABILITY_EXECUTION', 'INTEGRATION_OPERATION', 'CONFIGURATION_CHANGE', 'ADMINISTRATIVE_ACTION');

-- CreateEnum
CREATE TYPE "OperationalEventType" AS ENUM ('INTEGRATION_RETRY', 'INTEGRATION_OUTCOME', 'RECONCILIATION_REQUIRED', 'WORKFLOW_STATE_CHANGE', 'HUMAN_ESCALATION');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformSettings" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Hospital" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "addressLine" TEXT,
    "city" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "operatingHours" JSONB,
    "status" "HospitalStatus" NOT NULL DEFAULT 'DRAFT',
    "rejectionReason" TEXT,
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "reviewedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Hospital_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HospitalStaff" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HospitalStaff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Specialty" (
    "id" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Specialty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Doctor" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "hospitalId" TEXT NOT NULL,
    "departmentId" TEXT,
    "name" TEXT NOT NULL,
    "invitedEmail" TEXT,
    "photoUrl" TEXT,
    "qualifications" TEXT,
    "experienceYears" INTEGER,
    "languages" TEXT[],
    "consultationTypes" TEXT[],
    "defaultAppointmentDurationMinutes" INTEGER NOT NULL DEFAULT 30,
    "externalProviderId" TEXT,
    "status" "DoctorStatus" NOT NULL DEFAULT 'INVITED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Doctor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DoctorSpecialty" (
    "doctorId" TEXT NOT NULL,
    "specialtyId" TEXT NOT NULL,

    CONSTRAINT "DoctorSpecialty_pkey" PRIMARY KEY ("doctorId","specialtyId")
);

-- CreateTable
CREATE TABLE "Calendar" (
    "id" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Calendar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkingHour" (
    "id" TEXT NOT NULL,
    "calendarId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,

    CONSTRAINT "WorkingHour_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlockedSlot" (
    "id" TEXT NOT NULL,
    "calendarId" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BlockedSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveDay" (
    "id" TEXT NOT NULL,
    "calendarId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaveDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppointmentType" (
    "id" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppointmentType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SlotReservation" (
    "id" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "slotStart" TIMESTAMP(3) NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SlotReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Patient" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dateOfBirth" TIMESTAMP(3),
    "phone" TEXT,
    "communicationPreference" TEXT NOT NULL DEFAULT 'EMAIL',
    "preferredLanguage" TEXT,
    "externalPatientId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Patient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPreference" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Appointment" (
    "id" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "calendarId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "appointmentTypeId" TEXT,
    "slotStart" TIMESTAMP(3) NOT NULL,
    "slotEnd" TIMESTAMP(3) NOT NULL,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'REQUESTED',
    "reasonNote" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "externalAppointmentId" TEXT,
    "correlationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppointmentStatusHistory" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "fromStatus" "AppointmentStatus",
    "toStatus" "AppointmentStatus" NOT NULL,
    "reason" TEXT,
    "actor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppointmentStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Questionnaire" (
    "id" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "specialtyId" TEXT,
    "doctorId" TEXT,
    "appointmentTypeId" TEXT,
    "approvedConditionTag" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Questionnaire_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionnaireQuestion" (
    "id" TEXT NOT NULL,
    "questionnaireId" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "type" "QuestionFieldType" NOT NULL,
    "options" TEXT[],
    "required" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "QuestionnaireQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionnaireResponse" (
    "id" TEXT NOT NULL,
    "questionnaireId" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuestionnaireResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionnaireAnswer" (
    "id" TEXT NOT NULL,
    "responseId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "valueText" TEXT,
    "valueNumber" DOUBLE PRECISION,
    "valueBoolean" BOOLEAN,
    "valueJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuestionnaireAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIConversation" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "AIConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "toolName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIContext" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "intent" TEXT,
    "selectedHospitalId" TEXT,
    "selectedDoctorId" TEXT,
    "selectedSlotStart" TIMESTAMP(3),
    "selectedSlotEnd" TIMESTAMP(3),
    "currentAppointmentId" TEXT,
    "workflowState" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AIContext_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CapabilityExecution" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT,
    "capabilityName" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "output" JSONB,
    "success" BOOLEAN NOT NULL,
    "errorMessage" TEXT,
    "latencyMs" INTEGER,
    "idempotencyKey" TEXT,
    "correlationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CapabilityExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIEvaluation" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT,
    "scenarioKey" TEXT NOT NULL,
    "input" TEXT NOT NULL,
    "expectedOutcome" JSONB NOT NULL,
    "actualOutcome" JSONB NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HealthcareSystemConnection" (
    "id" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "connectorType" TEXT NOT NULL DEFAULT 'MOCK_EHR',
    "baseUrl" TEXT NOT NULL,
    "apiKeyRef" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HealthcareSystemConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalIdentifierMapping" (
    "id" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "entityType" "ExternalEntityType" NOT NULL,
    "internalId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalIdentifierMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationOperation" (
    "id" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "appointmentId" TEXT,
    "type" "IntegrationOperationType" NOT NULL,
    "status" "IntegrationOperationStatus" NOT NULL DEFAULT 'PENDING',
    "failureType" "IntegrationFailureType",
    "requestPayload" JSONB,
    "responsePayload" JSONB,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "idempotencyKey" TEXT,
    "correlationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationOperation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationVerification" (
    "id" TEXT NOT NULL,
    "integrationOperationId" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL,
    "externalStatus" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntegrationVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationRecord" (
    "id" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "outcome" "ReconciliationOutcome" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "details" JSONB,
    "escalatedToUserId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReconciliationRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workflow" (
    "id" TEXT NOT NULL,
    "hospitalId" TEXT,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "steps" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workflow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowExecution" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "appointmentId" TEXT,
    "status" "WorkflowExecutionStatus" NOT NULL DEFAULT 'PENDING',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "scheduledFor" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "error" TEXT,
    "correlationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "recipientUserId" TEXT NOT NULL,
    "appointmentId" TEXT,
    "type" "NotificationType" NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'CONSOLE',
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SENT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "category" "AuditEventCategory" NOT NULL,
    "actorUserId" TEXT,
    "hospitalId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "metadata" JSONB,
    "correlationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperationalEvent" (
    "id" TEXT NOT NULL,
    "type" "OperationalEventType" NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'INFO',
    "hospitalId" TEXT,
    "correlationId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperationalEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformSettings_key_key" ON "PlatformSettings"("key");

-- CreateIndex
CREATE UNIQUE INDEX "Hospital_slug_key" ON "Hospital"("slug");

-- CreateIndex
CREATE INDEX "Hospital_status_idx" ON "Hospital"("status");

-- CreateIndex
CREATE UNIQUE INDEX "HospitalStaff_userId_key" ON "HospitalStaff"("userId");

-- CreateIndex
CREATE INDEX "HospitalStaff_hospitalId_idx" ON "HospitalStaff"("hospitalId");

-- CreateIndex
CREATE UNIQUE INDEX "Department_hospitalId_name_key" ON "Department"("hospitalId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Specialty_hospitalId_name_key" ON "Specialty"("hospitalId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Doctor_userId_key" ON "Doctor"("userId");

-- CreateIndex
CREATE INDEX "Doctor_hospitalId_status_idx" ON "Doctor"("hospitalId", "status");

-- CreateIndex
CREATE INDEX "Calendar_doctorId_idx" ON "Calendar"("doctorId");

-- CreateIndex
CREATE INDEX "WorkingHour_calendarId_dayOfWeek_idx" ON "WorkingHour"("calendarId", "dayOfWeek");

-- CreateIndex
CREATE INDEX "BlockedSlot_calendarId_startAt_endAt_idx" ON "BlockedSlot"("calendarId", "startAt", "endAt");

-- CreateIndex
CREATE INDEX "LeaveDay_calendarId_startDate_endDate_idx" ON "LeaveDay"("calendarId", "startDate", "endDate");

-- CreateIndex
CREATE UNIQUE INDEX "AppointmentType_hospitalId_name_key" ON "AppointmentType"("hospitalId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "SlotReservation_appointmentId_key" ON "SlotReservation"("appointmentId");

-- CreateIndex
CREATE UNIQUE INDEX "SlotReservation_doctorId_slotStart_key" ON "SlotReservation"("doctorId", "slotStart");

-- CreateIndex
CREATE UNIQUE INDEX "Patient_userId_key" ON "Patient"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserPreference_patientId_key" ON "UserPreference"("patientId");

-- CreateIndex
CREATE UNIQUE INDEX "Appointment_idempotencyKey_key" ON "Appointment"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Appointment_hospitalId_doctorId_slotStart_idx" ON "Appointment"("hospitalId", "doctorId", "slotStart");

-- CreateIndex
CREATE INDEX "Appointment_patientId_idx" ON "Appointment"("patientId");

-- CreateIndex
CREATE INDEX "Appointment_status_idx" ON "Appointment"("status");

-- CreateIndex
CREATE INDEX "Appointment_correlationId_idx" ON "Appointment"("correlationId");

-- CreateIndex
CREATE INDEX "AppointmentStatusHistory_appointmentId_idx" ON "AppointmentStatusHistory"("appointmentId");

-- CreateIndex
CREATE INDEX "Questionnaire_hospitalId_idx" ON "Questionnaire"("hospitalId");

-- CreateIndex
CREATE INDEX "QuestionnaireQuestion_questionnaireId_order_idx" ON "QuestionnaireQuestion"("questionnaireId", "order");

-- CreateIndex
CREATE INDEX "QuestionnaireResponse_appointmentId_idx" ON "QuestionnaireResponse"("appointmentId");

-- CreateIndex
CREATE INDEX "QuestionnaireResponse_patientId_idx" ON "QuestionnaireResponse"("patientId");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionnaireAnswer_responseId_questionId_key" ON "QuestionnaireAnswer"("responseId", "questionId");

-- CreateIndex
CREATE INDEX "AIConversation_patientId_idx" ON "AIConversation"("patientId");

-- CreateIndex
CREATE INDEX "AIMessage_conversationId_createdAt_idx" ON "AIMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AIContext_conversationId_key" ON "AIContext"("conversationId");

-- CreateIndex
CREATE INDEX "CapabilityExecution_conversationId_idx" ON "CapabilityExecution"("conversationId");

-- CreateIndex
CREATE INDEX "CapabilityExecution_capabilityName_idx" ON "CapabilityExecution"("capabilityName");

-- CreateIndex
CREATE INDEX "CapabilityExecution_correlationId_idx" ON "CapabilityExecution"("correlationId");

-- CreateIndex
CREATE INDEX "AIEvaluation_scenarioKey_idx" ON "AIEvaluation"("scenarioKey");

-- CreateIndex
CREATE UNIQUE INDEX "HealthcareSystemConnection_hospitalId_connectorType_key" ON "HealthcareSystemConnection"("hospitalId", "connectorType");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalIdentifierMapping_hospitalId_entityType_internalId_key" ON "ExternalIdentifierMapping"("hospitalId", "entityType", "internalId");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalIdentifierMapping_hospitalId_entityType_externalId_key" ON "ExternalIdentifierMapping"("hospitalId", "entityType", "externalId");

-- CreateIndex
CREATE INDEX "IntegrationOperation_hospitalId_idx" ON "IntegrationOperation"("hospitalId");

-- CreateIndex
CREATE INDEX "IntegrationOperation_appointmentId_idx" ON "IntegrationOperation"("appointmentId");

-- CreateIndex
CREATE INDEX "IntegrationOperation_correlationId_idx" ON "IntegrationOperation"("correlationId");

-- CreateIndex
CREATE INDEX "IntegrationOperation_status_idx" ON "IntegrationOperation"("status");

-- CreateIndex
CREATE INDEX "IntegrationVerification_integrationOperationId_idx" ON "IntegrationVerification"("integrationOperationId");

-- CreateIndex
CREATE INDEX "ReconciliationRecord_appointmentId_idx" ON "ReconciliationRecord"("appointmentId");

-- CreateIndex
CREATE INDEX "ReconciliationRecord_hospitalId_outcome_idx" ON "ReconciliationRecord"("hospitalId", "outcome");

-- CreateIndex
CREATE UNIQUE INDEX "Workflow_hospitalId_key_key" ON "Workflow"("hospitalId", "key");

-- CreateIndex
CREATE INDEX "WorkflowExecution_workflowId_idx" ON "WorkflowExecution"("workflowId");

-- CreateIndex
CREATE INDEX "WorkflowExecution_appointmentId_idx" ON "WorkflowExecution"("appointmentId");

-- CreateIndex
CREATE INDEX "WorkflowExecution_status_idx" ON "WorkflowExecution"("status");

-- CreateIndex
CREATE INDEX "Notification_recipientUserId_idx" ON "Notification"("recipientUserId");

-- CreateIndex
CREATE INDEX "Notification_appointmentId_idx" ON "Notification"("appointmentId");

-- CreateIndex
CREATE INDEX "AuditEvent_hospitalId_idx" ON "AuditEvent"("hospitalId");

-- CreateIndex
CREATE INDEX "AuditEvent_category_idx" ON "AuditEvent"("category");

-- CreateIndex
CREATE INDEX "AuditEvent_correlationId_idx" ON "AuditEvent"("correlationId");

-- CreateIndex
CREATE INDEX "AuditEvent_createdAt_idx" ON "AuditEvent"("createdAt");

-- CreateIndex
CREATE INDEX "OperationalEvent_hospitalId_idx" ON "OperationalEvent"("hospitalId");

-- CreateIndex
CREATE INDEX "OperationalEvent_type_idx" ON "OperationalEvent"("type");

-- CreateIndex
CREATE INDEX "OperationalEvent_correlationId_idx" ON "OperationalEvent"("correlationId");

-- AddForeignKey
ALTER TABLE "Hospital" ADD CONSTRAINT "Hospital_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HospitalStaff" ADD CONSTRAINT "HospitalStaff_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HospitalStaff" ADD CONSTRAINT "HospitalStaff_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Specialty" ADD CONSTRAINT "Specialty_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Doctor" ADD CONSTRAINT "Doctor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Doctor" ADD CONSTRAINT "Doctor_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Doctor" ADD CONSTRAINT "Doctor_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoctorSpecialty" ADD CONSTRAINT "DoctorSpecialty_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoctorSpecialty" ADD CONSTRAINT "DoctorSpecialty_specialtyId_fkey" FOREIGN KEY ("specialtyId") REFERENCES "Specialty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Calendar" ADD CONSTRAINT "Calendar_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Calendar" ADD CONSTRAINT "Calendar_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkingHour" ADD CONSTRAINT "WorkingHour_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "Calendar"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlockedSlot" ADD CONSTRAINT "BlockedSlot_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "Calendar"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveDay" ADD CONSTRAINT "LeaveDay_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "Calendar"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentType" ADD CONSTRAINT "AppointmentType_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlotReservation" ADD CONSTRAINT "SlotReservation_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPreference" ADD CONSTRAINT "UserPreference_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "Calendar"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_appointmentTypeId_fkey" FOREIGN KEY ("appointmentTypeId") REFERENCES "AppointmentType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentStatusHistory" ADD CONSTRAINT "AppointmentStatusHistory_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Questionnaire" ADD CONSTRAINT "Questionnaire_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionnaireQuestion" ADD CONSTRAINT "QuestionnaireQuestion_questionnaireId_fkey" FOREIGN KEY ("questionnaireId") REFERENCES "Questionnaire"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionnaireResponse" ADD CONSTRAINT "QuestionnaireResponse_questionnaireId_fkey" FOREIGN KEY ("questionnaireId") REFERENCES "Questionnaire"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionnaireResponse" ADD CONSTRAINT "QuestionnaireResponse_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionnaireResponse" ADD CONSTRAINT "QuestionnaireResponse_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionnaireAnswer" ADD CONSTRAINT "QuestionnaireAnswer_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES "QuestionnaireResponse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionnaireAnswer" ADD CONSTRAINT "QuestionnaireAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "QuestionnaireQuestion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIConversation" ADD CONSTRAINT "AIConversation_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIMessage" ADD CONSTRAINT "AIMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AIConversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIContext" ADD CONSTRAINT "AIContext_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AIConversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CapabilityExecution" ADD CONSTRAINT "CapabilityExecution_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AIConversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIEvaluation" ADD CONSTRAINT "AIEvaluation_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AIConversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthcareSystemConnection" ADD CONSTRAINT "HealthcareSystemConnection_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationOperation" ADD CONSTRAINT "IntegrationOperation_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationVerification" ADD CONSTRAINT "IntegrationVerification_integrationOperationId_fkey" FOREIGN KEY ("integrationOperationId") REFERENCES "IntegrationOperation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationRecord" ADD CONSTRAINT "ReconciliationRecord_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workflow" ADD CONSTRAINT "Workflow_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowExecution" ADD CONSTRAINT "WorkflowExecution_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowExecution" ADD CONSTRAINT "WorkflowExecution_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationalEvent" ADD CONSTRAINT "OperationalEvent_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE SET NULL ON UPDATE CASCADE;
