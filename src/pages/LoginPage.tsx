import { useState, type FormEvent, useEffect } from 'react';
import { LogIn, Loader2, Smartphone, ArrowLeft, ChevronRight } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import * as api from '../api';
import type { LoginDevice } from '../types';

type Step = 'credentials' | 'method-choice' | 'password-entry' | 'device-list' | 'code-entry';

export default function LoginPage() {
  const { finishLogin } = useAuth();

  // Credentials step
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // Password-entry step
  const [securityPassword, setSecurityPassword] = useState('');

  // Device-list step
  const [devices, setDevices] = useState<LoginDevice[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<LoginDevice | null>(null);
  const [loadingDevices, setLoadingDevices] = useState(false);

  // Code-entry step
  const [deviceCode, setDeviceCode] = useState('');

  // Shared state
  const [step, setStep] = useState<Step>('credentials');
  const [preAuthToken, setPreAuthToken] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Load devices when entering device-list step
  useEffect(() => {
    if (step === 'device-list' && preAuthToken) {
      setLoadingDevices(true);
      setError('');
      api.listLoginDevices(preAuthToken)
        .then((res) => {
          setDevices(res.devices);
          setPreAuthToken(res.preAuthToken); // Server returns fresh token
          setLoadingDevices(false);
        })
        .catch((err) => {
          setError(err instanceof Error ? err.message : 'Geräte konnten nicht geladen werden');
          setLoadingDevices(false);
        });
    }
  }, [step, preAuthToken]);

  // Step 1: Submit credentials
  const handleCredentialsSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await api.loginCredentials(email, password);
      setPreAuthToken(res.preAuthToken);
      setStep('method-choice');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Anmeldung fehlgeschlagen');
    } finally {
      setLoading(false);
    }
  };

  // Step 2a: Choose password method
  const choosePasswordMethod = () => {
    setStep('password-entry');
  };

  // Step 2b: Choose device method → load devices
  const chooseDeviceMethod = () => {
    setStep('device-list');
  };

  // Step 2a (cont.): Submit security password
  const handlePasswordSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await api.loginFinalizeWithPassword(preAuthToken, securityPassword);
      finishLogin(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verschlüsselungspasswort falsch');
    } finally {
      setLoading(false);
    }
  };

  // Step 2b (cont.): Select a device and go to code entry
  // Note: No server call needed — the notification was already pushed
  // when loginCredentials was called (loginWithoutE2E on the server).
  const handleDeviceSelect = (device: LoginDevice) => {
    setSelectedDevice(device);
    setDeviceCode('');
    setStep('code-entry');
  };

  // Step 3: Submit device code
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
  useEffect(() => {
    if (deviceCode.length === 6 && step === 'code-entry') {
      // Small delay for UX feedback
      const timer = setTimeout(() => {
        handleCodeSubmit(new Event('submit') as unknown as FormEvent);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [deviceCode, step]);

  // Navigate back
  const goBack = () => {
    setError('');
    if (step === 'method-choice') {
      setStep('credentials');
    } else if (step === 'password-entry') {
      setStep('method-choice');
    } else if (step === 'device-list') {
      setStep('method-choice');
    } else if (step === 'code-entry') {
      setStep('device-list');
    }
  };

  // Format relative time
  function relativeTime(ts?: number): string {
    if (!ts) return 'Unbekannt';
    const diff = Date.now() / 1000 - ts;
    if (diff < 60) return 'Gerade eben';
    if (diff < 3600) return `vor ${Math.floor(diff / 60)} Min.`;
    if (diff < 86400) return `vor ${Math.floor(diff / 3600)} Std.`;
    return `vor ${Math.floor(diff / 86400)} Tagen`;
  }

  return (
    <div className="flex h-full items-center justify-center bg-surface-50 dark:bg-surface-950">
      <div className="w-full max-w-md p-8">
        <div className="mb-8 text-center">
          <img src="/bbz-logo-neu.png" alt="BBZ Rendsburg-Eckernförde" className="mx-auto mb-4 h-20" />
          <h1 className="text-2xl font-bold text-surface-900 dark:text-white">BBZ Chat</h1>
          <p className="mt-1 text-surface-500 dark:text-surface-400">Anmelden bei schul.cloud</p>
        </div>

        {/* ── Step: Credentials ── */}
        {step === 'credentials' && (
          <form onSubmit={handleCredentialsSubmit} className="space-y-4">
            {error && (
              <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
                {error}
              </div>
            )}

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

            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 py-2.5 font-medium text-white transition hover:bg-primary-700 disabled:opacity-50"
            >
              {loading ? <Loader2 size={20} className="animate-spin" /> : <LogIn size={20} />}
              {loading ? 'Wird überprüft...' : 'Weiter'}
            </button>
          </form>
        )}

        {/* ── Step: Method Choice ── */}
        {step === 'method-choice' && (
          <div className="space-y-4">
            {error && (
              <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
                {error}
              </div>
            )}

            <button
              onClick={choosePasswordMethod}
              className="flex w-full items-center gap-4 rounded-lg border border-surface-200 bg-white p-5 text-left transition hover:border-primary-300 hover:bg-primary-50 dark:border-surface-700 dark:bg-surface-800 dark:hover:border-primary-600 dark:hover:bg-surface-750"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-100 text-primary-600 dark:bg-primary-900/30 dark:text-primary-400">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
              </div>
              <div className="flex-1">
                <div className="font-medium text-surface-900 dark:text-white">Mit Verschlüsselungspasswort</div>
                <div className="text-sm text-surface-500 dark:text-surface-400">Gib dein Verschlüsselungspasswort ein</div>
              </div>
              <ChevronRight className="text-surface-400" size={20} />
            </button>

            <button
              onClick={chooseDeviceMethod}
              className="flex w-full items-center gap-4 rounded-lg border border-surface-200 bg-white p-5 text-left transition hover:border-primary-300 hover:bg-primary-50 dark:border-surface-700 dark:bg-surface-800 dark:hover:border-primary-600 dark:hover:bg-surface-750"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-100 text-primary-600 dark:bg-primary-900/30 dark:text-primary-400">
                <Smartphone size={24} />
              </div>
              <div className="flex-1">
                <div className="font-medium text-surface-900 dark:text-white">Durch ein anderes Gerät</div>
                <div className="text-sm text-surface-500 dark:text-surface-400">Nutze ein Gerät, das aktuell eingeloggt ist</div>
              </div>
              <ChevronRight className="text-surface-400" size={20} />
            </button>

            <button
              onClick={goBack}
              className="flex items-center gap-1 text-sm text-surface-500 hover:text-surface-700 dark:text-surface-400 dark:hover:text-surface-200"
            >
              <ArrowLeft size={14} /> Zurück
            </button>
          </div>
        )}

        {/* ── Step: Password Entry ── */}
        {step === 'password-entry' && (
          <form onSubmit={handlePasswordSubmit} className="space-y-4">
            {error && (
              <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
                {error}
              </div>
            )}

            <div>
              <label className="mb-1 block text-sm font-medium text-surface-700 dark:text-surface-300">
                Verschlüsselungspasswort
              </label>
              <input
                type="password"
                value={securityPassword}
                onChange={(e) => setSecurityPassword(e.target.value)}
                required
                autoFocus
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

            <button
              type="button"
              onClick={goBack}
              className="flex items-center gap-1 text-sm text-surface-500 hover:text-surface-700 dark:text-surface-400 dark:hover:text-surface-200"
            >
              <ArrowLeft size={14} /> Zurück
            </button>
          </form>
        )}

        {/* ── Step: Device List ── */}
        {step === 'device-list' && (
          <div className="space-y-4">
            {error && (
              <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
                {error}
              </div>
            )}

            <h2 className="text-lg font-semibold text-surface-900 dark:text-white">Gerät auswählen</h2>
            <p className="text-sm text-surface-500 dark:text-surface-400">
              Wähle ein Gerät, auf dem du bereits angemeldet bist. Dort wird ein 6-stelliger Code angezeigt.
            </p>

            {loadingDevices ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 size={24} className="animate-spin text-primary-500" />
              </div>
            ) : devices.length === 0 ? (
              <div className="rounded-lg border border-surface-200 bg-surface-50 p-6 text-center dark:border-surface-700 dark:bg-surface-800">
                <p className="text-sm text-surface-500 dark:text-surface-400">
                  Keine geeigneten Geräte gefunden. Stelle sicher, dass auf einem anderen Gerät eine aktive Session besteht.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {devices.map((device) => (
                  <button
                    key={device.device_id}
                    onClick={() => handleDeviceSelect(device)}
                    disabled={loading}
                    className="flex w-full items-center gap-4 rounded-lg border border-surface-200 bg-white p-4 text-left transition hover:border-primary-300 hover:bg-primary-50 disabled:opacity-50 dark:border-surface-700 dark:bg-surface-800 dark:hover:border-primary-600 dark:hover:bg-surface-750"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-100 dark:bg-surface-700">
                      <Smartphone size={18} className="text-surface-600 dark:text-surface-300" />
                    </div>
                    <div className="flex-1">
                      <div className="font-medium text-surface-900 dark:text-white">
                        {device.name || device.app_name}
                      </div>
                      <div className="text-xs text-surface-500 dark:text-surface-400">
                        {device.app_name}{device.name && device.name !== device.app_name ? ` · ${device.name}` : ''}
                        {device.last_login ? ` · ${relativeTime(device.last_login)}` : ''}
                      </div>
                    </div>
                    <ChevronRight size={18} className="text-surface-400" />
                  </button>
                ))}
              </div>
            )}

            <button
              onClick={goBack}
              className="flex items-center gap-1 text-sm text-surface-500 hover:text-surface-700 dark:text-surface-400 dark:hover:text-surface-200"
            >
              <ArrowLeft size={14} /> Zurück
            </button>
          </div>
        )}

        {/* ── Step: Code Entry ── */}
        {step === 'code-entry' && (
          <form onSubmit={handleCodeSubmit} className="space-y-4">
            {error && (
              <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
                {error}
              </div>
            )}

            <div className="text-center">
              <h2 className="text-lg font-semibold text-surface-900 dark:text-white">
                Code von {selectedDevice?.name || selectedDevice?.app_name || 'Gerät'}
              </h2>
              <p className="mt-1 text-sm text-surface-500 dark:text-surface-400">
                Der 6-stellige Code wurde auf deinem Gerät angezeigt
              </p>
            </div>

            <div className="flex justify-center">
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                pattern="[0-9]{6}"
                value={deviceCode}
                onChange={(e) => setDeviceCode(e.target.value.replace(/[^0-9]/g, ''))}
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
      </div>
    </div>
  );
}
