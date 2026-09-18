import { Module } from "@nestjs/common";
import { AppointmentsService } from "./appointments.service";
import { AppointmentsController } from "./appointments.controller";
import { SchedulingModule } from "../scheduling/scheduling.module";
import { IntegrationModule } from "../integration/integration.module";
import { WorkflowsModule } from "../workflows/workflows.module";

@Module({
  imports: [SchedulingModule, IntegrationModule, WorkflowsModule],
  providers: [AppointmentsService],
  controllers: [AppointmentsController],
  exports: [AppointmentsService],
})
export class AppointmentsModule {}
