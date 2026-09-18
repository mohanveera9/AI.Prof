export default function StatusBadge({ value }: { value: string }) {
  const tone =
    value === "APPROVED" || value === "CONFIRMED" || value === "ACTIVE" || value === "COMPLETED" || value === "SENT" || value === "ok"
      ? "bg-emerald-50 text-emerald-800"
      : value === "REJECTED" || value === "CANCELLED" || value === "FAILED" || value === "SUSPENDED" || value === "NO_SHOW" || value === "failed"
        ? "bg-red-50 text-red-700"
        : value === "RECONCILIATION_REQUIRED" || value === "UNDER_REVIEW" || value === "PENDING"
          ? "bg-amber-50 text-amber-800"
          : "bg-slate-100 text-slate-700";
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>{value.replace(/_/g, " ")}</span>;
}
