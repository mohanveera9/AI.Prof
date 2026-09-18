import { ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { clearSession, type AuthUser } from "../session";
import { roleLabel } from "../roles";

function navFor(role: string): Array<{ to: string; label: string; end?: boolean }> {
  if (role === "PLATFORM_ADMIN") {
    return [
      { to: "/platform", label: "Hospitals", end: true },
      { to: "/platform/observability", label: "Observability" },
    ];
  }
  if (role === "HOSPITAL_ADMIN") {
    return [
      { to: "/hospital", label: "Hospital", end: true },
      { to: "/hospital/observability", label: "Observability" },
    ];
  }
  return [];
}

export default function AppShell({ user, children }: { user: AuthUser; children: ReactNode }) {
  const navigate = useNavigate();
  const links = navFor(user.role);

  function logout() {
    clearSession();
    navigate("/login");
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-slate-900">AI.Prof</p>
            <p className="text-xs text-slate-500">
              {roleLabel(user.role)} · {user.name}
            </p>
          </div>
          <div className="flex items-center gap-4">
            {links.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.end}
                className={({ isActive }) => `text-sm ${isActive ? "text-teal-800 font-medium" : "text-slate-600 hover:text-slate-900"}`}
              >
                {link.label}
              </NavLink>
            ))}
            <button type="button" onClick={logout} className="text-sm text-slate-600 hover:text-slate-900">
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">{children}</main>
    </div>
  );
}
