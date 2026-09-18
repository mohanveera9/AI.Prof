import { ArrayNotEmpty, IsArray, IsIn, IsObject, IsOptional, IsString, MaxLength } from "class-validator";

export class MintRealtimeSessionDto {
  @IsOptional()
  @IsString()
  conversationId?: string;
}

export class ExecuteVoiceToolDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsObject()
  arguments?: Record<string, unknown>;
}

export class AppendTranscriptDto {
  @IsIn(["user", "assistant"])
  role!: "user" | "assistant";

  @IsString()
  @MaxLength(8000)
  content!: string;
}

export class SimulateTelephoneDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  turns!: string[];
}
