import { Module } from "@nestjs/common";
import { CapabilitiesService } from "./capabilities.service";
import { CapabilitiesController } from "./capabilities.controller";
import { HospitalsModule } from "../hospitals/hospitals.module";
import { DoctorsModule } from "../doctors/doctors.module";
import { SchedulingModule } from "../scheduling/scheduling.module";
import { AppointmentsModule } from "../appointments/appointments.module";
import { IntegrationModule } from "../integration/integration.module";
import { PatientsModule } from "../patients/patients.module";
import { QuestionnairesModule } from "../questionnaires/questionnaires.module";
import { WorkflowsModule } from "../workflows/workflows.module";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  imports: [
    HospitalsModule,
    DoctorsModule,
    SchedulingModule,
    AppointmentsModule,
    IntegrationModule,
    PatientsModule,
    QuestionnairesModule,
    WorkflowsModule,
    NotificationsModule,
  ],
  providers: [CapabilitiesService],
  controllers: [CapabilitiesController],
  exports: [CapabilitiesService],
})
export class CapabilitiesModule {}
