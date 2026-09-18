import { FormEvent, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import AppShell from "../components/AppShell";
import MetricsGrid, { type ObservabilityMetrics } from "../components/MetricsGrid";
import StatusBadge from "../components/StatusBadge";
import { api } from "../api";
import { formatWhen, hasHospital } from "../roles";
import type { AuthUser } from "../session";

interface AuditRow {
  id: string;
  category: string;
  action: string;
  correlationId?: string | null;
  createdAt: string;
  hospital?: { name: string } | null;
  actorUser?: { email: string; role: string } | null;
}

interface OperationalRow {
  id: string;
  type: string;
  severity: string;
  correlationId?: string | null;
  createdAt: string;
  hospital?: { name: string } | null;
}

interface Escalations {
  reconciliation: Array<{
    id: string;
    outcome: string;
    attempts: number;
    appointment: { id: string; status: string; correlationId: string; patient: { name: string }; doctor: { name: string } };
  }>;
  operational: Array<{ id: string; type: string; severity: string; correlationId?: string | null; createdAt: string }>;
}

interface TimelineItem {
  at: string;
  kind: string;
  label: string;
  detail: string;
}

interface Trace {
  correlationId: string;
  timeline: TimelineItem[];
  appointments: Array<{ id: string; status: string; hospital: { name: string }; doctor: { name: string }; patient: { name: string } }>;
}

const AUDIT_CATEGORIES = [
  "",
  "LOGIN_ACCESS",
  "APPOINTMENT_OPERATION",
  "PATIENT_DATA_ACCESS",
  "AI_ACTION",
  "CAPABILITY_EXECUTION",
  "INTEGRATION_OPERATION",
  "CONFIGURATION_CHANGE",
  "ADMINISTRATIVE_ACTION",
];

export default function ObservabilityPage({ user }: { user: AuthUser }) {
  const hospitalId = hasHospital(user) ? user.hospitalId : undefined;
  const root = user.role === "PLATFORM_ADMIN" ? "/api/platform" : `/api/hospitals/${hospitalId}`;
  const [category, setCategory] = useState("");
  const [correlationInput, setCorrelationInput] = useState("");
  const [traceId, setTraceId] = useState("");

  const metrics = useQuery({
    queryKey: ["obs-metrics", root],
    enabled: user.role === "PLATFORM_ADMIN" || Boolean(hospitalId),
    queryFn: () => api<ObservabilityMetrics>(`${root}/metrics`),
  });
  const audit = useQuery({
    queryKey: ["obs-audit", root, category],
    enabled: user.role === "PLATFORM_ADMIN" || Boolean(hospitalId),
    queryFn: () => api<AuditRow[]>(`${root}/audit${category ? `?category=${category}` : ""}`),
  });
  const operational = useQuery({
    queryKey: ["obs-operational", root],
    enabled: user.role === "PLATFORM_ADMIN" || Boolean(hospitalId),
    queryFn: () => api<OperationalRow[]>(`${root}/operational-events`),
  });
  const escalations = useQuery({
    queryKey: ["obs-escalations", root],
    enabled: user.role === "PLATFORM_ADMIN" || Boolean(hospitalId),
    queryFn: () => api<Escalations>(`${root}/escalations`),
  });
  const trace = useQuery({
    queryKey: ["obs-trace", root, traceId],
    enabled: Boolean(traceId),
    queryFn: () => api<Trace>(`${root}/trace/${encodeURIComponent(traceId)}`),
    retry: false,
  });

  function onTrace(event: FormEvent) {
    event.preventDefault();
    setTraceId(correlationInput.trim());
  }

  return (
    <AppShell user={user}>
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Observability</h1>
        <p className="text-sm text-slate-500">Audit log, correlation traces, and escalation queue</p>
      </div>

      {metrics.data && <MetricsGrid metrics={metrics.data} />}
      {metrics.isError && <p className="text-sm text-red-600">Could not load metrics.</p>}

      <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
        <h2 className="text-sm font-semibold">Correlation trace</h2>
        <form onSubmit={onTrace} className="flex gap-2">
          <input
            className="flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm font-mono"
            placeholder="corr_…"
            value={correlationInput}
            onChange={(e) => setCorrelationInput(e.target.value)}
          />
          <button className="rounded-md bg-slate-800 text-white text-sm px-3 py-1.5">Trace</button>
        </form>
        {trace.isError && <p className="text-sm text-red-600">No events found for that correlation id.</p>}
        {trace.data && (
          <div className="space-y-2">
            {trace.data.appointments.map((appt) => (
              <p key={appt.id} className="text-sm text-slate-700">
                {appt.patient.name} with {appt.doctor.name} at {appt.hospital.name} <StatusBadge value={appt.status} />
              </p>
            ))}
            <ol className="space-y-2 border-l border-slate-200 pl-4">
              {trace.data.timeline.map((item, index) => (
                <li key={`${item.at}-${index}`} className="text-sm">
                  <span className="text-xs text-slate-400">{formatWhen(item.at)}</span>{" "}
                  <StatusBadge value={item.kind} /> {item.label}
                  <span className="text-slate-400"> · {item.detail}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </section>

      <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">Audit log</h2>
          <select className="rounded-md border border-slate-300 px-2 py-1 text-sm" value={category} onChange={(e) => setCategory(e.target.value)}>
            {AUDIT_CATEGORIES.map((value) => (
              <option key={value || "all"} value={value}>
                {value || "All categories"}
              </option>
            ))}
          </select>
        </div>
        <ul className="divide-y divide-slate-100">
          {audit.data?.map((row) => (
            <li key={row.id} className="py-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-slate-800">{row.action}</span>
                <StatusBadge value={row.category} />
              </div>
              <p className="text-xs text-slate-500">
                {formatWhen(row.createdAt)}
                {row.actorUser ? ` · ${row.actorUser.email}` : ""}
                {row.hospital ? ` · ${row.hospital.name}` : ""}
                {row.correlationId ? (
                  <>
                    {" · "}
                    <button
                      type="button"
                      className="font-mono hover:underline"
                      onClick={() => {
                        setCorrelationInput(row.correlationId!);
                        setTraceId(row.correlationId!);
                      }}
                    >
                      {row.correlationId}
                    </button>
                  </>
                ) : null}
              </p>
            </li>
          ))}
          {audit.data?.length === 0 && <p className="text-sm text-slate-500">No audit events yet.</p>}
        </ul>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
          <h2 className="text-sm font-semibold">Operational events</h2>
          <ul className="divide-y divide-slate-100">
            {operational.data?.map((row) => (
              <li key={row.id} className="py-2 text-sm flex items-center justify-between gap-2">
                <div>
                  <p>{row.type}</p>
                  <p className="text-xs text-slate-500">
                    {formatWhen(row.createdAt)}
                    {row.correlationId ? ` · ${row.correlationId}` : ""}
                  </p>
                </div>
                <StatusBadge value={row.severity} />
              </li>
            ))}
            {operational.data?.length === 0 && <p className="text-sm text-slate-500">Nothing recorded.</p>}
          </ul>
        </section>

        <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
          <h2 className="text-sm font-semibold">Reconciliation & escalations</h2>
          <ul className="divide-y divide-slate-100">
            {escalations.data?.reconciliation.map((row) => (
              <li key={row.id} className="py-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span>
                    {row.appointment.patient.name} / {row.appointment.doctor.name}
                  </span>
                  <StatusBadge value={row.outcome} />
                </div>
                <p className="text-xs text-slate-500">
                  {row.attempts} attempt(s) · {row.appointment.correlationId}
                </p>
              </li>
            ))}
            {escalations.data?.operational.map((row) => (
              <li key={row.id} className="py-2 text-sm flex justify-between gap-2">
                <span>{row.type}</span>
                <StatusBadge value={row.severity} />
              </li>
            ))}
            {escalations.data?.reconciliation.length === 0 && escalations.data?.operational.length === 0 && (
              <p className="text-sm text-slate-500">Queue is clear.</p>
            )}
          </ul>
        </section>
      </div>
    </AppShell>
  );
}
