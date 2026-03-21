import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import * as api from '../api';

interface AuthState {
  loggedIn: boolean;
  user: Record<string, unknown> | null;
}

interface AuthContextType extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

const SESSION_KEY = 'schulchat_session';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ loggedIn: false, user: null });

  useEffect(() => {
    const saved = localStorage.getItem(SESSION_KEY);
    if (saved) {
      try {
        const { clientKey, deviceId } = JSON.parse(saved);
        api.restoreSession(clientKey, deviceId);
        api.getMe().then((payload) => {
          setState({ loggedIn: true, user: payload.userinfo });
        }).catch(() => {
          localStorage.removeItem(SESSION_KEY);
          api.clearSession();
        });
      } catch {
        localStorage.removeItem(SESSION_KEY);
      }
    }
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const payload = await api.login(email, password);
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      clientKey: api.getClientKey(),
      deviceId: api.getDeviceId(),
    }));
    setState({ loggedIn: true, user: payload.userinfo });
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(SESSION_KEY);
    api.clearSession();
    setState({ loggedIn: false, user: null });
  }, []);

  return (
    <AuthContext value={{ ...state, login, logout }}>
      {children}
    </AuthContext>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
