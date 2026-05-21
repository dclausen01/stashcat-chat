import { createContext, useContext, useState, useCallback, useEffect, useMemo, type ReactNode } from 'react';
import * as api from '../api';
import { closeRealtimeConnection } from '../hooks/useRealtimeEvents';
import { on, BridgeEvents } from '../lib/bridgeBus';
import { bridge } from '../lib/flutterBridge';
import { isMobileBridge } from '../lib/mobileBridge';
import type { User } from '../types';

interface AuthState {
  loggedIn: boolean;
  user: User | null;
}

interface AuthContextType extends AuthState {
  /**
   * Finalize a multi-step login (password or device flow).
   * The token is already persisted by the api.loginFinalizeWith* functions —
   * this just flips React state to logged in and stores the user.
   */
  finishLogin: (user: User) => void;
  logout: () => void;
  setUser: (user: User | null) => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ loggedIn: false, user: null });

  const finishLogin = useCallback((user: User) => {
    const availability = api.deriveAvailability(user.status);
    setState({ loggedIn: true, user: { ...user, availability } });
    bridge.ready({ user: user.email || `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim(), locale: 'de' });
  }, []);

  // Flutter shell can hand us a long-lived mobile token via `window.bbzChat.setToken()`.
  // Exchange it for a regular session token, then bootstrap as usual.
  useEffect(() => {
    if (!isMobileBridge()) return;
    return on<string>(BridgeEvents.setToken, async (mobileToken) => {
      try {
        const { token, user } = await api.mobileSession(mobileToken);
        api.persistToken(token);
        finishLogin(user);
      } catch {
        api.clearSession();
        setState({ loggedIn: false, user: null });
      }
    });
  }, [finishLogin]);

  useEffect(() => {
    api.restoreToken();
    if (api.isLoggedIn()) {
      api.getMe().then((user) => {
        finishLogin(user);
      }).catch((error: { status?: number; message?: string }) => {
        // Nur bei echtem 401/403 Token verwerfen — bei transienten Netzwerkfehlern
        // (Backend down, Offline, …) den Token behalten, damit der naechste Refresh
        // wieder funktioniert.
        const isAuthError = error?.status === 401 || error?.status === 403;
        if (isAuthError) {
          api.clearSession();
        }
        // sonst: Token behalten, App bleibt "logged-out" bis User refresht.
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const logout = useCallback(async () => {
    await api.logout();
    closeRealtimeConnection(); // Close SSE connection on logout
    setState({ loggedIn: false, user: null });
    bridge.logout();
  }, []);

  const setUser = useCallback((user: User | null) => {
    if (user) {
      const availability = api.deriveAvailability(user.status);
      setState((prev) => ({ ...prev, user: { ...user, availability } }));
    } else {
      setState((prev) => ({ ...prev, user: null }));
    }
  }, []);

  const value = useMemo(
    () => ({ ...state, finishLogin, logout, setUser }),
    [state, finishLogin, logout, setUser],
  );

  return (
    <AuthContext value={value}>
      {children}
    </AuthContext>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
