import { IntegrationFailureType } from "@ai-prof/shared";
import { decideReconciliationAction } from "./reconciliation.decision";

describe("decideReconciliationAction", () => {
  it("syncs when the external appointment is found", () => {
    expect(
      decideReconciliationAction({
        found: true,
        failureType: IntegrationFailureType.TIMEOUT,
        attempts: 1,
        maxAttempts: 3,
      }).action,
    ).toBe("SYNC");
  });

  it("safe-retries a retryable not-found within budget", () => {
    expect(
      decideReconciliationAction({
        found: false,
        failureType: IntegrationFailureType.TIMEOUT,
        attempts: 1,
        maxAttempts: 3,
      }).action,
    ).toBe("SAFE_RETRY");
  });

  it("escalates when retry budget is exhausted", () => {
    expect(
      decideReconciliationAction({
        found: false,
        failureType: IntegrationFailureType.OUTAGE,
        attempts: 3,
        maxAttempts: 3,
      }).action,
    ).toBe("ESCALATE");
  });

  it("escalates non-retryable failures immediately", () => {
    expect(
      decideReconciliationAction({
        found: false,
        failureType: IntegrationFailureType.VALIDATION_ERROR,
        attempts: 1,
        maxAttempts: 3,
      }).action,
    ).toBe("ESCALATE");
  });
});
