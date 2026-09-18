import { Injectable } from "@nestjs/common";
import { AuditEventCategory, NotificationType } from "@ai-prof/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";

export interface SendNotificationInput {
  recipientUserId: string;
  type: NotificationType;
  appointmentId?: string;
  message?: string;
  channel?: string;
  hospitalId?: string;
  correlationId?: string;
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async send(input: SendNotificationInput) {
    const body = input.message ?? defaultBody(input.type);
    const notification = await this.prisma.notification.create({
      data: {
        recipientUserId: input.recipientUserId,
        appointmentId: input.appointmentId,
        type: input.type,
        channel: input.channel ?? "CONSOLE",
        body,
        status: "SENT",
      },
    });
    // eslint-disable-next-line no-console
    console.log(`[notification] -> user ${input.recipientUserId}: ${body}`);

    await this.audit.recordAudit({
      category: AuditEventCategory.ADMINISTRATIVE_ACTION,
      action: "notification.sent",
      actorUserId: input.recipientUserId,
      hospitalId: input.hospitalId,
      targetType: "Notification",
      targetId: notification.id,
      correlationId: input.correlationId,
      metadata: { type: input.type },
    });
    return { notificationId: notification.id, status: "SENT" as const };
  }

  async listForUser(userId: string) {
    return this.prisma.notification.findMany({
      where: { recipientUserId: userId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  }
}

function defaultBody(type: NotificationType): string {
  switch (type) {
    case NotificationType.APPOINTMENT_CONFIRMATION:
      return "Your appointment is confirmed.";
    case NotificationType.APPOINTMENT_REMINDER:
      return "Reminder: you have an upcoming appointment.";
    case NotificationType.APPOINTMENT_CANCELLATION:
      return "Your appointment has been cancelled.";
    case NotificationType.APPOINTMENT_RESCHEDULED:
      return "Your appointment has been rescheduled.";
    case NotificationType.QUESTIONNAIRE_REMINDER:
      return "Please complete your pre-visit questionnaire.";
    default:
      return `Notification: ${type.replace(/_/g, " ").toLowerCase()}`;
  }
}
