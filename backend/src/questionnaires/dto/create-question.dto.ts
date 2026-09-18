import { ArrayNotEmpty, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Min, MinLength } from "class-validator";
import { QuestionFieldType } from "@ai-prof/shared";

const QUESTION_TYPES = Object.values(QuestionFieldType);

export class CreateQuestionDto {
  @IsString()
  @MinLength(1)
  prompt!: string;

  @IsIn(QUESTION_TYPES)
  type!: QuestionFieldType;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  options?: string[];

  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;
}

export class UpdateQuestionDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  prompt?: string;

  @IsOptional()
  @IsIn(QUESTION_TYPES)
  type?: QuestionFieldType;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  options?: string[];

  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;
}

export class SubmitAnswersDto {
  @IsArray()
  @ArrayNotEmpty()
  answers!: Array<{ questionId: string; value: string | number | boolean | string[] }>;
}
