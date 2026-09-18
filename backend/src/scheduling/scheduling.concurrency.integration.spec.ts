import { PrismaClient } from "@prisma/client";
import { nanoid } from "nanoid";
import { UserRole, HospitalStatus, DoctorStatus, AppointmentStatus } from "@ai-prof/shared";
import { SchedulingService } from "./scheduling.service";
import { SlotConflictException } from "./scheduling.exceptions";

/**
 * Integration test against a real Postgres database (PRD §7: "the system
 * must prevent concurrent double booking through appropriate transactions,
 * locking, reservation, or conflict-detection mechanisms" — and §25/§28
 * require demonstrating this, not just asserting it).
 *
 * Requires DATABASE_URL to point at a reachable Postgres (see backend/.env).
 */
describe("SchedulingService concurrent booking (integration)", () => {
  const prisma = new PrismaClient();
  const scheduling = new SchedulingService(prisma as any);
  const suffix = nanoid(8);

  let hospitalId: string;
  let doctorId: string;
  let patientId: string;
  const appointmentIds: string[] = [];

  beforeAll(async () => {
    const hospital = await prisma.hospital.create({
      data: {
        name: `Test Hospital ${suffix}`,
        slug: `test-hospital-${suffix}`,
        status: HospitalStatus.APPROVED,
      },
    });
    hospitalId = hospital.id;

    const doctorUser = await prisma.user.create({
      data: { email: `doctor-${suffix}@test.local`, passwordHash: "x", role: UserRole.DOCTOR },
    });
    const doctor = await prisma.doctor.create({
      data: { userId: doctorUser.id, hospitalId, name: "Dr. Concurrency", status: DoctorStatus.ACTIVE },
    });
    doctorId = doctor.id;
    await scheduling.createCalendarForDoctor(doctorId, hospitalId);

    const patientUser = await prisma.user.create({
      data: { email: `patient-${suffix}@test.local`, passwordHash: "x", role: UserRole.PATIENT },
    });
    const patient = await prisma.patient.create({ data: { userId: patientUser.id, name: "Test Patient" } });
    patientId = patient.id;
  });

  afterAll(async () => {
    await prisma.slotReservation.deleteMany({ where: { doctorId } });
    await prisma.appointment.deleteMany({ where: { doctorId } });
    await prisma.calendar.deleteMany({ where: { doctorId } });
    await prisma.doctor.delete({ where: { id: doctorId } }).catch(() => undefined);
    await prisma.patient.delete({ where: { id: patientId } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { email: { endsWith: `${suffix}@test.local` } } });
    await prisma.hospital.delete({ where: { id: hospitalId } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it("only lets one of two concurrent bookings for the same doctor+slot succeed", async () => {
    const slotStart = new Date(Date.UTC(2030, 0, 7, 9, 0));
    const slotEnd = new Date(Date.UTC(2030, 0, 7, 9, 30));

    const calendar = await prisma.calendar.findFirstOrThrow({ where: { doctorId } });

    const [appointmentA, appointmentB] = await Promise.all(
      [0, 1].map((i) =>
        prisma.appointment.create({
          data: {
            hospitalId,
            doctorId,
            calendarId: calendar.id,
            patientId,
            slotStart,
            slotEnd,
            status: AppointmentStatus.PENDING,
            idempotencyKey: `concurrency-test-${suffix}-${i}`,
            correlationId: `corr-${suffix}-${i}`,
          },
        }),
      ),
    );
    appointmentIds.push(appointmentA.id, appointmentB.id);

    const attempt = (appointmentId: string) =>
      prisma.$transaction((tx) => scheduling.reserveSlot(tx, doctorId, slotStart, appointmentId));

    const results = await Promise.allSettled([attempt(appointmentA.id), attempt(appointmentB.id)]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(SlotConflictException);

    const reservations = await prisma.slotReservation.findMany({ where: { doctorId, slotStart } });
    expect(reservations).toHaveLength(1);
  });
});
