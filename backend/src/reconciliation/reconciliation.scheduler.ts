import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Queue, Worker } from "bullmq";
import { ReconciliationService } from "./reconciliation.service";

const QUEUE_NAME = "reconciliation";

/**
 * Enqueues a reconciliation job on Redis/BullMQ when available, otherwise
 * runs it in-process after a short delay so local dev still works without Redis.
 */
@Injectable()
export class ReconciliationScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReconciliationScheduler.name);
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(
    private readonly reconciliation: ReconciliationService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit() {
    const url = this.config.get<string>("REDIS_URL");
    if (!url) {
      this.logger.warn("REDIS_URL not set; reconciliation will run in-process");
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
          await this.reconciliation.reconcileAppointment(job.data.appointmentId);
        },
        { connection: redis.duplicate() },
      );
      this.logger.log("Reconciliation queue connected to Redis");
    } catch (err) {
      this.logger.warn(
        `Redis unavailable (${(err as Error).message}); reconciliation will run in-process`,
      );
      this.queue = null;
      this.worker = null;
    }
  }

  async onModuleDestroy() {
    await this.worker?.close().catch(() => undefined);
    await this.queue?.close().catch(() => undefined);
  }

  async schedule(appointmentId: string, delayMs = 250): Promise<void> {
    if (this.config.get("RECONCILIATION_AUTO_RUN") === "false") return;

    if (this.queue) {
      try {
        await this.queue.add(
          "reconcile",
          { appointmentId },
          { jobId: `recon-${appointmentId}`, delay: delayMs, removeOnComplete: 100, attempts: 1 },
        );
        return;
      } catch (err) {
        this.logger.warn(`Failed to enqueue reconciliation job: ${(err as Error).message}`);
      }
    }

    const timer = setTimeout(() => {
      this.reconciliation.reconcileAppointment(appointmentId).catch((err) => {
        this.logger.error(`In-process reconciliation failed for ${appointmentId}`, err as Error);
      });
    }, delayMs);
    timer.unref();
  }
}
