import { UserRole } from "@ai-prof/shared";

/** Shape carried in the signed JWT and attached to `req.user`. */
export interface RequestUser {
  userId: string;
  role: UserRole;
  hospitalId?: string; // HOSPITAL_ADMIN, DOCTOR
  doctorId?: string; // DOCTOR
  patientId?: string; // PATIENT
}

declare module "express" {
  interface Request {
    user?: RequestUser;
  }
}
