import { Module } from "@nestjs/common";
import { HospitalsService } from "./hospitals.service";
import { HospitalsController } from "./hospitals.controller";
import { PlatformHospitalsController } from "./platform-hospitals.controller";
import { AuthModule } from "../auth/auth.module";

@Module({
  imports: [AuthModule],
  providers: [HospitalsService],
  controllers: [HospitalsController, PlatformHospitalsController],
  exports: [HospitalsService],
})
export class HospitalsModule {}
