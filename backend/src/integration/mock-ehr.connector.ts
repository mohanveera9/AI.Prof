import type { IntegrationConnector } from "./connector.interface";
import type {
  ConnectorConfig,
  CreateExternalAppointmentInput,
  ExternalAppointmentRecord,
  ExternalFacilityRecord,
  ExternalPatientRecord,
  ExternalProviderRecord,
  UpdateExternalAppointmentInput,
  VerifyExternalAppointmentResult,
} from "./connector.types";
import { ConnectorError } from "./connector.types";
import { IntegrationFailureType } from "@ai-prof/shared";
import { assertCompleteAppointment, requestJson } from "./http.util";

export interface ChaosConfigDto {
  mode: string;
  scope: string;
  remainingHits: number;
  timeoutMs: number;
}

/**
 * HTTP adapter for the standalone mock-EHR service. A production connector
 * for Epic/Cerner/etc. would implement the same IntegrationConnector surface.
 */
export class MockEhrConnector implements IntegrationConnector {
  constructor(private readonly config: ConnectorConfig) {}

  async lookupPatient(query: { id?: string; name?: string; dob?: string; phone?: string }): Promise<ExternalPatientRecord[]> {
    if (query.id) {
      try {
        const patient = await requestJson<ExternalPatientRecord>(this.config, "GET", `/patients/${query.id}`);
        return [patient];
      } catch (err) {
        if (err instanceof ConnectorError && err.failureType === IntegrationFailureType.MISSING_ENTITY) return [];
        throw err;
      }
    }
    const params = new URLSearchParams();
    if (query.name) params.set("name", query.name);
    if (query.dob) params.set("dob", query.dob);
    if (query.phone) params.set("phone", query.phone);
    const qs = params.toString();
    const result = await requestJson<{ patients: ExternalPatientRecord[] }>(
      this.config,
      "GET",
      `/patients${qs ? `?${qs}` : ""}`,
    );
    return result.patients ?? [];
  }

  createPatient(input: { name: string; dob?: string; phone?: string }): Promise<ExternalPatientRecord> {
    return requestJson<ExternalPatientRecord>(this.config, "POST", "/patients", input);
  }

  async lookupProvider(query: { id?: string; name?: string; specialty?: string }): Promise<ExternalProviderRecord[]> {
    if (query.id) {
      try {
        const provider = await requestJson<ExternalProviderRecord>(this.config, "GET", `/providers/${query.id}`);
        return [provider];
      } catch (err) {
        if (err instanceof ConnectorError && err.failureType === IntegrationFailureType.MISSING_ENTITY) return [];
        throw err;
      }
    }
    const params = new URLSearchParams();
    if (query.name) params.set("name", query.name);
    if (query.specialty) params.set("specialty", query.specialty);
    const qs = params.toString();
    const result = await requestJson<{ providers: ExternalProviderRecord[] }>(
      this.config,
      "GET",
      `/providers${qs ? `?${qs}` : ""}`,
    );
    return result.providers ?? [];
  }

  createProvider(input: { name: string; specialty?: string }): Promise<ExternalProviderRecord> {
    return requestJson<ExternalProviderRecord>(this.config, "POST", "/providers", input);
  }

  async lookupFacility(query: { id?: string; name?: string }): Promise<ExternalFacilityRecord[]> {
    if (query.id) {
      try {
        const facility = await requestJson<ExternalFacilityRecord>(this.config, "GET", `/facilities/${query.id}`);
        return [facility];
      } catch (err) {
        if (err instanceof ConnectorError && err.failureType === IntegrationFailureType.MISSING_ENTITY) return [];
        throw err;
      }
    }
    const result = await requestJson<{ facilities: ExternalFacilityRecord[] }>(this.config, "GET", "/facilities");
    const all = result.facilities ?? [];
    if (query.name) {
      return all.filter((f) => f.name.toLowerCase().includes(query.name!.toLowerCase()));
    }
    return all;
  }

  createFacility(input: { name: string }): Promise<ExternalFacilityRecord> {
    return requestJson<ExternalFacilityRecord>(this.config, "POST", "/facilities", input);
  }

  lookupCalendar(providerId: string): Promise<unknown> {
    return requestJson(this.config, "GET", `/calendars/${providerId}`);
  }

  lookupAvailability(providerId: string, from: string, to: string): Promise<unknown> {
    const params = new URLSearchParams({ providerId, from, to });
    return requestJson(this.config, "GET", `/availability?${params.toString()}`);
  }

  async createAppointment(input: CreateExternalAppointmentInput): Promise<ExternalAppointmentRecord> {
    const record = await requestJson<ExternalAppointmentRecord>(this.config, "POST", "/appointments", input);
    assertCompleteAppointment(record);
    return record;
  }

  updateAppointment(externalId: string, input: UpdateExternalAppointmentInput): Promise<ExternalAppointmentRecord> {
    return requestJson<ExternalAppointmentRecord>(this.config, "PATCH", `/appointments/${externalId}`, input);
  }

  cancelAppointment(externalId: string): Promise<ExternalAppointmentRecord> {
    return requestJson<ExternalAppointmentRecord>(this.config, "POST", `/appointments/${externalId}/cancel`);
  }

  async retrieveAppointment(externalId: string): Promise<ExternalAppointmentRecord | null> {
    try {
      return await requestJson<ExternalAppointmentRecord>(this.config, "GET", `/appointments/${externalId}`);
    } catch (err) {
      if (err instanceof ConnectorError && err.failureType === IntegrationFailureType.MISSING_ENTITY) return null;
      throw err;
    }
  }

  async retrieveAppointmentByIdempotencyKey(idempotencyKey: string): Promise<ExternalAppointmentRecord | null> {
    try {
      return await requestJson<ExternalAppointmentRecord>(
        this.config,
        "GET",
        `/appointments?idempotencyKey=${encodeURIComponent(idempotencyKey)}`,
      );
    } catch (err) {
      if (err instanceof ConnectorError && err.failureType === IntegrationFailureType.MISSING_ENTITY) return null;
      throw err;
    }
  }

  async listAppointments(): Promise<ExternalAppointmentRecord[]> {
    const result = await requestJson<{ appointments: ExternalAppointmentRecord[] }>(this.config, "GET", "/appointments");
    return result.appointments ?? [];
  }

  verifyAppointment(externalId: string): Promise<VerifyExternalAppointmentResult> {
    return requestJson<VerifyExternalAppointmentResult>(this.config, "GET", `/appointments/${externalId}/verify`);
  }

  // ---- Demo-only admin surface (not part of IntegrationConnector) ----

  setChaos(config: Partial<ChaosConfigDto>): Promise<ChaosConfigDto> {
    return requestJson<ChaosConfigDto>(this.config, "POST", "/chaos", config);
  }

  getChaos(): Promise<ChaosConfigDto> {
    return requestJson<ChaosConfigDto>(this.config, "GET", "/chaos");
  }

  resetChaos(): Promise<ChaosConfigDto> {
    return requestJson<ChaosConfigDto>(this.config, "DELETE", "/chaos");
  }

  resetStore(): Promise<unknown> {
    return requestJson(this.config, "POST", "/admin/reset");
  }
}
