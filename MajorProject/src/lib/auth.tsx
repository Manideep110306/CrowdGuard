import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { authApi, type AuthSession, type AuthUser } from './auth-api';

type AuthState = {
  user: AuthUser | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (identifier: string, password: string) => Promise<AuthSession>;
  register: (name: string, username: string, email: string, password: string) => Promise<AuthSession>;
  loginWithGoogle: (credential: string) => Promise<AuthSession>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setSession(authApi.getSession());
    setIsLoading(false);
  }, []);

  const login = async (identifier: string, password: string) => {
    const nextSession = await authApi.login(identifier, password);
    setSession(nextSession);
    return nextSession;
  };

  const register = async (name: string, username: string, email: string, password: string) => {
    const nextSession = await authApi.register(name, username, email, password);
    setSession(nextSession);
    return nextSession;
  };

  const loginWithGoogle = async (credential: string) => {
    const nextSession = await authApi.loginWithGoogle(credential);
    setSession(nextSession);
    return nextSession;
  };

  const logout = async () => {
    await authApi.logout();
    setSession(null);
  };

  return <AuthContext.Provider value={{ user: session?.user ?? null, token: session?.token ?? null, isAuthenticated: Boolean(session?.token), isLoading, login, register, loginWithGoogle, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('AuthProvider required');
  return context;
}

export function useOptionalAuth() {
  return useContext(AuthContext);
}
