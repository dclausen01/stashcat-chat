import { useState, type FormEvent } from 'react';
import { LogIn, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [securityPassword, setSecurityPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password, securityPassword);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login fehlgeschlagen');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center bg-surface-50 dark:bg-surface-950">
      <div className="w-full max-w-md p-8">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary-600 text-white">
            <LogIn size={32} />
          </div>
          <h1 className="text-2xl font-bold text-surface-900 dark:text-white">SchulChat</h1>
          <p className="mt-1 text-surface-500 dark:text-surface-400">Anmelden bei stashcat.com</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
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
      </div>
    </div>
  );
}
