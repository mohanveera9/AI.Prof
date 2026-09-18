import { FormEvent, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import AppShell from "../components/AppShell";
import StatusBadge from "../components/StatusBadge";
import MetricsGrid, { type ObservabilityMetrics } from "../components/MetricsGrid";
import { api } from "../api";
import { formatSlot, hasHospital } from "../roles";
import type { AuthUser } from "../session";

interface Hospital {
  id: string;
  name: string;
  city?: string | null;
  status: string;
  departments: Array<{ id: string; name: string }>;
  specialties: Array<{ id: string; name: string }>;
}

interface DoctorRow {
  id: string;
  name: string;
  status: string;
  invitedEmail?: string | null;
}

interface AppointmentRow {
  id: string;
  status: string;
  slotStart: string;
  slotEnd: string;
  doctor: { name: string };
  patient: { name: string };
}

interface QuestionnaireRow {
  id: string;
  title: string;
  isActive: boolean;
  questions: unknown[];
}

interface WorkflowRow {
  id: string;
  key: string;
  name: string;
  trigger: string;
  isActive: boolean;
}

interface ExecutionRow {
  id: string;
  status: string;
  workflow: { name: string; key: string };
}

export default function HospitalDashboard({ user }: { user: AuthUser }) {
  const hospitalId = hasHospital(user) ? user.hospitalId : undefined;
  const queryClient = useQueryClient();
  const [dept, setDept] = useState("");
  const [specialty, setSpecialty] = useState("");
  const [doctorName, setDoctorName] = useState("");
  const [doctorEmail, setDoctorEmail] = useState("");
  const [doctorPassword, setDoctorPassword] = useState("");
  const [qTitle, setQTitle] = useState("Pre-visit intake");
  const [qPrompt, setQPrompt] = useState("Do you have any allergies?");
  const [error, setError] = useState<string | null>(null);

  const hospital = useQuery({
    queryKey: ["hospital", hospitalId],
    enabled: Boolean(hospitalId),
    queryFn: () => api<Hospital>(`/api/hospitals/${hospitalId}`),
  });
  const doctors = useQuery({
    queryKey: ["hospital-doctors", hospitalId],
    enabled: Boolean(hospitalId),
    queryFn: () => api<DoctorRow[]>(`/api/hospitals/${hospitalId}/doctors`),
  });
  const appointments = useQuery({
    queryKey: ["hospital-appointments", hospitalId],
    enabled: Boolean(hospitalId),
    queryFn: () => api<AppointmentRow[]>(`/api/hospitals/${hospitalId}/appointments`),
  });
  const questionnaires = useQuery({
    queryKey: ["hospital-questionnaires", hospitalId],
    enabled: Boolean(hospitalId),
    queryFn: () => api<QuestionnaireRow[]>(`/api/hospitals/${hospitalId}/questionnaires`),
  });
  const workflows = useQuery({
    queryKey: ["hospital-workflows", hospitalId],
    enabled: Boolean(hospitalId),
    queryFn: () => api<WorkflowRow[]>(`/api/hospitals/${hospitalId}/workflows`),
  });
  const executions = useQuery({
    queryKey: ["hospital-executions", hospitalId],
    enabled: Boolean(hospitalId),
    queryFn: () => api<ExecutionRow[]>(`/api/hospitals/${hospitalId}/workflow-executions`),
  });
  const metrics = useQuery({
    queryKey: ["hospital-metrics", hospitalId],
    enabled: Boolean(hospitalId),
    queryFn: () => api<ObservabilityMetrics>(`/api/hospitals/${hospitalId}/metrics`),
  });

  function invalidate() {
    void queryClient.invalidateQueries();
  }

  async function run(path: string, init: RequestInit) {
    setError(null);
    try {
      await api(path, init);
      invalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    }
  }

  if (!hospitalId) {
    return (
      <AppShell user={user}>
        <p className="text-sm text-red-600">This account is not linked to a hospital.</p>
      </AppShell>
    );
  }

  async function addNamed(kind: "departments" | "specialties", name: string, clear: () => void, event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    await run(`/api/hospitals/${hospitalId}/${kind}`, { method: "POST", body: JSON.stringify({ name: name.trim() }) });
    clear();
  }

  async function inviteDoctor(event: FormEvent) {
    event.preventDefault();
    await run(`/api/hospitals/${hospitalId}/doctors`, {
      method: "POST",
      body: JSON.stringify({ name: doctorName, email: doctorEmail, password: doctorPassword }),
    });
    setDoctorName("");
    setDoctorEmail("");
    setDoctorPassword("");
  }

  async function createQuestionnaire(event: FormEvent) {
    event.preventDefault();
    await run(`/api/hospitals/${hospitalId}/questionnaires`, {
      method: "POST",
      body: JSON.stringify({
        title: qTitle,
        questions: [{ prompt: qPrompt, type: "YES_NO", required: true }],
      }),
    });
  }

  return (
    <AppShell user={user}>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {metrics.data && <MetricsGrid metrics={metrics.data} />}
      <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">{hospital.data?.name ?? "Hospital"}</h1>
          <p className="text-sm text-slate-500">{hospital.data?.city}</p>
        </div>
        <div className="flex items-center gap-2">
          {hospital.data && <StatusBadge value={hospital.data.status} />}
          {hospital.data?.status === "DRAFT" && (
            <button
              type="button"
              className="rounded-md bg-teal-700 text-white px-3 py-1.5 text-sm"
              onClick={() => run(`/api/hospitals/${hospitalId}/submit`, { method: "POST", body: JSON.stringify({}) })}
            >
              Submit for review
            </button>
          )}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
          <h2 className="text-sm font-semibold">Departments</h2>
          <ul className="text-sm text-slate-700 list-disc pl-5">
            {hospital.data?.departments.map((d) => (
              <li key={d.id}>{d.name}</li>
            ))}
          </ul>
          <form className="flex gap-2" onSubmit={(e) => addNamed("departments", dept, () => setDept(""), e)}>
            <input className="flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm" value={dept} onChange={(e) => setDept(e.target.value)} placeholder="Add department" />
            <button className="text-sm text-teal-700">Add</button>
          </form>
        </section>
        <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
          <h2 className="text-sm font-semibold">Specialties</h2>
          <ul className="text-sm text-slate-700 list-disc pl-5">
            {hospital.data?.specialties.map((s) => (
              <li key={s.id}>{s.name}</li>
            ))}
          </ul>
          <form className="flex gap-2" onSubmit={(e) => addNamed("specialties", specialty, () => setSpecialty(""), e)}>
            <input className="flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm" value={specialty} onChange={(e) => setSpecialty(e.target.value)} placeholder="Add specialty" />
            <button className="text-sm text-teal-700">Add</button>
          </form>
        </section>
      </div>

      <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
        <h2 className="text-sm font-semibold">Doctors</h2>
        <ul className="divide-y divide-slate-100">
          {doctors.data?.map((doc) => (
            <li key={doc.id} className="py-2 flex items-center justify-between gap-2">
              <span className="text-sm">
                {doc.name} {doc.invitedEmail ? <span className="text-slate-400">({doc.invitedEmail})</span> : null}
              </span>
              <div className="flex items-center gap-2">
                <StatusBadge value={doc.status} />
                {doc.status === "INVITED" && (
                  <button type="button" className="text-xs text-teal-700" onClick={() => run(`/api/doctors/${doc.id}/activate`, { method: "POST", body: JSON.stringify({}) })}>
                    Activate
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
        <form onSubmit={inviteDoctor} className="grid gap-2 sm:grid-cols-4">
          <input className="rounded-md border border-slate-300 px-3 py-1.5 text-sm" placeholder="Name" value={doctorName} onChange={(e) => setDoctorName(e.target.value)} required />
          <input className="rounded-md border border-slate-300 px-3 py-1.5 text-sm" type="email" placeholder="Email" value={doctorEmail} onChange={(e) => setDoctorEmail(e.target.value)} required />
          <input className="rounded-md border border-slate-300 px-3 py-1.5 text-sm" type="password" placeholder="Temp password" value={doctorPassword} onChange={(e) => setDoctorPassword(e.target.value)} required minLength={8} />
          <button className="rounded-md bg-slate-800 text-white text-sm py-1.5">Invite doctor</button>
        </form>
      </section>

      <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
        <h2 className="text-sm font-semibold">Appointments</h2>
        <ul className="divide-y divide-slate-100">
          {appointments.data?.map((row) => (
            <li key={row.id} className="py-2 flex justify-between gap-3 text-sm">
              <span>
                {row.patient.name} with {row.doctor.name} · {formatSlot(row.slotStart, row.slotEnd)}
              </span>
              <StatusBadge value={row.status} />
            </li>
          ))}
          {appointments.data?.length === 0 && <p className="text-sm text-slate-500">No appointments yet.</p>}
        </ul>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
          <h2 className="text-sm font-semibold">Questionnaires</h2>
          <ul className="text-sm text-slate-700 space-y-1">
            {questionnaires.data?.map((q) => (
              <li key={q.id}>
                {q.title} <span className="text-slate-400">({Array.isArray(q.questions) ? q.questions.length : 0} questions)</span>
              </li>
            ))}
          </ul>
          <form onSubmit={createQuestionnaire} className="space-y-2">
            <input className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm" value={qTitle} onChange={(e) => setQTitle(e.target.value)} />
            <input className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm" value={qPrompt} onChange={(e) => setQPrompt(e.target.value)} />
            <button className="text-sm rounded-md bg-teal-700 text-white px-3 py-1.5">Create template</button>
          </form>
        </section>
        <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
          <h2 className="text-sm font-semibold">Workflows</h2>
          <ul className="text-sm space-y-1">
            {workflows.data?.map((wf) => (
              <li key={wf.id}>
                {wf.name} <span className="text-slate-400">({wf.trigger})</span>
              </li>
            ))}
          </ul>
          <h3 className="text-xs font-semibold text-slate-500 pt-2">Recent runs</h3>
          <ul className="text-sm space-y-1">
            {executions.data?.slice(0, 8).map((ex) => (
              <li key={ex.id} className="flex justify-between gap-2">
                <span>{ex.workflow.name}</span>
                <StatusBadge value={ex.status} />
              </li>
            ))}
          </ul>
        </section>
      </div>
    </AppShell>
  );
}
