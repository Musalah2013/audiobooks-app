import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { API_BASE } from '../hooks/useApi';

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const resp = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
        credentials: 'include',
      });
      const data = await resp.json() as { error?: string };
      if (!resp.ok) {
        setError(data.error ?? `Error ${resp.status}`);
        return;
      }
      navigate('/', { replace: true });
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[color:var(--shell-bg)] px-4">
      <div className="w-full max-w-sm space-y-6">

        <div className="flex flex-col items-center gap-3">
          <img src="/samawy/assets/logo-primary.png" alt="Samawy" className="h-10 w-auto" />
          <p className="text-sm text-[color:var(--fg-2)]">Audiobook Operations Platform</p>
        </div>

        <form onSubmit={handleSubmit} className="card space-y-4">
          <h1 className="text-xl font-bold text-[color:var(--samawy-ink)]">Sign in</h1>

          {error && (
            <div className="rounded-[10px] bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <label className="block space-y-1.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-[color:var(--fg-2)]">Email</span>
            <input
              type="email"
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@samawy.com"
              autoComplete="email"
              required
              autoFocus
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-[color:var(--fg-2)]">Password</span>
            <input
              type="password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              required
            />
          </label>

          <button type="submit" className="btn-primary w-full justify-center" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
