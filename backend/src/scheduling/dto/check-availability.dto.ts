import { Type } from "class-transformer";
import { IsDateString, IsInt, IsOptional, IsString, Max, Min } from "class-validator";

export class CheckAvailabilityQueryDto {
  @IsDateString()
  dateFrom!: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @IsOptional()
  @IsString()
  appointmentTypeId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5)
  durationMinutes?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
