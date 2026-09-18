import { nanoid } from "nanoid";

/** Shared correlation id so a booking can be traced across every layer (PRD §19). */
export function newCorrelationId(): string {
  return `corr_${nanoid(16)}`;
}

export function newIdempotencyKey(): string {
  return `idem_${nanoid(20)}`;
}
