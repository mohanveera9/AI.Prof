import { Injectable, Logger } from "@nestjs/common";
import { nanoid } from "nanoid";
import {
  AuditEventCategory,
  CapabilityName,
  CapabilitySchemas,
  NotificationType,
  OperationalEventType,
} from "@ai-prof/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { HospitalsService } from "../hospitals/hospitals.service";
import { DoctorsService } from "../doctors/doctors.service";
import { SchedulingService } from "../scheduling/scheduling.service";
import { AppointmentsService } from "../appointments/appointments.service";
import { IntegrationService } from "../integration/integration.service";
import { PatientsService } from "../patients/patients.service";
import { QuestionnairesService } from "../questionnaires/questionnaires.service";
import { WorkflowsService } from "../workflows/workflows.service";
import { NotificationsService } from "../notifications/notifications.service";
import { toAppointmentSummary } from "../appointments/appointment.mapper";
import { CapabilityContext, CapabilityResult } from "./capabilities.types";

/**
 * The ONLY surface the AI agent may call (PRD §10/§20). Every capability
 * here: validates input/output against the shared zod contract, resolves
 * authorization from the authenticated patient (never from AI-supplied
 * ids), and records a CapabilityExecution row for observability — the AI
 * never touches Prisma or the EHR connector directly.
 */
@Injectable()
export class CapabilitiesService {
  private readonly logger = new Logger(CapabilitiesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly hospitals: HospitalsService,
    private readonly doctors: DoctorsService,
    private readonly scheduling: SchedulingService,
    private readonly appointments: AppointmentsService,
    private readonly integration: IntegrationService,
    private readonly patients: PatientsService,
    private readonly questionnaires: QuestionnairesService,
    private readonly workflows: WorkflowsService,
    private readonly notifications: NotificationsService,
  ) {}

  async execute(name: string, rawInput: unknown, ctx: CapabilityContext): Promise<CapabilityResult> {
    const schema = CapabilitySchemas[name as CapabilityName];
    if (!schema) {
      return { success: false, error: `Unknown capability: ${name}` };
    }

    const parsedInput = schema.input.safeParse(rawInput ?? {});
    if (!parsedInput.success) {
      const message = `Invalid input for ${name}: ${parsedInput.error.issues.map((i) => i.message).join("; ")}`;
      await this.recordExecution(name, ctx, rawInput, undefined, false, message, 0);
      return { success: false, error: message };
    }

    const start = Date.now();
    try {
      const rawOutput = await this.dispatch(name as CapabilityName, parsedInput.data, ctx);
      const output = schema.output.parse(rawOutput);
      await this.recordExecution(name, ctx, parsedInput.data, output, true, undefined, Date.now() - start);
      return { success: true, output };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Capability ${name} failed: ${message}`);
      await this.recordExecution(name, ctx, parsedInput.data, undefined, false, message, Date.now() - start);
      return { success: false, error: message };
    }
  }

  private async dispatch(name: CapabilityName, input: any, ctx: CapabilityContext): Promise<unknown> {
    switch (name) {
      case CapabilityName.SEARCH_HOSPITALS:
        return this.searchHospitals(input);
      case CapabilityName.SEARCH_DOCTORS:
        return this.searchDoctors(input);
      case CapabilityName.CHECK_AVAILABILITY:
        return this.checkAvailability(input);
      case CapabilityName.LOOKUP_PATIENT:
        return this.lookupPatient(ctx);
      case CapabilityName.GET_APPOINTMENT:
        return this.getAppointment(input, ctx);
      case CapabilityName.CREATE_APPOINTMENT:
        return { appointment: await this.appointments.create(ctx.patientId, ctx.requester, input) };
      case CapabilityName.RESCHEDULE_APPOINTMENT:
        return { appointment: await this.appointments.reschedule(input.appointmentId, ctx.requester, input) };
      case CapabilityName.CANCEL_APPOINTMENT:
        return { appointment: await this.appointments.cancel(input.appointmentId, ctx.requester, input) };
      case CapabilityName.GET_QUESTIONNAIRE:
        return this.questionnaires.getForPatient(ctx.patientId, ctx.requester, input);
      case CapabilityName.SUBMIT_QUESTIONNAIRE:
        return this.questionnaires.submitAnswers(input.questionnaireResponseId, ctx.requester, input.answers);
      case CapabilityName.SEND_NOTIFICATION:
        return this.sendNotification(input, ctx);
      case CapabilityName.START_WORKFLOW:
        return this.startWorkflow(input, ctx);
      case CapabilityName.GET_CONTEXT:
        return this.getContext(ctx);
      case CapabilityName.UPDATE_PREFERENCES:
        return this.updatePreferences(input, ctx);
      case CapabilityName.VERIFY_EXTERNAL_APPOINTMENT:
        return this.verifyExternalAppointment(input, ctx);
      case CapabilityName.SYNCHRONIZE_STATE:
        return this.synchronizeState(input, ctx);
      case CapabilityName.TRANSFER_TO_HUMAN:
        return this.transferToHuman(input, ctx);
      default:
        throw new Error(`Capability ${name} has no implementation.`);
    }
  }

  // ---- Discovery ----

  private async searchHospitals(input: { query?: string; specialty?: string; department?: string; city?: string; limit: number }) {
    const hospitals = await this.hospitals.listApproved({ city: input.city, specialty: input.specialty });
    const filtered = hospitals.filter((h) => {
      if (input.department && !h.departments.some((d) => d.name.toLowerCase().includes(input.department!.toLowerCase()))) {
        return false;
      }
      if (input.query) {
        const q = input.query.toLowerCase();
        if (!h.name.toLowerCase().includes(q) && !(h.city ?? "").toLowerCase().includes(q)) return false;
      }
      return true;
    });
    return {
      hospitals: filtered.slice(0, input.limit).map((h) => ({
        id: h.id,
        name: h.name,
        city: h.city ?? undefined,
        departments: h.departments.map((d) => d.name),
        specialties: h.specialties.map((s) => s.name),
      })),
    };
  }

  private async searchDoctors(input: {
    hospitalId?: string;
    specialty?: string;
    department?: string;
    query?: string;
    language?: string;
    limit: number;
  }) {
    const results = await this.doctors.search(input);
    return {
      doctors: results.map((d) => ({
        id: d.id,
        name: d.name,
        hospitalId: d.hospitalId,
        specialty: d.specialties[0]?.specialty.name,
        department: d.department?.name,
        languages: d.languages,
        consultationTypes: d.consultationTypes,
      })),
    };
  }

  private async checkAvailability(input: {
    doctorId: string;
    appointmentTypeId?: string;
    dateFrom: string;
    dateTo?: string;
    limit: number;
  }) {
    const slots = await this.scheduling.checkAvailability(input.doctorId, input);
    return {
      slots: slots.map((s) => ({
        doctorId: input.doctorId,
        start: s.start.toISOString(),
        end: s.end.toISOString(),
        appointmentTypeId: input.appointmentTypeId,
      })),
    };
  }

  // ---- Patient / appointment self-service ----

  private async lookupPatient(ctx: CapabilityContext) {
    const patient = await this.patients.getById(ctx.patientId, ctx.requester);
    return { patient: { id: patient.id, name: patient.name, communicationPreference: patient.communicationPreference } };
  }

  private async getAppointment(input: { appointmentId?: string; latestForPatient?: boolean }, ctx: CapabilityContext) {
    if (input.appointmentId) {
      const appointment = await this.appointments.getById(input.appointmentId, ctx.requester);
      return { appointment: toAppointmentSummary(appointment) };
    }
    const latest = await this.appointments.getLatestForPatient(ctx.patientId, ctx.requester);
    return { appointment: latest ? toAppointmentSummary(latest) : null };
  }

  // ---- Notifications & workflows ----

  private async sendNotification(
    input: { type: NotificationType; recipientPatientId?: string; appointmentId?: string; message?: string },
    ctx: CapabilityContext,
  ) {
    return this.notifications.send({
      recipientUserId: ctx.requester.userId,
      type: input.type,
      appointmentId: input.appointmentId,
      message: input.message,
      correlationId: ctx.correlationId,
    });
  }

  private async startWorkflow(input: { workflowKey: string; appointmentId?: string }, ctx: CapabilityContext) {
    let appointmentId = input.appointmentId;
    if (!appointmentId) {
      const latest = await this.appointments.getLatestForPatient(ctx.patientId, ctx.requester);
      appointmentId = latest?.id;
    }
    const execution = await this.workflows.startByKey(input.workflowKey, appointmentId, ctx.correlationId);
    return { workflowExecutionId: execution.id, status: execution.status };
  }

  // ---- Context ----

  private async getContext(ctx: CapabilityContext) {
    if (!ctx.conversationId) {
      return {
        intent: null,
        selectedHospitalId: null,
        selectedDoctorId: null,
        selectedSlot: null,
        currentAppointmentId: null,
        workflowState: null,
      };
    }
    const context = await this.prisma.aIContext.findUnique({ where: { conversationId: ctx.conversationId } });
    if (!context) {
      return {
        intent: null,
        selectedHospitalId: null,
        selectedDoctorId: null,
        selectedSlot: null,
        currentAppointmentId: null,
        workflowState: null,
      };
    }
    const selectedSlot =
      context.selectedDoctorId && context.selectedSlotStart && context.selectedSlotEnd
        ? {
            doctorId: context.selectedDoctorId,
            start: context.selectedSlotStart.toISOString(),
            end: context.selectedSlotEnd.toISOString(),
          }
        : null;
    return {
      intent: context.intent,
      selectedHospitalId: context.selectedHospitalId,
      selectedDoctorId: context.selectedDoctorId,
      selectedSlot,
      currentAppointmentId: context.currentAppointmentId,
      workflowState: context.workflowState as Record<string, unknown>,
    };
  }

  // ---- Preferences ----

  private async updatePreferences(
    input: { communicationPreference?: string; preferredLanguage?: string; other?: Record<string, unknown> },
    ctx: CapabilityContext,
  ) {
    if (input.communicationPreference || input.preferredLanguage) {
      await this.patients.update(ctx.patientId, ctx.requester, {
        communicationPreference: input.communicationPreference,
        preferredLanguage: input.preferredLanguage,
      });
    }
    if (input.other && Object.keys(input.other).length > 0) {
      await this.patients.updatePreferences(ctx.patientId, ctx.requester, { data: input.other });
    }
    const patient = await this.patients.getById(ctx.patientId, ctx.requester);
    return {
      preferences: {
        communicationPreference: patient.communicationPreference,
        preferredLanguage: patient.preferredLanguage,
        ...((patient.preference?.data as Record<string, unknown>) ?? {}),
      },
    };
  }

  // ---- Integration ----

  private async verifyExternalAppointment(input: { appointmentId: string }, ctx: CapabilityContext) {
    const appointment = await this.appointments.getById(input.appointmentId, ctx.requester);
    if (!appointment.externalAppointmentId) return { verified: false };
    return this.integration.verifyExternalAppointment(appointment.hospitalId, appointment.externalAppointmentId);
  }

  private async synchronizeState(input: { appointmentId: string }, ctx: CapabilityContext) {
    const appointment = await this.appointments.getById(input.appointmentId, ctx.requester);
    if (!appointment.externalAppointmentId) {
      return { appointment: toAppointmentSummary(appointment) };
    }
    const updated = await this.integration.pullLatestAndSync(
      appointment.hospitalId,
      appointment.id,
      appointment.externalAppointmentId,
      ctx.correlationId,
    );
    return { appointment: toAppointmentSummary(updated ?? appointment) };
  }

  // ---- Escalation ----

  private async transferToHuman(input: { reason: string; urgency: "low" | "medium" | "high" }, ctx: CapabilityContext) {
    const escalationId = `esc_${nanoid(10)}`;
    await this.audit.recordOperational({
      type: OperationalEventType.HUMAN_ESCALATION,
      severity: input.urgency === "high" ? "CRITICAL" : input.urgency === "medium" ? "WARNING" : "INFO",
      correlationId: ctx.correlationId,
      metadata: { escalationId, reason: input.reason, patientId: ctx.patientId },
    });
    await this.audit.recordAudit({
      category: AuditEventCategory.AI_ACTION,
      action: "ai.transfer_to_human",
      actorUserId: ctx.requester.userId,
      correlationId: ctx.correlationId,
      metadata: { escalationId, reason: input.reason, urgency: input.urgency },
    });
    return { escalationId, status: "escalated" };
  }

  private async recordExecution(
    capabilityName: string,
    ctx: CapabilityContext,
    input: unknown,
    output: unknown,
    success: boolean,
    errorMessage: string | undefined,
    latencyMs: number,
  ) {
    await this.prisma.capabilityExecution
      .create({
        data: {
          conversationId: ctx.conversationId,
          capabilityName,
          input: input as object,
          output: output as object | undefined,
          success,
          errorMessage,
          latencyMs,
          idempotencyKey: (input as { idempotencyKey?: string })?.idempotencyKey,
          correlationId: ctx.correlationId,
        },
      })
      .catch((err) => this.logger.error(`Failed to record capability execution for ${capabilityName}`, err));

    await this.audit.recordAudit({
      category: AuditEventCategory.CAPABILITY_EXECUTION,
      action: `capability.${capabilityName}`,
      actorUserId: ctx.requester.userId,
      correlationId: ctx.correlationId,
      metadata: { success, errorMessage },
    });
  }
}
