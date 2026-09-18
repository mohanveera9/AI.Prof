import type { Appointment } from "@prisma/client";

/** Shape consumed by the AI capability layer (matches shared AppointmentSummarySchema). */
export function toAppointmentSummary(appointment: Appointment) {
  return {
    id: appointment.id,
    status: appointment.status,
    doctorId: appointment.doctorId,
    hospitalId: appointment.hospitalId,
    patientId: appointment.patientId,
    slotStart: appointment.slotStart.toISOString(),
    slotEnd: appointment.slotEnd.toISOString(),
    externalAppointmentId: appointment.externalAppointmentId,
  };
}
