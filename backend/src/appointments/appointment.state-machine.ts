import { BadRequestException } from "@nestjs/common";
import { AppointmentStatus, APPOINTMENT_TERMINAL_STATES } from "@ai-prof/shared";

/**
 * Allowed appointment status transitions (PRD §13/§23). Kept as a pure
 * table so the machine can be unit-tested without Prisma.
 *
 * RESCHEDULED is recorded in status history; the live row returns to
 * CONFIRMED (or PENDING while the EHR update is in flight) so the slot
 * remains held via APPOINTMENT_ACTIVE_STATES.
 */
export const ALLOWED_TRANSITIONS: Record<AppointmentStatus, ReadonlyArray<AppointmentStatus>> = {
  [AppointmentStatus.REQUESTED]: [
    AppointmentStatus.PENDING,
    AppointmentStatus.FAILED,
    AppointmentStatus.CANCELLED,
  ],
  [AppointmentStatus.PENDING]: [
    AppointmentStatus.SYNCHRONIZATION_PENDING,
    AppointmentStatus.CONFIRMED,
    AppointmentStatus.RECONCILIATION_REQUIRED,
    AppointmentStatus.FAILED,
    AppointmentStatus.CANCELLED,
  ],
  [AppointmentStatus.SYNCHRONIZATION_PENDING]: [
    AppointmentStatus.CONFIRMED,
    AppointmentStatus.RECONCILIATION_REQUIRED,
    AppointmentStatus.FAILED,
    AppointmentStatus.CANCELLED,
  ],
  [AppointmentStatus.CONFIRMED]: [
    AppointmentStatus.PENDING, // reschedule in-flight
    AppointmentStatus.RESCHEDULED,
    AppointmentStatus.CANCELLED,
    AppointmentStatus.COMPLETED,
    AppointmentStatus.NO_SHOW,
    AppointmentStatus.RECONCILIATION_REQUIRED,
  ],
  [AppointmentStatus.RESCHEDULED]: [
    AppointmentStatus.CONFIRMED,
    AppointmentStatus.PENDING,
    AppointmentStatus.CANCELLED,
    AppointmentStatus.COMPLETED,
    AppointmentStatus.NO_SHOW,
  ],
  [AppointmentStatus.RECONCILIATION_REQUIRED]: [
    AppointmentStatus.CONFIRMED,
    AppointmentStatus.SYNCHRONIZATION_PENDING,
    AppointmentStatus.PENDING,
    AppointmentStatus.FAILED,
    AppointmentStatus.CANCELLED,
  ],
  [AppointmentStatus.FAILED]: [AppointmentStatus.CANCELLED],
  [AppointmentStatus.CANCELLED]: [],
  [AppointmentStatus.COMPLETED]: [],
  [AppointmentStatus.NO_SHOW]: [],
};

export function canTransition(from: AppointmentStatus, to: AppointmentStatus): boolean {
  if (from === to) return true;
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: AppointmentStatus, to: AppointmentStatus): void {
  if (!canTransition(from, to)) {
    throw new BadRequestException(`Cannot move an appointment from ${from} to ${to}.`);
  }
}

export function isTerminal(status: AppointmentStatus): boolean {
  return APPOINTMENT_TERMINAL_STATES.has(status);
}
