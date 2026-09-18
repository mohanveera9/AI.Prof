import { IsDateString, IsOptional, IsString } from "class-validator";

export class CreateLeaveDayDto {
  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;

  @IsOptional()
  @IsString()
  reason?: string;
}
