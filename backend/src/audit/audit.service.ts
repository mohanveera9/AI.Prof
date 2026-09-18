import { Injectable, Logger } from "@nestjs/common";
import { AuditEventCategory, OperationalEventType } from "@ai-prof/shared";
import { PrismaService } from "../prisma/prisma.service";

export interface RecordAuditEventInput {
  category: AuditEventCategory;
  action: string;
  actorUserId?: string;
  hospitalId?: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  correlationId?: string;
}

export interface RecordOperationalEventInput {
  type: OperationalEventType;
  severity?: "INFO" | "WARNING" | "CRITICAL";
  hospitalId?: string;
  correlationId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Writes to AuditEvent ("who did what") and OperationalEvent ("system
 * health / integration state") — kept as two separate streams per PRD
 * §19/§23 so each can be queried, retained, and reasoned about on its own.
 * Never place raw sensitive healthcare content into metadata (PRD §21).
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async recordAudit(input: RecordAuditEventInput): Promise<void> {
    try {
      await this.prisma.auditEvent.create({
        data: {
          category: input.category,
          action: input.action,
          actorUserId: input.actorUserId,
          hospitalId: input.hospitalId,
          targetType: input.targetType,
          targetId: input.targetId,
          metadata: input.metadata as any,
          correlationId: input.correlationId,
        },
      });
    } catch (err) {
      // Audit failures must never break the primary business operation.
      this.logger.error(`Failed to record audit event: ${input.action}`, err as Error);
    }
  }

  async recordOperational(input: RecordOperationalEventInput): Promise<void> {
    try {
      await this.prisma.operationalEvent.create({
        data: {
          type: input.type,
          severity: input.severity ?? "INFO",
          hospitalId: input.hospitalId,
          correlationId: input.correlationId,
          metadata: input.metadata as any,
        },
      });
    } catch (err) {
      this.logger.error(`Failed to record operational event: ${input.type}`, err as Error);
    }
  }
}
