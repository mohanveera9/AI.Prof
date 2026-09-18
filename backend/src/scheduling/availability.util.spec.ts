import { computeAvailableSlots } from "./availability.util";

const DAY = 86_400_000;

function utc(y: number, m: number, d: number, h = 0, min = 0): Date {
  return new Date(Date.UTC(y, m, d, h, min));
}

describe("computeAvailableSlots", () => {
  // Monday 2025-01-06 09:00-17:00 UTC, 30-minute slots, otherwise no data.
  const mondayWorkingHours = [{ dayOfWeek: 1, startMinute: 9 * 60, endMinute: 17 * 60 }];

  it("never invents a slot outside working hours (PRD §7: AI/system must never invent availability)", () => {
    const slots = computeAvailableSlots({
      now: utc(2025, 0, 1),
      rangeStart: utc(2025, 0, 6),
      rangeEnd: utc(2025, 0, 7),
      durationMinutes: 30,
      workingHours: mondayWorkingHours,
      blockedSlots: [],
      leaveDays: [],
      busyIntervals: [],
      limit: 100,
    });

    expect(slots.length).toBeGreaterThan(0);
    for (const slot of slots) {
      expect(slot.start.getUTCHours()).toBeGreaterThanOrEqual(9);
      expect(slot.end.getUTCHours() <= 17).toBe(true);
    }
    // First slot is exactly at the start of working hours.
    expect(slots[0].start.toISOString()).toBe(utc(2025, 0, 6, 9, 0).toISOString());
  });

  it("excludes slots that overlap a blocked period", () => {
    const slots = computeAvailableSlots({
      now: utc(2025, 0, 1),
      rangeStart: utc(2025, 0, 6),
      rangeEnd: utc(2025, 0, 7),
      durationMinutes: 30,
      workingHours: mondayWorkingHours,
      blockedSlots: [{ start: utc(2025, 0, 6, 9, 0), end: utc(2025, 0, 6, 10, 0) }],
      leaveDays: [],
      busyIntervals: [],
      limit: 100,
    });

    const blockedStart = utc(2025, 0, 6, 9, 30).toISOString();
    expect(slots.some((s) => s.start.toISOString() === blockedStart)).toBe(false);
    expect(slots[0].start.toISOString()).toBe(utc(2025, 0, 6, 10, 0).toISOString());
  });

  it("excludes an entire day the doctor is on leave", () => {
    const slots = computeAvailableSlots({
      now: utc(2025, 0, 1),
      rangeStart: utc(2025, 0, 6),
      rangeEnd: utc(2025, 0, 6, 23, 59),
      durationMinutes: 30,
      workingHours: mondayWorkingHours,
      blockedSlots: [],
      leaveDays: [{ start: utc(2025, 0, 6), end: utc(2025, 0, 6, 23, 59) }],
      busyIntervals: [],
      limit: 100,
    });

    expect(slots).toHaveLength(0);
  });

  it("excludes slots that overlap an existing (busy) appointment — prevents double-booking", () => {
    const slots = computeAvailableSlots({
      now: utc(2025, 0, 1),
      rangeStart: utc(2025, 0, 6),
      rangeEnd: utc(2025, 0, 7),
      durationMinutes: 30,
      workingHours: mondayWorkingHours,
      blockedSlots: [],
      leaveDays: [],
      busyIntervals: [{ start: utc(2025, 0, 6, 9, 0), end: utc(2025, 0, 6, 9, 30) }],
      limit: 100,
    });

    const bookedStart = utc(2025, 0, 6, 9, 0).toISOString();
    expect(slots.some((s) => s.start.toISOString() === bookedStart)).toBe(false);
    expect(slots[0].start.toISOString()).toBe(utc(2025, 0, 6, 9, 30).toISOString());
  });

  it("never returns a slot before `now`", () => {
    const slots = computeAvailableSlots({
      now: utc(2025, 0, 6, 9, 45),
      rangeStart: utc(2025, 0, 6),
      rangeEnd: utc(2025, 0, 7),
      durationMinutes: 30,
      workingHours: mondayWorkingHours,
      blockedSlots: [],
      leaveDays: [],
      busyIntervals: [],
      limit: 100,
    });

    for (const slot of slots) {
      expect(slot.start.getTime()).toBeGreaterThanOrEqual(utc(2025, 0, 6, 9, 45).getTime());
    }
  });

  it("respects the requested duration (appointment-type compatibility)", () => {
    const slots = computeAvailableSlots({
      now: utc(2025, 0, 1),
      rangeStart: utc(2025, 0, 6),
      rangeEnd: utc(2025, 0, 7),
      durationMinutes: 60,
      workingHours: mondayWorkingHours,
      blockedSlots: [],
      leaveDays: [],
      busyIntervals: [],
      limit: 100,
    });

    for (const slot of slots) {
      expect(slot.end.getTime() - slot.start.getTime()).toBe(60 * 60_000);
    }
    // 9:00-17:00 in 60-minute increments = 8 slots for the one day in range.
    expect(slots).toHaveLength(8);
  });

  it("respects the limit", () => {
    const slots = computeAvailableSlots({
      now: utc(2025, 0, 1),
      rangeStart: utc(2025, 0, 6),
      rangeEnd: utc(2025, 0, 13),
      durationMinutes: 30,
      workingHours: mondayWorkingHours,
      blockedSlots: [],
      leaveDays: [],
      busyIntervals: [],
      limit: 3,
    });

    expect(slots).toHaveLength(3);
  });

  it("returns nothing when there are no working hours at all", () => {
    const slots = computeAvailableSlots({
      now: utc(2025, 0, 1),
      rangeStart: utc(2025, 0, 6),
      rangeEnd: utc(2025, 0, 7),
      durationMinutes: 30,
      workingHours: [],
      blockedSlots: [],
      leaveDays: [],
      busyIntervals: [],
      limit: 100,
    });

    expect(slots).toHaveLength(0);
  });
});
