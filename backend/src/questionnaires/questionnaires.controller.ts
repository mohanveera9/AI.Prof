import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { UserRole } from "@ai-prof/shared";
import { QuestionnairesService } from "./questionnaires.service";
import { CreateQuestionnaireDto, UpdateQuestionnaireDto } from "./dto/create-questionnaire.dto";
import { CreateQuestionDto, SubmitAnswersDto, UpdateQuestionDto } from "./dto/create-question.dto";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequestUser } from "../common/types";

@UseGuards(JwtAuthGuard)
@Controller()
export class QuestionnairesController {
  constructor(private readonly questionnaires: QuestionnairesService) {}

  @UseGuards(RolesGuard)
  @Roles(UserRole.HOSPITAL_ADMIN, UserRole.PLATFORM_ADMIN)
  @Post("hospitals/:hospitalId/questionnaires")
  create(
    @Param("hospitalId") hospitalId: string,
    @Body() dto: CreateQuestionnaireDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.questionnaires.createTemplate(hospitalId, user, dto);
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.HOSPITAL_ADMIN, UserRole.PLATFORM_ADMIN)
  @Get("hospitals/:hospitalId/questionnaires")
  list(@Param("hospitalId") hospitalId: string, @CurrentUser() user: RequestUser) {
    return this.questionnaires.listTemplates(hospitalId, user);
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.HOSPITAL_ADMIN, UserRole.PLATFORM_ADMIN)
  @Get("questionnaires/:id")
  get(@Param("id") id: string, @CurrentUser() user: RequestUser) {
    return this.questionnaires.getTemplate(id, user);
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.HOSPITAL_ADMIN, UserRole.PLATFORM_ADMIN)
  @Patch("questionnaires/:id")
  update(@Param("id") id: string, @Body() dto: UpdateQuestionnaireDto, @CurrentUser() user: RequestUser) {
    return this.questionnaires.updateTemplate(id, user, dto);
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.HOSPITAL_ADMIN, UserRole.PLATFORM_ADMIN)
  @Post("questionnaires/:id/questions")
  addQuestion(@Param("id") id: string, @Body() dto: CreateQuestionDto, @CurrentUser() user: RequestUser) {
    return this.questionnaires.addQuestion(id, user, dto);
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.HOSPITAL_ADMIN, UserRole.PLATFORM_ADMIN)
  @Patch("questionnaire-questions/:id")
  updateQuestion(@Param("id") id: string, @Body() dto: UpdateQuestionDto, @CurrentUser() user: RequestUser) {
    return this.questionnaires.updateQuestion(id, user, dto);
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.HOSPITAL_ADMIN, UserRole.PLATFORM_ADMIN)
  @Delete("questionnaire-questions/:id")
  removeQuestion(@Param("id") id: string, @CurrentUser() user: RequestUser) {
    return this.questionnaires.removeQuestion(id, user);
  }

  @Get("patients/:patientId/questionnaires/pending")
  async pending(@Param("patientId") patientId: string, @CurrentUser() user: RequestUser) {
    const pending = await this.questionnaires.pendingForPatient(patientId, user);
    return { pending };
  }

  @Post("questionnaire-responses/:id/submit")
  submit(@Param("id") id: string, @Body() dto: SubmitAnswersDto, @CurrentUser() user: RequestUser) {
    return this.questionnaires.submitAnswers(id, user, dto.answers);
  }
}
