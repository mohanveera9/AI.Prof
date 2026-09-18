import { RequestUser } from "../common/types";

/**
 * Everything a capability needs about "who is asking" — always resolved
 * from the authenticated patient, never taken from the AI's own input
 * (PRD §20: the AI may act only as the patient it is currently serving).
 */
export interface CapabilityContext {
  patientId: string;
  requester: RequestUser;
  conversationId?: string;
  correlationId: string;
}

export interface CapabilityResult<T = unknown> {
  success: boolean;
  output?: T;
  error?: string;
}
