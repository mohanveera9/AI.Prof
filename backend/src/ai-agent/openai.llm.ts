import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import OpenAI from "openai";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import type { LlmChatMessage, LlmClient, LlmCompletion } from "./llm.types";

@Injectable()
export class OpenAiLlmClient implements LlmClient {
  private readonly client: OpenAI | null;
  private readonly model: string;

  constructor(config: ConfigService) {
    const apiKey = config.get<string>("OPENAI_API_KEY");
    this.model = config.get<string>("OPENAI_CHAT_MODEL") ?? "gpt-4o-mini";
    this.client = apiKey && !apiKey.includes("replace-me") ? new OpenAI({ apiKey }) : null;
  }

  async complete(input: { messages: LlmChatMessage[]; tools: unknown[] }): Promise<LlmCompletion> {
    if (!this.client) {
      throw new ServiceUnavailableException("OPENAI_API_KEY is not configured.");
    }

    const response = await this.client.chat.completions.create({
      model: this.model,
      temperature: 0.2,
      messages: input.messages.map(toOpenAiMessage),
      tools: input.tools as ChatCompletionTool[],
      tool_choice: "auto",
    });

    const message = response.choices[0]?.message;
    const toolCalls = (message?.tool_calls ?? [])
      .filter((call) => call.type === "function")
      .map((call) => ({
        id: call.id,
        name: call.function.name,
        arguments: call.function.arguments,
      }));

    return { content: message?.content ?? null, toolCalls };
  }
}

function toOpenAiMessage(message: LlmChatMessage): ChatCompletionMessageParam {
  if (message.role === "tool") {
    return {
      role: "tool",
      tool_call_id: message.toolCallId ?? "",
      content: message.content ?? "",
    };
  }
  if (message.role === "assistant" && message.toolCalls?.length) {
    return {
      role: "assistant",
      content: message.content,
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: "function" as const,
        function: { name: call.name, arguments: call.arguments },
      })),
    };
  }
  if (message.role === "system") return { role: "system", content: message.content ?? "" };
  if (message.role === "assistant") return { role: "assistant", content: message.content };
  return { role: "user", content: message.content ?? "" };
}
