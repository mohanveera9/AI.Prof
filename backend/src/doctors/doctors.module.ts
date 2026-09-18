import { Module } from "@nestjs/common";
import { DoctorsService } from "./doctors.service";
import { DoctorsController } from "./doctors.controller";
import { AuthModule } from "../auth/auth.module";
import { SchedulingModule } from "../scheduling/scheduling.module";

@Module({
  imports: [AuthModule, SchedulingModule],
  providers: [DoctorsService],
  controllers: [DoctorsController],
  exports: [DoctorsService],
})
export class DoctorsModule {}
