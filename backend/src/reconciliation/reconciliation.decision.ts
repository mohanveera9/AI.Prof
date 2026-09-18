import { IntegrationFailureType } from "@ai-prof/shared";
import { isRetryableFailure } from "../integration/connector.types";

export type ReconciliationAction = "SYNC" | "SAFE_RETRY" | "ESCALATE";

export interface ReconciliationDecision {
  action: ReconciliationAction;
  reason: string;
}

/**
 * Pure decision table for the reconciliation engine (PRD §12/§28):
 *   Found → sync
 *   NotFound → safe-retry (idempotency-key guarded; never a blind duplicate)
 *   else / exhausted → escalate to a human
 */
export function decideReconciliationAction(input: {
  found: boolean;
  failureType: IntegrationFailureType | null;
  attempts: number;
  maxAttempts: number;
}): ReconciliationDecision {
  if (input.found) {
    return { action: "SYNC", reason: "External appointment found on re-query" };
  }
  if (!isRetryableFailure(input.failureType)) {
    return {
      action: "ESCALATE",
      reason: `Non-retryable failure ${input.failureType ?? "unknown"} — human review required`,
    };
  }
  if (input.attempts >= input.maxAttempts) {
    return {
      action: "ESCALATE",
      reason: `Retry budget exhausted after ${input.attempts} attempt(s)`,
    };
  }
  return {
    action: "SAFE_RETRY",
    reason: "Not found externally; retrying with the original idempotency key",
  };
}
