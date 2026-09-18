import { ForbiddenException } from "@nestjs/common";
import { UserRole } from "@ai-prof/shared";
import { RequestUser } from "./types";

/**
 * Enforces the platform's non-negotiable tenant boundary (PRD §4/§21):
 * "Hospital A must never access Hospital B's private data."
 * Platform admins bypass (they operate across hospitals by design).
 */
export function assertHospitalScope(user: RequestUser, hospitalId: string): void {
  if (user.role === UserRole.PLATFORM_ADMIN) return;
  if ((user.role === UserRole.HOSPITAL_ADMIN || user.role === UserRole.DOCTOR) && user.hospitalId === hospitalId) {
    return;
  }
  throw new ForbiddenException("You do not have access to this hospital's data.");
}

/** A patient may only act on their own resources. */
export function assertSelfPatient(user: RequestUser, patientId: string): void {
  if (user.role === UserRole.PLATFORM_ADMIN) return;
  if (user.role === UserRole.PATIENT && user.patientId === patientId) return;
  throw new ForbiddenException("You do not have access to this patient's data.");
}

/** A doctor may only act on their own record/appointments. */
export function assertSelfDoctor(user: RequestUser, doctorId: string): void {
  if (user.role === UserRole.PLATFORM_ADMIN) return;
  if (user.role === UserRole.HOSPITAL_ADMIN) return; // scoped separately via assertHospitalScope
  if (user.role === UserRole.DOCTOR && user.doctorId === doctorId) return;
  throw new ForbiddenException("You do not have access to this doctor's data.");
}
