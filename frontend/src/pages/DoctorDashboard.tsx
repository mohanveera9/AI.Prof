import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import AppShell from "../components/AppShell";
import StatusBadge from "../components/StatusBadge";
import { api } from "../api";
import { formatSlot, hasDoctor } from "../roles";
import type { AuthUser } from "../session";

interface AppointmentRow {
  id: string;
  status: string;
  slotStart: string;
  slotEnd: string;
  patient: { name: string };
}

interface WorkingHour {
  id: string;
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function DoctorDashboard({ user }: { user: AuthUser }) {
  const doctorId = hasDoctor(user) ? user.doctorId : undefined;
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const appointments = useQuery({
    queryKey: ["doctor-appointments", doctorId],
    enabled: Boolean(doctorId),
    queryFn: () => api<AppointmentRow[]>(`/api/doctors/${doctorId}/appointments`),
  });
  const hours = useQuery({
    queryKey: ["doctor-hours", doctorId],
    enabled: Boolean(doctorId),
    queryFn: () => api<WorkingHour[]>(`/api/doctors/${doctorId}/working-hours`),
  });

  async function run(path: string, init: RequestInit) {
    setError(null);
    try {
      await api(path, init);
      await queryClient.invalidateQueries();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    }
  }

  if (!doctorId) {
    return (
      <AppShell user={user}>
        <p className="text-sm text-red-600">This account is not linked to a doctor profile.</p>
      </AppShell>
    );
  }

  return (
    <AppShell user={user}>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Schedule</h2>
          <button
            type="button"
            className="text-sm rounded-md bg-slate-800 text-white px-3 py-1.5"
            onClick={() =>
              run(`/api/doctors/${doctorId}/working-hours`, {
                method: "PUT",
                body: JSON.stringify({
                  hours: [1, 2, 3, 4, 5].map((dayOfWeek) => ({
                    dayOfWeek,
                    startMinute: 9 * 60,
                    endMinute: 17 * 60,
                  })),
                }),
              })
            }
          >
            Set Mon–Fri 9:00–17:00
          </button>
        </div>
        <ul className="text-sm text-slate-700">
          {hours.data?.map((h) => (
            <li key={h.id}>
              {DAYS[h.dayOfWeek]} {Math.floor(h.startMinute / 60)}:00–{Math.floor(h.endMinute / 60)}:00
            </li>
          ))}
          {hours.data?.length === 0 && <p className="text-slate-500">No clinic hours yet.</p>}
        </ul>
      </section>

      <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
        <h2 className="text-sm font-semibold">Appointments</h2>
        <ul className="divide-y divide-slate-100">
          {appointments.data?.map((row) => (
            <li key={row.id} className="py-3 flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium">{row.patient.name}</p>
                <p className="text-xs text-slate-500">{formatSlot(row.slotStart, row.slotEnd)}</p>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge value={row.status} />
                {row.status === "CONFIRMED" && (
                  <>
                    <button type="button" className="text-xs text-teal-700" onClick={() => run(`/api/appointments/${row.id}/complete`, { method: "POST", body: JSON.stringify({}) })}>
                      Complete
                    </button>
                    <button type="button" className="text-xs text-red-700" onClick={() => run(`/api/appointments/${row.id}/no-show`, { method: "POST", body: JSON.stringify({}) })}>
                      No-show
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}
          {appointments.data?.length === 0 && <p className="text-sm text-slate-500">No appointments on the books.</p>}
        </ul>
      </section>
    </AppShell>
  );
}
