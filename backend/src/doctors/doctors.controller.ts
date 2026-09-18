import { Body, Controller, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { UserRole } from "@ai-prof/shared";
import { DoctorsService } from "./doctors.service";
import { CreateDoctorDto } from "./dto/create-doctor.dto";
import { UpdateDoctorDto } from "./dto/update-doctor.dto";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { OptionalJwtAuthGuard } from "../common/guards/optional-jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequestUser } from "../common/types";

@Controller()
export class DoctorsController {
  constructor(private readonly doctorsService: DoctorsService) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.HOSPITAL_ADMIN, UserRole.PLATFORM_ADMIN)
  @Post("hospitals/:hospitalId/doctors")
  create(@Param("hospitalId") hospitalId: string, @Body() dto: CreateDoctorDto, @CurrentUser() user: RequestUser) {
    return this.doctorsService.create(hospitalId, user, dto);
  }

  @UseGuards(OptionalJwtAuthGuard)
  @Get("hospitals/:hospitalId/doctors")
  listForHospital(@Param("hospitalId") hospitalId: string, @CurrentUser() user?: RequestUser) {
    return this.doctorsService.listForHospital(hospitalId, user);
  }

  @Get("doctors/:id")
  getById(@Param("id") id: string) {
    return this.doctorsService.getById(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.HOSPITAL_ADMIN, UserRole.PLATFORM_ADMIN, UserRole.DOCTOR)
  @Patch("doctors/:id")
  update(@Param("id") id: string, @Body() dto: UpdateDoctorDto, @CurrentUser() user: RequestUser) {
    return this.doctorsService.update(id, user, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.HOSPITAL_ADMIN, UserRole.PLATFORM_ADMIN)
  @Post("doctors/:id/activate")
  activate(@Param("id") id: string, @CurrentUser() user: RequestUser) {
    return this.doctorsService.activate(id, user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.HOSPITAL_ADMIN, UserRole.PLATFORM_ADMIN)
  @Post("doctors/:id/suspend")
  suspend(@Param("id") id: string, @CurrentUser() user: RequestUser) {
    return this.doctorsService.suspend(id, user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.HOSPITAL_ADMIN, UserRole.PLATFORM_ADMIN)
  @Post("doctors/:id/deactivate")
  deactivate(@Param("id") id: string, @CurrentUser() user: RequestUser) {
    return this.doctorsService.deactivate(id, user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.HOSPITAL_ADMIN, UserRole.PLATFORM_ADMIN)
  @Post("doctors/:id/reactivate")
  reactivate(@Param("id") id: string, @CurrentUser() user: RequestUser) {
    return this.doctorsService.reactivate(id, user);
  }
}
