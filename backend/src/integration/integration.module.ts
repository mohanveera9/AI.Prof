import { Module } from "@nestjs/common";
import { IdentifierMappingService } from "./identifier-mapping.service";
import { ConnectorFactory } from "./connector.factory";
import { AppointmentExternalSync } from "./appointment-external-sync";
import { IntegrationService } from "./integration.service";
import { IntegrationController } from "./integration.controller";
import { ReconciliationService } from "../reconciliation/reconciliation.service";
import { ReconciliationScheduler } from "../reconciliation/reconciliation.scheduler";

@Module({
  providers: [
    IdentifierMappingService,
    ConnectorFactory,
    AppointmentExternalSync,
    IntegrationService,
    ReconciliationService,
    ReconciliationScheduler,
  ],
  controllers: [IntegrationController],
  exports: [
    IdentifierMappingService,
    ConnectorFactory,
    AppointmentExternalSync,
    IntegrationService,
    ReconciliationService,
    ReconciliationScheduler,
  ],
})
export class IntegrationModule {}
