import type { ReactElement } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { loadSession, type AuthUser } from "./session";
import { homePath } from "./roles";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import RegisterHospitalPage from "./pages/RegisterHospitalPage";
import PatientHome from "./pages/PatientHome";
import HospitalDashboard from "./pages/HospitalDashboard";
import DoctorDashboard from "./pages/DoctorDashboard";
import PlatformDashboard from "./pages/PlatformDashboard";
import ObservabilityPage from "./pages/ObservabilityPage";

function RequireAuth({ children, roles }: { children: ReactElement; roles?: string[] }) {
  const { token, user } = loadSession();
  if (!token || !user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to={homePath(user.role)} replace />;
  return children;
}

function RoleHome({ render }: { render: (user: AuthUser) => ReactElement }) {
  const { user } = loadSession();
  if (!user) return <Navigate to="/login" replace />;
  return render(user);
}

export default function App() {
  const { user } = loadSession();

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/register-hospital" element={<RegisterHospitalPage />} />
      <Route
        path="/app"
        element={
          <RequireAuth roles={["PATIENT"]}>
            <RoleHome render={(u) => <PatientHome user={u} />} />
          </RequireAuth>
        }
      />
      <Route
        path="/hospital/observability"
        element={
          <RequireAuth roles={["HOSPITAL_ADMIN"]}>
            <RoleHome render={(u) => <ObservabilityPage user={u} />} />
          </RequireAuth>
        }
      />
      <Route
        path="/hospital"
        element={
          <RequireAuth roles={["HOSPITAL_ADMIN"]}>
            <RoleHome render={(u) => <HospitalDashboard user={u} />} />
          </RequireAuth>
        }
      />
      <Route
        path="/doctor"
        element={
          <RequireAuth roles={["DOCTOR"]}>
            <RoleHome render={(u) => <DoctorDashboard user={u} />} />
          </RequireAuth>
        }
      />
      <Route
        path="/platform/observability"
        element={
          <RequireAuth roles={["PLATFORM_ADMIN"]}>
            <RoleHome render={(u) => <ObservabilityPage user={u} />} />
          </RequireAuth>
        }
      />
      <Route
        path="/platform"
        element={
          <RequireAuth roles={["PLATFORM_ADMIN"]}>
            <RoleHome render={(u) => <PlatformDashboard user={u} />} />
          </RequireAuth>
        }
      />
      <Route path="/" element={<Navigate to={user ? homePath(user.role) : "/login"} replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
