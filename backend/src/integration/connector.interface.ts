import type {
  CreateExternalAppointmentInput,
  ExternalAppointmentRecord,
  ExternalFacilityRecord,
  ExternalPatientRecord,
  ExternalProviderRecord,
  UpdateExternalAppointmentInput,
  VerifyExternalAppointmentResult,
} from "./connector.types";

/**
 * The only way the platform talks to an external healthcare system.
 * A real EHR connector can replace MockEhrConnector without touching
 * AI, scheduling, or appointment orchestration (PRD §12/§24).
 */
export interface IntegrationConnector {
  lookupPatient(query: { id?: string; name?: string; dob?: string; phone?: string }): Promise<ExternalPatientRecord[]>;
  createPatient(input: { name: string; dob?: string; phone?: string }): Promise<ExternalPatientRecord>;

  lookupProvider(query: { id?: string; name?: string; specialty?: string }): Promise<ExternalProviderRecord[]>;
  createProvider(input: { name: string; specialty?: string }): Promise<ExternalProviderRecord>;

  lookupFacility(query: { id?: string; name?: string }): Promise<ExternalFacilityRecord[]>;
  createFacility(input: { name: string }): Promise<ExternalFacilityRecord>;

  lookupCalendar(providerId: string): Promise<unknown>;
  lookupAvailability(providerId: string, from: string, to: string): Promise<unknown>;

  createAppointment(input: CreateExternalAppointmentInput): Promise<ExternalAppointmentRecord>;
  updateAppointment(externalId: string, input: UpdateExternalAppointmentInput): Promise<ExternalAppointmentRecord>;
  cancelAppointment(externalId: string): Promise<ExternalAppointmentRecord>;
  retrieveAppointment(externalId: string): Promise<ExternalAppointmentRecord | null>;
  retrieveAppointmentByIdempotencyKey(idempotencyKey: string): Promise<ExternalAppointmentRecord | null>;
  verifyAppointment(externalId: string): Promise<VerifyExternalAppointmentResult>;
}
