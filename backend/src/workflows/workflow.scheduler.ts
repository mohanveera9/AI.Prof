import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Queue, Worker } from "bullmq";
import { WorkflowsService } from "./workflows.service";

const QUEUE_NAME = "workflows";

/**
 * BullMQ when Redis is up; otherwise in-process timers (same pattern as
 * reconciliation). Delayed workflow steps (reminders) still run locally.
 */
@Injectable()
export class WorkflowScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkflowScheduler.name);
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(
    private readonly workflows: WorkflowsService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit() {
    this.workflows.bindScheduler(this);
    const url = this.config.get<string>("REDIS_URL");
    if (!url) {
      this.logger.warn("REDIS_URL not set; workflows will run in-process");
      return;
    }
    try {
      const IORedis = (await import("ioredis")).default;
      const redis = new IORedis(url, {
        maxRetriesPerRequest: null,
        connectTimeout: 800,
        retryStrategy: () => null,
        lazyConnect: false,
      });
      redis.on("error", () => undefined);
      await new Promise<void>((resolve, reject) => {
        const onReady = () => {
          redis.off("error", onError);
          resolve();
        };
        const onError = (err: Error) => {
          redis.off("ready", onReady);
          reject(err);
        };
        if (redis.status === "ready") return resolve();
        redis.once("ready", onReady);
        redis.once("error", onError);
        const timer = setTimeout(() => reject(new Error("Redis connect timeout")), 900);
        timer.unref();
      });
      this.queue = new Queue(QUEUE_NAME, { connection: redis });
      this.worker = new Worker(
        QUEUE_NAME,
        async (job) => {
          await this.workflows.resumeStep(job.data.executionId, job.data.stepIndex);
        },
        { connection: redis.duplicate() },
      );
      this.logger.log("Workflow queue connected to Redis");
    } catch (err) {
      this.logger.warn(`Redis unavailable (${(err as Error).message}); workflows will run in-process`);
      this.queue = null;
      this.worker = null;
    }
  }

  async onModuleDestroy() {
    await this.worker?.close().catch(() => undefined);
    await this.queue?.close().catch(() => undefined);
  }

  async schedule(executionId: string, stepIndex: number, delayMs: number): Promise<void> {
    if (this.queue) {
      try {
        await this.queue.add(
          "step",
          { executionId, stepIndex },
          {
            jobId: `wf-${executionId}-${stepIndex}`,
            delay: delayMs,
            removeOnComplete: 100,
            attempts: 2,
          },
        );
        return;
      } catch (err) {
        this.logger.warn(`Failed to enqueue workflow step: ${(err as Error).message}`);
      }
    }

    const timer = setTimeout(() => {
      this.workflows.resumeStep(executionId, stepIndex).catch((err) => {
        this.logger.error(`In-process workflow step failed for ${executionId}`, err as Error);
      });
    }, delayMs);
    timer.unref();
  }
}
