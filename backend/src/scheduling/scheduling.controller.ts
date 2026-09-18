import { Body, Controller, Delete, Get, Param, Put, Post, Query, UseGuards } from "@nestjs/common";
import { UserRole } from "@ai-prof/shared";
import { SchedulingService } from "./scheduling.service";
import { SetWorkingHoursDto } from "./dto/set-working-hours.dto";
import { CreateBlockedSlotDto } from "./dto/create-blocked-slot.dto";
import { CreateLeaveDayDto } from "./dto/create-leave-day.dto";
import { CheckAvailabilityQueryDto } from "./dto/check-availability.dto";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequestUser } from "../common/types";

const MANAGE_ROLES = [UserRole.HOSPITAL_ADMIN, UserRole.PLATFORM_ADMIN, UserRole.DOCTOR];

@Controller("doctors/:doctorId")
export class SchedulingController {
  constructor(private readonly schedulingService: SchedulingService) {}

  @Get("availability")
  checkAvailability(@Param("doctorId") doctorId: string, @Query() query: CheckAvailabilityQueryDto) {
    return this.schedulingService.checkAvailability(doctorId, query);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...MANAGE_ROLES)
  @Put("working-hours")
  setWorkingHours(@Param("doctorId") doctorId: string, @Body() dto: SetWorkingHoursDto, @CurrentUser() user: RequestUser) {
    return this.schedulingService.setWorkingHours(doctorId, user, dto);
  }

  @Get("working-hours")
  listWorkingHours(@Param("doctorId") doctorId: string) {
    return this.schedulingService.listWorkingHours(doctorId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...MANAGE_ROLES)
  @Post("blocked-slots")
  addBlockedSlot(@Param("doctorId") doctorId: string, @Body() dto: CreateBlockedSlotDto, @CurrentUser() user: RequestUser) {
    return this.schedulingService.addBlockedSlot(doctorId, user, dto);
  }

  @Get("blocked-slots")
  listBlockedSlots(@Param("doctorId") doctorId: string) {
    return this.schedulingService.listBlockedSlots(doctorId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...MANAGE_ROLES)
  @Delete("blocked-slots/:blockedSlotId")
  removeBlockedSlot(
    @Param("doctorId") doctorId: string,
    @Param("blockedSlotId") blockedSlotId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.schedulingService.removeBlockedSlot(doctorId, user, blockedSlotId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...MANAGE_ROLES)
  @Post("leave-days")
  addLeaveDay(@Param("doctorId") doctorId: string, @Body() dto: CreateLeaveDayDto, @CurrentUser() user: RequestUser) {
    return this.schedulingService.addLeaveDay(doctorId, user, dto);
  }

  @Get("leave-days")
  listLeaveDays(@Param("doctorId") doctorId: string) {
    return this.schedulingService.listLeaveDays(doctorId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...MANAGE_ROLES)
  @Delete("leave-days/:leaveDayId")
  removeLeaveDay(
    @Param("doctorId") doctorId: string,
    @Param("leaveDayId") leaveDayId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.schedulingService.removeLeaveDay(doctorId, user, leaveDayId);
  }
}
