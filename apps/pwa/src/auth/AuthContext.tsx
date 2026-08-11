/**
 * Placeholder auth-state scaffolding. Just enough for feature/pwa-onboarding-auth-screens
 * (real login/signup UI) and feature/pwa-factura-flows (screens gated behind a logged-in user)
 * to read/write session state without inventing their own store.
 *
 * Session is persisted to localStorage so a reload doesn't drop it — convenient while building
 * screens against the mock API (src/api/client.ts). Calling `login()` also registers the access
 * token with the API client via `setAccessToken()`, so authenticated client calls "just work"
 * after that.
 *
 * Not covered here (left to feature/pwa-onboarding-auth-screens):
 * - Actually calling `login`/`signup` from src/api/client.ts and wiring up forms/validation.
 * - Automatic refresh-token rotation when the access token expires.
 * - Route guarding (redirecting to /login when unauthenticated) — the router in src/App.tsx
 *   currently renders every route unconditionally.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { setAccessToken } from '../api/client';
import type { LoginResponse, Usuario } from '../api/types';

const STORAGE_KEY = 'epsa:auth';

interface StoredSession {
  usuario: Usuario;
  accessToken: string;
  refreshToken: string;
}

interface AuthContextValue {
  usuario: Usuario | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  /** Call with the response of api/client.ts `login()` (or `signup()` + `login()`). */
  login: (session: LoginResponse) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function readStoredSession(): StoredSession | null {
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredSession;
  } catch {
    return null;
  }
}

/** Swallows quota/private-browsing errors the same way mockData.ts's writeStore does — losing
 * persistence is fine, throwing out of a click handler and leaving the UI stuck isn't. */
function writeStoredSession(session: StoredSession | null): void {
  if (typeof localStorage === 'undefined') return;
  try {
    if (session) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // ignore — see mockData.ts writeStore for the same tradeoff
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<StoredSession | null>(() => readStoredSession());

  // Registering the restored token with the API client is a side effect on module-level state
  // outside React, so it belongs in an effect, not in the useState initializer above — React
  // may invoke a lazy initializer more than once per commit (e.g. under <StrictMode>, used in
  // main.tsx) without it corresponding to a committed render.
  useEffect(() => {
    setAccessToken(session?.accessToken ?? null);
  }, [session]);

  const login = useCallback((data: LoginResponse) => {
    const next: StoredSession = {
      usuario: data.usuario,
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
    };
    writeStoredSession(next);
    setSession(next);
  }, []);

  const logout = useCallback(() => {
    writeStoredSession(null);
    setSession(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      usuario: session?.usuario ?? null,
      accessToken: session?.accessToken ?? null,
      refreshToken: session?.refreshToken ?? null,
      isAuthenticated: session !== null,
      login,
      logout,
    }),
    [session, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an <AuthProvider>');
  return ctx;
}
