import type { AuthBroadcast, AuthBroadcastMessage } from './types';

export const AUTH_BROADCAST_CHANNEL = 'nnpm-auth';

function isAuthBroadcastMessage(value: unknown): value is AuthBroadcastMessage {
  if (typeof value !== 'object' || value === null) return false;
  const type = (value as { type?: unknown }).type;
  return type === 'session-changed' || type === 'logout';
}

export function createAuthBroadcast(
  channelName = AUTH_BROADCAST_CHANNEL
): AuthBroadcast | null {
  if (typeof BroadcastChannel === 'undefined') return null;

  const channel = new BroadcastChannel(channelName);
  return {
    post(message) {
      channel.postMessage(message);
    },
    subscribe(handler) {
      const listener = (event: MessageEvent) => {
        if (isAuthBroadcastMessage(event.data)) handler(event.data);
      };
      channel.addEventListener('message', listener);
      return () => channel.removeEventListener('message', listener);
    },
    close() {
      channel.close();
    },
  };
}

export async function withRefreshLock<T>(run: () => Promise<T>): Promise<T> {
  const locks = globalThis.navigator?.locks;
  if (!locks?.request) return run();
  return locks.request('nnpm-auth-refresh', run);
}
