import { Body, Controller, Get, Param, Patch, UseGuards } from "@nestjs/common";
import { PatientsService } from "./patients.service";
import { UpdatePatientDto } from "./dto/update-patient.dto";
import { UpdatePreferencesDto } from "./dto/update-preferences.dto";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequestUser } from "../common/types";

@UseGuards(JwtAuthGuard)
@Controller("patients")
export class PatientsController {
  constructor(private readonly patientsService: PatientsService) {}

  @Get(":id")
  getById(@Param("id") id: string, @CurrentUser() user: RequestUser) {
    return this.patientsService.getById(id, user);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpdatePatientDto, @CurrentUser() user: RequestUser) {
    return this.patientsService.update(id, user, dto);
  }

  @Patch(":id/preferences")
  updatePreferences(@Param("id") id: string, @Body() dto: UpdatePreferencesDto, @CurrentUser() user: RequestUser) {
    return this.patientsService.updatePreferences(id, user, dto);
  }
}
