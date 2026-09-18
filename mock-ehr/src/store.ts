import { nanoid } from "nanoid";
import type {
  ExternalAppointment,
  ExternalFacility,
  ExternalPatient,
  ExternalProvider,
} from "./types";

function id(prefix: string): string {
  return `${prefix}_${nanoid(10)}`;
}

/** In-memory external healthcare system. Isolated from the platform database. */
export class MemoryStore {
  patients = new Map<string, ExternalPatient>();
  providers = new Map<string, ExternalProvider>();
  facilities = new Map<string, ExternalFacility>();
  appointments = new Map<string, ExternalAppointment>();
  appointmentsByIdempotency = new Map<string, string>();

  reset(): void {
    this.patients.clear();
    this.providers.clear();
    this.facilities.clear();
    this.appointments.clear();
    this.appointmentsByIdempotency.clear();
  }

  seed(): void {
    const facility: ExternalFacility = { id: "fac_riverside", name: "Riverside General" };
    this.facilities.set(facility.id, facility);

    const chen: ExternalProvider = { id: "prv_chen", name: "Dr. Chen", specialty: "Cardiology" };
    const patel: ExternalProvider = { id: "prv_patel", name: "Dr. Patel", specialty: "General Practice" };
    this.providers.set(chen.id, chen);
    this.providers.set(patel.id, patel);

    const jane: ExternalPatient = {
      id: "pat_jane",
      name: "Jane Doe",
      dob: "1990-04-12",
      phone: "+15550001111",
    };
    this.patients.set(jane.id, jane);
  }

  createPatient(input: { name: string; dob?: string; phone?: string }): ExternalPatient {
    const patient: ExternalPatient = { id: id("pat"), name: input.name, dob: input.dob, phone: input.phone };
    this.patients.set(patient.id, patient);
    return patient;
  }

  createProvider(input: { name: string; specialty?: string }): ExternalProvider {
    const provider: ExternalProvider = { id: id("prv"), name: input.name, specialty: input.specialty };
    this.providers.set(provider.id, provider);
    return provider;
  }

  createFacility(input: { name: string }): ExternalFacility {
    const facility: ExternalFacility = { id: id("fac"), name: input.name };
    this.facilities.set(facility.id, facility);
    return facility;
  }

  findPatient(query: { name?: string; dob?: string; phone?: string }): ExternalPatient[] {
    return [...this.patients.values()].filter((p) => {
      if (query.name && !p.name.toLowerCase().includes(query.name.toLowerCase())) return false;
      if (query.dob && p.dob !== query.dob) return false;
      if (query.phone && p.phone !== query.phone) return false;
      return true;
    });
  }

  findProvider(query: { name?: string; specialty?: string }): ExternalProvider[] {
    return [...this.providers.values()].filter((p) => {
      if (query.name && !p.name.toLowerCase().includes(query.name.toLowerCase())) return false;
      if (query.specialty && p.specialty?.toLowerCase() !== query.specialty.toLowerCase()) return false;
      return true;
    });
  }

  getAppointmentByIdempotency(key: string): ExternalAppointment | undefined {
    const idValue = this.appointmentsByIdempotency.get(key);
    return idValue ? this.appointments.get(idValue) : undefined;
  }

  /**
   * Creates an appointment, or returns the existing one for the same
   * idempotency key. Never creates a duplicate for a replayed key.
   */
  createAppointment(input: {
    externalPatientId: string;
    externalProviderId: string;
    externalFacilityId?: string;
    start: string;
    end: string;
    idempotencyKey: string;
  }): { appointment: ExternalAppointment; created: boolean } {
    const existing = this.getAppointmentByIdempotency(input.idempotencyKey);
    if (existing) return { appointment: existing, created: false };

    const conflict = [...this.appointments.values()].find(
      (a) =>
        a.externalProviderId === input.externalProviderId &&
        a.status !== "cancelled" &&
        a.start === input.start,
    );
    if (conflict) {
      const err = new Error("Slot already booked for this provider");
      (err as Error & { code: string }).code = "SLOT_CONFLICT";
      throw err;
    }

    const now = new Date().toISOString();
    const appointment: ExternalAppointment = {
      id: id("apt"),
      externalPatientId: input.externalPatientId,
      externalProviderId: input.externalProviderId,
      externalFacilityId: input.externalFacilityId,
      start: input.start,
      end: input.end,
      status: "booked",
      idempotencyKey: input.idempotencyKey,
      createdAt: now,
      updatedAt: now,
    };
    this.appointments.set(appointment.id, appointment);
    this.appointmentsByIdempotency.set(input.idempotencyKey, appointment.id);
    return { appointment, created: true };
  }

  updateAppointment(
    appointmentId: string,
    patch: { start?: string; end?: string; status?: ExternalAppointment["status"] },
  ): ExternalAppointment | undefined {
    const existing = this.appointments.get(appointmentId);
    if (!existing) return undefined;
    const updated: ExternalAppointment = {
      ...existing,
      start: patch.start ?? existing.start,
      end: patch.end ?? existing.end,
      status: patch.status ?? (patch.start ? "updated" : existing.status),
      updatedAt: new Date().toISOString(),
    };
    this.appointments.set(appointmentId, updated);
    return updated;
  }

  cancelAppointment(appointmentId: string): ExternalAppointment | undefined {
    return this.updateAppointment(appointmentId, { status: "cancelled" });
  }

  stats() {
    return {
      patients: this.patients.size,
      providers: this.providers.size,
      facilities: this.facilities.size,
      appointments: this.appointments.size,
    };
  }
}
