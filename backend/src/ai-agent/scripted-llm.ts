import type { LlmChatMessage, LlmClient, LlmCompletion, LlmToolCall } from "./llm.types";

export type ScriptedTurn =
  | { content: string; toolCalls?: never }
  | { content?: string | null; toolCalls: LlmToolCall[] }
  | ((messages: LlmChatMessage[]) => LlmCompletion | Promise<LlmCompletion>);

/** Deterministic stand-in for OpenAI, used by scripted evaluation tests. */
export class ScriptedLlmClient implements LlmClient {
  private index = 0;

  constructor(private readonly turns: ScriptedTurn[]) {}

  async complete(input: { messages: LlmChatMessage[] }): Promise<LlmCompletion> {
    const turn = this.turns[this.index++];
    if (!turn) {
      return { content: "I wasn't able to continue that request.", toolCalls: [] };
    }
    if (typeof turn === "function") {
      return turn(input.messages);
    }
    return { content: turn.content ?? null, toolCalls: turn.toolCalls ?? [] };
  }
}

export function parseLastToolOutput<T = unknown>(messages: LlmChatMessage[]): T | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "tool" && messages[i].content) {
      try {
        return JSON.parse(messages[i].content as string) as T;
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function toolCall(name: string, args: unknown, id?: string): LlmToolCall {
  return {
    id: id ?? `call_${name}_${Math.random().toString(36).slice(2, 8)}`,
    name,
    arguments: JSON.stringify(args),
  };
}
