import { Type } from "class-transformer";
import { IsArray, IsBoolean, IsObject, IsOptional, IsString, MinLength } from "class-validator";

export class CreateWorkflowDto {
  @IsString()
  @MinLength(1)
  key!: string;

  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  @MinLength(1)
  trigger!: string;

  @IsArray()
  @IsObject({ each: true })
  steps!: Record<string, unknown>[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateWorkflowDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  trigger?: string;

  @IsOptional()
  @IsArray()
  @IsObject({ each: true })
  steps?: Record<string, unknown>[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class StartWorkflowDto {
  @IsOptional()
  @IsString()
  appointmentId?: string;

  @IsOptional()
  @Type(() => Object)
  params?: Record<string, unknown>;
}
