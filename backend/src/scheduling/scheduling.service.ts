import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AppointmentStatus, DoctorStatus, UserRole } from "@ai-prof/shared";
import { PrismaService } from "../prisma/prisma.service";
import { RequestUser } from "../common/types";
import { assertHospitalScope, assertSelfDoctor } from "../common/tenant";
import { computeAvailableSlots } from "./availability.util";
import { SlotConflictException } from "./scheduling.exceptions";
import { SetWorkingHoursDto } from "./dto/set-working-hours.dto";
import { CreateBlockedSlotDto } from "./dto/create-blocked-slot.dto";
import { CreateLeaveDayDto } from "./dto/create-leave-day.dto";
import { CheckAvailabilityQueryDto } from "./dto/check-availability.dto";

const MAX_RANGE_DAYS = 30;
const DEFAULT_RANGE_DAYS = 7;

// Active states that hold a doctor's slot exclusively (mirrors shared APPOINTMENT_ACTIVE_STATES).
const BUSY_STATES: AppointmentStatus[] = [
  AppointmentStatus.REQUESTED,
  AppointmentStatus.PENDING,
  AppointmentStatus.CONFIRMED,
  AppointmentStatus.SYNCHRONIZATION_PENDING,
  AppointmentStatus.RECONCILIATION_REQUIRED,
];

@Injectable()
export class SchedulingService {
  constructor(private readonly prisma: PrismaService) {}

  async createCalendarForDoctor(doctorId: string, hospitalId: string, timezone = "UTC") {
    return this.prisma.calendar.create({ data: { doctorId, hospitalId, timezone } });
  }

  private async getCalendarOrThrow(doctorId: string) {
    const calendar = await this.prisma.calendar.findFirst({ where: { doctorId } });
    if (!calendar) throw new NotFoundException("This doctor has no calendar configured.");
    return calendar;
  }

  private async assertManagesDoctor(doctorId: string, user: RequestUser) {
    const doctor = await this.prisma.doctor.findUnique({ where: { id: doctorId } });
    if (!doctor) throw new NotFoundException("Doctor not found.");
    if (user.role === UserRole.DOCTOR) {
      assertSelfDoctor(user, doctorId);
    } else {
      assertHospitalScope(user, doctor.hospitalId);
    }
    return doctor;
  }

  // ---- Working hours ----

  async setWorkingHours(doctorId: string, user: RequestUser, dto: SetWorkingHoursDto) {
    await this.assertManagesDoctor(doctorId, user);
    const calendar = await this.getCalendarOrThrow(doctorId);

    for (const h of dto.hours) {
      if (h.startMinute >= h.endMinute) {
        throw new BadRequestException("startMinute must be before endMinute for every working-hour entry.");
      }
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.workingHour.deleteMany({ where: { calendarId: calendar.id } });
      if (dto.hours.length) {
        await tx.workingHour.createMany({
          data: dto.hours.map((h) => ({ calendarId: calendar.id, ...h })),
        });
      }
      return tx.workingHour.findMany({ where: { calendarId: calendar.id } });
    });
  }

  async listWorkingHours(doctorId: string) {
    const calendar = await this.getCalendarOrThrow(doctorId);
    return this.prisma.workingHour.findMany({ where: { calendarId: calendar.id }, orderBy: { dayOfWeek: "asc" } });
  }

  // ---- Blocked slots ----

  async addBlockedSlot(doctorId: string, user: RequestUser, dto: CreateBlockedSlotDto) {
    await this.assertManagesDoctor(doctorId, user);
    const calendar = await this.getCalendarOrThrow(doctorId);
    const startAt = new Date(dto.startAt);
    const endAt = new Date(dto.endAt);
    if (startAt >= endAt) throw new BadRequestException("startAt must be before endAt.");
    return this.prisma.blockedSlot.create({ data: { calendarId: calendar.id, startAt, endAt, reason: dto.reason } });
  }

  async listBlockedSlots(doctorId: string) {
    const calendar = await this.getCalendarOrThrow(doctorId);
    return this.prisma.blockedSlot.findMany({ where: { calendarId: calendar.id }, orderBy: { startAt: "asc" } });
  }

  async removeBlockedSlot(doctorId: string, user: RequestUser, blockedSlotId: string) {
    await this.assertManagesDoctor(doctorId, user);
    await this.prisma.blockedSlot.delete({ where: { id: blockedSlotId } });
  }

  // ---- Leave days ----

  async addLeaveDay(doctorId: string, user: RequestUser, dto: CreateLeaveDayDto) {
    await this.assertManagesDoctor(doctorId, user);
    const calendar = await this.getCalendarOrThrow(doctorId);
    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);
    if (startDate > endDate) throw new BadRequestException("startDate must be on or before endDate.");
    return this.prisma.leaveDay.create({ data: { calendarId: calendar.id, startDate, endDate, reason: dto.reason } });
  }

  async listLeaveDays(doctorId: string) {
    const calendar = await this.getCalendarOrThrow(doctorId);
    return this.prisma.leaveDay.findMany({ where: { calendarId: calendar.id }, orderBy: { startDate: "asc" } });
  }

  async removeLeaveDay(doctorId: string, user: RequestUser, leaveDayId: string) {
    await this.assertManagesDoctor(doctorId, user);
    await this.prisma.leaveDay.delete({ where: { id: leaveDayId } });
  }

  // ---- Availability (source of truth for bookable slots — PRD §7) ----

  async checkAvailability(doctorId: string, query: CheckAvailabilityQueryDto) {
    const doctor = await this.prisma.doctor.findUnique({ where: { id: doctorId } });
    if (!doctor || doctor.status !== DoctorStatus.ACTIVE) return [];

    const calendar = await this.prisma.calendar.findFirst({ where: { doctorId } });
    if (!calendar || !calendar.isActive) return [];

    let durationMinutes = query.durationMinutes ?? doctor.defaultAppointmentDurationMinutes;
    if (query.appointmentTypeId) {
      const appointmentType = await this.prisma.appointmentType.findUnique({ where: { id: query.appointmentTypeId } });
      if (!appointmentType || appointmentType.hospitalId !== doctor.hospitalId) {
        throw new BadRequestException("Unknown appointment type for this doctor's hospital.");
      }
      durationMinutes = appointmentType.durationMinutes;
    }

    const now = new Date();
    const rangeStart = new Date(Math.max(new Date(query.dateFrom).getTime(), now.getTime()));
    const requestedEnd = query.dateTo ? new Date(query.dateTo) : new Date(rangeStart.getTime() + DEFAULT_RANGE_DAYS * 86_400_000);
    const maxEnd = new Date(rangeStart.getTime() + MAX_RANGE_DAYS * 86_400_000);
    const rangeEnd = requestedEnd > maxEnd ? maxEnd : requestedEnd;

    const rules = await this.loadRules(calendar.id, doctorId, rangeStart, rangeEnd);

    return computeAvailableSlots({
      now,
      rangeStart,
      rangeEnd,
      durationMinutes,
      ...rules,
      limit: query.limit ?? 10,
    });
  }

  /**
   * Revalidates a single candidate slot immediately before booking/rescheduling
   * (PRD §7: "Availability should be revalidated immediately before booking").
   * `excludeAppointmentId` lets a reschedule ignore the appointment's own
   * current hold on the calendar.
   */
  async isSlotStillAvailable(
    doctorId: string,
    slotStart: Date,
    slotEnd: Date,
    excludeAppointmentId?: string,
  ): Promise<boolean> {
    const doctor = await this.prisma.doctor.findUnique({ where: { id: doctorId } });
    if (!doctor || doctor.status !== DoctorStatus.ACTIVE) return false;

    const calendar = await this.prisma.calendar.findFirst({ where: { doctorId } });
    if (!calendar || !calendar.isActive) return false;

    const durationMinutes = Math.round((slotEnd.getTime() - slotStart.getTime()) / 60_000);
    if (durationMinutes <= 0) return false;

    const rules = await this.loadRules(calendar.id, doctorId, slotStart, slotEnd, excludeAppointmentId);

    const slots = computeAvailableSlots({
      now: new Date(),
      rangeStart: slotStart,
      rangeEnd: slotEnd,
      durationMinutes,
      ...rules,
      limit: 1,
    });

    return slots.length === 1 && slots[0].start.getTime() === slotStart.getTime();
  }

  private async loadRules(
    calendarId: string,
    doctorId: string,
    rangeStart: Date,
    rangeEnd: Date,
    excludeAppointmentId?: string,
  ) {
    const [workingHours, blockedSlots, leaveDays, busyAppointments] = await Promise.all([
      this.prisma.workingHour.findMany({ where: { calendarId } }),
      this.prisma.blockedSlot.findMany({
        where: { calendarId, startAt: { lt: rangeEnd }, endAt: { gt: rangeStart } },
      }),
      this.prisma.leaveDay.findMany({
        where: { calendarId, startDate: { lte: rangeEnd }, endDate: { gte: rangeStart } },
      }),
      this.prisma.appointment.findMany({
        where: {
          doctorId,
          status: { in: BUSY_STATES },
          slotStart: { lt: rangeEnd },
          slotEnd: { gt: rangeStart },
          ...(excludeAppointmentId ? { id: { not: excludeAppointmentId } } : {}),
        },
      }),
    ]);

    return {
      workingHours: workingHours.map((w) => ({ dayOfWeek: w.dayOfWeek, startMinute: w.startMinute, endMinute: w.endMinute })),
      blockedSlots: blockedSlots.map((b) => ({ start: b.startAt, end: b.endAt })),
      leaveDays: leaveDays.map((l) => ({ start: l.startDate, end: l.endDate })),
      busyIntervals: busyAppointments.map((a) => ({ start: a.slotStart, end: a.slotEnd })),
    };
  }

  /**
   * Claims exclusive ownership of (doctorId, slotStart) for `appointmentId`,
   * inside the caller's transaction. The DB unique constraint on
   * SlotReservation — not application logic — is what actually prevents
   * double-booking under concurrency (PRD §7).
   */
  async reserveSlot(tx: Prisma.TransactionClient, doctorId: string, slotStart: Date, appointmentId: string) {
    try {
      await tx.slotReservation.create({ data: { doctorId, slotStart, appointmentId } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new SlotConflictException(doctorId, slotStart);
      }
      throw err;
    }
  }

  async releaseSlotByAppointmentId(tx: Prisma.TransactionClient, appointmentId: string) {
    await tx.slotReservation.deleteMany({ where: { appointmentId } });
  }
}
