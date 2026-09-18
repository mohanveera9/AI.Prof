import { IsDateString, IsOptional, IsString, MaxLength } from "class-validator";

export class CreateAppointmentDto {
  @IsString()
  doctorId!: string;

  @IsDateString()
  slotStart!: string;

  @IsDateString()
  slotEnd!: string;

  @IsOptional()
  @IsString()
  appointmentTypeId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reasonNote?: string;

  /** Callers (e.g. the AI capability layer) may supply their own key so a
   * replayed request never creates a second appointment. If omitted, one is
   * generated server-side. */
  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}
