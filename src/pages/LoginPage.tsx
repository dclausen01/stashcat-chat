import { useState, type FormEvent, useEffect } from 'react';
import { LogIn, Loader2, Smartphone, ArrowLeft, ChevronRight } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import * as api from '../api';
import type { LoginDevice } from '../types';

type Step = 'credentials' | 'device-list' | 'code-entry';

export default function LoginPage() {
  const { finishLogin } = useAuth();

  // Credentials step
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [securityPassword, setSecurityPassword] = useState('');

  // Device-list step
  const [devices, setDevices] = useState<LoginDevice[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<LoginDevice | null>(null);
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [initiatingTransfer, setInitiatingTransfer] = useState(false);

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
          setLoadingDevices(false);
        })
        .catch((err) => {
          setError(err instanceof Error ? err.message : 'Geräte konnten nicht geladen werden');
          setLoadingDevices(false);
        });
    }
  }, [step, preAuthToken]);

  // Step 1: Submit with security password (legacy flow)
  const handlePasswordLogin = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
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

  // Step 2: Start device flow — submit credentials first, then device list
  const startDeviceFlow = async () => {
    if (!email || !password) {
      setError('Bitte E-Mail und Passwort ausfüllen');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const res = await api.loginCredentials(email, password);
      setPreAuthToken(res.preAuthToken);
      setStep('device-list');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Anmeldung fehlgeschlagen');
    } finally {
      setLoading(false);
    }
  };

  // Step 3: Select device and initiate key transfer
  const handleDeviceSelect = async (device: LoginDevice) => {
    setError('');
    setLoading(true);
    setInitiatingTransfer(true);
    setSelectedDevice(device);
    try {
      await api.initiateDeviceKeyTransfer(preAuthToken, device.device_id);
      setDeviceCode('');
      setStep('code-entry');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Schlüsselübertragung fehlgeschlagen');
    } finally {
      setLoading(false);
      setInitiatingTransfer(false);
    }
  };

  // Step 4: Submit device code
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
      const timer = setTimeout(() => {
        handleCodeSubmit(new Event('submit') as unknown as FormEvent);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [deviceCode, step]);

  // Navigate back
  const goBack = () => {
    setError('');
    if (step === 'device-list') setStep('credentials');
    else if (step === 'code-entry') setStep('device-list');
  };

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
                  required
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
              disabled={loading}
              className="flex w-full items-center gap-4 rounded-lg border border-surface-200 bg-white p-4 text-left transition hover:border-primary-300 hover:bg-primary-50 disabled:opacity-50 dark:border-surface-700 dark:bg-surface-800 dark:hover:border-primary-600 dark:hover:bg-surface-750"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-100 text-primary-600 dark:bg-primary-900/30 dark:text-primary-400">
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
              <ChevronRight size={18} className="shrink-0 text-surface-400" />
            </button>
          </div>
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
              Wähle ein Gerät, auf dem du bereits angemeldet bist.
            </p>

            {loadingDevices ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 size={24} className="animate-spin text-primary-500" />
              </div>
            ) : devices.length === 0 ? (
              <div className="rounded-lg border border-surface-200 bg-surface-50 p-6 text-center dark:border-surface-700 dark:bg-surface-800">
                <p className="text-sm text-surface-500 dark:text-surface-400">
                  Keine geeigneten Geräte gefunden.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {devices.map((device) => (
                  <button
                    key={device.device_id}
                    onClick={() => handleDeviceSelect(device)}
                    disabled={loading || initiatingTransfer}
                    className="flex w-full items-center gap-4 rounded-lg border border-surface-200 bg-white p-4 text-left transition hover:border-primary-300 hover:bg-primary-50 disabled:opacity-50 dark:border-surface-700 dark:bg-surface-800 dark:hover:border-primary-600 dark:hover:bg-surface-750"
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-100 dark:bg-surface-700">
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
                    {(loading || initiatingTransfer) && selectedDevice?.device_id === device.device_id ? (
                      <Loader2 size={18} className="animate-spin text-primary-500" />
                    ) : (
                      <ChevronRight size={18} className="text-surface-400" />
                    )}
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
                Gib den 6-stelligen Code ein, der auf deinem Gerät angezeigt wird
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
