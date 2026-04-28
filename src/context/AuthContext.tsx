import { createContext, useContext, useState, useCallback, useEffect, useMemo, type ReactNode } from 'react';
import * as api from '../api';
import { closeRealtimeConnection } from '../hooks/useRealtimeEvents';
import type { User } from '../types';

interface AuthState {
  loggedIn: boolean;
  user: User | null;
}

interface AuthContextType extends AuthState {
  login: (email: string, password: string, securityPassword: string) => Promise<void>;
  /**
   * Finalize a multi-step login (password or device flow).
   * The token is already persisted by the api.loginFinalizeWith* functions.
   * @deprecated Use the phased login api functions directly + finishLogin instead.
   */
  finishLogin: (user: User) => void;
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
        // Derive availability from status text
        const availability = api.deriveAvailability(user.status);
        setState({ loggedIn: true, user: { ...user, availability } });
      }).catch((error) => {
        // Only clear session on explicit authentication errors (401/403)
        // Don't clear session on temporary network/server errors
        const isAuthError = error?.message?.includes('401') || 
                           error?.message?.includes('403') ||
                           error?.message?.includes('Unauthorized') ||
                           error?.message?.includes('Forbidden');
        if (isAuthError) {
          // console.log('[Auth] Authentication failed, clearing session');
          api.clearSession();
        } else {
          // For temporary errors, keep the token but show logged out state
          // The user can refresh to try again
          // console.log('[Auth] Temporary error, keeping token for retry:', error?.message);
        }
      });
    }
  }, []);

  const login = useCallback(async (email: string, password: string, securityPassword: string) => {
    const res = await api.login(email, password, securityPassword);
    setState({ loggedIn: true, user: res.user });
  }, []);

  const finishLogin = useCallback((user: User) => {
    setState({ loggedIn: true, user });
  }, []);

  const logout = useCallback(async () => {
    await api.logout();
    closeRealtimeConnection(); // Close SSE connection on logout
    setState({ loggedIn: false, user: null });
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
    () => ({ ...state, login, finishLogin, logout, setUser }),
    [state, login, finishLogin, logout, setUser],
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
