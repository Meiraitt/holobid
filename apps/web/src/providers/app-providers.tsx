import type { ReactNode } from 'react';
import { BrowserRouter } from 'react-router-dom';

import { Toaster } from '../components/ui/toast';
import { DemoProvider } from '../demo/demo-provider';

import { ThemeProvider } from './theme-provider';

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <DemoProvider>
        <BrowserRouter>
          <Toaster>{children}</Toaster>
        </BrowserRouter>
      </DemoProvider>
    </ThemeProvider>
  );
}
