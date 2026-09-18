import { IsObject } from "class-validator";

export class UpdatePreferencesDto {
  @IsObject()
  data!: Record<string, unknown>;
}
