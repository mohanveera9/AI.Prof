import { IsIn, IsInt, IsOptional, IsString, Min } from "class-validator";
import { Type } from "class-transformer";

export const CHAOS_MODES = [
  "none",
  "error_500",
  "timeout_no_create",
  "timeout_with_create",
  "auth_failure",
  "rate_limited",
  "outage",
  "validation_error",
  "slot_conflict",
] as const;

export class SetChaosDto {
  @IsIn(CHAOS_MODES)
  mode!: (typeof CHAOS_MODES)[number];

  @IsOptional()
  @IsIn(["appointment_create", "*"])
  scope?: "appointment_create" | "*";

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  remainingHits?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  timeoutMs?: number;
}

export class ConnectionConfigDto {
  @IsString()
  baseUrl!: string;

  @IsOptional()
  @IsString()
  apiKeyRef?: string;
}
