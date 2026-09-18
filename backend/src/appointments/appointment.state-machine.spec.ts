import { AppointmentStatus } from "@ai-prof/shared";
import { assertTransition, canTransition, isTerminal } from "./appointment.state-machine";

describe("appointment state machine", () => {
  it("allows the happy-path booking chain", () => {
    expect(canTransition(AppointmentStatus.REQUESTED, AppointmentStatus.PENDING)).toBe(true);
    expect(canTransition(AppointmentStatus.PENDING, AppointmentStatus.SYNCHRONIZATION_PENDING)).toBe(true);
    expect(canTransition(AppointmentStatus.SYNCHRONIZATION_PENDING, AppointmentStatus.CONFIRMED)).toBe(true);
  });

  it("allows cancel from in-flight and confirmed states", () => {
    expect(canTransition(AppointmentStatus.PENDING, AppointmentStatus.CANCELLED)).toBe(true);
    expect(canTransition(AppointmentStatus.CONFIRMED, AppointmentStatus.CANCELLED)).toBe(true);
    expect(canTransition(AppointmentStatus.RECONCILIATION_REQUIRED, AppointmentStatus.CANCELLED)).toBe(true);
  });

  it("allows complete and no-show only from a confirmed (or rescheduled) appointment", () => {
    expect(canTransition(AppointmentStatus.CONFIRMED, AppointmentStatus.COMPLETED)).toBe(true);
    expect(canTransition(AppointmentStatus.CONFIRMED, AppointmentStatus.NO_SHOW)).toBe(true);
    expect(canTransition(AppointmentStatus.PENDING, AppointmentStatus.COMPLETED)).toBe(false);
    expect(canTransition(AppointmentStatus.CANCELLED, AppointmentStatus.COMPLETED)).toBe(false);
  });

  it("treats cancelled / completed / no-show as terminal", () => {
    expect(isTerminal(AppointmentStatus.CANCELLED)).toBe(true);
    expect(isTerminal(AppointmentStatus.COMPLETED)).toBe(true);
    expect(isTerminal(AppointmentStatus.NO_SHOW)).toBe(true);
    expect(isTerminal(AppointmentStatus.CONFIRMED)).toBe(false);
    expect(() => assertTransition(AppointmentStatus.CANCELLED, AppointmentStatus.CONFIRMED)).toThrow(
      /Cannot move an appointment from CANCELLED to CONFIRMED/,
    );
  });

  it("allows a confirmed appointment to go PENDING while a reschedule is in flight", () => {
    expect(canTransition(AppointmentStatus.CONFIRMED, AppointmentStatus.PENDING)).toBe(true);
    expect(canTransition(AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED)).toBe(true);
  });

  it("does not allow a failed booking to be confirmed without going through reconciliation", () => {
    expect(canTransition(AppointmentStatus.FAILED, AppointmentStatus.CONFIRMED)).toBe(false);
    expect(canTransition(AppointmentStatus.RECONCILIATION_REQUIRED, AppointmentStatus.CONFIRMED)).toBe(true);
  });
});
