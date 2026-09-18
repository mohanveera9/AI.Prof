import { IsIn, IsOptional, IsString } from "class-validator";
import { AuditEventCategory, OperationalEventType } from "@ai-prof/shared";

const CATEGORIES = Object.values(AuditEventCategory);
const OPERATIONAL_TYPES = Object.values(OperationalEventType);
const SEVERITIES = ["INFO", "WARNING", "CRITICAL"] as const;

export class AuditQueryDto {
  @IsOptional()
  @IsString()
  hospitalId?: string;

  @IsOptional()
  @IsIn(CATEGORIES)
  category?: (typeof CATEGORIES)[number];

  @IsOptional()
  @IsString()
  correlationId?: string;
}

export class OperationalQueryDto {
  @IsOptional()
  @IsString()
  hospitalId?: string;

  @IsOptional()
  @IsIn(OPERATIONAL_TYPES)
  type?: (typeof OPERATIONAL_TYPES)[number];

  @IsOptional()
  @IsIn(SEVERITIES)
  severity?: (typeof SEVERITIES)[number];

  @IsOptional()
  @IsString()
  correlationId?: string;
}

export class MetricsQueryDto {
  @IsOptional()
  @IsString()
  hospitalId?: string;
}
