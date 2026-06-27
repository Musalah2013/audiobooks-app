import { type FC, useEffect, useState, lazy, Suspense } from 'react';
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import Layout from './components/Layout';
import { API_BASE } from './hooks/useApi';

// Lazy-loaded route pages
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Batches = lazy(() => import('./pages/Batches'));
const BatchDetail = lazy(() => import('./pages/BatchDetail'));
const Books = lazy(() => import('./pages/Books'));
const BookDetail = lazy(() => import('./pages/BookDetail'));
const Processing = lazy(() => import('./pages/Processing'));
const ProcessingLogs = lazy(() => import('./pages/ProcessingLogs'));
const Artifacts = lazy(() => import('./pages/Artifacts'));
const Analytics = lazy(() => import('./pages/Analytics'));
const Settings = lazy(() => import('./pages/Settings'));
const UsersPage = lazy(() => import('./pages/Users'));
const Studios = lazy(() => import('./pages/Studios'));
const LegacyImport = lazy(() => import('./pages/LegacyImport'));
const StudioManage = lazy(() => import('./pages/StudioManage'));
const StudioPortal = lazy(() => import('./pages/StudioPortal'));
const AcquisitionPortal = lazy(() => import('./pages/AcquisitionPortal'));
const Login = lazy(() => import('./pages/Login'));

interface AuthUser { email: string; name?: string | null; permissions: string[] }

function ProtectedApp({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  return (
    <Layout user={user} onLogout={onLogout}>
      <Suspense fallback={<div className="flex items-center justify-center h-screen"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-sky-600"></div></div>}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/batches" element={<Batches />} />
          <Route path="/new-batch" element={<Batches />} />
          <Route path="/intake" element={<Batches />} />
          <Route path="/metadata" element={<Batches />} />
          <Route path="/matching" element={<Batches />} />
          <Route path="/batches/:id" element={<BatchDetail />} />
          <Route path="/books" element={<Books />} />
          <Route path="/books/:id" element={<BookDetail />} />
          <Route path="/legacy-import" element={<LegacyImport />} />
          <Route path="/processing" element={<Processing />} />
          <Route path="/processing/logs" element={<ProcessingLogs />} />
          <Route path="/artifacts" element={<Artifacts />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/users" element={<UsersPage />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/studios" element={<Studios />} />
          <Route path="/studios/:id" element={<StudioManage />} />
        </Routes>
      </Suspense>
    </Layout>
  );
}

const App: FC = () => {
  const [user, setUser] = useState<AuthUser | null | 'loading'>('loading');
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    // Skip auth check for public portal routes and studio auth endpoints
    if (location.pathname.startsWith('/studio/') ||
        location.pathname.startsWith('/api/studio-auth/') ||
        location.pathname === '/acquisition' ||
        location.pathname === '/login') {
      setUser(null);
      return;
    }
    fetch(`${API_BASE}/api/auth/me`, { credentials: 'include', cache: 'no-store' })
      .then((r) => r.json() as Promise<{ user: AuthUser | null }>)
      .then(({ user: u }) => {
        if (u) { setUser(u); }
        else { setUser(null); navigate('/login', { replace: true }); }
      })
      .catch(() => { setUser(null); navigate('/login', { replace: true }); });
  }, [location.pathname]);

  async function handleLogout() {
    await fetch(`${API_BASE}/api/auth/logout`, { method: 'POST', credentials: 'include' });
    setUser(null);
    navigate('/login', { replace: true });
  }

  // Magic link verify — force full page load so Worker handles it
  // Browsers ignore location.href = same-url, so we add a cache-busting param
  if (location.pathname.startsWith('/api/studio-auth/verify')) {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('_r')) {
      url.searchParams.set('_r', Date.now().toString());
      window.location.replace(url.toString());
    }
    return <div className="min-h-screen flex items-center justify-center text-sm text-slate-500">جاري التحقق…</div>;
  }

  // Public portal routes — no admin auth needed
  if (location.pathname.startsWith('/studio/')) return <Routes><Route path="/studio/:slug" element={<StudioPortal />} /></Routes>;
  if (location.pathname === '/acquisition') return <Routes><Route path="/acquisition" element={<AcquisitionPortal />} /></Routes>;
  if (location.pathname === '/login') return <Routes><Route path="/login" element={<Login />} /></Routes>;
  if (user === 'loading') return <div className="min-h-screen flex items-center justify-center text-sm text-[color:var(--fg-2)]">Loading…</div>;
  if (!user) return null;

  return <ProtectedApp user={user} onLogout={handleLogout} />;
};

export default App;
