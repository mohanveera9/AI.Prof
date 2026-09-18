import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { AuditEventCategory, NotificationType, OperationalEventType, UserRole, WorkflowExecutionStatus } from "@ai-prof/shared";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { QuestionnairesService } from "../questionnaires/questionnaires.service";
import { NotificationsService } from "../notifications/notifications.service";
import { RequestUser } from "../common/types";
import { assertHospitalScope } from "../common/tenant";
import { newCorrelationId } from "../common/correlation";
import {
  WORKFLOW_KEYS,
  WORKFLOW_TRIGGERS,
  WorkflowStep,
  WorkflowStepsSchema,
} from "./workflow.types";
import { CreateWorkflowDto, UpdateWorkflowDto } from "./dto/create-workflow.dto";
import type { WorkflowScheduler } from "./workflow.scheduler";

@Injectable()
export class WorkflowsService {
  private readonly logger = new Logger(WorkflowsService.name);
  private scheduler: WorkflowScheduler | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly questionnaires: QuestionnairesService,
    private readonly notifications: NotificationsService,
  ) {}

  bindScheduler(scheduler: WorkflowScheduler) {
    this.scheduler = scheduler;
  }

  async create(hospitalId: string, requester: RequestUser, dto: CreateWorkflowDto) {
    this.assertCanManage(requester, hospitalId);
    const steps = this.parseSteps(dto.steps);
    const created = await this.prisma.workflow.create({
      data: {
        hospitalId,
        key: dto.key,
        name: dto.name,
        trigger: dto.trigger,
        steps: steps as unknown as Prisma.InputJsonValue,
        isActive: dto.isActive ?? true,
      },
    });
    await this.audit.recordAudit({
      category: AuditEventCategory.CONFIGURATION_CHANGE,
      action: "workflow.created",
      actorUserId: requester.userId,
      hospitalId,
      targetType: "Workflow",
      targetId: created.id,
    });
    return created;
  }

  async list(hospitalId: string, requester: RequestUser) {
    this.assertCanManage(requester, hospitalId);
    await this.ensureDefaults(hospitalId);
    return this.prisma.workflow.findMany({ where: { hospitalId }, orderBy: { createdAt: "asc" } });
  }

  async getById(id: string, requester: RequestUser) {
    const workflow = await this.requireWorkflow(id);
    if (workflow.hospitalId) this.assertCanManage(requester, workflow.hospitalId);
    return workflow;
  }

  async update(id: string, requester: RequestUser, dto: UpdateWorkflowDto) {
    const workflow = await this.requireWorkflow(id);
    if (workflow.hospitalId) this.assertCanManage(requester, workflow.hospitalId);
    const steps = dto.steps ? this.parseSteps(dto.steps) : undefined;
    return this.prisma.workflow.update({
      where: { id },
      data: {
        name: dto.name,
        trigger: dto.trigger,
        steps: steps as unknown as Prisma.InputJsonValue | undefined,
        isActive: dto.isActive,
      },
    });
  }

  async listExecutions(hospitalId: string, requester: RequestUser) {
    this.assertCanManage(requester, hospitalId);
    return this.prisma.workflowExecution.findMany({
      where: { workflow: { hospitalId } },
      include: { workflow: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  }

  async startByKey(workflowKey: string, appointmentId: string | undefined, correlationId = newCorrelationId()) {
    const appointment = appointmentId
      ? await this.prisma.appointment.findUnique({ where: { id: appointmentId }, include: { patient: true } })
      : null;
    if (appointmentId && !appointment) throw new NotFoundException("Appointment not found.");
    if (!appointment) {
      throw new BadRequestException("start_workflow requires an appointmentId (or a recent appointment on the patient).");
    }
    await this.ensureDefaults(appointment.hospitalId);
    const workflow = await this.prisma.workflow.findFirst({
      where: { hospitalId: appointment.hospitalId, key: workflowKey, isActive: true },
    });
    if (!workflow) throw new BadRequestException(`No active workflow with key "${workflowKey}" for this hospital.`);
    return this.startExecution(workflow.id, appointment.id, correlationId);
  }

  async startByTrigger(trigger: string, appointmentId: string, correlationId = newCorrelationId()) {
    const appointment = await this.prisma.appointment.findUnique({ where: { id: appointmentId } });
    if (!appointment) throw new NotFoundException("Appointment not found.");
    await this.ensureDefaults(appointment.hospitalId);
    const workflow = await this.prisma.workflow.findFirst({
      where: { hospitalId: appointment.hospitalId, trigger, isActive: true },
    });
    if (!workflow) {
      this.logger.warn(`No workflow for trigger ${trigger} at hospital ${appointment.hospitalId}`);
      return null;
    }
    return this.startExecution(workflow.id, appointment.id, correlationId);
  }

  async startExecution(workflowId: string, appointmentId: string | null, correlationId = newCorrelationId()) {
    const existing = await this.prisma.workflowExecution.findFirst({
      where: {
        workflowId,
        appointmentId: appointmentId ?? undefined,
        status: { in: [WorkflowExecutionStatus.PENDING, WorkflowExecutionStatus.RUNNING] },
      },
    });
    if (existing) return existing;

    const execution = await this.prisma.workflowExecution.create({
      data: {
        workflowId,
        appointmentId: appointmentId ?? undefined,
        status: WorkflowExecutionStatus.PENDING,
        correlationId,
        scheduledFor: new Date(),
      },
    });

    await this.audit.recordOperational({
      type: OperationalEventType.WORKFLOW_STATE_CHANGE,
      hospitalId: (await this.prisma.workflow.findUnique({ where: { id: workflowId } }))?.hospitalId ?? undefined,
      correlationId,
      metadata: { workflowExecutionId: execution.id, status: execution.status },
    });

    await this.executeStep(execution.id, 0);
    return this.prisma.workflowExecution.findUniqueOrThrow({ where: { id: execution.id } });
  }

  async executeStep(executionId: string, stepIndex: number): Promise<void> {
    const execution = await this.prisma.workflowExecution.findUnique({
      where: { id: executionId },
      include: { workflow: true, appointment: { include: { patient: true } } },
    });
    if (!execution) return;
    if (
      execution.status === WorkflowExecutionStatus.COMPLETED ||
      execution.status === WorkflowExecutionStatus.FAILED
    ) {
      return;
    }

    const parsed = WorkflowStepsSchema.safeParse(execution.workflow.steps);
    if (!parsed.success) {
      await this.fail(execution.id, "Workflow steps are invalid.", execution.correlationId, execution.workflow.hospitalId);
      return;
    }
    const steps = parsed.data;
    if (stepIndex >= steps.length) {
      await this.prisma.workflowExecution.update({
        where: { id: execution.id },
        data: { status: WorkflowExecutionStatus.COMPLETED, completedAt: new Date() },
      });
      await this.audit.recordOperational({
        type: OperationalEventType.WORKFLOW_STATE_CHANGE,
        hospitalId: execution.workflow.hospitalId ?? undefined,
        correlationId: execution.correlationId,
        metadata: { workflowExecutionId: execution.id, status: WorkflowExecutionStatus.COMPLETED },
      });
      return;
    }

    const step = steps[stepIndex];
    const delayMs = step.delayMs ?? 0;
    if (delayMs > 0) {
      await this.prisma.workflowExecution.update({
        where: { id: execution.id },
        data: { status: WorkflowExecutionStatus.RUNNING, startedAt: execution.startedAt ?? new Date() },
      });
      if (this.scheduler) {
        await this.scheduler.schedule(execution.id, stepIndex, delayMs);
      } else {
        const timer = setTimeout(() => {
          this.resumeStep(execution.id, stepIndex).catch((err) => this.logger.error(err as Error));
        }, delayMs);
        timer.unref();
      }
      return;
    }

    await this.runStepNow(execution.id, stepIndex, step);
  }

  /** Runs a previously scheduled step without re-applying its delay. */
  async resumeStep(executionId: string, stepIndex: number): Promise<void> {
    const execution = await this.prisma.workflowExecution.findUnique({
      where: { id: executionId },
      include: { workflow: true },
    });
    if (!execution) return;
    const parsed = WorkflowStepsSchema.safeParse(execution.workflow.steps);
    if (!parsed.success || stepIndex >= parsed.data.length) {
      await this.executeStep(executionId, stepIndex);
      return;
    }
    await this.runStepNow(executionId, stepIndex, parsed.data[stepIndex]);
  }

  private async runStepNow(executionId: string, stepIndex: number, step: WorkflowStep) {
    const execution = await this.prisma.workflowExecution.findUnique({
      where: { id: executionId },
      include: { workflow: true, appointment: { include: { patient: true } } },
    });
    if (!execution || execution.status === WorkflowExecutionStatus.COMPLETED) return;

    await this.prisma.workflowExecution.update({
      where: { id: execution.id },
      data: { status: WorkflowExecutionStatus.RUNNING, startedAt: execution.startedAt ?? new Date() },
    });

    try {
      await this.perform(step, execution);
      await this.executeStep(executionId, stepIndex + 1);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.fail(execution.id, message, execution.correlationId, execution.workflow.hospitalId);
    }
  }

  private async perform(
    step: WorkflowStep,
    execution: {
      id: string;
      appointmentId: string | null;
      correlationId: string;
      workflow: { hospitalId: string | null };
      appointment: { patient: { userId: string }; hospitalId: string; id: string } | null;
    },
  ) {
    if (step.type === "wait") return;
    if (step.type === "assign_questionnaire") {
      if (!execution.appointmentId) throw new Error("assign_questionnaire requires an appointment.");
      await this.questionnaires.assignToAppointment(execution.appointmentId);
      return;
    }
    if (step.type === "send_notification") {
      if (!execution.appointment?.patient) throw new Error("send_notification requires an appointment.");
      await this.notifications.send({
        recipientUserId: execution.appointment.patient.userId,
        type: step.notificationType as NotificationType,
        appointmentId: execution.appointment.id,
        message: step.message,
        hospitalId: execution.appointment.hospitalId,
        correlationId: execution.correlationId,
      });
    }
  }

  private async fail(executionId: string, error: string, correlationId: string, hospitalId: string | null) {
    this.logger.warn(`Workflow execution ${executionId} failed: ${error}`);
    await this.prisma.workflowExecution.update({
      where: { id: executionId },
      data: { status: WorkflowExecutionStatus.FAILED, error, completedAt: new Date() },
    });
    await this.audit.recordOperational({
      type: OperationalEventType.WORKFLOW_STATE_CHANGE,
      severity: "WARNING",
      hospitalId: hospitalId ?? undefined,
      correlationId,
      metadata: { workflowExecutionId: executionId, status: WorkflowExecutionStatus.FAILED, error },
    });
  }

  async ensureDefaults(hospitalId: string) {
    const defaults: Array<{ key: string; name: string; trigger: string; steps: WorkflowStep[] }> = [
      {
        key: WORKFLOW_KEYS.POST_BOOKING,
        name: "Post-booking intake",
        trigger: WORKFLOW_TRIGGERS.APPOINTMENT_CONFIRMED,
        steps: [
          { type: "assign_questionnaire" },
          { type: "send_notification", notificationType: NotificationType.APPOINTMENT_CONFIRMATION },
          { type: "send_notification", notificationType: NotificationType.QUESTIONNAIRE_REMINDER },
        ],
      },
      {
        key: WORKFLOW_KEYS.POST_RESCHEDULE,
        name: "Reschedule notice",
        trigger: WORKFLOW_TRIGGERS.APPOINTMENT_RESCHEDULED,
        steps: [{ type: "send_notification", notificationType: NotificationType.APPOINTMENT_RESCHEDULED }],
      },
      {
        key: WORKFLOW_KEYS.POST_CANCEL,
        name: "Cancellation notice",
        trigger: WORKFLOW_TRIGGERS.APPOINTMENT_CANCELLED,
        steps: [{ type: "send_notification", notificationType: NotificationType.APPOINTMENT_CANCELLATION }],
      },
    ];

    for (const def of defaults) {
      await this.prisma.workflow.upsert({
        where: { hospitalId_key: { hospitalId, key: def.key } },
        update: {},
        create: {
          hospitalId,
          key: def.key,
          name: def.name,
          trigger: def.trigger,
          steps: def.steps as unknown as Prisma.InputJsonValue,
          isActive: true,
        },
      });
    }
  }

  private parseSteps(raw: unknown): WorkflowStep[] {
    const parsed = WorkflowStepsSchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException(`Invalid workflow steps: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
    }
    return parsed.data;
  }

  private async requireWorkflow(id: string) {
    const workflow = await this.prisma.workflow.findUnique({ where: { id } });
    if (!workflow) throw new NotFoundException("Workflow not found.");
    return workflow;
  }

  private assertCanManage(requester: RequestUser, hospitalId: string) {
    if (requester.role === UserRole.PATIENT) {
      throw new ForbiddenException("Patients cannot manage workflows.");
    }
    assertHospitalScope(requester, hospitalId);
  }
}
