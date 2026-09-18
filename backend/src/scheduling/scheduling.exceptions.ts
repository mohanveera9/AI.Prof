import { ConflictException } from "@nestjs/common";

/** Thrown when a concurrent request already claimed the same doctor+slot (PRD §7). */
export class SlotConflictException extends ConflictException {
  constructor(doctorId: string, slotStart: Date) {
    super(`Slot ${slotStart.toISOString()} for doctor ${doctorId} is no longer available.`);
  }
}
