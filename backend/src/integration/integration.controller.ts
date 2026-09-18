import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from "@nestjs/common";
import { UserRole } from "@ai-prof/shared";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequestUser } from "../common/types";
import { assertHospitalScope } from "../common/tenant";
import { PrismaService } from "../prisma/prisma.service";
import { ConnectorFactory } from "./connector.factory";
import { ReconciliationService } from "../reconciliation/reconciliation.service";
import { ConnectionConfigDto, SetChaosDto } from "./dto/integration.dto";

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class IntegrationController {
  constructor(
    private readonly connectors: ConnectorFactory,
    private readonly reconciliation: ReconciliationService,
    private readonly prisma: PrismaService,
  ) {}

  @Roles(UserRole.PLATFORM_ADMIN)
  @Get("platform/integration/operations")
  listOperations(@Query("hospitalId") hospitalId?: string) {
    return this.prisma.integrationOperation.findMany({
      where: hospitalId ? { hospitalId } : undefined,
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  }

  @Roles(UserRole.PLATFORM_ADMIN)
  @Get("platform/integration/reconciliation")
  listReconciliation(@Query("hospitalId") hospitalId?: string) {
    return this.reconciliation.listOpen(hospitalId);
  }

  @Roles(UserRole.PLATFORM_ADMIN)
  @Post("platform/integration/reconciliation/:appointmentId/run")
  runReconciliation(@Param("appointmentId") appointmentId: string) {
    return this.reconciliation.reconcileAppointment(appointmentId);
  }

  @Roles(UserRole.PLATFORM_ADMIN)
  @Get("platform/integration/chaos")
  async getChaos() {
    const connector = await this.connectors.adminConnector();
    return connector.getChaos();
  }

  @Roles(UserRole.PLATFORM_ADMIN)
  @Post("platform/integration/chaos")
  async setChaos(@Body() dto: SetChaosDto) {
    const connector = await this.connectors.adminConnector();
    return connector.setChaos(dto);
  }

  @Roles(UserRole.PLATFORM_ADMIN)
  @Delete("platform/integration/chaos")
  async resetChaos() {
    const connector = await this.connectors.adminConnector();
    return connector.resetChaos();
  }

  @Roles(UserRole.HOSPITAL_ADMIN, UserRole.PLATFORM_ADMIN)
  @Get("hospitals/:hospitalId/integration/connection")
  async getConnection(@Param("hospitalId") hospitalId: string, @CurrentUser() user: RequestUser) {
    if (user.role === UserRole.HOSPITAL_ADMIN) assertHospitalScope(user, hospitalId);
    return this.connectors.ensureConnection(hospitalId);
  }

  @Roles(UserRole.HOSPITAL_ADMIN, UserRole.PLATFORM_ADMIN)
  @Put("hospitals/:hospitalId/integration/connection")
  async updateConnection(
    @Param("hospitalId") hospitalId: string,
    @Body() dto: ConnectionConfigDto,
    @CurrentUser() user: RequestUser,
  ) {
    if (user.role === UserRole.HOSPITAL_ADMIN) assertHospitalScope(user, hospitalId);
    await this.connectors.ensureConnection(hospitalId);
    return this.prisma.healthcareSystemConnection.update({
      where: { hospitalId_connectorType: { hospitalId, connectorType: "MOCK_EHR" } },
      data: { baseUrl: dto.baseUrl, apiKeyRef: dto.apiKeyRef ?? "MOCK_EHR_API_KEY" },
    });
  }
}
