import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import AppShell from "../components/AppShell";
import ChatPanel from "../components/ChatPanel";
import VoiceWidget from "../components/VoiceWidget";
import PhoneSimulator from "../components/PhoneSimulator";
import QuestionnairePanel from "../components/QuestionnairePanel";
import StatusBadge from "../components/StatusBadge";
import { api } from "../api";
import { formatSlot, hasPatient } from "../roles";
import type { AuthUser } from "../session";

interface PatientAppointment {
  id: string;
  status: string;
  slotStart: string;
  slotEnd: string;
  doctor: { name: string };
  hospital: { name: string };
}

interface NotificationRow {
  id: string;
  type: string;
  body: string;
  createdAt: string;
}

export default function PatientHome({ user }: { user: AuthUser }) {
  const queryClient = useQueryClient();
  const patientId = hasPatient(user) ? user.patientId : undefined;

  const appointments = useQuery({
    queryKey: ["patient-appointments", patientId],
    enabled: Boolean(patientId),
    queryFn: () => api<PatientAppointment[]>(`/api/patients/${patientId}/appointments`),
  });
  const notifications = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api<NotificationRow[]>("/api/notifications"),
  });
  const cancel = useMutation({
    mutationFn: (id: string) =>
      api(`/api/appointments/${id}/cancel`, { method: "POST", body: JSON.stringify({ reason: "Cancelled by patient" }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["patient-appointments", patientId] }),
  });

  return (
    <AppShell user={user}>
      <div className="grid gap-4 lg:grid-cols-2 lg:h-[520px]">
        <ChatPanel />
        <VoiceWidget />
      </div>
      <QuestionnairePanel user={user} />
      <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
        <h2 className="text-sm font-semibold text-slate-800">Your appointments</h2>
        {appointments.isLoading && <p className="text-sm text-slate-500">Loading…</p>}
        {appointments.data?.length === 0 && <p className="text-sm text-slate-500">No appointments yet. Book one by chat or voice.</p>}
        <ul className="divide-y divide-slate-100">
          {appointments.data?.map((row) => (
            <li key={row.id} className="py-3 flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-slate-800">
                  {row.doctor.name} · {row.hospital.name}
                </p>
                <p className="text-xs text-slate-500">{formatSlot(row.slotStart, row.slotEnd)}</p>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge value={row.status} />
                {row.status === "CONFIRMED" || row.status === "PENDING" ? (
                  <button
                    type="button"
                    className="text-xs text-red-700 hover:underline"
                    onClick={() => cancel.mutate(row.id)}
                  >
                    Cancel
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </section>
      <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
        <h2 className="text-sm font-semibold text-slate-800">Notifications</h2>
        {notifications.data?.length === 0 && <p className="text-sm text-slate-500">None yet.</p>}
        <ul className="space-y-2">
          {notifications.data?.slice(0, 8).map((note) => (
            <li key={note.id} className="text-sm text-slate-700">
              <StatusBadge value={note.type} />{" "}
              <span className="text-slate-600">{note.body}</span>
            </li>
          ))}
        </ul>
      </section>
      <PhoneSimulator />
    </AppShell>
  );
}
