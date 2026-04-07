import { createContext, useContext, useState, useCallback, useEffect, useMemo, type ReactNode } from 'react';
import * as api from '../api';
import type { User } from '../types';

interface AuthState {
  loggedIn: boolean;
  user: User | null;
}

interface AuthContextType extends AuthState {
  login: (email: string, password: string, securityPassword: string) => Promise<void>;
  logout: () => void;
  setUser: (user: User | null) => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ loggedIn: false, user: null });

  useEffect(() => {
    api.restoreToken();
    if (api.isLoggedIn()) {
      api.getMe().then((user) => {
        setState({ loggedIn: true, user });
      }).catch((error) => {
        // Only clear session on explicit authentication errors (401/403)
        // Don't clear session on temporary network/server errors
        const isAuthError = error?.message?.includes('401') || 
                           error?.message?.includes('403') ||
                           error?.message?.includes('Unauthorized') ||
                           error?.message?.includes('Forbidden');
        if (isAuthError) {
          console.log('[Auth] Authentication failed, clearing session');
          api.clearSession();
        } else {
          // For temporary errors, keep the token but show logged out state
          // The user can refresh to try again
          console.log('[Auth] Temporary error, keeping token for retry:', error?.message);
        }
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

  const setUser = useCallback((user: User | null) => {
    setState((prev) => ({ ...prev, user }));
  }, []);

  const value = useMemo(
    () => ({ ...state, login, logout, setUser }),
    [state, login, logout, setUser],
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
