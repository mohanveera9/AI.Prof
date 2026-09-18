export interface ExternalPatient {
  id: string;
  name: string;
  dob?: string;
  phone?: string;
}

export interface ExternalProvider {
  id: string;
  name: string;
  specialty?: string;
}

export interface ExternalFacility {
  id: string;
  name: string;
}

export type ExternalAppointmentStatus = "booked" | "updated" | "cancelled";

export interface ExternalAppointment {
  id: string;
  externalPatientId: string;
  externalProviderId: string;
  externalFacilityId?: string;
  start: string;
  end: string;
  status: ExternalAppointmentStatus;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
}

export type ChaosMode =
  | "none"
  | "error_500"
  | "timeout_no_create"
  | "timeout_with_create"
  | "auth_failure"
  | "rate_limited"
  | "outage"
  | "validation_error"
  | "slot_conflict";

export type ChaosScope = "appointment_create" | "*";

export interface ChaosConfig {
  mode: ChaosMode;
  scope: ChaosScope;
  remainingHits: number;
  timeoutMs: number;
}

export interface MockEhrAppOptions {
  apiKey?: string;
  seed?: boolean;
}
