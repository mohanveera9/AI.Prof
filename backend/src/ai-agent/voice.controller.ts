import { Body, Controller, Logger, Param, Post, UseGuards } from "@nestjs/common";
import { UserRole } from "@ai-prof/shared";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequestUser } from "../common/types";
import { AiAgentService } from "./ai-agent.service";
import { VoiceService } from "./voice.service";
import { AppendTranscriptDto, ExecuteVoiceToolDto, MintRealtimeSessionDto, SimulateTelephoneDto } from "./dto/voice.dto";

const VOICE_TOOL_LATENCY_WARN_MS = 1500;

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.PATIENT)
@Controller("ai")
export class VoiceController {
  private readonly logger = new Logger(VoiceController.name);

  constructor(
    private readonly voice: VoiceService,
    private readonly agent: AiAgentService,
  ) {}

  @Post("realtime/session")
  mintSession(@Body() dto: MintRealtimeSessionDto, @CurrentUser() user: RequestUser) {
    return this.voice.mintRealtimeSession(user, dto.conversationId);
  }

  @Post("conversations/:id/tools")
  async executeTool(@Param("id") id: string, @Body() dto: ExecuteVoiceToolDto, @CurrentUser() user: RequestUser) {
    const started = Date.now();
    const result = await this.agent.invokeCapability(id, user, dto.name, dto.arguments ?? {});
    const latencyMs = Date.now() - started;
    if (latencyMs > VOICE_TOOL_LATENCY_WARN_MS) {
      this.logger.warn(`Voice tool ${dto.name} took ${latencyMs}ms (budget ${VOICE_TOOL_LATENCY_WARN_MS}ms)`);
    }
    return { ...result, latencyMs };
  }

  @Post("conversations/:id/transcript")
  appendTranscript(@Param("id") id: string, @Body() dto: AppendTranscriptDto, @CurrentUser() user: RequestUser) {
    return this.agent.appendTranscript(id, user, dto);
  }

  @Post("telephone/simulate")
  simulateCall(@Body() dto: SimulateTelephoneDto, @CurrentUser() user: RequestUser) {
    return this.agent.simulateTelephone(user, dto.turns);
  }
}
