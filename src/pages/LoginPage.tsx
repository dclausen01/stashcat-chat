import { useState, type FormEvent } from 'react';
import { LogIn, Loader2, Smartphone, ArrowLeft } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import * as api from '../api';

type Step = 'credentials' | 'code-entry';

export default function LoginPage() {
  const { finishLogin } = useAuth();

  // Credentials step
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [securityPassword, setSecurityPassword] = useState('');

  // Code-entry step
  const [deviceCode, setDeviceCode] = useState('');

  // Shared state
  const [step, setStep] = useState<Step>('credentials');
  const [preAuthToken, setPreAuthToken] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [deviceFlow, setDeviceFlow] = useState(false);

  // Step 1a: Submit with security password (legacy flow)
  const handlePasswordLogin = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      // Use phased login: credentials + password
      const credRes = await api.loginCredentials(email, password);
      setPreAuthToken(credRes.preAuthToken);
      const res = await api.loginFinalizeWithPassword(credRes.preAuthToken, securityPassword);
      finishLogin(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login fehlgeschlagen');
    } finally {
      setLoading(false);
    }
  };

  // Step 1b: Switch to device flow — submit credentials first, then code entry
  const startDeviceFlow = async () => {
    console.log('[LoginPage] startDeviceFlow called, email:', email ? 'set' : 'empty', 'password:', password ? 'set' : 'empty');
    if (!email || !password) {
      setError('Bitte E-Mail und Passwort ausfüllen');
      return;
    }
    setError('');
    setLoading(true);
    try {
      console.log('[LoginPage] Calling api.loginCredentials...');
      const res = await api.loginCredentials(email, password);
      console.log('[LoginPage] loginCredentials response:', res);
      setPreAuthToken(res.preAuthToken);
      setDeviceFlow(true);
      setStep('code-entry');
      setDeviceCode('');
    } catch (err) {
      console.error('[LoginPage] loginCredentials error:', err);
      setError(err instanceof Error ? err.message : 'Anmeldung fehlgeschlagen');
    } finally {
      setLoading(false);
    }
  };

  // Step 2: Submit device code
  const handleCodeSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await api.loginFinalizeWithDeviceCode(preAuthToken, deviceCode);
      finishLogin(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Code ungültig oder abgelaufen');
    } finally {
      setLoading(false);
    }
  };

  // Auto-submit when code has 6 digits
  const handleCodeChange = (value: string) => {
    setDeviceCode(value);
  };

  // Navigate back from code entry
  const goBack = () => {
    setError('');
    setDeviceFlow(false);
    setStep('credentials');
    setDeviceCode('');
    setPreAuthToken('');
  };

  return (
    <div className="flex h-full items-center justify-center bg-surface-50 dark:bg-surface-950">
      <div className="w-full max-w-md p-8">
        <div className="mb-8 text-center">
          <img src="/bbz-logo-neu.png" alt="BBZ Rendsburg-Eckernförde" className="mx-auto mb-4 h-20" />
          <h1 className="text-2xl font-bold text-surface-900 dark:text-white">BBZ Chat</h1>
          <p className="mt-1 text-surface-500 dark:text-surface-400">Anmelden bei schul.cloud</p>
        </div>

        {/* ── Step: Code Entry (Device Flow) ── */}
        {step === 'code-entry' && (
          <form onSubmit={handleCodeSubmit} className="space-y-4">
            {error && (
              <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
                {error}
              </div>
            )}

            <div className="text-center">
              <h2 className="text-lg font-semibold text-surface-900 dark:text-white">
                Bestätigung auf deinem Gerät
              </h2>
              <p className="mt-1 text-sm text-surface-500 dark:text-surface-400">
                Gib den 6-stelligen Code ein, der auf deinem angemeldeten Gerät angezeigt wird
              </p>
            </div>

            <div className="flex justify-center">
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                pattern="[0-9]{6}"
                value={deviceCode}
                onChange={(e) => handleCodeChange(e.target.value.replace(/[^0-9]/g, ''))}
                required
                autoFocus
                className="w-48 rounded-lg border border-surface-300 bg-white px-4 py-3 text-center text-2xl tracking-[0.5em] text-surface-900 outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 dark:border-surface-600 dark:bg-surface-800 dark:text-white"
                placeholder="000000"
              />
            </div>

            <button
              type="submit"
              disabled={loading || deviceCode.length !== 6}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 py-2.5 font-medium text-white transition hover:bg-primary-700 disabled:opacity-50"
            >
              {loading ? <Loader2 size={20} className="animate-spin" /> : <LogIn size={20} />}
              {loading ? 'Wird angemeldet...' : 'Anmelden'}
            </button>

            <button
              type="button"
              onClick={goBack}
              className="flex w-full items-center justify-center gap-1 text-sm text-surface-500 hover:text-surface-700 dark:text-surface-400 dark:hover:text-surface-200"
            >
              <ArrowLeft size={14} /> Abbrechen
            </button>
          </form>
        )}

        {/* ── Step: Credentials (Main) ── */}
        {step === 'credentials' && (
          <div className="space-y-4">
            {error && (
              <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
                {error}
              </div>
            )}

            <form onSubmit={handlePasswordLogin} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-surface-700 dark:text-surface-300">
                  E-Mail
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                  className="w-full rounded-lg border border-surface-300 bg-white px-4 py-2.5 text-surface-900 outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 dark:border-surface-600 dark:bg-surface-800 dark:text-white"
                  placeholder="name@schule.de"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-surface-700 dark:text-surface-300">
                  Passwort
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full rounded-lg border border-surface-300 bg-white px-4 py-2.5 text-surface-900 outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 dark:border-surface-600 dark:bg-surface-800 dark:text-white"
                  placeholder="Passwort eingeben"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-surface-700 dark:text-surface-300">
                  Verschlüsselungspasswort
                </label>
                <input
                  type="password"
                  value={securityPassword}
                  onChange={(e) => setSecurityPassword(e.target.value)}
                  required={!deviceFlow}
                  className="w-full rounded-lg border border-surface-300 bg-white px-4 py-2.5 text-surface-900 outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 dark:border-surface-600 dark:bg-surface-800 dark:text-white"
                  placeholder="Verschlüsselungspasswort eingeben"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 py-2.5 font-medium text-white transition hover:bg-primary-700 disabled:opacity-50"
              >
                {loading ? <Loader2 size={20} className="animate-spin" /> : <LogIn size={20} />}
                {loading ? 'Wird angemeldet...' : 'Anmelden'}
              </button>
            </form>

            {/* Divider */}
            <div className="flex items-center gap-3">
              <div className="flex-1 border-t border-surface-200 dark:border-surface-700" />
              <span className="text-xs text-surface-400 dark:text-surface-500">oder</span>
              <div className="flex-1 border-t border-surface-200 dark:border-surface-700" />
            </div>

            {/* Device flow button */}
            <button
              type="button"
              onClick={startDeviceFlow}
              className="flex w-full items-center gap-4 rounded-lg border border-surface-200 bg-white p-4 text-left transition hover:border-primary-300 hover:bg-primary-50 dark:border-surface-700 dark:bg-surface-800 dark:hover:border-primary-600 dark:hover:bg-surface-750"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-100 text-primary-600 dark:bg-primary-900/30 dark:text-primary-400">
                <Smartphone size={20} />
              </div>
              <div className="flex-1">
                <div className="font-medium text-surface-900 dark:text-white">
                  Stattdessen mit angemeldetem Gerät einloggen
                </div>
                <div className="text-xs text-surface-500 dark:text-surface-400">
                  Nutze ein Gerät, auf dem du bereits eingeloggt bist
                </div>
              </div>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
