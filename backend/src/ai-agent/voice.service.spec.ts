import { ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { VoiceService } from "./voice.service";
import { AiAgentService } from "./ai-agent.service";
import { UserRole } from "@ai-prof/shared";

describe("VoiceService", () => {
  it("refuses to mint a Realtime session when the API key is missing", async () => {
    const config = {
      get: (key: string) => (key === "OPENAI_API_KEY" ? "sk-replace-me" : undefined),
    } as ConfigService;
    const agent = {
      startConversation: jest.fn(),
      getConversation: jest.fn(),
    } as unknown as AiAgentService;
    const voice = new VoiceService(config, agent);

    await expect(
      voice.mintRealtimeSession({ userId: "u1", role: UserRole.PATIENT, patientId: "p1" }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(agent.startConversation).not.toHaveBeenCalled();
  });
});
