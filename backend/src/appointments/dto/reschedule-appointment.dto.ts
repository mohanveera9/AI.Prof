import { IsDateString, IsOptional, IsString } from "class-validator";

export class RescheduleAppointmentDto {
  @IsDateString()
  newSlotStart!: string;

  @IsDateString()
  newSlotEnd!: string;

  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}
