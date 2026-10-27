import { createContext, type ReactNode, useContext, useEffect, useSyncExternalStore } from 'react';

import { browserCoordinator } from '../auth/browser-coordinator';
import { SessionController } from '../auth/session-controller';
import { clearPrivateQueries, queryClient } from '../lib/query-client';
import { apiClient, authApi } from '../services';

const session = new SessionController(authApi, browserCoordinator(), () =>
  clearPrivateQueries(queryClient),
);
const AuthContext = createContext<SessionController | null>(null);

apiClient.bindSession(session);

export function AuthProvider({ children }: { children: ReactNode }) {
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);

  useEffect(() => {
    const disconnect = session.connect();

    void session.restore();

    return disconnect;
  }, []);

  useEffect(() => {
    if (snapshot.status !== 'authenticated') {
      return;
    }

    const renew = () => {
      if (Date.now() >= snapshot.expiresAt - 30_000) {
        void session.refresh(session.token()).catch(() => {});
      }
    };

    const timer = window.setTimeout(renew, Math.max(0, snapshot.expiresAt - Date.now() - 30_000));

    window.addEventListener('focus', renew);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('focus', renew);
    };
  }, [snapshot]);

  return <AuthContext.Provider value={session}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const controller = useContext(AuthContext);

  if (!controller) {
    throw new Error('useAuth requires AuthProvider');
  }

  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);

  return {
    ...snapshot,
    signIn: controller.signIn,
    logout: controller.logout,
    restore: controller.restore,
  };
}
