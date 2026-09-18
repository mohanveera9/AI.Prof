import { z } from "zod";
import { NotificationType } from "@ai-prof/shared";

const notificationTypeValues = Object.values(NotificationType) as [NotificationType, ...NotificationType[]];

export const WorkflowStepSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("assign_questionnaire"),
    delayMs: z.number().int().nonnegative().optional(),
  }),
  z.object({
    type: z.literal("send_notification"),
    notificationType: z.enum(notificationTypeValues),
    message: z.string().max(1000).optional(),
    delayMs: z.number().int().nonnegative().optional(),
  }),
  z.object({
    type: z.literal("wait"),
    delayMs: z.number().int().nonnegative(),
  }),
]);

export type WorkflowStep = z.infer<typeof WorkflowStepSchema>;

export const WorkflowStepsSchema = z.array(WorkflowStepSchema).min(1);

export const WORKFLOW_KEYS = {
  POST_BOOKING: "post_booking",
  POST_RESCHEDULE: "post_reschedule",
  POST_CANCEL: "post_cancel",
} as const;

export const WORKFLOW_TRIGGERS = {
  APPOINTMENT_CONFIRMED: "APPOINTMENT_CONFIRMED",
  APPOINTMENT_RESCHEDULED: "APPOINTMENT_RESCHEDULED",
  APPOINTMENT_CANCELLED: "APPOINTMENT_CANCELLED",
} as const;
