import { FormEvent, useState } from "react";
import { api, ApiError } from "../api";

interface SimulateResult {
  conversationId: string;
  channel: string;
  turns: Array<{ reply: string; toolTrace: Array<{ name: string; success: boolean }> }>;
}

export default function PhoneSimulator() {
  const [script, setScript] = useState("Hi, I'd like an appointment with a cardiologist next week.");
  const [result, setResult] = useState<SimulateResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(event: FormEvent) {
    event.preventDefault();
    const turns = script
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (!turns.length) return;
    setBusy(true);
    setError(null);
    try {
      const data = await api<SimulateResult>("/api/ai/telephone/simulate", {
        method: "POST",
        body: JSON.stringify({ turns }),
      });
      setResult(data);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 503
          ? "Telephone stub needs a real OPENAI_API_KEY on the backend."
          : err instanceof Error
            ? err.message
            : "Call simulation failed",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-slate-800">Telephone stub</h2>
        <p className="text-xs text-slate-500">Simulates a phone call with the same agent core. No live Twilio number.</p>
      </div>
      <form onSubmit={run} className="space-y-2">
        <textarea
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm min-h-[88px]"
          value={script}
          onChange={(e) => setScript(e.target.value)}
          placeholder="One spoken turn per line"
        />
        <button type="submit" disabled={busy} className="rounded-md bg-slate-800 text-white px-3 py-1.5 text-sm disabled:opacity-50">
          {busy ? "Calling…" : "Simulate call"}
        </button>
      </form>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {result && (
        <ol className="space-y-2 text-sm">
          {result.turns.map((turn, i) => (
            <li key={i} className="rounded-md bg-slate-50 p-2">
              <p className="text-slate-800">{turn.reply}</p>
              {turn.toolTrace.length > 0 && (
                <p className="text-xs text-slate-400 mt-1">{turn.toolTrace.map((t) => t.name).join(" → ")}</p>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
