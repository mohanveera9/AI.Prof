import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { UserRole } from "@ai-prof/shared";
import { AiAgentService } from "./ai-agent.service";
import { CreateConversationDto, SendMessageDto } from "./dto/chat.dto";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequestUser } from "../common/types";

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.PATIENT)
@Controller("ai/conversations")
export class AiAgentController {
  constructor(private readonly agent: AiAgentService) {}

  @Post()
  start(@Body() dto: CreateConversationDto, @CurrentUser() user: RequestUser) {
    return this.agent.startConversation(user, dto.channel ?? "web_chat");
  }

  @Get()
  list(@CurrentUser() user: RequestUser) {
    return this.agent.listConversations(user);
  }

  @Get(":id")
  get(@Param("id") id: string, @CurrentUser() user: RequestUser) {
    return this.agent.getConversation(id, user);
  }

  @Post(":id/messages")
  send(@Param("id") id: string, @Body() dto: SendMessageDto, @CurrentUser() user: RequestUser) {
    return this.agent.sendMessage(id, user, dto.content);
  }
}
