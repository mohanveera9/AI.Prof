import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { UserRole } from "@ai-prof/shared";
import { HospitalsService } from "./hospitals.service";
import { RegisterHospitalDto } from "./dto/register-hospital.dto";
import { UpdateHospitalDto } from "./dto/update-hospital.dto";
import { NameDto } from "./dto/name.dto";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequestUser } from "../common/types";

@Controller("hospitals")
export class HospitalsController {
  constructor(private readonly hospitalsService: HospitalsService) {}

  @Post("register")
  register(@Body() dto: RegisterHospitalDto) {
    return this.hospitalsService.registerHospital(dto);
  }

  @Get()
  listApproved(@Query("city") city?: string, @Query("specialty") specialty?: string) {
    return this.hospitalsService.listApproved({ city, specialty });
  }

  @UseGuards(JwtAuthGuard)
  @Get(":id")
  getById(@Param("id") id: string, @CurrentUser() user: RequestUser) {
    return this.hospitalsService.getById(id, user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.HOSPITAL_ADMIN, UserRole.PLATFORM_ADMIN)
  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpdateHospitalDto, @CurrentUser() user: RequestUser) {
    return this.hospitalsService.update(id, user, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.HOSPITAL_ADMIN)
  @Post(":id/submit")
  submit(@Param("id") id: string, @CurrentUser() user: RequestUser) {
    return this.hospitalsService.submit(id, user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.HOSPITAL_ADMIN, UserRole.PLATFORM_ADMIN)
  @Post(":id/departments")
  addDepartment(@Param("id") id: string, @Body() dto: NameDto, @CurrentUser() user: RequestUser) {
    return this.hospitalsService.addDepartment(id, user, dto.name);
  }

  @Get(":id/departments")
  listDepartments(@Param("id") id: string) {
    return this.hospitalsService.listDepartments(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.HOSPITAL_ADMIN, UserRole.PLATFORM_ADMIN)
  @Delete(":id/departments/:departmentId")
  removeDepartment(
    @Param("id") id: string,
    @Param("departmentId") departmentId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.hospitalsService.removeDepartment(id, user, departmentId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.HOSPITAL_ADMIN, UserRole.PLATFORM_ADMIN)
  @Post(":id/specialties")
  addSpecialty(@Param("id") id: string, @Body() dto: NameDto, @CurrentUser() user: RequestUser) {
    return this.hospitalsService.addSpecialty(id, user, dto.name);
  }

  @Get(":id/specialties")
  listSpecialties(@Param("id") id: string) {
    return this.hospitalsService.listSpecialties(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.HOSPITAL_ADMIN, UserRole.PLATFORM_ADMIN)
  @Delete(":id/specialties/:specialtyId")
  removeSpecialty(
    @Param("id") id: string,
    @Param("specialtyId") specialtyId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.hospitalsService.removeSpecialty(id, user, specialtyId);
  }
}
