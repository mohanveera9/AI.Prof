import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { saveSession, type AuthResult } from "../session";
import { homePath } from "../roles";

export default function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api<AuthResult>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      saveSession(result);
      navigate(homePath(result.user.role));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <form onSubmit={onSubmit} className="w-full max-w-sm bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Sign in</h1>
          <p className="text-sm text-slate-500 mt-1">Patients, doctors, and hospital teams</p>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <label className="block text-sm">
          <span className="text-slate-600">Email</span>
          <input
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label className="block text-sm">
          <span className="text-slate-600">Password</span>
          <input
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-md bg-teal-700 text-white py-2 text-sm font-medium hover:bg-teal-800 disabled:opacity-50"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <p className="text-sm text-slate-500">
          New patient?{" "}
          <Link className="text-teal-700 hover:underline" to="/register">
            Create an account
          </Link>
        </p>
        <p className="text-sm text-slate-500">
          Hospital?{" "}
          <Link className="text-teal-700 hover:underline" to="/register-hospital">
            Register your hospital
          </Link>
        </p>
      </form>
    </div>
  );
}
