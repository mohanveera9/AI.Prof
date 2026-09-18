import { FormEvent, useEffect, useState } from "react";
import { api } from "../api";
import { type AuthUser } from "../session";

interface Question {
  id: string;
  prompt: string;
  type: string;
  options?: string[];
  required?: boolean;
}

interface PendingQuestionnaire {
  responseId: string;
  status: string;
  appointmentId: string;
  questionnaire: { id: string; title: string; questions: Question[] };
  answers: Array<{ questionId: string; value: unknown }>;
}

export default function QuestionnairePanel({ user }: { user: AuthUser }) {
  const [pending, setPending] = useState<PendingQuestionnaire | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user.patientId) return;
    api<{ pending: PendingQuestionnaire | null }>(`/api/patients/${user.patientId}/questionnaires/pending`)
      .then((data) => {
        setPending(data.pending);
        const initial: Record<string, string> = {};
        for (const answer of data.pending?.answers ?? []) {
          initial[answer.questionId] = Array.isArray(answer.value) ? answer.value.join(",") : String(answer.value ?? "");
        }
        setValues(initial);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load questionnaire"));
  }, [user.patientId]);

  if (done) {
    return (
      <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
        <h2 className="text-sm font-semibold text-slate-800">Pre-visit questionnaire</h2>
        <p className="text-xs text-slate-500 mt-1">Answers recorded. Thank you.</p>
      </section>
    );
  }
  if (!pending && !error) return null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      const answers = pending.questionnaire.questions.map((q) => ({
        questionId: q.id,
        value: coerce(q.type, values[q.id] ?? ""),
      }));
      await api(`/api/questionnaire-responses/${pending.responseId}/submit`, {
        method: "POST",
        body: JSON.stringify({ answers }),
      });
      setDone(true);
      setPending(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submit failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-slate-800">Pre-visit questionnaire</h2>
        <p className="text-xs text-slate-500">
          {done ? "Answers recorded." : pending ? pending.questionnaire.title : "Structured collection for your upcoming visit."}
        </p>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {pending && (
        <form onSubmit={submit} className="space-y-3">
          {pending.questionnaire.questions.map((q) => (
            <label key={q.id} className="block text-sm">
              <span className="text-slate-700">
                {q.prompt}
                {q.required ? " *" : ""}
              </span>
              {q.type === "YES_NO" ? (
                <select
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
                  value={values[q.id] ?? ""}
                  onChange={(e) => setValues((prev) => ({ ...prev, [q.id]: e.target.value }))}
                  required={q.required}
                >
                  <option value="">Select</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              ) : q.type === "CHOICE" ? (
                <select
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
                  value={values[q.id] ?? ""}
                  onChange={(e) => setValues((prev) => ({ ...prev, [q.id]: e.target.value }))}
                  required={q.required}
                >
                  <option value="">Select</option>
                  {(q.options ?? []).map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
                  value={values[q.id] ?? ""}
                  onChange={(e) => setValues((prev) => ({ ...prev, [q.id]: e.target.value }))}
                  required={q.required}
                />
              )}
            </label>
          ))}
          <button type="submit" disabled={busy} className="rounded-md bg-teal-700 text-white px-3 py-1.5 text-sm disabled:opacity-50">
            {busy ? "Saving…" : "Submit answers"}
          </button>
        </form>
      )}
    </section>
  );
}

function coerce(type: string, raw: string): string | number | boolean | string[] {
  if (type === "YES_NO") return raw;
  if (type === "NUMERIC") return Number(raw);
  if (type === "MULTIPLE_CHOICE") return raw.split(",").map((s) => s.trim()).filter(Boolean);
  return raw;
}
