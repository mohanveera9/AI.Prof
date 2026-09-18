import { IsDateString, IsOptional, IsString } from "class-validator";

export class CreateBlockedSlotDto {
  @IsDateString()
  startAt!: string;

  @IsDateString()
  endAt!: string;

  @IsOptional()
  @IsString()
  reason?: string;
}
