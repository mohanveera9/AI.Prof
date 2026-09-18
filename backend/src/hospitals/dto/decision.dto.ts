import { IsOptional, IsString } from "class-validator";

export class DecisionDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
