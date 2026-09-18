import { Module } from "@nestjs/common";
import { CapabilitiesModule } from "../capabilities/capabilities.module";
import { AiAgentService } from "./ai-agent.service";
import { AiAgentController } from "./ai-agent.controller";
import { VoiceService } from "./voice.service";
import { VoiceController } from "./voice.controller";
import { OpenAiLlmClient } from "./openai.llm";
import { LLM_CLIENT } from "./llm.types";

@Module({
  imports: [CapabilitiesModule],
  providers: [
    AiAgentService,
    VoiceService,
    OpenAiLlmClient,
    { provide: LLM_CLIENT, useExisting: OpenAiLlmClient },
  ],
  controllers: [AiAgentController, VoiceController],
  exports: [AiAgentService, VoiceService],
})
export class AiAgentModule {}
