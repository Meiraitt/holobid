import { Moon, Sun } from 'lucide-react';
import { createContext, type ReactNode, useContext, useEffect, useState } from 'react';

import { Button } from '../components/ui/button';
import { cn } from '../lib/utils';

type Theme = 'dark' | 'light';

const ThemeContext = createContext<{ theme: Theme; setTheme: (theme: Theme) => void } | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return localStorage.getItem('holobid-theme') === 'light' ? 'light' : 'dark';
    } catch {
      return 'dark';
    }
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');

    try {
      localStorage.setItem('holobid-theme', theme);
    } catch {
      /* Theme remains usable without browser storage. */
    }
  }, [theme]);

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function ThemeToggle() {
  const value = useContext(ThemeContext);

  if (!value) {
    throw new Error('ThemeProvider is required.');
  }

  const isDark = value.theme === 'dark';
  const label = isDark ? 'Ativar tema claro' : 'Ativar tema escuro';

  return (
    <Button
      variant="ghost"
      size="icon"
      className="relative overflow-hidden rounded-full border-0 [&_svg]:size-5"
      aria-label={label}
      title={label}
      onClick={() => value.setTheme(isDark ? 'light' : 'dark')}
    >
      <Sun
        aria-hidden="true"
        className={cn(
          'absolute transition-[rotate,scale,opacity] duration-300 ease-out motion-reduce:transition-none',
          isDark ? 'rotate-0 scale-100 opacity-100' : 'rotate-90 scale-50 opacity-0',
        )}
      />
      <Moon
        aria-hidden="true"
        className={cn(
          'absolute transition-[rotate,scale,opacity] duration-300 ease-out motion-reduce:transition-none',
          isDark ? '-rotate-90 scale-50 opacity-0' : 'rotate-0 scale-100 opacity-100',
        )}
      />
    </Button>
  );
}
