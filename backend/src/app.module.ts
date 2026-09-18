import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ConfigModule } from "@nestjs/config";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { AppController } from "./app.controller";
import { PrismaModule } from "./prisma/prisma.module";
import { AuditModule } from "./audit/audit.module";
import { AuthModule } from "./auth/auth.module";
import { HospitalsModule } from "./hospitals/hospitals.module";
import { DoctorsModule } from "./doctors/doctors.module";
import { PatientsModule } from "./patients/patients.module";
import { SchedulingModule } from "./scheduling/scheduling.module";
import { IntegrationModule } from "./integration/integration.module";
import { AppointmentsModule } from "./appointments/appointments.module";
import { CapabilitiesModule } from "./capabilities/capabilities.module";
import { AiAgentModule } from "./ai-agent/ai-agent.module";
import { QuestionnairesModule } from "./questionnaires/questionnaires.module";
import { WorkflowsModule } from "./workflows/workflows.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { DemoModule } from "./demo/demo.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot({
      throttlers: [{ name: "default", ttl: 60_000, limit: 120 }],
    }),
    PrismaModule,
    AuditModule,
    AuthModule,
    HospitalsModule,
    DoctorsModule,
    PatientsModule,
    SchedulingModule,
    IntegrationModule,
    AppointmentsModule,
    CapabilitiesModule,
    AiAgentModule,
    QuestionnairesModule,
    WorkflowsModule,
    NotificationsModule,
    DemoModule,
  ],
  controllers: [AppController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
