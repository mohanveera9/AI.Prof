import { Module } from "@nestjs/common";
import { QuestionnairesModule } from "../questionnaires/questionnaires.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { WorkflowsService } from "./workflows.service";
import { WorkflowsController } from "./workflows.controller";
import { WorkflowScheduler } from "./workflow.scheduler";

@Module({
  imports: [QuestionnairesModule, NotificationsModule],
  providers: [WorkflowsService, WorkflowScheduler],
  controllers: [WorkflowsController],
  exports: [WorkflowsService],
})
export class WorkflowsModule {}
