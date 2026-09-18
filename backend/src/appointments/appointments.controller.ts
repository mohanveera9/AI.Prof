import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { AppointmentStatus, UserRole } from "@ai-prof/shared";
import { AppointmentsService } from "./appointments.service";
import { CreateAppointmentDto } from "./dto/create-appointment.dto";
import { RescheduleAppointmentDto } from "./dto/reschedule-appointment.dto";
import { CancelAppointmentDto } from "./dto/cancel-appointment.dto";
import { CompleteAppointmentDto } from "./dto/complete-appointment.dto";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequestUser } from "../common/types";

@UseGuards(JwtAuthGuard)
@Controller()
export class AppointmentsController {
  constructor(private readonly appointmentsService: AppointmentsService) {}

  @UseGuards(RolesGuard)
  @Roles(UserRole.PATIENT, UserRole.PLATFORM_ADMIN)
  @Post("patients/:patientId/appointments")
  create(@Param("patientId") patientId: string, @Body() dto: CreateAppointmentDto, @CurrentUser() user: RequestUser) {
    return this.appointmentsService.create(patientId, user, dto);
  }

  @Get("patients/:patientId/appointments/latest")
  latestForPatient(@Param("patientId") patientId: string, @CurrentUser() user: RequestUser) {
    return this.appointmentsService.getLatestForPatient(patientId, user);
  }

  @Get("patients/:patientId/appointments")
  listForPatient(@Param("patientId") patientId: string, @CurrentUser() user: RequestUser) {
    return this.appointmentsService.listForPatient(patientId, user);
  }

  @Get("appointments/:id")
  getById(@Param("id") id: string, @CurrentUser() user: RequestUser) {
    return this.appointmentsService.getById(id, user);
  }

  @Post("appointments/:id/reschedule")
  reschedule(@Param("id") id: string, @Body() dto: RescheduleAppointmentDto, @CurrentUser() user: RequestUser) {
    return this.appointmentsService.reschedule(id, user, dto);
  }

  @Post("appointments/:id/cancel")
  cancel(@Param("id") id: string, @Body() dto: CancelAppointmentDto, @CurrentUser() user: RequestUser) {
    return this.appointmentsService.cancel(id, user, dto);
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.DOCTOR, UserRole.HOSPITAL_ADMIN, UserRole.PLATFORM_ADMIN)
  @Post("appointments/:id/complete")
  complete(@Param("id") id: string, @Body() dto: CompleteAppointmentDto, @CurrentUser() user: RequestUser) {
    return this.appointmentsService.complete(id, user, dto.reason);
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.DOCTOR, UserRole.HOSPITAL_ADMIN, UserRole.PLATFORM_ADMIN)
  @Post("appointments/:id/no-show")
  markNoShow(@Param("id") id: string, @Body() dto: CompleteAppointmentDto, @CurrentUser() user: RequestUser) {
    return this.appointmentsService.markNoShow(id, user, dto.reason);
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.DOCTOR, UserRole.HOSPITAL_ADMIN, UserRole.PLATFORM_ADMIN)
  @Get("doctors/:doctorId/appointments")
  listForDoctor(@Param("doctorId") doctorId: string, @CurrentUser() user: RequestUser) {
    return this.appointmentsService.listForDoctor(doctorId, user);
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.HOSPITAL_ADMIN, UserRole.PLATFORM_ADMIN)
  @Get("hospitals/:hospitalId/appointments")
  listForHospital(
    @Param("hospitalId") hospitalId: string,
    @CurrentUser() user: RequestUser,
    @Query("status") status?: AppointmentStatus,
  ) {
    return this.appointmentsService.listForHospital(hospitalId, user, status);
  }
}
