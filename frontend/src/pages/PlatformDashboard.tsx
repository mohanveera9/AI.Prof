import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import AppShell from "../components/AppShell";
import StatusBadge from "../components/StatusBadge";
import MetricsGrid, { type ObservabilityMetrics } from "../components/MetricsGrid";
import { api } from "../api";
import type { AuthUser } from "../session";

interface HospitalRow {
  id: string;
  name: string;
  city?: string | null;
  status: string;
  submittedAt?: string | null;
}

interface ReconciliationRow {
  id: string;
  appointmentId: string;
  outcome: string;
  attempts: number;
  appointment?: { status: string };
}

interface OperationRow {
  id: string;
  type: string;
  status: string;
  failureType?: string | null;
  hospitalId: string;
  createdAt: string;
}

interface ChaosConfig {
  mode: string;
  remainingHits?: number;
  scope?: string;
}

interface FailureDemoStep {
  name: string;
  ok: boolean;
  detail: string;
}

interface FailureDemoResult {
  ok: boolean;
  scenario: string;
  duplicated: boolean;
  correlationId: string;
  steps: FailureDemoStep[];
  ehrCount: { before: number; afterTimeout: number; afterReconcile: number };
  appointment: {
    id: string;
    status: string;
    externalAppointmentId?: string | null;
    hospitalName: string;
    doctorName: string;
    patientName: string;
  };
  auditActions: string[];
}

const CHAOS_MODES = ["none", "timeout_no_create", "timeout_with_create", "error_500", "outage", "slot_conflict"];

export default function PlatformDashboard({ user }: { user: AuthUser }) {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("");
  const [reason, setReason] = useState("Does not meet onboarding requirements");
  const [error, setError] = useState<string | null>(null);
  const [demoRunning, setDemoRunning] = useState(false);
  const [demoResult, setDemoResult] = useState<FailureDemoResult | null>(null);

  const hospitals = useQuery({
    queryKey: ["platform-hospitals", statusFilter],
    queryFn: () => api<HospitalRow[]>(`/api/platform/hospitals${statusFilter ? `?status=${statusFilter}` : ""}`),
  });
  const reconciliation = useQuery({
    queryKey: ["platform-reconciliation"],
    queryFn: () => api<ReconciliationRow[]>("/api/platform/integration/reconciliation"),
  });
  const operations = useQuery({
    queryKey: ["platform-operations"],
    queryFn: () => api<OperationRow[]>("/api/platform/integration/operations"),
  });
  const chaos = useQuery({
    queryKey: ["platform-chaos"],
    queryFn: () => api<ChaosConfig>("/api/platform/integration/chaos"),
  });
  const metrics = useQuery({
    queryKey: ["platform-metrics"],
    queryFn: () => api<ObservabilityMetrics>("/api/platform/metrics"),
  });

  async function run(path: string, init: RequestInit = { method: "POST", body: JSON.stringify({}) }) {
    setError(null);
    try {
      await api(path, init);
      await queryClient.invalidateQueries();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    }
  }

  return (
    <AppShell user={user}>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {metrics.data && <MetricsGrid metrics={metrics.data} />}

      <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">Hospital applications</h2>
          <select className="rounded-md border border-slate-300 px-2 py-1 text-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            {["DRAFT", "SUBMITTED", "UNDER_REVIEW", "APPROVED", "REJECTED", "SUSPENDED"].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <label className="block text-xs text-slate-500">
          Decision reason
          <input className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm" value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <ul className="divide-y divide-slate-100">
          {hospitals.data?.map((h) => (
            <li key={h.id} className="py-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">{h.name}</p>
                  <p className="text-xs text-slate-500">{h.city}</p>
                </div>
                <StatusBadge value={h.status} />
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                {h.status === "SUBMITTED" && (
                  <button type="button" className="text-teal-700" onClick={() => run(`/api/platform/hospitals/${h.id}/review`)}>
                    Mark in review
                  </button>
                )}
                {(h.status === "SUBMITTED" || h.status === "UNDER_REVIEW") && (
                  <>
                    <button type="button" className="text-emerald-700" onClick={() => run(`/api/platform/hospitals/${h.id}/approve`)}>
                      Approve
                    </button>
                    <button
                      type="button"
                      className="text-red-700"
                      onClick={() => run(`/api/platform/hospitals/${h.id}/reject`, { method: "POST", body: JSON.stringify({ reason }) })}
                    >
                      Reject
                    </button>
                  </>
                )}
                {h.status === "APPROVED" && (
                  <button
                    type="button"
                    className="text-red-700"
                    onClick={() => run(`/api/platform/hospitals/${h.id}/suspend`, { method: "POST", body: JSON.stringify({ reason }) })}
                  >
                    Suspend
                  </button>
                )}
                {h.status === "SUSPENDED" && (
                  <button type="button" className="text-teal-700" onClick={() => run(`/api/platform/hospitals/${h.id}/reactivate`)}>
                    Reactivate
                  </button>
                )}
              </div>
            </li>
          ))}
          {hospitals.data?.length === 0 && <p className="text-sm text-slate-500">No hospitals in this filter.</p>}
        </ul>
      </section>

      <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
        <h2 className="text-sm font-semibold">Failure recovery demo</h2>
        <p className="text-xs text-slate-500">
          Injects write-then-timeout chaos, books a real slot, then reconciles to CONFIRMED without a duplicate EHR row.
          Takes about 10 seconds.
        </p>
        <button
          type="button"
          disabled={demoRunning}
          className="text-xs rounded-md px-3 py-1.5 bg-teal-700 text-white disabled:opacity-50"
          onClick={async () => {
            setError(null);
            setDemoRunning(true);
            try {
              const result = await api<FailureDemoResult>("/api/platform/demo/failure-recovery", {
                method: "POST",
                body: JSON.stringify({}),
              });
              setDemoResult(result);
              await queryClient.invalidateQueries();
            } catch (err) {
              setError(err instanceof Error ? err.message : "Failure demo failed");
            } finally {
              setDemoRunning(false);
            }
          }}
        >
          {demoRunning ? "Running demo…" : "Run failure demo"}
        </button>
        {demoResult && (
          <div className="space-y-2 text-sm">
            <p className={demoResult.ok && !demoResult.duplicated ? "text-emerald-700" : "text-red-700"}>
              {demoResult.ok && !demoResult.duplicated
                ? `Recovered ${demoResult.appointment.status} · EHR ${demoResult.ehrCount.before} → ${demoResult.ehrCount.afterReconcile} (no duplicate)`
                : "Demo did not recover cleanly"}
            </p>
            <p className="text-xs text-slate-500">
              {demoResult.appointment.hospitalName} · {demoResult.appointment.doctorName} · {demoResult.appointment.patientName}
            </p>
            <p className="text-xs font-mono text-slate-600 break-all">correlationId: {demoResult.correlationId}</p>
            <ul className="divide-y divide-slate-100">
              {demoResult.steps.map((step) => (
                <li key={step.name} className="py-1.5 flex items-start justify-between gap-2 text-xs">
                  <span>
                    <span className="font-medium">{step.name}</span>
                    <span className="text-slate-500"> — {step.detail}</span>
                  </span>
                  <StatusBadge value={step.ok ? "ok" : "failed"} />
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
        <h2 className="text-sm font-semibold">Mock EHR chaos</h2>
        <p className="text-xs text-slate-500">Current mode: {chaos.data?.mode ?? "unknown"}</p>
        <div className="flex flex-wrap gap-2">
          {CHAOS_MODES.map((mode) => (
            <button
              key={mode}
              type="button"
              className={`text-xs rounded-md px-2 py-1 border ${chaos.data?.mode === mode ? "bg-slate-800 text-white border-slate-800" : "border-slate-300"}`}
              onClick={() =>
                mode === "none"
                  ? run("/api/platform/integration/chaos", { method: "DELETE" })
                  : run("/api/platform/integration/chaos", {
                      method: "POST",
                      body: JSON.stringify({ mode, remainingHits: 1, scope: "appointment_create" }),
                    })
              }
            >
              {mode}
            </button>
          ))}
        </div>
      </section>

      <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
        <h2 className="text-sm font-semibold">Open reconciliation</h2>
        <ul className="divide-y divide-slate-100">
          {reconciliation.data?.map((row) => (
            <li key={row.id} className="py-2 flex items-center justify-between gap-2 text-sm">
              <span>
                {row.appointmentId.slice(0, 8)}… · {row.attempts} attempt(s)
              </span>
              <div className="flex items-center gap-2">
                <StatusBadge value={row.outcome} />
                <button type="button" className="text-xs text-teal-700" onClick={() => run(`/api/platform/integration/reconciliation/${row.appointmentId}/run`)}>
                  Run
                </button>
              </div>
            </li>
          ))}
          {reconciliation.data?.length === 0 && <p className="text-sm text-slate-500">Nothing in the queue.</p>}
        </ul>
      </section>

      <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
        <h2 className="text-sm font-semibold">Recent integration operations</h2>
        <ul className="divide-y divide-slate-100">
          {operations.data?.slice(0, 12).map((op) => (
            <li key={op.id} className="py-2 flex justify-between gap-2 text-sm">
              <span>
                {op.type} {op.failureType ? `· ${op.failureType}` : ""}
              </span>
              <StatusBadge value={op.status} />
            </li>
          ))}
        </ul>
      </section>
    </AppShell>
  );
}
