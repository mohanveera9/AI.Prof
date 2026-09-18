import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { QuestionFieldType, UserRole } from "@ai-prof/shared";
import { Prisma, QuestionFieldType as PrismaQuestionFieldType } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { RequestUser } from "../common/types";
import { assertHospitalScope, assertSelfPatient } from "../common/tenant";
import { AuditEventCategory } from "@ai-prof/shared";
import { CreateQuestionnaireDto, UpdateQuestionnaireDto } from "./dto/create-questionnaire.dto";
import { CreateQuestionDto, UpdateQuestionDto } from "./dto/create-question.dto";

export interface QuestionnaireAnswerInput {
  questionId: string;
  value: string | number | boolean | string[];
}

@Injectable()
export class QuestionnairesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async createTemplate(hospitalId: string, requester: RequestUser, dto: CreateQuestionnaireDto) {
    this.assertCanManageHospital(requester, hospitalId);
    await this.assertScopeRefs(hospitalId, dto);

    const created = await this.prisma.questionnaire.create({
      data: {
        hospitalId,
        title: dto.title,
        specialtyId: dto.specialtyId,
        doctorId: dto.doctorId,
        appointmentTypeId: dto.appointmentTypeId,
        approvedConditionTag: dto.approvedConditionTag,
        questions: dto.questions?.length
          ? {
              create: dto.questions.map((q, index) => ({
                prompt: q.prompt,
                type: q.type as PrismaQuestionFieldType,
                options: q.options ?? [],
                required: q.required ?? true,
                order: q.order ?? index,
              })),
            }
          : undefined,
      },
      include: { questions: { orderBy: { order: "asc" } } },
    });

    await this.audit.recordAudit({
      category: AuditEventCategory.CONFIGURATION_CHANGE,
      action: "questionnaire.created",
      actorUserId: requester.userId,
      hospitalId,
      targetType: "Questionnaire",
      targetId: created.id,
    });
    return created;
  }

  async listTemplates(hospitalId: string, requester: RequestUser) {
    this.assertCanManageHospital(requester, hospitalId);
    return this.prisma.questionnaire.findMany({
      where: { hospitalId },
      include: { questions: { orderBy: { order: "asc" } } },
      orderBy: { createdAt: "desc" },
    });
  }

  async getTemplate(id: string, requester: RequestUser) {
    const questionnaire = await this.requireTemplate(id);
    this.assertCanManageHospital(requester, questionnaire.hospitalId);
    return questionnaire;
  }

  async updateTemplate(id: string, requester: RequestUser, dto: UpdateQuestionnaireDto) {
    const questionnaire = await this.requireTemplate(id);
    this.assertCanManageHospital(requester, questionnaire.hospitalId);
    await this.assertScopeRefs(questionnaire.hospitalId, dto);

    const updated = await this.prisma.questionnaire.update({
      where: { id },
      data: {
        title: dto.title,
        specialtyId: dto.specialtyId === undefined ? undefined : dto.specialtyId,
        doctorId: dto.doctorId === undefined ? undefined : dto.doctorId,
        appointmentTypeId: dto.appointmentTypeId === undefined ? undefined : dto.appointmentTypeId,
        approvedConditionTag: dto.approvedConditionTag === undefined ? undefined : dto.approvedConditionTag,
        isActive: dto.isActive,
      },
      include: { questions: { orderBy: { order: "asc" } } },
    });
    await this.audit.recordAudit({
      category: AuditEventCategory.CONFIGURATION_CHANGE,
      action: "questionnaire.updated",
      actorUserId: requester.userId,
      hospitalId: questionnaire.hospitalId,
      targetType: "Questionnaire",
      targetId: id,
    });
    return updated;
  }

  async addQuestion(questionnaireId: string, requester: RequestUser, dto: CreateQuestionDto) {
    const questionnaire = await this.requireTemplate(questionnaireId);
    this.assertCanManageHospital(requester, questionnaire.hospitalId);
    const order = dto.order ?? questionnaire.questions.length;
    return this.prisma.questionnaireQuestion.create({
      data: {
        questionnaireId,
        prompt: dto.prompt,
        type: dto.type as PrismaQuestionFieldType,
        options: dto.options ?? [],
        required: dto.required ?? true,
        order,
      },
    });
  }

  async updateQuestion(questionId: string, requester: RequestUser, dto: UpdateQuestionDto) {
    const question = await this.prisma.questionnaireQuestion.findUnique({
      where: { id: questionId },
      include: { questionnaire: true },
    });
    if (!question) throw new NotFoundException("Question not found.");
    this.assertCanManageHospital(requester, question.questionnaire.hospitalId);
    return this.prisma.questionnaireQuestion.update({
      where: { id: questionId },
      data: {
        prompt: dto.prompt,
        type: dto.type as PrismaQuestionFieldType | undefined,
        options: dto.options,
        required: dto.required,
        order: dto.order,
      },
    });
  }

  async removeQuestion(questionId: string, requester: RequestUser) {
    const question = await this.prisma.questionnaireQuestion.findUnique({
      where: { id: questionId },
      include: { questionnaire: true },
    });
    if (!question) throw new NotFoundException("Question not found.");
    this.assertCanManageHospital(requester, question.questionnaire.hospitalId);
    await this.prisma.questionnaireAnswer.deleteMany({ where: { questionId } });
    await this.prisma.questionnaireQuestion.delete({ where: { id: questionId } });
    return { deleted: true };
  }

  /**
   * Picks the best active template for an appointment: doctor > appointment
   * type > specialty > hospital-generic. Returns null when none exist.
   */
  async matchForAppointment(appointmentId: string) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: { doctor: { include: { specialties: true } } },
    });
    if (!appointment) throw new NotFoundException("Appointment not found.");

    const templates = await this.prisma.questionnaire.findMany({
      where: { hospitalId: appointment.hospitalId, isActive: true },
      include: { questions: { orderBy: { order: "asc" } } },
    });
    const specialtyIds = new Set(appointment.doctor.specialties.map((s) => s.specialtyId));

    let best: (typeof templates)[number] | null = null;
    let bestScore = -1;
    for (const template of templates) {
      const score = this.scoreTemplate(template, appointment, specialtyIds);
      if (score === null) continue;
      if (score > bestScore) {
        best = template;
        bestScore = score;
      }
    }
    return best;
  }

  async assignToAppointment(appointmentId: string) {
    const template = await this.matchForAppointment(appointmentId);
    if (!template) return null;
    const appointment = await this.prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } });
    return this.ensureResponse(template.id, appointment.id, appointment.patientId);
  }

  async getForPatient(
    patientId: string,
    requester: RequestUser,
    input: { appointmentId?: string; questionnaireId?: string },
  ) {
    assertSelfPatient(requester, patientId);

    const appointment = input.appointmentId
      ? await this.requirePatientAppointment(input.appointmentId, patientId)
      : await this.prisma.appointment.findFirst({
          where: { patientId },
          orderBy: { createdAt: "desc" },
        });

    if (!appointment) {
      return { questionnaire: null, responseId: null, responseStatus: null };
    }

    let template = input.questionnaireId
      ? await this.prisma.questionnaire.findUnique({
          where: { id: input.questionnaireId },
          include: { questions: { orderBy: { order: "asc" } } },
        })
      : await this.matchForAppointment(appointment.id);

    if (template && template.hospitalId !== appointment.hospitalId) {
      throw new ForbiddenException("That questionnaire does not belong to this appointment's hospital.");
    }
    if (!template) {
      return { questionnaire: null, responseId: null, responseStatus: null };
    }

    const response = await this.ensureResponse(template.id, appointment.id, patientId);
    return {
      questionnaire: this.toCapabilityQuestionnaire(template),
      responseId: response.id,
      responseStatus: response.status,
    };
  }

  async pendingForPatient(patientId: string, requester: RequestUser) {
    assertSelfPatient(requester, patientId);
    const response = await this.prisma.questionnaireResponse.findFirst({
      where: { patientId, status: { not: "COMPLETED" } },
      orderBy: { createdAt: "desc" },
      include: {
        questionnaire: { include: { questions: { orderBy: { order: "asc" } } } },
        answers: true,
      },
    });
    if (!response) return null;
    return {
      responseId: response.id,
      status: response.status,
      appointmentId: response.appointmentId,
      questionnaire: this.toCapabilityQuestionnaire(response.questionnaire),
      answers: response.answers.map((a) => ({
        questionId: a.questionId,
        value: a.valueJson ?? a.valueBoolean ?? a.valueNumber ?? a.valueText,
      })),
    };
  }

  async submitAnswers(responseId: string, requester: RequestUser, answers: QuestionnaireAnswerInput[]) {
    const response = await this.prisma.questionnaireResponse.findUnique({
      where: { id: responseId },
      include: {
        questionnaire: { include: { questions: { orderBy: { order: "asc" } } } },
        appointment: true,
        answers: true,
      },
    });
    if (!response) throw new NotFoundException("Questionnaire response not found.");
    assertSelfPatient(requester, response.patientId);

    const questions = new Map(response.questionnaire.questions.map((q) => [q.id, q]));
    for (const answer of answers) {
      const question = questions.get(answer.questionId);
      if (!question) {
        throw new BadRequestException(`Unknown question ${answer.questionId} for this questionnaire.`);
      }
      const stored = this.normalizeAnswer(question.type, question.options, answer.value);
      await this.prisma.questionnaireAnswer.upsert({
        where: { responseId_questionId: { responseId, questionId: answer.questionId } },
        create: { responseId, questionId: answer.questionId, ...stored },
        update: stored,
      });
    }

    const allAnswers = await this.prisma.questionnaireAnswer.findMany({ where: { responseId } });
    const answered = new Set(allAnswers.map((a) => a.questionId));
    const requiredMissing = response.questionnaire.questions.filter((q) => q.required && !answered.has(q.id));
    const status = requiredMissing.length === 0 ? "COMPLETED" : "IN_PROGRESS";

    await this.prisma.questionnaireResponse.update({
      where: { id: responseId },
      data: { status, completedAt: status === "COMPLETED" ? new Date() : null },
    });

    await this.audit.recordAudit({
      category: AuditEventCategory.PATIENT_DATA_ACCESS,
      action: "questionnaire.submitted",
      actorUserId: requester.userId,
      hospitalId: response.appointment.hospitalId,
      targetType: "QuestionnaireResponse",
      targetId: responseId,
      metadata: { status, answerCount: answers.length },
    });

    return { responseId, status: "recorded" as const, completionStatus: status };
  }

  private scoreTemplate(
    template: { doctorId: string | null; appointmentTypeId: string | null; specialtyId: string | null },
    appointment: { doctorId: string; appointmentTypeId: string | null },
    specialtyIds: Set<string>,
  ): number | null {
    if (template.doctorId && template.doctorId !== appointment.doctorId) return null;
    if (template.appointmentTypeId && template.appointmentTypeId !== appointment.appointmentTypeId) return null;
    if (template.specialtyId && !specialtyIds.has(template.specialtyId)) return null;

    let score = 0;
    if (template.doctorId) score += 100;
    if (template.appointmentTypeId) score += 50;
    if (template.specialtyId) score += 25;
    return score;
  }

  private async ensureResponse(questionnaireId: string, appointmentId: string, patientId: string) {
    const existing = await this.prisma.questionnaireResponse.findFirst({
      where: { questionnaireId, appointmentId, patientId },
    });
    if (existing) return existing;
    return this.prisma.questionnaireResponse.create({
      data: { questionnaireId, appointmentId, patientId, status: "PENDING" },
    });
  }

  private toCapabilityQuestionnaire(template: {
    id: string;
    title: string;
    questions: Array<{ id: string; prompt: string; type: string; options: string[]; required: boolean }>;
  }) {
    return {
      id: template.id,
      title: template.title,
      questions: template.questions.map((q) => ({
        id: q.id,
        prompt: q.prompt,
        type: q.type,
        options: q.options.length ? q.options : undefined,
        required: q.required,
      })),
    };
  }

  private normalizeAnswer(
    type: PrismaQuestionFieldType,
    options: string[],
    value: string | number | boolean | string[],
  ): Pick<Prisma.QuestionnaireAnswerCreateInput, "valueText" | "valueNumber" | "valueBoolean" | "valueJson"> {
    switch (type) {
      case QuestionFieldType.YES_NO: {
        const bool =
          typeof value === "boolean"
            ? value
            : typeof value === "string"
              ? ["yes", "true", "y", "1"].includes(value.toLowerCase())
              : null;
        if (bool === null) throw new BadRequestException("YES_NO answers must be yes/no or true/false.");
        return { valueBoolean: bool, valueText: null, valueNumber: null, valueJson: undefined };
      }
      case QuestionFieldType.CHOICE: {
        const text = String(value);
        if (options.length && !options.includes(text)) {
          throw new BadRequestException(`Choice must be one of: ${options.join(", ")}`);
        }
        return { valueText: text, valueBoolean: null, valueNumber: null, valueJson: undefined };
      }
      case QuestionFieldType.MULTIPLE_CHOICE: {
        const selected = Array.isArray(value) ? value.map(String) : [String(value)];
        if (options.length && selected.some((item) => !options.includes(item))) {
          throw new BadRequestException(`Choices must be from: ${options.join(", ")}`);
        }
        return { valueJson: selected, valueText: null, valueBoolean: null, valueNumber: null };
      }
      case QuestionFieldType.NUMERIC: {
        const num = typeof value === "number" ? value : Number(value);
        if (Number.isNaN(num)) throw new BadRequestException("Numeric answer expected.");
        return { valueNumber: num, valueText: null, valueBoolean: null, valueJson: undefined };
      }
      case QuestionFieldType.STRUCTURED:
        return { valueJson: value as Prisma.InputJsonValue, valueText: null, valueBoolean: null, valueNumber: null };
      default:
        return { valueText: String(value), valueBoolean: null, valueNumber: null, valueJson: undefined };
    }
  }

  private async requireTemplate(id: string) {
    const questionnaire = await this.prisma.questionnaire.findUnique({
      where: { id },
      include: { questions: { orderBy: { order: "asc" } } },
    });
    if (!questionnaire) throw new NotFoundException("Questionnaire not found.");
    return questionnaire;
  }

  private async requirePatientAppointment(appointmentId: string, patientId: string) {
    const appointment = await this.prisma.appointment.findUnique({ where: { id: appointmentId } });
    if (!appointment) throw new NotFoundException("Appointment not found.");
    if (appointment.patientId !== patientId) {
      throw new ForbiddenException("You do not have access to this appointment.");
    }
    return appointment;
  }

  private async assertScopeRefs(
    hospitalId: string,
    dto: { specialtyId?: string | null; doctorId?: string | null; appointmentTypeId?: string | null },
  ) {
    if (dto.specialtyId) {
      const specialty = await this.prisma.specialty.findUnique({ where: { id: dto.specialtyId } });
      if (!specialty || specialty.hospitalId !== hospitalId) {
        throw new BadRequestException("Specialty does not belong to this hospital.");
      }
    }
    if (dto.doctorId) {
      const doctor = await this.prisma.doctor.findUnique({ where: { id: dto.doctorId } });
      if (!doctor || doctor.hospitalId !== hospitalId) {
        throw new BadRequestException("Doctor does not belong to this hospital.");
      }
    }
    if (dto.appointmentTypeId) {
      const type = await this.prisma.appointmentType.findUnique({ where: { id: dto.appointmentTypeId } });
      if (!type || type.hospitalId !== hospitalId) {
        throw new BadRequestException("Appointment type does not belong to this hospital.");
      }
    }
  }

  private assertCanManageHospital(requester: RequestUser, hospitalId: string) {
    if (requester.role === UserRole.PATIENT) {
      throw new ForbiddenException("Patients cannot manage questionnaire templates.");
    }
    assertHospitalScope(requester, hospitalId);
  }
}
