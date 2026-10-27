import { createContext, type ReactNode, useContext, useEffect, useState } from 'react';

type Theme = 'dark' | 'light' | 'system';

const ThemeContext = createContext<{ theme: Theme; setTheme: (theme: Theme) => void } | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const saved = localStorage.getItem('holobid-theme');

      return saved === 'dark' || saved === 'light' ? saved : 'system';
    } catch {
      return 'system';
    }
  });

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () =>
      document.documentElement.classList.toggle(
        'dark',
        theme === 'dark' || (theme === 'system' && media.matches),
      );

    apply();
    media.addEventListener('change', apply);
    try {
      localStorage.setItem('holobid-theme', theme);
    } catch {
      /* Theme remains usable without browser storage. */
    }

    return () => media.removeEventListener('change', apply);
  }, [theme]);

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function ThemeSelect() {
  const value = useContext(ThemeContext);

  if (!value) {
    throw new Error('ThemeProvider is required.');
  }

  return (
    <label className="flex items-center">
      <span className="sr-only">Tema</span>
      <select
        aria-label="Tema"
        className="min-h-11 rounded-sm border border-input bg-background px-2 text-sm"
        value={value.theme}
        onChange={(event) => value.setTheme(event.target.value as Theme)}
      >
        <option value="dark">Escuro</option>
        <option value="light">Claro</option>
        <option value="system">Sistema</option>
      </select>
    </label>
  );
}
