import { IsOptional, IsString, MaxLength } from "class-validator";

export class CompleteAppointmentDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
