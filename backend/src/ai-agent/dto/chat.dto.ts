import { IsIn, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

export class CreateConversationDto {
  @IsOptional()
  @IsIn(["web_chat", "web_voice", "telephone"])
  channel?: string;
}

export class SendMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  content!: string;
}
