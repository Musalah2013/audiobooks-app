import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Activity,
  AudioLines,
  BarChart3,
  Building2,
  Database,
  FolderKanban,
  Grid2X2,
  LibraryBig,
  LogOut,
  Menu,
  Settings,
  Sparkles,
  Upload,
  Users,
  X,
} from 'lucide-react';
import { useLocale } from '../hooks/useLocale';

interface LayoutProps {
  children: React.ReactNode;
  user?: { email: string; name?: string | null; permissions?: string[] };
  onLogout?: () => void;
}

export default function Layout({ children, user, onLogout }: LayoutProps) {
  const location = useLocation();
  const { locale, isArabic, toggleLocale } = useLocale();
  const isAdmin = user?.permissions?.includes('users') ?? false;
  const [navOpen, setNavOpen] = useState(false);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => { setNavOpen(false); }, [location.pathname]);

  const navItems = [
    { path: '/', label: isArabic ? 'لوحة التحكم' : 'Dashboard', icon: Grid2X2 },
    { path: '/new-batch', label: isArabic ? 'بدء دفعة' : 'New Batch', icon: Sparkles },
    { path: '/intake', label: isArabic ? 'الاستقبال' : 'Intake', icon: FolderKanban },
    { path: '/metadata', label: isArabic ? 'البيانات' : 'Metadata', icon: Database },
    { path: '/matching', label: isArabic ? 'المطابقة' : 'Matching', icon: LibraryBig },
    { path: '/books', label: isArabic ? 'العناوين' : 'Books', icon: AudioLines },
    { path: '/processing', label: isArabic ? 'المعالجة' : 'Processing', icon: Activity },
    { path: '/artifacts', label: isArabic ? 'التخزين' : 'Storage', icon: FolderKanban },
    { path: '/analytics', label: isArabic ? 'التحليلات' : 'Analytics', icon: BarChart3 },
    { path: '/users', label: isArabic ? 'المستخدمون' : 'Users', icon: Users },
    { path: '/settings', label: isArabic ? 'الإعدادات' : 'Settings', icon: Settings },
    ...(isAdmin ? [
      { path: '/studios', label: isArabic ? 'الاستوديوهات' : 'Studios', icon: Building2 },
      { path: '/legacy-import', label: isArabic ? 'استيراد كتب قديمة' : 'Legacy Books', icon: Upload },
      { path: '/legacy-studios-import', label: isArabic ? 'استيراد استوديوهات' : 'Legacy Studios', icon: Upload },
    ] : []),
  ];

  return (
    <div className={`shell flex min-h-screen ${navOpen ? 'nav-open' : ''}`}>
      {/* Mobile backdrop */}
      {navOpen && <div className="sidebar-backdrop" onClick={() => setNavOpen(false)} aria-hidden />}

      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="flex items-start justify-between gap-2">
            <img src="/samawy/assets/logo-primary.png" alt="Samawy" className="h-10 w-auto" />
            <button
              type="button"
              onClick={() => setNavOpen(false)}
              className="mobile-bar-icon-btn lg:hidden"
              aria-label={isArabic ? 'إغلاق القائمة' : 'Close menu'}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div>
            <p className="sidebar-brand">SAMAWY AUDIOBOOKS OPS</p>
            <p className="sidebar-subtitle">
              {isArabic ? 'منصة إدارة إنتاج الكتب الصوتية' : 'Audiobook Operations Platform'}
            </p>
          </div>
        </div>

        <nav className="sidebar-nav">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive =
              location.pathname === item.path ||
              (item.path !== '/' && location.pathname.startsWith(`${item.path}/`));
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`sidebar-link ${isActive ? 'sidebar-link-active' : ''}`}
              >
                <Icon className="sidebar-icon" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="sidebar-footer space-y-2">
          {user && (
            <div className="rounded-[14px] border border-slate-100 px-3 py-2.5 flex items-center justify-between gap-2">
              <div className="min-w-0">
                {user.name && <p className="text-xs font-semibold text-[color:var(--samawy-ink)] truncate">{user.name}</p>}
                <p className="text-xs text-[color:var(--fg-2)] truncate">{user.email}</p>
              </div>
              {onLogout && (
                <button type="button" onClick={onLogout} title={isArabic ? 'تسجيل الخروج' : 'Sign out'} className="shrink-0 text-[color:var(--fg-2)] hover:text-red-600 transition-colors">
                  <LogOut className="h-4 w-4" />
                </button>
              )}
            </div>
          )}
          <button type="button" className="btn-secondary w-full justify-center" onClick={toggleLocale}>
            {locale === 'ar' ? 'EN' : 'AR'}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile bar */}
        <div className="mobile-bar">
          <button
            type="button"
            onClick={() => setNavOpen(true)}
            className="mobile-bar-icon-btn"
            aria-label={isArabic ? 'فتح القائمة' : 'Open menu'}
          >
            <Menu className="h-5 w-5" />
          </button>
          <img src="/samawy/assets/logo-primary.png" alt="Samawy" className="h-7 w-auto" />
          <button type="button" className="mobile-bar-icon-btn text-xs font-semibold px-2.5" onClick={toggleLocale}>
            {locale === 'ar' ? 'EN' : 'AR'}
          </button>
        </div>

        <header className="topbar">
          <div className="rounded-full bg-[rgba(11,128,255,0.08)] px-4 py-2 text-sm font-medium text-sky-700">
            {isArabic ? 'النظام المرجعي لعناوين سماوي ودفاتر التسليم' : 'Source of truth for Samawy audiobooks and delivery dossiers'}
          </div>
        </header>
        <main className="main-content">
          {children}
        </main>
      </div>
    </div>
  );
}
