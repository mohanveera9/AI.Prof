/**
 * Pure slot-computation logic (PRD §7). Deliberately has no DB/Prisma
 * dependency so every availability rule can be unit tested directly:
 * doctor/calendar-active are checked by the caller before invoking this;
 * everything else (working hours, blocked periods, leave, existing
 * bookings, appointment-type duration) is enforced here.
 *
 * Simplification: all instants are treated as UTC. Calendar.timezone is
 * stored for future per-hospital-timezone support but slot math here is
 * timezone-naive (documented limitation for this prototype).
 */

export interface WorkingHourRule {
  dayOfWeek: number; // 0 = Sunday .. 6 = Saturday (UTC)
  startMinute: number;
  endMinute: number;
}

export interface Interval {
  start: Date;
  end: Date;
}

export interface ComputeAvailableSlotsParams {
  now: Date;
  rangeStart: Date;
  rangeEnd: Date;
  durationMinutes: number;
  workingHours: WorkingHourRule[];
  blockedSlots: Interval[];
  leaveDays: Interval[];
  busyIntervals: Interval[];
  limit: number;
}

export interface AvailableSlot {
  start: Date;
  end: Date;
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function computeAvailableSlots(params: ComputeAvailableSlotsParams): AvailableSlot[] {
  const { now, durationMinutes, workingHours, blockedSlots, leaveDays, busyIntervals, limit } = params;

  if (durationMinutes <= 0 || params.rangeEnd <= params.rangeStart) return [];

  const results: AvailableSlot[] = [];
  const rangeStartDay = startOfUtcDay(params.rangeStart);
  const rangeEndDay = startOfUtcDay(params.rangeEnd);

  for (
    let day = new Date(rangeStartDay);
    day.getTime() <= rangeEndDay.getTime() && results.length < limit;
    day.setUTCDate(day.getUTCDate() + 1)
  ) {
    const dayOfWeek = day.getUTCDay();

    const isOnLeave = leaveDays.some((leave) => overlaps(day, new Date(day.getTime() + 86_400_000), leave.start, leave.end));
    if (isOnLeave) continue;

    const rulesForDay = workingHours.filter((rule) => rule.dayOfWeek === dayOfWeek);

    for (const rule of rulesForDay) {
      for (
        let minuteOffset = rule.startMinute;
        minuteOffset + durationMinutes <= rule.endMinute && results.length < limit;
        minuteOffset += durationMinutes
      ) {
        const slotStart = new Date(day.getTime() + minuteOffset * 60_000);
        const slotEnd = new Date(slotStart.getTime() + durationMinutes * 60_000);

        if (slotStart < now) continue;
        if (slotStart < params.rangeStart || slotEnd > params.rangeEnd) continue;

        const blocked = blockedSlots.some((b) => overlaps(slotStart, slotEnd, b.start, b.end));
        if (blocked) continue;

        const busy = busyIntervals.some((b) => overlaps(slotStart, slotEnd, b.start, b.end));
        if (busy) continue;

        results.push({ start: slotStart, end: slotEnd });
      }
    }
  }

  return results;
}
