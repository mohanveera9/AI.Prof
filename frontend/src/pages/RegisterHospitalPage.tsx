import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { saveSession, type AuthResult } from "../session";
import { homePath } from "../roles";

export default function RegisterHospitalPage() {
  const navigate = useNavigate();
  const [hospitalName, setHospitalName] = useState("");
  const [city, setCity] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ auth: AuthResult }>("/api/hospitals/register", {
        method: "POST",
        body: JSON.stringify({
          hospitalName,
          city,
          contactEmail,
          adminName,
          adminEmail,
          adminPassword,
        }),
      });
      saveSession(result.auth);
      navigate(homePath(result.auth.user.role));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <form onSubmit={onSubmit} className="w-full max-w-md bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Register a hospital</h1>
          <p className="text-sm text-slate-500 mt-1">Creates a draft application and a hospital admin account</p>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <label className="block text-sm">
          <span className="text-slate-600">Hospital name</span>
          <input className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" value={hospitalName} onChange={(e) => setHospitalName(e.target.value)} required />
        </label>
        <label className="block text-sm">
          <span className="text-slate-600">City</span>
          <input className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" value={city} onChange={(e) => setCity(e.target.value)} />
        </label>
        <label className="block text-sm">
          <span className="text-slate-600">Hospital contact email</span>
          <input className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} required />
        </label>
        <label className="block text-sm">
          <span className="text-slate-600">Admin name</span>
          <input className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" value={adminName} onChange={(e) => setAdminName(e.target.value)} required />
        </label>
        <label className="block text-sm">
          <span className="text-slate-600">Admin email</span>
          <input className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} required />
        </label>
        <label className="block text-sm">
          <span className="text-slate-600">Admin password</span>
          <input className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" type="password" value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} required minLength={8} />
        </label>
        <button type="submit" disabled={busy} className="w-full rounded-md bg-teal-700 text-white py-2 text-sm font-medium disabled:opacity-50">
          {busy ? "Creating…" : "Create hospital"}
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
