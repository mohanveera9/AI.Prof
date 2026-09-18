import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { UserRole } from "@ai-prof/shared";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequestUser } from "../common/types";
import { ObservabilityService } from "./observability.service";
import { AuditQueryDto, MetricsQueryDto, OperationalQueryDto } from "./dto/observability-query.dto";

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.PLATFORM_ADMIN, UserRole.HOSPITAL_ADMIN)
@Controller()
export class ObservabilityController {
  constructor(private readonly observability: ObservabilityService) {}

  @Roles(UserRole.PLATFORM_ADMIN)
  @Get("platform/metrics")
  platformMetrics(@CurrentUser() user: RequestUser, @Query() query: MetricsQueryDto) {
    return this.observability.metrics(user, query.hospitalId);
  }

  @Roles(UserRole.PLATFORM_ADMIN)
  @Get("platform/audit")
  platformAudit(@CurrentUser() user: RequestUser, @Query() query: AuditQueryDto) {
    return this.observability.listAudit(user, query);
  }

  @Roles(UserRole.PLATFORM_ADMIN)
  @Get("platform/operational-events")
  platformOperational(@CurrentUser() user: RequestUser, @Query() query: OperationalQueryDto) {
    return this.observability.listOperational(user, query);
  }

  @Roles(UserRole.PLATFORM_ADMIN)
  @Get("platform/escalations")
  platformEscalations(@CurrentUser() user: RequestUser, @Query("hospitalId") hospitalId?: string) {
    return this.observability.listEscalations(user, hospitalId);
  }

  @Roles(UserRole.PLATFORM_ADMIN)
  @Get("platform/trace/:correlationId")
  platformTrace(@CurrentUser() user: RequestUser, @Param("correlationId") correlationId: string) {
    return this.observability.trace(user, correlationId);
  }

  @Get("hospitals/:hospitalId/metrics")
  hospitalMetrics(@CurrentUser() user: RequestUser, @Param("hospitalId") hospitalId: string) {
    return this.observability.metrics(user, hospitalId);
  }

  @Get("hospitals/:hospitalId/audit")
  hospitalAudit(@CurrentUser() user: RequestUser, @Param("hospitalId") hospitalId: string, @Query() query: AuditQueryDto) {
    return this.observability.listAudit(user, { ...query, hospitalId });
  }

  @Get("hospitals/:hospitalId/operational-events")
  hospitalOperational(
    @CurrentUser() user: RequestUser,
    @Param("hospitalId") hospitalId: string,
    @Query() query: OperationalQueryDto,
  ) {
    return this.observability.listOperational(user, { ...query, hospitalId });
  }

  @Get("hospitals/:hospitalId/escalations")
  hospitalEscalations(@CurrentUser() user: RequestUser, @Param("hospitalId") hospitalId: string) {
    return this.observability.listEscalations(user, hospitalId);
  }

  @Get("hospitals/:hospitalId/trace/:correlationId")
  hospitalTrace(
    @CurrentUser() user: RequestUser,
    @Param("hospitalId") hospitalId: string,
    @Param("correlationId") correlationId: string,
  ) {
    return this.observability.trace(user, correlationId, hospitalId);
  }
}
