import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { saveSession, type AuthResult } from "../session";
import { homePath } from "../roles";

export default function RegisterPage() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api<AuthResult>("/api/auth/register/patient", {
        method: "POST",
        body: JSON.stringify({ name, email, password }),
      });
      saveSession(result);
      navigate(homePath(result.user.role));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <form onSubmit={onSubmit} className="w-full max-w-sm bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Create patient account</h1>
          <p className="text-sm text-slate-500 mt-1">Book appointments by chat or voice</p>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <label className="block text-sm">
          <span className="text-slate-600">Full name</span>
          <input className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label className="block text-sm">
          <span className="text-slate-600">Email</span>
          <input className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="block text-sm">
          <span className="text-slate-600">Password</span>
          <input className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
        </label>
        <button type="submit" disabled={busy} className="w-full rounded-md bg-teal-700 text-white py-2 text-sm font-medium hover:bg-teal-800 disabled:opacity-50">
          {busy ? "Creating…" : "Create account"}
        </button>
        <p className="text-sm text-slate-500">
          Already have an account?{" "}
          <Link className="text-teal-700 hover:underline" to="/login">
            Sign in
          </Link>
        </p>
      </form>
    </div>
  );
}
