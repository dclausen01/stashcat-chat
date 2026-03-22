import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import * as api from '../api';

interface AuthState {
  loggedIn: boolean;
  user: Record<string, unknown> | null;
}

interface AuthContextType extends AuthState {
  login: (email: string, password: string, securityPassword: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ loggedIn: false, user: null });

  useEffect(() => {
    api.restoreToken();
    if (api.isLoggedIn()) {
      api.getMe().then((user) => {
        setState({ loggedIn: true, user });
      }).catch(() => {
        api.clearSession();
      });
    }
  }, []);

  const login = useCallback(async (email: string, password: string, securityPassword: string) => {
    const res = await api.login(email, password, securityPassword);
    setState({ loggedIn: true, user: res.user });
  }, []);

  const logout = useCallback(async () => {
    await api.logout();
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
