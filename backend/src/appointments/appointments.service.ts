import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, Optional } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  AppointmentStatus,
  APPOINTMENT_TERMINAL_STATES,
  AuditEventCategory,
  DoctorStatus,
  HospitalStatus,
  UserRole,
} from "@ai-prof/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { SchedulingService } from "../scheduling/scheduling.service";
import { SlotConflictException } from "../scheduling/scheduling.exceptions";
import { IntegrationService } from "../integration/integration.service";
import { RequestUser } from "../common/types";
import { assertHospitalScope, assertSelfDoctor, assertSelfPatient } from "../common/tenant";
import { newCorrelationId, newIdempotencyKey } from "../common/correlation";
import { toAppointmentSummary } from "./appointment.mapper";
import { assertTransition } from "./appointment.state-machine";
import { CreateAppointmentDto } from "./dto/create-appointment.dto";
import { RescheduleAppointmentDto } from "./dto/reschedule-appointment.dto";
import { CancelAppointmentDto } from "./dto/cancel-appointment.dto";
import { WorkflowsService } from "../workflows/workflows.service";
import { WORKFLOW_TRIGGERS } from "../workflows/workflow.types";

@Injectable()
export class AppointmentsService {
  private readonly logger = new Logger(AppointmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scheduling: SchedulingService,
    private readonly integration: IntegrationService,
    @Optional() private readonly workflows?: WorkflowsService,
  ) {}

  /**
   * Books a real, previously-checked-available slot. Re-validates the slot
   * immediately before committing (PRD §7), reserves it transactionally so
   * concurrent requests can't double-book (PRD §7), then pushes to the EHR,
   * verifies, and synchronizes (PRD §12/§13) — never reporting success until
   * the external result is verified.
   */
  async create(patientId: string, requester: RequestUser, dto: CreateAppointmentDto) {
    assertSelfPatient(requester, patientId);

    const idempotencyKey = dto.idempotencyKey ?? newIdempotencyKey();
    const existing = await this.prisma.appointment.findUnique({ where: { idempotencyKey } });
    if (existing) {
      if (existing.patientId !== patientId) {
        throw new BadRequestException("This idempotency key was already used for a different patient.");
      }
      return toAppointmentSummary(existing);
    }

    const doctor = await this.prisma.doctor.findUnique({ where: { id: dto.doctorId }, include: { hospital: true } });
    if (!doctor) throw new NotFoundException("Doctor not found.");
    if (doctor.status !== DoctorStatus.ACTIVE) {
      throw new BadRequestException("This doctor is not currently accepting appointments.");
    }
    if (doctor.hospital.status !== HospitalStatus.APPROVED) {
      throw new BadRequestException("This hospital is not currently accepting appointments.");
    }

    const slotStart = new Date(dto.slotStart);
    const slotEnd = new Date(dto.slotEnd);
    if (slotStart >= slotEnd) throw new BadRequestException("slotStart must be before slotEnd.");
    if (slotStart < new Date()) throw new BadRequestException("Cannot book a slot in the past.");

    if (dto.appointmentTypeId) {
      const type = await this.prisma.appointmentType.findUnique({ where: { id: dto.appointmentTypeId } });
      if (!type || type.hospitalId !== doctor.hospitalId) {
        throw new BadRequestException("Unknown appointment type for this doctor's hospital.");
      }
    }

    const calendar = await this.prisma.calendar.findFirst({ where: { doctorId: doctor.id } });
    if (!calendar) throw new BadRequestException("This doctor has no calendar configured.");

    // Never trust a stale check_availability result — revalidate now (PRD §7).
    const stillAvailable = await this.scheduling.isSlotStillAvailable(doctor.id, slotStart, slotEnd);
    if (!stillAvailable) {
      throw new BadRequestException("This slot is no longer available. Please check availability again.");
    }

    const correlationId = newCorrelationId();

    let appointmentId: string;
    try {
      appointmentId = await this.prisma.$transaction(async (tx) => {
        const created = await tx.appointment.create({
          data: {
            hospitalId: doctor.hospitalId,
            doctorId: doctor.id,
            calendarId: calendar.id,
            patientId,
            appointmentTypeId: dto.appointmentTypeId,
            slotStart,
            slotEnd,
            reasonNote: dto.reasonNote,
            idempotencyKey,
            correlationId,
            status: AppointmentStatus.REQUESTED,
          },
        });

        await tx.appointmentStatusHistory.create({
          data: {
            appointmentId: created.id,
            fromStatus: null,
            toStatus: AppointmentStatus.REQUESTED,
            reason: "booking_requested",
            actor: requester.role === UserRole.PATIENT ? "patient" : "system",
          },
        });

        await this.scheduling.reserveSlot(tx, doctor.id, slotStart, created.id);
        assertTransition(AppointmentStatus.REQUESTED, AppointmentStatus.PENDING);

        await tx.appointment.update({ where: { id: created.id }, data: { status: AppointmentStatus.PENDING } });
        await tx.appointmentStatusHistory.create({
          data: {
            appointmentId: created.id,
            fromStatus: AppointmentStatus.REQUESTED,
            toStatus: AppointmentStatus.PENDING,
            reason: "slot_reserved",
            actor: "system",
          },
        });

        return created.id;
      });
    } catch (err) {
      if (err instanceof SlotConflictException) {
        throw new BadRequestException("This slot was just booked by someone else. Please choose another time.");
      }
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        const winner = await this.prisma.appointment.findUnique({ where: { idempotencyKey } });
        if (winner && winner.patientId === patientId) return toAppointmentSummary(winner);
        throw new BadRequestException("This booking collided with another request. Please retry with a new idempotency key.");
      }
      throw err;
    }

    await this.audit.recordAudit({
      category: AuditEventCategory.APPOINTMENT_OPERATION,
      action: "appointment.requested",
      actorUserId: requester.userId,
      hospitalId: doctor.hospitalId,
      targetType: "Appointment",
      targetId: appointmentId,
      correlationId,
    });

    const result = await this.integration.createVerifyAndSync({
      hospitalId: doctor.hospitalId,
      appointmentId,
      patientId,
      doctorId: doctor.id,
      slotStart,
      slotEnd,
      idempotencyKey,
      correlationId,
    });

    if (result.outcome === "FAILED") {
      // A definitive failure frees the slot for other patients; an ambiguous
      // RECONCILIATION_REQUIRED outcome deliberately keeps the hold, since the
      // EHR may still have created it.
      await this.prisma.slotReservation.deleteMany({ where: { appointmentId } });
    }

    const finalAppointment = await this.prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } });
    if (finalAppointment.status === AppointmentStatus.CONFIRMED) {
      await this.kickoffWorkflow(WORKFLOW_TRIGGERS.APPOINTMENT_CONFIRMED, appointmentId);
    }
    return toAppointmentSummary(finalAppointment);
  }

  async reschedule(appointmentId: string, requester: RequestUser, dto: RescheduleAppointmentDto) {
    const appointment = await this.requireAppointment(appointmentId);
    this.assertCanManage(requester, appointment);

    if (appointment.status !== AppointmentStatus.CONFIRMED) {
      throw new BadRequestException(
        `Only a confirmed appointment can be rescheduled (current status: ${appointment.status}).`,
      );
    }
    assertTransition(appointment.status, AppointmentStatus.PENDING);

    const newSlotStart = new Date(dto.newSlotStart);
    const newSlotEnd = new Date(dto.newSlotEnd);
    if (newSlotStart >= newSlotEnd) throw new BadRequestException("newSlotStart must be before newSlotEnd.");
    if (newSlotStart < new Date()) throw new BadRequestException("Cannot reschedule to a slot in the past.");

    if (dto.idempotencyKey) {
      const alreadyApplied = await this.prisma.appointmentStatusHistory.findFirst({
        where: { appointmentId, reason: `reschedule:${dto.idempotencyKey}` },
      });
      if (alreadyApplied) {
        const current = await this.prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } });
        return toAppointmentSummary(current);
      }
    }

    const stillAvailable = await this.scheduling.isSlotStillAvailable(
      appointment.doctorId,
      newSlotStart,
      newSlotEnd,
      appointmentId,
    );
    if (!stillAvailable) {
      throw new BadRequestException("The requested new slot is not available. Please check availability again.");
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        await this.scheduling.releaseSlotByAppointmentId(tx, appointmentId);
        await this.scheduling.reserveSlot(tx, appointment.doctorId, newSlotStart, appointmentId);
        await tx.appointment.update({
          where: { id: appointmentId },
          data: { slotStart: newSlotStart, slotEnd: newSlotEnd, status: AppointmentStatus.PENDING },
        });
        await tx.appointmentStatusHistory.create({
          data: {
            appointmentId,
            fromStatus: appointment.status,
            toStatus: AppointmentStatus.PENDING,
            reason: dto.idempotencyKey ? `reschedule:${dto.idempotencyKey}` : "reschedule_requested",
            actor: "system",
          },
        });
      });
    } catch (err) {
      if (err instanceof SlotConflictException) {
        throw new BadRequestException("That new slot was just booked by someone else. Please choose another time.");
      }
      throw err;
    }

    await this.audit.recordAudit({
      category: AuditEventCategory.APPOINTMENT_OPERATION,
      action: "appointment.reschedule_requested",
      actorUserId: requester.userId,
      hospitalId: appointment.hospitalId,
      targetType: "Appointment",
      targetId: appointmentId,
      correlationId: appointment.correlationId,
    });

    if (appointment.externalAppointmentId) {
      await this.integration.rescheduleAndSync({
        hospitalId: appointment.hospitalId,
        appointmentId,
        externalAppointmentId: appointment.externalAppointmentId,
        newSlotStart,
        newSlotEnd,
        correlationId: appointment.correlationId,
      });
    } else {
      this.logger.warn(`Rescheduling appointment ${appointmentId} with no externalAppointmentId yet`);
    }

    const finalAppointment = await this.prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } });
    if (finalAppointment.status === AppointmentStatus.CONFIRMED) {
      await this.kickoffWorkflow(WORKFLOW_TRIGGERS.APPOINTMENT_RESCHEDULED, appointmentId);
    }
    return toAppointmentSummary(finalAppointment);
  }

  async cancel(appointmentId: string, requester: RequestUser, dto: CancelAppointmentDto) {
    const appointment = await this.requireAppointment(appointmentId);
    this.assertCanManage(requester, appointment);

    if (appointment.status === AppointmentStatus.CANCELLED) {
      return toAppointmentSummary(appointment);
    }
    if (APPOINTMENT_TERMINAL_STATES.has(appointment.status)) {
      throw new BadRequestException(`Cannot cancel an appointment in status ${appointment.status}.`);
    }
    assertTransition(appointment.status, AppointmentStatus.CANCELLED);

    if (dto.idempotencyKey) {
      const alreadyApplied = await this.prisma.appointmentStatusHistory.findFirst({
        where: { appointmentId, reason: `cancel:${dto.idempotencyKey}` },
      });
      if (alreadyApplied) {
        const current = await this.prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } });
        return toAppointmentSummary(current);
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await this.scheduling.releaseSlotByAppointmentId(tx, appointmentId);
      await tx.appointment.update({ where: { id: appointmentId }, data: { status: AppointmentStatus.CANCELLED } });
      await tx.appointmentStatusHistory.create({
        data: {
          appointmentId,
          fromStatus: appointment.status,
          toStatus: AppointmentStatus.CANCELLED,
          reason: dto.idempotencyKey ? `cancel:${dto.idempotencyKey}` : (dto.reason ?? "cancelled"),
          actor: this.actorLabel(requester.role),
        },
      });
    });

    await this.audit.recordAudit({
      category: AuditEventCategory.APPOINTMENT_OPERATION,
      action: "appointment.cancelled",
      actorUserId: requester.userId,
      hospitalId: appointment.hospitalId,
      targetType: "Appointment",
      targetId: appointmentId,
      correlationId: appointment.correlationId,
      metadata: dto.reason ? { reason: dto.reason } : undefined,
    });

    if (appointment.externalAppointmentId) {
      await this.integration.cancelBestEffort({
        hospitalId: appointment.hospitalId,
        appointmentId,
        externalAppointmentId: appointment.externalAppointmentId,
        correlationId: appointment.correlationId,
      });
    }

    const finalAppointment = await this.prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } });
    await this.kickoffWorkflow(WORKFLOW_TRIGGERS.APPOINTMENT_CANCELLED, appointmentId);
    return toAppointmentSummary(finalAppointment);
  }

  async complete(appointmentId: string, requester: RequestUser, reason?: string) {
    return this.closeAs(appointmentId, requester, AppointmentStatus.COMPLETED, reason ?? "completed");
  }

  async markNoShow(appointmentId: string, requester: RequestUser, reason?: string) {
    return this.closeAs(appointmentId, requester, AppointmentStatus.NO_SHOW, reason ?? "no_show");
  }

  async getById(appointmentId: string, requester: RequestUser) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: { statusHistory: { orderBy: { createdAt: "asc" } }, doctor: true, hospital: true },
    });
    if (!appointment) throw new NotFoundException("Appointment not found.");
    this.assertCanView(requester, appointment);
    return appointment;
  }

  async getLatestForPatient(patientId: string, requester: RequestUser) {
    assertSelfPatient(requester, patientId);
    return this.prisma.appointment.findFirst({
      where: { patientId },
      orderBy: { createdAt: "desc" },
    });
  }

  async listForPatient(patientId: string, requester: RequestUser) {
    assertSelfPatient(requester, patientId);
    return this.prisma.appointment.findMany({
      where: { patientId },
      include: { doctor: true, hospital: true },
      orderBy: { slotStart: "desc" },
    });
  }

  async listForDoctor(doctorId: string, requester: RequestUser) {
    const doctor = await this.prisma.doctor.findUnique({ where: { id: doctorId } });
    if (!doctor) throw new NotFoundException("Doctor not found.");
    if (requester.role === UserRole.DOCTOR) {
      assertSelfDoctor(requester, doctorId);
    } else {
      assertHospitalScope(requester, doctor.hospitalId);
    }
    return this.prisma.appointment.findMany({
      where: { doctorId },
      include: { patient: true },
      orderBy: { slotStart: "asc" },
    });
  }

  async listForHospital(hospitalId: string, requester: RequestUser, status?: AppointmentStatus) {
    assertHospitalScope(requester, hospitalId);
    return this.prisma.appointment.findMany({
      where: { hospitalId, status },
      include: { doctor: true, patient: true },
      orderBy: { slotStart: "desc" },
    });
  }

  private async requireAppointment(appointmentId: string) {
    const appointment = await this.prisma.appointment.findUnique({ where: { id: appointmentId } });
    if (!appointment) throw new NotFoundException("Appointment not found.");
    return appointment;
  }

  private async closeAs(
    appointmentId: string,
    requester: RequestUser,
    toStatus: typeof AppointmentStatus.COMPLETED | typeof AppointmentStatus.NO_SHOW,
    reason: string,
  ) {
    const appointment = await this.requireAppointment(appointmentId);
    this.assertCanClose(requester, appointment);
    assertTransition(appointment.status, toStatus);

    await this.prisma.$transaction(async (tx) => {
      await this.scheduling.releaseSlotByAppointmentId(tx, appointmentId);
      await tx.appointment.update({ where: { id: appointmentId }, data: { status: toStatus } });
      await tx.appointmentStatusHistory.create({
        data: {
          appointmentId,
          fromStatus: appointment.status,
          toStatus,
          reason,
          actor: this.actorLabel(requester.role),
        },
      });
    });

    await this.audit.recordAudit({
      category: AuditEventCategory.APPOINTMENT_OPERATION,
      action: toStatus === AppointmentStatus.COMPLETED ? "appointment.completed" : "appointment.no_show",
      actorUserId: requester.userId,
      hospitalId: appointment.hospitalId,
      targetType: "Appointment",
      targetId: appointmentId,
      correlationId: appointment.correlationId,
      metadata: { reason },
    });

    return toAppointmentSummary(await this.prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } }));
  }

  private async kickoffWorkflow(trigger: string, appointmentId: string) {
    if (!this.workflows) return;
    try {
      await this.workflows.startByTrigger(trigger, appointmentId);
    } catch (err) {
      this.logger.warn(`Workflow ${trigger} failed for ${appointmentId}: ${(err as Error).message}`);
    }
  }

  private actorLabel(role: UserRole): string {
    if (role === UserRole.PATIENT) return "patient";
    if (role === UserRole.DOCTOR) return "doctor";
    if (role === UserRole.HOSPITAL_ADMIN) return "hospital_admin";
    if (role === UserRole.PLATFORM_ADMIN) return "platform_admin";
    return "system";
  }

  private assertCanManage(user: RequestUser, appointment: { patientId: string; hospitalId: string; doctorId: string }) {
    if (user.role === UserRole.PLATFORM_ADMIN) return;
    if (user.role === UserRole.PATIENT) return assertSelfPatient(user, appointment.patientId);
    if (user.role === UserRole.HOSPITAL_ADMIN) return assertHospitalScope(user, appointment.hospitalId);
    if (user.role === UserRole.DOCTOR) return assertSelfDoctor(user, appointment.doctorId);
    throw new ForbiddenException("You do not have permission to manage this appointment.");
  }

  private assertCanClose(user: RequestUser, appointment: { hospitalId: string; doctorId: string }) {
    if (user.role === UserRole.PLATFORM_ADMIN) return;
    if (user.role === UserRole.HOSPITAL_ADMIN) return assertHospitalScope(user, appointment.hospitalId);
    if (user.role === UserRole.DOCTOR) return assertSelfDoctor(user, appointment.doctorId);
    throw new ForbiddenException("Only the doctor or hospital admin can complete or mark a no-show.");
  }

  private assertCanView(user: RequestUser, appointment: { patientId: string; hospitalId: string; doctorId: string }) {
    if (user.role === UserRole.PLATFORM_ADMIN) return;
    if (user.role === UserRole.PATIENT) return assertSelfPatient(user, appointment.patientId);
    if (user.role === UserRole.HOSPITAL_ADMIN) return assertHospitalScope(user, appointment.hospitalId);
    if (user.role === UserRole.DOCTOR) return assertSelfDoctor(user, appointment.doctorId);
    throw new ForbiddenException("You do not have permission to view this appointment.");
  }
}
