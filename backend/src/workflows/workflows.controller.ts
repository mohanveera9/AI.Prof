import { Body, Controller, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { UserRole } from "@ai-prof/shared";
import { WorkflowsService } from "./workflows.service";
import { CreateWorkflowDto, StartWorkflowDto, UpdateWorkflowDto } from "./dto/create-workflow.dto";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequestUser } from "../common/types";
import { newCorrelationId } from "../common/correlation";

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.HOSPITAL_ADMIN, UserRole.PLATFORM_ADMIN)
@Controller()
export class WorkflowsController {
  constructor(private readonly workflows: WorkflowsService) {}

  @Post("hospitals/:hospitalId/workflows")
  create(@Param("hospitalId") hospitalId: string, @Body() dto: CreateWorkflowDto, @CurrentUser() user: RequestUser) {
    return this.workflows.create(hospitalId, user, dto);
  }

  @Get("hospitals/:hospitalId/workflows")
  list(@Param("hospitalId") hospitalId: string, @CurrentUser() user: RequestUser) {
    return this.workflows.list(hospitalId, user);
  }

  @Get("hospitals/:hospitalId/workflow-executions")
  executions(@Param("hospitalId") hospitalId: string, @CurrentUser() user: RequestUser) {
    return this.workflows.listExecutions(hospitalId, user);
  }

  @Get("workflows/:id")
  get(@Param("id") id: string, @CurrentUser() user: RequestUser) {
    return this.workflows.getById(id, user);
  }

  @Patch("workflows/:id")
  update(@Param("id") id: string, @Body() dto: UpdateWorkflowDto, @CurrentUser() user: RequestUser) {
    return this.workflows.update(id, user, dto);
  }

  @Post("workflows/:id/start")
  start(@Param("id") id: string, @Body() dto: StartWorkflowDto, @CurrentUser() user: RequestUser) {
    return this.workflows.getById(id, user).then((workflow) =>
      this.workflows.startExecution(workflow.id, dto.appointmentId ?? null, newCorrelationId()),
    );
  }
}
