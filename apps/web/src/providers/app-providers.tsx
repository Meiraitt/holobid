import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { BrowserRouter } from 'react-router-dom';

import { Toaster } from '../components/ui/toast';
import { DemoProvider } from '../demo/demo-provider';
import { queryClient } from '../lib/query-client';

import { AuthProvider, useAuth } from './auth-provider';
import { RealtimeProvider } from './realtime-provider';
import { ThemeProvider } from './theme-provider';

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <RealtimeProvider>
            <SessionDemo>
              <BrowserRouter>
                <Toaster>{children}</Toaster>
              </BrowserRouter>
            </SessionDemo>
          </RealtimeProvider>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

function SessionDemo({ children }: { children: ReactNode }) {
  const { user } = useAuth();

  return (
    <DemoProvider
      user={
        user
          ? {
              email: user.email,
              name: user.email.split('@')[0]!,
              role: user.role === 'AUCTIONEER' ? 'auctioneer' : 'bidder',
            }
          : null
      }
    >
      {children}
    </DemoProvider>
  );
}
