export interface ObservabilityMetrics {
  scope: string;
  appointments: {
    total: number;
    confirmed: number;
    cancelled: number;
    completed: number;
    noShow: number;
    failed: number;
    reconciliationRequired: number;
    pending: number;
    bookedLast7Days: number;
  };
  integration: {
    verified: number;
    success: number;
    failed: number;
    pending: number;
    unknown: number;
  };
  openReconciliation: number;
  escalations: number;
  ai: {
    conversations: number;
    capabilityCalls: number;
    capabilityFailed: number;
    avgLatencyMs: number;
  };
  operationalLast24h: {
    info: number;
    warning: number;
    critical: number;
  };
  hospitals?: Record<string, number>;
}

export default function MetricsGrid({ metrics }: { metrics: ObservabilityMetrics }) {
  const cards = [
    { label: "Appointments", value: metrics.appointments.total, hint: `${metrics.appointments.bookedLast7Days} in last 7 days` },
    { label: "Confirmed", value: metrics.appointments.confirmed, hint: `${metrics.appointments.pending} pending` },
    { label: "Open reconciliation", value: metrics.openReconciliation, hint: `${metrics.appointments.reconciliationRequired} flagged` },
    { label: "Escalations", value: metrics.escalations, hint: `${metrics.operationalLast24h.critical} critical / 24h` },
    { label: "EHR verified", value: metrics.integration.verified, hint: `${metrics.integration.failed} failed` },
    { label: "AI capability calls", value: metrics.ai.capabilityCalls, hint: `${metrics.ai.avgLatencyMs} ms avg` },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((card) => (
        <section key={card.label} className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">{card.label}</p>
          <p className="text-2xl font-semibold text-slate-900 mt-1">{card.value}</p>
          <p className="text-xs text-slate-500 mt-1">{card.hint}</p>
        </section>
      ))}
    </div>
  );
}
