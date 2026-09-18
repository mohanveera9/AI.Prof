import { ForbiddenException } from "@nestjs/common";
import { UserRole } from "@ai-prof/shared";
import { assertHospitalScope, assertSelfDoctor, assertSelfPatient } from "./tenant";
import { RequestUser } from "./types";

describe("tenant scope helpers", () => {
  const platform: RequestUser = { userId: "plat", role: UserRole.PLATFORM_ADMIN };
  const adminA: RequestUser = { userId: "admin-a", role: UserRole.HOSPITAL_ADMIN, hospitalId: "hosp-a" };
  const adminB: RequestUser = { userId: "admin-b", role: UserRole.HOSPITAL_ADMIN, hospitalId: "hosp-b" };
  const doctorA: RequestUser = { userId: "doc-a", role: UserRole.DOCTOR, hospitalId: "hosp-a", doctorId: "doc-a" };
  const patientA: RequestUser = { userId: "pat-a", role: UserRole.PATIENT, patientId: "pat-a" };
  const patientB: RequestUser = { userId: "pat-b", role: UserRole.PATIENT, patientId: "pat-b" };

  it("lets platform admins cross hospitals and lets matching hospital staff through", () => {
    expect(() => assertHospitalScope(platform, "hosp-b")).not.toThrow();
    expect(() => assertHospitalScope(adminA, "hosp-a")).not.toThrow();
    expect(() => assertHospitalScope(doctorA, "hosp-a")).not.toThrow();
  });

  it("blocks hospital A from hospital B", () => {
    expect(() => assertHospitalScope(adminA, "hosp-b")).toThrow(ForbiddenException);
    expect(() => assertHospitalScope(doctorA, "hosp-b")).toThrow(ForbiddenException);
    expect(() => assertHospitalScope(adminB, "hosp-a")).toThrow(/this hospital's data/i);
  });

  it("blocks patients from acting as another patient", () => {
    expect(() => assertSelfPatient(patientA, "pat-a")).not.toThrow();
    expect(() => assertSelfPatient(platform, "pat-b")).not.toThrow();
    expect(() => assertSelfPatient(patientA, "pat-b")).toThrow(ForbiddenException);
    expect(() => assertSelfPatient(patientB, "pat-a")).toThrow(/this patient's data/i);
  });

  it("blocks doctors from acting on another doctor's record", () => {
    expect(() => assertSelfDoctor(doctorA, "doc-a")).not.toThrow();
    expect(() => assertSelfDoctor(adminA, "doc-a")).not.toThrow();
    expect(() => assertSelfDoctor(platform, "doc-b")).not.toThrow();
    expect(() => assertSelfDoctor(doctorA, "doc-b")).toThrow(ForbiddenException);
  });
});
