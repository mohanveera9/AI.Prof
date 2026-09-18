import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { HospitalStatus, UserRole } from "@ai-prof/shared";
import { HospitalsService } from "./hospitals.service";
import { DecisionDto } from "./dto/decision.dto";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequestUser } from "../common/types";

/** Platform-admin hospital application review queue (PRD §5). */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.PLATFORM_ADMIN)
@Controller("platform/hospitals")
export class PlatformHospitalsController {
  constructor(private readonly hospitalsService: HospitalsService) {}

  @Get()
  list(@Query("status") status?: HospitalStatus) {
    return this.hospitalsService.listForPlatformAdmin(status);
  }

  @Post(":id/review")
  markUnderReview(@Param("id") id: string, @CurrentUser() user: RequestUser) {
    return this.hospitalsService.markUnderReview(id, user);
  }

  @Post(":id/approve")
  approve(@Param("id") id: string, @CurrentUser() user: RequestUser) {
    return this.hospitalsService.approve(id, user);
  }

  @Post(":id/reject")
  reject(@Param("id") id: string, @Body() dto: DecisionDto, @CurrentUser() user: RequestUser) {
    return this.hospitalsService.reject(id, user, dto.reason);
  }

  @Post(":id/request-corrections")
  requestCorrections(@Param("id") id: string, @Body() dto: DecisionDto, @CurrentUser() user: RequestUser) {
    return this.hospitalsService.requestCorrections(id, user, dto.reason);
  }

  @Post(":id/suspend")
  suspend(@Param("id") id: string, @Body() dto: DecisionDto, @CurrentUser() user: RequestUser) {
    return this.hospitalsService.suspend(id, user, dto.reason);
  }

  @Post(":id/reactivate")
  reactivate(@Param("id") id: string, @CurrentUser() user: RequestUser) {
    return this.hospitalsService.reactivate(id, user);
  }
}
