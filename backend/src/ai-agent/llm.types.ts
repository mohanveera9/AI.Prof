export interface LlmChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  toolCallId?: string;
  toolName?: string;
  toolCalls?: LlmToolCall[];
}

export interface LlmToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface LlmCompletion {
  content: string | null;
  toolCalls: LlmToolCall[];
}

export interface LlmClient {
  complete(input: { messages: LlmChatMessage[]; tools: unknown[] }): Promise<LlmCompletion>;
}

export const LLM_CLIENT = "LLM_CLIENT";
