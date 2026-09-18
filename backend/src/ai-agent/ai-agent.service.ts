import { ForbiddenException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { AppointmentStatus, AuditEventCategory, CapabilityName, UserRole } from "@ai-prof/shared";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { CapabilitiesService } from "../capabilities/capabilities.service";
import { RequestUser } from "../common/types";
import { newCorrelationId } from "../common/correlation";
import { buildSystemPrompt } from "./system-prompt";
import { ALLOWED_TOOL_NAMES, buildOpenAiTools } from "./tools";
import { LLM_CLIENT, type LlmChatMessage, type LlmClient } from "./llm.types";

const MAX_TOOL_ROUNDS = 8;
const HISTORY_LIMIT = 40;

export interface ChatTurnResult {
  conversationId: string;
  correlationId: string;
  reply: string;
  toolTrace: Array<{ name: string; success: boolean; error?: string }>;
}

@Injectable()
export class AiAgentService {
  private readonly logger = new Logger(AiAgentService.name);
  private readonly tools = buildOpenAiTools();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly capabilities: CapabilitiesService,
    @Inject(LLM_CLIENT) private readonly llm: LlmClient,
  ) {}

  async startConversation(requester: RequestUser, channel = "web_chat") {
    const patientId = this.requirePatientId(requester);
    const conversation = await this.prisma.aIConversation.create({
      data: {
        patientId,
        channel,
        context: { create: { workflowState: {} } },
      },
    });
    await this.audit.recordAudit({
      category: AuditEventCategory.AI_ACTION,
      action: "ai.conversation_started",
      actorUserId: requester.userId,
      targetType: "AIConversation",
      targetId: conversation.id,
      metadata: { channel },
    });
    return conversation;
  }

  async listConversations(requester: RequestUser) {
    const patientId = this.requirePatientId(requester);
    return this.prisma.aIConversation.findMany({
      where: { patientId },
      orderBy: { startedAt: "desc" },
      take: 20,
      include: { context: true },
    });
  }

  async getConversation(conversationId: string, requester: RequestUser) {
    return this.requireOwnedConversation(conversationId, requester);
  }

  async sendMessage(conversationId: string, requester: RequestUser, content: string): Promise<ChatTurnResult> {
    const conversation = await this.requireOwnedConversation(conversationId, requester);
    const correlationId = newCorrelationId();

    await this.prisma.aIMessage.create({
      data: { conversationId, role: "user", content },
    });

    const history = await this.prisma.aIMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: "asc" },
      take: HISTORY_LIMIT,
    });

    // Replay only user/assistant text. Tool calls from prior turns are recovered
    // via get_context rather than replaying OpenAI tool-call transcripts.
    const conversational = history.filter((m) => m.role === "user" || (m.role === "assistant" && !m.toolName));

    const messages: LlmChatMessage[] = [
      { role: "system", content: buildSystemPrompt() },
      ...conversational.map((m) => this.toLlmMessage(m)),
    ];

    const toolTrace: ChatTurnResult["toolTrace"] = [];
    let reply = "";

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const completion = await this.llm.complete({ messages, tools: this.tools });

      if (completion.toolCalls.length === 0) {
        reply = (completion.content ?? "").trim() || "Is there anything else I can help you with?";
        await this.prisma.aIMessage.create({
          data: { conversationId, role: "assistant", content: reply },
        });
        break;
      }

      await this.prisma.aIMessage.create({
        data: {
          conversationId,
          role: "assistant",
          content: completion.content ?? "",
          toolName: completion.toolCalls.map((c) => c.name).join(","),
        },
      });
      messages.push({
        role: "assistant",
        content: completion.content,
        toolCalls: completion.toolCalls,
      });

      for (const call of completion.toolCalls) {
        const result = await this.invokeCapability(conversationId, requester, call.name, call.arguments, correlationId);
        toolTrace.push({ name: call.name, success: result.success, error: result.error });

        const payload = JSON.stringify(result.success ? result.output : { error: result.error });
        await this.prisma.aIMessage.create({
          data: { conversationId, role: "tool", content: payload, toolName: call.name },
        });
        messages.push({ role: "tool", content: payload, toolCallId: call.id, toolName: call.name });
      }
    }

    if (!reply) {
      reply = "I wasn't able to finish that request safely. I can transfer you to a human if you'd like.";
      await this.prisma.aIMessage.create({
        data: { conversationId, role: "assistant", content: reply },
      });
    }

    await this.audit.recordAudit({
      category: AuditEventCategory.AI_ACTION,
      action: "ai.turn_completed",
      actorUserId: requester.userId,
      targetType: "AIConversation",
      targetId: conversationId,
      correlationId,
      metadata: { tools: toolTrace.map((t) => t.name) },
    });

    return { conversationId, correlationId, reply, toolTrace };
  }

  /**
   * Executes one controlled capability in a conversation (used by the text
   * loop, the WebRTC voice widget, and the telephone stub). Unknown tool
   * names never reach Prisma or the EHR.
   */
  async invokeCapability(
    conversationId: string,
    requester: RequestUser,
    name: string,
    rawArgs: string | unknown,
    correlationId = newCorrelationId(),
  ) {
    const conversation = await this.requireOwnedConversation(conversationId, requester);
    if (!ALLOWED_TOOL_NAMES.has(name)) {
      this.logger.warn(`Model requested non-capability tool: ${name}`);
      return { success: false as const, error: `Unknown capability: ${name}` };
    }

    let args: unknown = rawArgs ?? {};
    if (typeof rawArgs === "string") {
      try {
        args = rawArgs ? JSON.parse(rawArgs) : {};
      } catch {
        return { success: false as const, error: "Tool arguments were not valid JSON." };
      }
    }

    const result = await this.capabilities.execute(name, args, {
      patientId: conversation.patientId,
      requester,
      conversationId,
      correlationId,
    });
    if (result.success) {
      await this.applyContextSideEffects(conversationId, name, JSON.stringify(args ?? {}), result.output);
    }
    return result;
  }

  async appendTranscript(
    conversationId: string,
    requester: RequestUser,
    entry: { role: "user" | "assistant"; content: string },
  ) {
    await this.requireOwnedConversation(conversationId, requester);
    return this.prisma.aIMessage.create({
      data: { conversationId, role: entry.role, content: entry.content },
    });
  }

  /** Mock telephone interface: each spoken turn is a text turn on the same agent core (PRD telephone stub). */
  async simulateTelephone(requester: RequestUser, turns: string[]) {
    const conversation = await this.startConversation(requester, "telephone");
    const results: ChatTurnResult[] = [];
    for (const spoken of turns) {
      results.push(await this.sendMessage(conversation.id, requester, spoken));
    }
    const full = await this.getConversation(conversation.id, requester);
    return { conversationId: conversation.id, channel: "telephone", turns: results, conversation: full };
  }

  private async applyContextSideEffects(
    conversationId: string,
    capabilityName: string,
    rawArgs: string,
    output: unknown,
  ) {
    let args: Record<string, unknown> = {};
    try {
      args = rawArgs ? (JSON.parse(rawArgs) as Record<string, unknown>) : {};
    } catch {
      args = {};
    }

    const patch: {
      intent?: string;
      selectedHospitalId?: string;
      selectedDoctorId?: string;
      selectedSlotStart?: Date;
      selectedSlotEnd?: Date;
      currentAppointmentId?: string;
    } = {};

    if (capabilityName === CapabilityName.SEARCH_DOCTORS && typeof args.hospitalId === "string") {
      patch.selectedHospitalId = args.hospitalId;
    }
    if (capabilityName === CapabilityName.SEARCH_DOCTORS) {
      const doctors = (output as { doctors?: Array<{ id: string; hospitalId: string }> })?.doctors ?? [];
      if (doctors.length === 1) {
        patch.selectedDoctorId = doctors[0].id;
        patch.selectedHospitalId = doctors[0].hospitalId;
      }
    }
    if (capabilityName === CapabilityName.CHECK_AVAILABILITY && typeof args.doctorId === "string") {
      patch.selectedDoctorId = args.doctorId;
      patch.intent = "check_availability";
    }
    if (capabilityName === CapabilityName.CREATE_APPOINTMENT) {
      const appointment = (
        output as {
          appointment?: {
            id: string;
            doctorId: string;
            hospitalId: string;
            slotStart: string;
            slotEnd: string;
            status: string;
          };
        }
      )?.appointment;
      if (appointment) {
        patch.currentAppointmentId = appointment.id;
        patch.selectedDoctorId = appointment.doctorId;
        patch.selectedHospitalId = appointment.hospitalId;
        patch.selectedSlotStart = new Date(appointment.slotStart);
        patch.selectedSlotEnd = new Date(appointment.slotEnd);
        patch.intent = appointment.status === AppointmentStatus.CONFIRMED ? "book_appointment" : "booking_pending";
      }
    }
    if (capabilityName === CapabilityName.GET_APPOINTMENT) {
      const appointment = (output as { appointment?: { id: string } | null })?.appointment;
      if (appointment) patch.currentAppointmentId = appointment.id;
    }
    if (capabilityName === CapabilityName.CANCEL_APPOINTMENT) {
      patch.intent = "cancel_appointment";
    }
    if (capabilityName === CapabilityName.RESCHEDULE_APPOINTMENT) {
      patch.intent = "reschedule_appointment";
    }
    if (capabilityName === CapabilityName.TRANSFER_TO_HUMAN) {
      patch.intent = "escalated";
    }

    let workflowStatePatch: Record<string, unknown> | undefined;
    if (capabilityName === CapabilityName.GET_QUESTIONNAIRE) {
      const q = output as { responseId?: string | null; questionnaire?: { id: string } | null };
      if (q.responseId) {
        workflowStatePatch = { questionnaireResponseId: q.responseId, questionnaireId: q.questionnaire?.id };
        patch.intent = "collect_questionnaire";
      }
    }
    if (capabilityName === CapabilityName.START_WORKFLOW) {
      const wf = output as { workflowExecutionId?: string };
      if (wf.workflowExecutionId) {
        workflowStatePatch = { workflowExecutionId: wf.workflowExecutionId };
      }
    }

    if (Object.keys(patch).length === 0 && !workflowStatePatch) return;

    const existing = workflowStatePatch
      ? await this.prisma.aIContext.findUnique({ where: { conversationId } })
      : null;
    const workflowState = workflowStatePatch
      ? { ...((existing?.workflowState as Record<string, unknown> | undefined) ?? {}), ...workflowStatePatch }
      : undefined;

    await this.prisma.aIContext.upsert({
      where: { conversationId },
      create: { conversationId, workflowState: (workflowState ?? {}) as Prisma.InputJsonValue, ...patch },
      update: { ...patch, ...(workflowState ? { workflowState: workflowState as Prisma.InputJsonValue } : {}) },
    });
  }

  private toLlmMessage(row: { role: string; content: string; toolName: string | null }): LlmChatMessage {
    if (row.role === "tool") {
      return { role: "tool", content: row.content, toolName: row.toolName ?? undefined, toolCallId: "replayed" };
    }
    if (row.role === "assistant") {
      return { role: "assistant", content: row.content };
    }
    if (row.role === "system") return { role: "system", content: row.content };
    return { role: "user", content: row.content };
  }

  private async requireOwnedConversation(conversationId: string, requester: RequestUser) {
    const conversation = await this.prisma.aIConversation.findUnique({
      where: { id: conversationId },
      include: {
        context: true,
        messages: { orderBy: { createdAt: "asc" } },
      },
    });
    if (!conversation) throw new NotFoundException("Conversation not found.");
    if (requester.role !== UserRole.PLATFORM_ADMIN && conversation.patientId !== requester.patientId) {
      throw new ForbiddenException("You do not have access to this conversation.");
    }
    return conversation;
  }

  private requirePatientId(requester: RequestUser): string {
    if (!requester.patientId) {
      throw new ForbiddenException("Only a patient can start this conversation.");
    }
    return requester.patientId;
  }
}
