export type UserRole = 'admin' | 'security_operator';

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
};

export type AuthSession = { user: AuthUser; token: string };

const API_URL = import.meta.env['VITE_API_URL'] || 'http://127.0.0.1:5000';
const SESSION_KEY = 'crowdguard.auth.session';

export class AuthError extends Error {
  constructor(message: string, public readonly code: 'invalid' | 'conflict' | 'unavailable' | 'timeout' | 'server' | 'unknown') {
    super(message);
    this.name = 'AuthError';
  }
}

function readSession(): AuthSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as Partial<AuthSession>;
    if (!session.token || !session.user?.id || !session.user.email) return null;
    return { token: session.token, user: session.user as AuthUser };
  } catch {
    return null;
  }
}

function saveSession(session: AuthSession) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export const authApi = {
  async login(identifier: string, password: string): Promise<AuthSession> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(`${API_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ identifier, password }),
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => null) as { error?: string; user?: AuthUser; token?: string } | null;
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) throw new AuthError('Invalid username or password.', 'invalid');
        if (response.status === 404 || response.status === 405) throw new AuthError('Authentication service is not connected yet.', 'unavailable');
        if (response.status >= 500) throw new AuthError('Authentication service unavailable. Check that Flask is running.', 'server');
        throw new AuthError(payload?.error || 'Unable to sign in. Please try again.', 'unknown');
      }
      if (!payload?.token || !payload.user) throw new AuthError('Authentication response was incomplete.', 'unknown');
      const session = { token: payload.token, user: payload.user };
      saveSession(session);
      return session;
    } catch (error) {
      if (error instanceof AuthError) throw error;
      if (error instanceof DOMException && error.name === 'AbortError') throw new AuthError('Login request timed out. Please try again.', 'timeout');
      if (error instanceof TypeError) throw new AuthError('Authentication service unavailable. Check that Flask is running.', 'unavailable');
      throw new AuthError('Unable to sign in. Please try again.', 'unknown');
    } finally {
      clearTimeout(timer);
    }
  },
  async register(name: string, username: string, email: string, password: string): Promise<AuthSession> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(`${API_URL}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ name, username, email, password }),
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => null) as { error?: string; user?: AuthUser; token?: string } | null;
      if (!response.ok) {
        if (response.status === 409 || /already exists|already registered|duplicate/i.test(payload?.error ?? '')) throw new AuthError('An account with those details already exists.', 'conflict');
        if (response.status === 400 && /email/i.test(payload?.error ?? '')) throw new AuthError('Please enter a valid email address.', 'invalid');
        if (response.status >= 500) throw new AuthError('Authentication service unavailable. Check that Flask is running.', 'server');
        throw new AuthError('Unable to create the account. Please review your details.', 'unknown');
      }
      if (!payload?.token || !payload.user) throw new AuthError('Registration response was incomplete.', 'unknown');
      const session = { token: payload.token, user: payload.user };
      saveSession(session);
      return session;
    } catch (error) {
      if (error instanceof AuthError) throw error;
      if (error instanceof DOMException && error.name === 'AbortError') throw new AuthError('Registration request timed out. Please try again.', 'timeout');
      if (error instanceof TypeError) throw new AuthError('Authentication service unavailable. Check that Flask is running.', 'unavailable');
      throw new AuthError('Unable to create the account. Please try again.', 'unknown');
    } finally {
      clearTimeout(timer);
    }
  },
    async loginWithGoogle(credential: string): Promise<AuthSession> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await fetch(`${API_URL}/api/auth/google`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ credential }),
        signal: controller.signal,
      });

      const payload = await response.json().catch(() => null) as {
        error?: string;
        user?: AuthUser;
        token?: string;
      } | null;

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new AuthError(
            payload?.error || 'Google sign-in failed. Please try again.',
            'invalid'
          );
        }

        if (response.status === 404 || response.status === 405) {
          throw new AuthError(
            'Google authentication endpoint was not found.',
            'unavailable'
          );
        }

        if (response.status >= 500) {
          throw new AuthError(
            payload?.error || 'Authentication service unavailable. Check that Flask is running.',
            'server'
          );
        }

        throw new AuthError(
          payload?.error || 'Google sign-in failed. Please try again.',
          'unknown'
        );
      }

      const user = payload?.user;
      const token = payload?.token;

      if (
        !user ||
        typeof user.id !== 'string' ||
        typeof user.email !== 'string' ||
        (user.role !== 'admin' && user.role !== 'security_operator') ||
        typeof token !== 'string' ||
        !token.trim()
      ) {
        throw new AuthError(
          'The server returned an invalid Google sign-in response.',
          'invalid'
        );
      }

      const session: AuthSession = {
        user,
        token,
      };

      saveSession(session);

      return session;
    } catch (error) {
      if (error instanceof AuthError) {
        throw error;
      }

      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new AuthError(
          'Google sign-in request timed out. Please try again.',
          'timeout'
        );
      }

      if (error instanceof TypeError) {
        throw new AuthError(
          'Authentication service unavailable. Check that Flask is running.',
          'unavailable'
        );
      }

      throw new AuthError(
        'Unable to complete Google sign-in. Please try again.',
        'unknown'
      );
    } finally {
      clearTimeout(timer);
    }
  },
  async logout(): Promise<void> {
    const session = readSession();
    localStorage.removeItem(SESSION_KEY);
    if (!session?.token) return;
    try {
      await fetch(`${API_URL}/api/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${session.token}` } });
    } catch {
      // Local session cleanup remains authoritative when the optional endpoint is unavailable.
    }
  },
  getCurrentUser: (): AuthUser | null => readSession()?.user ?? null,
  getSession: (): AuthSession | null => readSession(),
  isAuthenticated: (): boolean => Boolean(readSession()?.token),
};
