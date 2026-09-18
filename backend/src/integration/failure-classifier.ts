import { IntegrationFailureType } from "@ai-prof/shared";
import { ConnectorError } from "./connector.types";

export function classifyHttpStatus(status: number, body?: unknown): IntegrationFailureType {
  if (status === 401) return IntegrationFailureType.AUTH_FAILURE;
  if (status === 403) return IntegrationFailureType.AUTHZ_FAILURE;
  if (status === 429) return IntegrationFailureType.RATE_LIMITED;
  if (status === 400) return IntegrationFailureType.VALIDATION_ERROR;
  if (status === 404) return IntegrationFailureType.MISSING_ENTITY;
  if (status === 409) {
    const code = typeof body === "object" && body && "code" in body ? String((body as { code?: string }).code) : "";
    if (code === "DUPLICATE_REQUEST") return IntegrationFailureType.DUPLICATE_REQUEST;
    return IntegrationFailureType.SLOT_CONFLICT;
  }
  if (status === 504 || status === 408) return IntegrationFailureType.TIMEOUT;
  if (status >= 500) return IntegrationFailureType.OUTAGE;
  if (status === 202 || status === 206) return IntegrationFailureType.PARTIAL_SUCCESS;
  return IntegrationFailureType.UNKNOWN_OUTCOME;
}

export function classifyThrown(err: unknown): ConnectorError {
  if (err instanceof ConnectorError) return err;

  const name = err && typeof err === "object" && "name" in err ? String((err as { name: string }).name) : "";
  const message = err instanceof Error ? err.message : String(err);

  if (name === "AbortError" || /aborted|timeout/i.test(message)) {
    return new ConnectorError(IntegrationFailureType.TIMEOUT, "External system request timed out", { cause: err });
  }
  if (/ECONNREFUSED|ENOTFOUND|ECONNRESET|fetch failed|network/i.test(message)) {
    return new ConnectorError(IntegrationFailureType.OUTAGE, "External system unreachable", { cause: err });
  }
  return new ConnectorError(IntegrationFailureType.UNKNOWN_OUTCOME, message || "Unknown connector error", { cause: err });
}

export function assertCompleteAppointment(body: unknown): void {
  if (!body || typeof body !== "object") {
    throw new ConnectorError(IntegrationFailureType.UNKNOWN_OUTCOME, "Empty or non-object response from EHR");
  }
  const rec = body as { id?: unknown };
  if (typeof rec.id !== "string" || rec.id.length === 0) {
    throw new ConnectorError(IntegrationFailureType.UNKNOWN_OUTCOME, "EHR response missing appointment id");
  }
}
