import { useCallback, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowRight, Eye, EyeOff, Radio, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/command/shared';
import { AuthError } from '@/lib/auth-api';
import { useAuth } from '@/lib/auth';
import { GoogleSignInButton } from './google-sign-in';

function AuthErrorMessage({ children }: { children: string }) {
  return <div role="alert" className="form-note login-error">{children}</div>;
}

export function LoginPage() {
  const { login, loginWithGoogle } = useAuth();
  const navigate = useNavigate();
  const [show, setShow] = useState(false);
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const finishLogin = useCallback(() => { setPassword(''); void navigate({ to: '/dashboard', replace: true }); }, [navigate]);
  const handleGoogle = useCallback(async (credential: string) => {
    setError(''); setBusy(true);
    try { await loginWithGoogle(credential); finishLogin(); } catch (reason) { setError(reason instanceof AuthError ? reason.message : 'Google sign-in failed. Please try again.'); } finally { setBusy(false); }
  }, [finishLogin, loginWithGoogle]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const cleanIdentifier = identifier.trim();
    if (!cleanIdentifier) return setError('Username or email is required.');
    if (!password) return setError('Password is required.');
    setError(''); setBusy(true);
    try { await login(cleanIdentifier, password); finishLogin(); } catch (reason) { setError(reason instanceof AuthError ? reason.message : 'Unable to sign in. Please try again.'); setPassword(''); } finally { setBusy(false); }
  };
  return <AuthFrame><section className="login-card"><div className="login-heading"><Badge tone="muted">SECURE AUTHENTICATION</Badge><h2>Secure Login</h2><p>Sign in to access the Crowd Safety Command Center</p></div><form className="login-form" onSubmit={event => void submit(event)} noValidate><label htmlFor="identifier">Username or Email<input id="identifier" value={identifier} onChange={event => setIdentifier(event.target.value)} autoComplete="username" placeholder="operator@organization.com" /></label><label htmlFor="password">Password<div className="password-input"><input id="password" value={password} onChange={event => setPassword(event.target.value)} type={show ? 'text' : 'password'} autoComplete="current-password" placeholder="Enter your password" /><Button variant="ghost" size="icon" type="button" aria-label={show ? 'Hide password' : 'Show password'} onClick={() => setShow(value => !value)}>{show ? <EyeOff /> : <Eye />}</Button></div></label>{error && <AuthErrorMessage>{error}</AuthErrorMessage>}<Button size="lg" type="submit" disabled={busy}>{busy ? 'Signing in...' : 'Secure Login'}<ArrowRight /></Button></form><div className="auth-divider"><span>OR</span></div><GoogleSignInButton onCredential={credential => void handleGoogle(credential)} disabled={busy} /><p className="auth-switch">Don't have an account? <Link to="/signup">Create Account</Link></p><p className="login-notice"><Shield size={14} /> Authorized personnel only. All monitoring access is logged by the system.</p></section></AuthFrame>;
}

export function SignupPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', username: '', email: '', password: '', confirmPassword: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const update = (field: keyof typeof form, value: string) => setForm(current => ({ ...current, [field]: value }));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.name.trim()) return setError('Full name is required.');
    if (!form.username.trim()) return setError('Username is required.');
    if (!form.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) return setError('Please enter a valid email address.');
    if (!form.password) return setError('Password is required.');
    if (form.password !== form.confirmPassword) return setError('Passwords do not match.');
    setError(''); setBusy(true);
    try { await register(form.name.trim(), form.username.trim(), form.email.trim(), form.password); void navigate({ to: '/dashboard', replace: true }); } catch (reason) { setError(reason instanceof AuthError ? reason.message : 'Unable to create the account. Please try again.'); } finally { setBusy(false); }
  };
  return <AuthFrame><section className="login-card signup-card"><div className="login-heading"><Badge tone="muted">NEW OPERATOR ACCESS</Badge><h2>Create Your CrowdGuard Account</h2><p>Create a secure account for the Crowd Safety Command Center</p></div><form className="login-form" onSubmit={event => void submit(event)} noValidate><label htmlFor="signup-name">Full Name<input id="signup-name" value={form.name} onChange={event => update('name', event.target.value)} autoComplete="name" /></label><label htmlFor="signup-username">Username<input id="signup-username" value={form.username} onChange={event => update('username', event.target.value)} autoComplete="username" /></label><label htmlFor="signup-email">Email Address<input id="signup-email" value={form.email} onChange={event => update('email', event.target.value)} type="email" autoComplete="email" /></label><label htmlFor="signup-password">Password<input id="signup-password" value={form.password} onChange={event => update('password', event.target.value)} type="password" autoComplete="new-password" /></label><label htmlFor="signup-confirm">Confirm Password<input id="signup-confirm" value={form.confirmPassword} onChange={event => update('confirmPassword', event.target.value)} type="password" autoComplete="new-password" /></label>{error && <AuthErrorMessage>{error}</AuthErrorMessage>}<Button size="lg" type="submit" disabled={busy}>{busy ? 'Creating account...' : 'Create Account'}<ArrowRight /></Button></form><p className="auth-switch">Already have an account? <Link to="/login">Sign In</Link></p></section></AuthFrame>;
}

function AuthFrame({ children }: { children: ReactNode }) {
  return <div className="login-page"><div className="login-scrim" /><div className="login-brand"><div className="brand-mark"><Shield size={26} /></div><div><strong>CROWD<span>GUARD</span></strong><small>AI SAFETY PLATFORM</small></div></div><div className="login-layout"><section className="login-intro"><div className="eyebrow">AUTHORIZED ACCESS / AI OPERATIONS</div><h1>AI CROWD SAFETY</h1><p>Intelligent Crowd Monitoring &amp; Safety Alert System</p><span>Authorized access to the AI-powered crowd monitoring command center.</span><div className="login-signal"><Radio /><span><strong>COMPUTER VISION ONLINE</strong><small>Camera intelligence · Crowd safety · Secure operations</small></span></div></section>{children}</div></div>;
}
