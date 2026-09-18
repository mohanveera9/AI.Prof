import { CapabilityName, CapabilitySchemas } from "@ai-prof/shared";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { ChatCompletionTool } from "openai/resources/chat/completions";

/** OpenAI tool list — exactly the controlled capabilities, nothing else. */
export function buildOpenAiTools(): ChatCompletionTool[] {
  return (Object.values(CapabilityName) as CapabilityName[]).map((name) => {
    const spec = CapabilitySchemas[name];
    const json = (zodToJsonSchema as (schema: unknown, opts: object) => Record<string, unknown>)(spec.input, {
      $refStrategy: "none",
      target: "openApi3",
    });
    const { $schema, ...parameters } = json;
    return {
      type: "function",
      function: {
        name,
        description: spec.description,
        parameters,
      },
    };
  });
}

/** Realtime API tool shape (unwrapped; used by ephemeral WebRTC sessions). */
export function buildRealtimeTools() {
  return buildOpenAiTools().map((tool) => ({
    type: "function" as const,
    name: tool.function!.name!,
    description: tool.function!.description ?? "",
    parameters: tool.function!.parameters ?? { type: "object", properties: {} },
  }));
}

export const ALLOWED_TOOL_NAMES = new Set<string>(Object.values(CapabilityName));
