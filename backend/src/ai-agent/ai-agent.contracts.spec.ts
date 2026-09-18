import { CapabilityName } from "@ai-prof/shared";
import { buildSystemPrompt } from "./system-prompt";
import { ALLOWED_TOOL_NAMES, buildOpenAiTools, buildRealtimeTools } from "./tools";

describe("AI agent contracts", () => {
  it("exposes exactly the 16 controlled capabilities as tools", () => {
    const tools = buildOpenAiTools();
    const names = tools.map((t) => t.function?.name).sort();
    const expected = Object.values(CapabilityName).slice().sort();
    expect(names).toEqual(expected);
    expect(ALLOWED_TOOL_NAMES.size).toBe(expected.length);
  });

  it("emits the same capability names in the Realtime (WebRTC) tool schema", () => {
    const realtime = buildRealtimeTools();
    expect(realtime.map((t) => t.name).sort()).toEqual(Object.values(CapabilityName).slice().sort());
    expect(realtime[0]).toEqual(
      expect.objectContaining({ type: "function", name: expect.any(String), parameters: expect.any(Object) }),
    );
  });

  it("encodes the administrative-only safety boundary and clarify-over-guess rule", () => {
    const prompt = buildSystemPrompt(new Date("2026-09-18T10:00:00.000Z"));
    expect(prompt).toMatch(/administrative/i);
    expect(prompt).toMatch(/Never invent/);
    expect(prompt).toMatch(/check_availability/);
    expect(prompt).toMatch(/Clarify over guess/);
    expect(prompt).toMatch(/book that for Friday/);
    expect(prompt).toMatch(/medical|clinical|diagnostic/i);
    expect(prompt).toContain("2026-09-18");
  });
});
