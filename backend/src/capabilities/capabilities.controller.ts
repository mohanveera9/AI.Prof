import { Body, Controller, Param, Post, Query, UseGuards } from "@nestjs/common";
import { UserRole } from "@ai-prof/shared";
import { CapabilitiesService } from "./capabilities.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequestUser } from "../common/types";
import { newCorrelationId } from "../common/correlation";

/**
 * Direct capability invocation for testing/debugging the capability layer
 * independent of the AI agent (which will call CapabilitiesService.execute
 * directly once the conversation loop exists). Always acts as the
 * authenticated patient — there is no "act as another patient" mode.
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.PATIENT)
@Controller("ai/capabilities")
export class CapabilitiesController {
  constructor(private readonly capabilities: CapabilitiesService) {}

  @Post(":name")
  execute(
    @Param("name") name: string,
    @Body() body: unknown,
    @CurrentUser() user: RequestUser,
    @Query("conversationId") conversationId?: string,
  ) {
    return this.capabilities.execute(name, body, {
      patientId: user.patientId!,
      requester: user,
      conversationId,
      correlationId: newCorrelationId(),
    });
  }
}
