import type { ChaosConfig, ChaosMode, ChaosScope } from "./types";

export class ChaosHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ChaosHttpError";
  }
}

const DEFAULT_CHAOS: ChaosConfig = {
  mode: "none",
  scope: "appointment_create",
  remainingHits: 0,
  timeoutMs: 8000,
};

export class ChaosEngine {
  private config: ChaosConfig = { ...DEFAULT_CHAOS };
  private timers: NodeJS.Timeout[] = [];

  get(): ChaosConfig {
    return { ...this.config };
  }

  set(patch: Partial<ChaosConfig>): ChaosConfig {
    this.config = {
      mode: patch.mode ?? this.config.mode,
      scope: patch.scope ?? this.config.scope,
      remainingHits: patch.remainingHits ?? this.config.remainingHits,
      timeoutMs: patch.timeoutMs ?? this.config.timeoutMs,
    };
    return this.get();
  }

  reset(): ChaosConfig {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
    this.config = { ...DEFAULT_CHAOS };
    return this.get();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      timer.unref();
      this.timers.push(timer);
    });
  }

  /**
   * Returns how the caller should proceed:
   *  - `proceed` — run the real operation and respond normally
   *  - `delay_after` — run the real operation (so the write happens) then hang
   * Throws ChaosHttpError for injected 4xx/5xx / hang-without-write.
   */
  async apply(operation: ChaosScope): Promise<"proceed" | "delay_after"> {
    if (this.config.mode === "none" || this.config.remainingHits <= 0) return "proceed";
    if (this.config.scope !== "*" && this.config.scope !== operation) return "proceed";

    this.config.remainingHits -= 1;
    const mode: ChaosMode = this.config.mode;

    switch (mode) {
      case "error_500":
        throw new ChaosHttpError(500, "Injected internal error", { chaos: mode });
      case "outage":
        throw new ChaosHttpError(503, "Injected service unavailable", { chaos: mode });
      case "auth_failure":
        throw new ChaosHttpError(401, "Injected authentication failure", { chaos: mode });
      case "rate_limited":
        throw new ChaosHttpError(429, "Injected rate limit", { chaos: mode });
      case "validation_error":
        throw new ChaosHttpError(400, "Injected validation error", { chaos: mode });
      case "slot_conflict":
        throw new ChaosHttpError(409, "Injected slot conflict", { chaos: mode, code: "SLOT_CONFLICT" });
      case "timeout_no_create":
        await this.sleep(this.config.timeoutMs);
        throw new ChaosHttpError(504, "Injected timeout without write", { chaos: mode });
      case "timeout_with_create":
        return "delay_after";
      default:
        return "proceed";
    }
  }

  async delayIfNeeded(instruction: "proceed" | "delay_after"): Promise<void> {
    if (instruction === "delay_after") {
      await this.sleep(this.config.timeoutMs);
    }
  }
}
