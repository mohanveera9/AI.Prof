import type { AuthUser } from "./session";

export function homePath(role: string | undefined): string {
  switch (role) {
    case "PLATFORM_ADMIN":
      return "/platform";
    case "HOSPITAL_ADMIN":
      return "/hospital";
    case "DOCTOR":
      return "/doctor";
    default:
      return "/app";
  }
}

export function roleLabel(role: string | undefined): string {
  switch (role) {
    case "PLATFORM_ADMIN":
      return "Platform admin";
    case "HOSPITAL_ADMIN":
      return "Hospital admin";
    case "DOCTOR":
      return "Doctor";
    case "PATIENT":
      return "Patient";
    default:
      return "User";
  }
}

export function formatSlot(start: string, end?: string) {
  const from = new Date(start);
  const to = end ? new Date(end) : null;
  const date = from.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const time = from.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (!to) return `${date} ${time}`;
  const endTime = to.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return `${date} ${time}–${endTime}`;
}

export function formatWhen(value: string) {
  const date = new Date(value);
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function hasHospital(user: AuthUser | null): user is AuthUser & { hospitalId: string } {
  return Boolean(user?.hospitalId);
}

export function hasDoctor(user: AuthUser | null): user is AuthUser & { doctorId: string } {
  return Boolean(user?.doctorId);
}

export function hasPatient(user: AuthUser | null): user is AuthUser & { patientId: string } {
  return Boolean(user?.patientId);
}
