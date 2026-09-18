import { Module } from "@nestjs/common";
import { AppointmentsModule } from "../appointments/appointments.module";
import { IntegrationModule } from "../integration/integration.module";
import { SchedulingModule } from "../scheduling/scheduling.module";
import { FailureDemoService } from "./failure-demo.service";
import { DemoController } from "./demo.controller";

@Module({
  imports: [AppointmentsModule, IntegrationModule, SchedulingModule],
  providers: [FailureDemoService],
  controllers: [DemoController],
})
export class DemoModule {}
