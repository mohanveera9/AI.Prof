export interface AuthUser {
  id: string;
  email: string;
  role: string;
  name: string;
  hospitalId?: string;
  doctorId?: string;
  patientId?: string;
}

export interface AuthResult {
  accessToken: string;
  user: AuthUser;
}

const TOKEN_KEY = "ai_prof_token";
const USER_KEY = "ai_prof_user";

export function loadSession(): { token: string | null; user: AuthUser | null } {
  const token = localStorage.getItem(TOKEN_KEY);
  const raw = localStorage.getItem(USER_KEY);
  return { token, user: raw ? (JSON.parse(raw) as AuthUser) : null };
}

export function saveSession(result: AuthResult) {
  localStorage.setItem(TOKEN_KEY, result.accessToken);
  localStorage.setItem(USER_KEY, JSON.stringify(result.user));
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}
