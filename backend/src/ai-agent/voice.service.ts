import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { buildSystemPrompt } from "./system-prompt";
import { buildRealtimeTools } from "./tools";
import { AiAgentService } from "./ai-agent.service";
import { RequestUser } from "../common/types";

@Injectable()
export class VoiceService {
  private readonly logger = new Logger(VoiceService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly agent: AiAgentService,
  ) {}

  /**
   * Mints an OpenAI Realtime ephemeral client secret scoped to the same
   * capability tool schema the text agent uses. The browser then talks to
   * OpenAI over WebRTC; tool calls come back here for execution.
   */
  async mintRealtimeSession(requester: RequestUser, conversationId?: string) {
    const apiKey = this.config.get<string>("OPENAI_API_KEY");
    if (!apiKey || apiKey.includes("replace-me")) {
      throw new ServiceUnavailableException("OPENAI_API_KEY is not configured for voice.");
    }

    const conversation = conversationId
      ? await this.agent.getConversation(conversationId, requester)
      : await this.agent.startConversation(requester, "web_voice");

    const model = this.config.get<string>("OPENAI_REALTIME_MODEL") ?? "gpt-4o-realtime-preview";
    const body = {
      model,
      voice: "alloy",
      modalities: ["audio", "text"],
      instructions: buildSystemPrompt(),
      tools: buildRealtimeTools(),
      tool_choice: "auto",
      input_audio_transcription: { model: "whisper-1" },
      turn_detection: {
        type: "server_vad",
        threshold: 0.5,
        prefix_padding_ms: 300,
        silence_duration_ms: 500,
        create_response: true,
        interrupt_response: true,
      },
    };

    const response = await fetch("https://api.openai.com/v1/realtime/sessions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "openai-beta": "realtime=v1",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const detail = await response.text();
      this.logger.error(`Realtime session mint failed (${response.status}): ${detail}`);
      throw new ServiceUnavailableException("Could not start a voice session with the speech provider.");
    }

    const session = (await response.json()) as {
      client_secret?: { value?: string; expires_at?: number };
      id?: string;
    };

    const clientSecret = session.client_secret?.value;
    if (!clientSecret) {
      throw new ServiceUnavailableException("Voice provider did not return a client secret.");
    }

    return {
      conversationId: conversation.id,
      model,
      clientSecret,
      expiresAt: session.client_secret?.expires_at ?? null,
      sessionId: session.id ?? null,
    };
  }
}
