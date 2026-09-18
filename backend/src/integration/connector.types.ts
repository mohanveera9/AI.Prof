import { IntegrationFailureType } from "@ai-prof/shared";

export interface ExternalPatientRecord {
  id: string;
  name: string;
  dob?: string;
  phone?: string;
}

export interface ExternalProviderRecord {
  id: string;
  name: string;
  specialty?: string;
}

export interface ExternalFacilityRecord {
  id: string;
  name: string;
}

export type ExternalAppointmentStatus = "booked" | "updated" | "cancelled";

export interface ExternalAppointmentRecord {
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

export interface CreateExternalAppointmentInput {
  externalPatientId: string;
  externalProviderId: string;
  externalFacilityId?: string;
  start: string;
  end: string;
  idempotencyKey: string;
}

export interface UpdateExternalAppointmentInput {
  start?: string;
  end?: string;
  status?: ExternalAppointmentStatus;
}

export interface VerifyExternalAppointmentResult {
  exists: boolean;
  verified: boolean;
  status?: string;
  appointment?: ExternalAppointmentRecord;
}

export interface ConnectorConfig {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
}

export class ConnectorError extends Error {
  readonly failureType: IntegrationFailureType;
  readonly statusCode?: number;
  readonly body?: unknown;

  constructor(
    failureType: IntegrationFailureType,
    message: string,
    options?: { statusCode?: number; body?: unknown; cause?: unknown },
  ) {
    super(message);
    this.name = "ConnectorError";
    this.failureType = failureType;
    this.statusCode = options?.statusCode;
    this.body = options?.body;
    if (options?.cause) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

export const RETRYABLE_FAILURES: ReadonlySet<IntegrationFailureType> = new Set([
  IntegrationFailureType.TIMEOUT,
  IntegrationFailureType.OUTAGE,
  IntegrationFailureType.RATE_LIMITED,
  IntegrationFailureType.UNKNOWN_OUTCOME,
  IntegrationFailureType.PARTIAL_SUCCESS,
]);

export function isRetryableFailure(type: IntegrationFailureType | null | undefined): boolean {
  if (!type) return true;
  return RETRYABLE_FAILURES.has(type);
}
