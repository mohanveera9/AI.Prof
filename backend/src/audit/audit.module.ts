import { Global, Module } from "@nestjs/common";
import { AuditService } from "./audit.service";
import { ObservabilityService } from "./observability.service";
import { ObservabilityController } from "./observability.controller";

@Global()
@Module({
  providers: [AuditService, ObservabilityService],
  controllers: [ObservabilityController],
  exports: [AuditService, ObservabilityService],
})
export class AuditModule {}
