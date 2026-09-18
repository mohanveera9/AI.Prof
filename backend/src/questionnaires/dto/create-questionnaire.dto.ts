import { Type } from "class-transformer";
import { IsArray, IsBoolean, IsOptional, IsString, MinLength, ValidateNested } from "class-validator";
import { CreateQuestionDto } from "./create-question.dto";

export class CreateQuestionnaireDto {
  @IsString()
  @MinLength(1)
  title!: string;

  @IsOptional()
  @IsString()
  specialtyId?: string;

  @IsOptional()
  @IsString()
  doctorId?: string;

  @IsOptional()
  @IsString()
  appointmentTypeId?: string;

  @IsOptional()
  @IsString()
  approvedConditionTag?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateQuestionDto)
  questions?: CreateQuestionDto[];
}

export class UpdateQuestionnaireDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  title?: string;

  @IsOptional()
  @IsString()
  specialtyId?: string | null;

  @IsOptional()
  @IsString()
  doctorId?: string | null;

  @IsOptional()
  @IsString()
  appointmentTypeId?: string | null;

  @IsOptional()
  @IsString()
  approvedConditionTag?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
