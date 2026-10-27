import type { SessionCoordinator } from './session-controller';

const storageKey = 'holobid-session-state';

type State = 'active' | 'signed-out';

type Notice = { state: State; nonce: string };

function readNotice(value: string | null): Notice | null {
  try {
    const notice = JSON.parse(value ?? 'null') as Notice | null;

    return notice &&
      ['active', 'signed-out'].includes(notice.state) &&
      typeof notice.nonce === 'string'
      ? notice
      : null;
  } catch {
    return null;
  }
}

export function browserCoordinator(): SessionCoordinator {
  let queue = Promise.resolve();
  let memoryState: State | null = null;
  const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(storageKey);

  return {
    exclusive: async <T>(work: () => Promise<T>): Promise<T> => {
      if (navigator.locks) {
        return await navigator.locks.request('holobid-auth-cookie', work);
      }

      const task = queue.then(work, work);

      queue = task.then(
        () => {},
        () => {},
      );

      return task;
    },
    signedOut: () => {
      try {
        return readNotice(localStorage.getItem(storageKey))?.state === 'signed-out';
      } catch {
        return memoryState === 'signed-out';
      }
    },
    publish: (state) => {
      const notice: Notice = { state, nonce: crypto.randomUUID() };

      memoryState = state;
      try {
        // Only a non-secret logout marker; credentials and JWTs never enter Web Storage.
        localStorage.setItem(storageKey, JSON.stringify(notice));
      } catch {
        // Restricted storage still permits the in-memory session.
      }

      channel?.postMessage(notice);
    },
    subscribe: (listener) => {
      let lastNonce = '';
      const receive = (notice: Notice | null) => {
        if (notice && notice.nonce !== lastNonce) {
          lastNonce = notice.nonce;
          memoryState = notice.state;
          listener(notice.state);
        }
      };

      const storage = (event: StorageEvent) => {
        if (event.key === storageKey) {
          receive(readNotice(event.newValue));
        }
      };

      const broadcast = (event: MessageEvent) => receive(readNotice(JSON.stringify(event.data)));

      window.addEventListener('storage', storage);
      channel?.addEventListener('message', broadcast);

      return () => {
        window.removeEventListener('storage', storage);
        channel?.removeEventListener('message', broadcast);
      };
    },
  };
}
