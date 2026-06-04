import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type AppLocale = 'ar' | 'en';

interface LocaleContextValue {
  locale: AppLocale;
  isArabic: boolean;
  setLocale: (locale: AppLocale) => void;
  toggleLocale: () => void;
}

const LOCALE_STORAGE_KEY = 'samawy-ui-locale';
const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<AppLocale>(() => {
    const saved = typeof window !== 'undefined' ? window.localStorage.getItem(LOCALE_STORAGE_KEY) : null;
    const initial: AppLocale = saved === 'en' ? 'en' : 'ar';
    if (typeof window !== 'undefined') {
      document.documentElement.lang = initial;
      document.documentElement.dir = initial === 'ar' ? 'rtl' : 'ltr';
    }
    return initial;
  });

  useEffect(() => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
  }, [locale]);

  const value = useMemo<LocaleContextValue>(() => ({
    locale,
    isArabic: locale === 'ar',
    setLocale: setLocaleState,
    toggleLocale: () => setLocaleState((current) => (current === 'ar' ? 'en' : 'ar')),
  }), [locale]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const context = useContext(LocaleContext);
  if (!context) {
    throw new Error('useLocale must be used within a LocaleProvider');
  }
  return context;
}
