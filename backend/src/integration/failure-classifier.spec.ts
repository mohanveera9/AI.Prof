import { IntegrationFailureType } from "@ai-prof/shared";
import { assertCompleteAppointment, classifyHttpStatus, classifyThrown } from "./failure-classifier";
import { ConnectorError } from "./connector.types";

describe("classifyHttpStatus", () => {
  it("maps auth, rate-limit, validation, missing, conflict, timeout, and outage", () => {
    expect(classifyHttpStatus(401)).toBe(IntegrationFailureType.AUTH_FAILURE);
    expect(classifyHttpStatus(403)).toBe(IntegrationFailureType.AUTHZ_FAILURE);
    expect(classifyHttpStatus(429)).toBe(IntegrationFailureType.RATE_LIMITED);
    expect(classifyHttpStatus(400)).toBe(IntegrationFailureType.VALIDATION_ERROR);
    expect(classifyHttpStatus(404)).toBe(IntegrationFailureType.MISSING_ENTITY);
    expect(classifyHttpStatus(409)).toBe(IntegrationFailureType.SLOT_CONFLICT);
    expect(classifyHttpStatus(409, { code: "DUPLICATE_REQUEST" })).toBe(IntegrationFailureType.DUPLICATE_REQUEST);
    expect(classifyHttpStatus(504)).toBe(IntegrationFailureType.TIMEOUT);
    expect(classifyHttpStatus(503)).toBe(IntegrationFailureType.OUTAGE);
    expect(classifyHttpStatus(500)).toBe(IntegrationFailureType.OUTAGE);
    expect(classifyHttpStatus(202)).toBe(IntegrationFailureType.PARTIAL_SUCCESS);
  });
});

describe("classifyThrown", () => {
  it("classifies abort/timeout as TIMEOUT", () => {
    const abort = new Error("The operation was aborted");
    abort.name = "AbortError";
    expect(classifyThrown(abort).failureType).toBe(IntegrationFailureType.TIMEOUT);
  });

  it("classifies connection refused as OUTAGE", () => {
    expect(classifyThrown(new Error("fetch failed: ECONNREFUSED")).failureType).toBe(IntegrationFailureType.OUTAGE);
  });

  it("passes ConnectorError through unchanged", () => {
    const original = new ConnectorError(IntegrationFailureType.MAPPING_ERROR, "bad map");
    expect(classifyThrown(original)).toBe(original);
  });
});

describe("assertCompleteAppointment", () => {
  it("rejects empty or id-less payloads as UNKNOWN_OUTCOME", () => {
    expect(() => assertCompleteAppointment(null)).toThrow(ConnectorError);
    expect(() => assertCompleteAppointment({})).toThrow(ConnectorError);
    expect(() => assertCompleteAppointment({ id: "apt_1" })).not.toThrow();
  });
});
