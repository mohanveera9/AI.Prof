import { Controller, Post, UseGuards } from "@nestjs/common";
import { UserRole } from "@ai-prof/shared";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequestUser } from "../common/types";
import { FailureDemoService } from "./failure-demo.service";

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.PLATFORM_ADMIN)
@Controller("platform/demo")
export class DemoController {
  constructor(private readonly demo: FailureDemoService) {}

  @Post("failure-recovery")
  runFailureRecovery(@CurrentUser() user: RequestUser) {
    return this.demo.runFailureRecovery(user);
  }
}
