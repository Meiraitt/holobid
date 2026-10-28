import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from 'react';

import { RealtimeClient, socketFactory } from '../realtime/realtime-client';
import { apiClient } from '../services';

import { useSessionController } from './auth-provider';

const RealtimeContext = createContext<RealtimeClient | null>(null);

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const cache = useQueryClient();
  const session = useSessionController();
  const [client] = useState(
    () =>
      new RealtimeClient(
        cache,
        session,
        socketFactory(import.meta.env.VITE_SOCKET_URL || apiClient.origin),
      ),
  );

  useEffect(() => client.start(), [client]);

  return <RealtimeContext.Provider value={client}>{children}</RealtimeContext.Provider>;
}

export function useRealtime() {
  const client = useContext(RealtimeContext);

  if (!client) {
    throw new Error('useRealtime requires RealtimeProvider');
  }

  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot);

  return { ...snapshot, client, retry: client.retry };
}

export function useRealtimeRoom(id: string) {
  const realtime = useRealtime();

  useEffect(() => realtime.client.watchAuction(id), [realtime.client, id]);

  const room = realtime.rooms[id] ?? 'joining';

  return { ...realtime, room, ready: realtime.phase === 'ready' && room === 'joined' };
}
