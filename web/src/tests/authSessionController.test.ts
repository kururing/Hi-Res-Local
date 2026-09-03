import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthSessionController } from '../auth/AuthSessionController';
import { CloudApiError } from '../api/client';
import { createFakeAccount, recordLocalStorage, SAMPLE_SESSION } from './support/auth';

describe('AuthSessionController', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('bootstraps from refresh into an in-memory session', async () => {
    const storage = recordLocalStorage();
    const account = createFakeAccount();
    const session = new AuthSessionController({ account, broadcast: null });
    await session.bootstrap();
    expect(session.getSnapshot()).toEqual({
      status: 'authenticated',
      user: SAMPLE_SESSION.user,
    });
    expect(session.getAccessToken()).toBe('access-token-memory-only');
    expect(account.calls).toEqual(['refresh']);
    expect(storage.setItem).not.toHaveBeenCalled();
    session.destroy();
  });

  it('treats bootstrap 401 as anonymous', async () => {
    const account = createFakeAccount({
      refresh: async () => {
        throw new CloudApiError('Refresh token invalid.', 401, {
          code: 'AUTH_REFRESH_INVALID',
          message: 'Refresh token invalid.',
          request_id: 'r1',
        }, 'AUTH_REFRESH_INVALID');
      },
    });
    const session = new AuthSessionController({ account, broadcast: null });
    await session.bootstrap();
    expect(session.getSnapshot().status).toBe('anonymous');
    expect(session.getAccessToken()).toBeNull();
    session.destroy();
  });

  it('treats bootstrap network errors as offline and can retry', async () => {
    let shouldFail = true;
    const account = createFakeAccount({
      refresh: async () => {
        if (shouldFail) throw new TypeError('Failed to fetch');
        return SAMPLE_SESSION;
      },
    });
    const session = new AuthSessionController({ account, broadcast: null });
    await session.bootstrap();
    expect(session.getSnapshot().status).toBe('offline');
    expect(session.getAccessToken()).toBeNull();

    shouldFail = false;
    await session.retryBootstrap();
    expect(session.getSnapshot().status).toBe('authenticated');
    expect(session.getAccessToken()).toBe('access-token-memory-only');
    session.destroy();
  });

  it('keeps access tokens in memory only', async () => {
    const storage = recordLocalStorage();
    const account = createFakeAccount();
    const session = new AuthSessionController({ account, broadcast: null });
    await session.login({ email: 'bang@example.com', password: 'correct-horse' });
    expect(session.getAccessToken()).toBe('access-token-memory-only');
    expect(JSON.stringify(storage.setItem.mock.calls)).not.toMatch(/access-token-memory-only/);
    expect(storage.setItem).not.toHaveBeenCalled();
    session.destroy();
  });

  it('clears memory on logout even when the server request fails', async () => {
    const account = createFakeAccount({
      logout: async () => {
        throw new TypeError('Failed to fetch');
      },
    });
    const session = new AuthSessionController({ account, broadcast: null });
    await session.login({ email: 'bang@example.com', password: 'correct-horse' });
    await session.logout();
    expect(session.getAccessToken()).toBeNull();
    expect(session.getSnapshot()).toEqual({ status: 'anonymous', user: null });
    session.destroy();
  });

  it('shares one refresh across Strict Mode double bootstrap', async () => {
    let started = 0;
    let finish!: (value: typeof SAMPLE_SESSION) => void;
    const pending = new Promise<typeof SAMPLE_SESSION>(resolve => {
      finish = resolve;
    });
    const account = createFakeAccount({
      refresh: async () => {
        started += 1;
        return pending;
      },
    });
    const session = new AuthSessionController({ account, broadcast: null });
    const first = session.bootstrap();
    const second = session.bootstrap();
    expect(started).toBe(1);
    finish(SAMPLE_SESSION);
    await Promise.all([first, second]);
    expect(started).toBe(1);
    session.destroy();
  });

  it('cleans up listeners and is idempotent', () => {
    const session = new AuthSessionController({
      account: createFakeAccount(),
      broadcast: null,
    });
    let notifications = 0;
    const unsubscribe = session.subscribe(() => {
      notifications += 1;
    });
    unsubscribe();
    unsubscribe();
    session.destroy();
    session.destroy();
    expect(notifications).toBe(0);
  });

  it('clears the session when a later refresh is unauthorized', async () => {
    let refreshCount = 0;
    const account = createFakeAccount({
      refresh: async () => {
        refreshCount += 1;
        if (refreshCount === 1) return SAMPLE_SESSION;
        throw new CloudApiError('Refresh token invalid.', 401, {
          code: 'AUTH_REFRESH_INVALID',
          message: 'Refresh token invalid.',
          request_id: 'r3',
        }, 'AUTH_REFRESH_INVALID');
      },
    });
    const session = new AuthSessionController({ account, broadcast: null });
    await session.bootstrap();
    expect(await session.handleUnauthorized()).toBe(false);
    expect(session.getSnapshot().status).toBe('anonymous');
    expect(session.getAccessToken()).toBeNull();
    session.destroy();
  });

  it('refreshes about 60 seconds before the access token expires', async () => {
    vi.useFakeTimers();
    const account = createFakeAccount();
    const session = new AuthSessionController({ account, broadcast: null });
    await session.login({ email: 'bang@example.com', password: 'correct-horse' });
    expect(account.calls.filter(call => call === 'refresh')).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(839_000);
    expect(account.calls.filter(call => call === 'refresh')).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(account.calls.filter(call => call === 'refresh')).toHaveLength(1);
    session.destroy();
  });

  it('cancels the proactive refresh timer on logout and destroy', async () => {
    vi.useFakeTimers();
    const account = createFakeAccount();
    const session = new AuthSessionController({ account, broadcast: null });
    await session.login({ email: 'bang@example.com', password: 'correct-horse' });
    await session.logout();
    await vi.advanceTimersByTimeAsync(900_000);
    expect(account.calls.filter(call => call === 'refresh')).toHaveLength(0);

    await session.login({ email: 'bang@example.com', password: 'correct-horse' });
    session.destroy();
    await vi.advanceTimersByTimeAsync(900_000);
    expect(account.calls.filter(call => call === 'refresh')).toHaveLength(0);
  });

  it('rolls back an optimistic profile update', async () => {
    const account = createFakeAccount({
      updateProfile: async () => {
        throw new CloudApiError('Request validation failed.', 400, {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed.',
          request_id: 'r2',
        }, 'VALIDATION_ERROR');
      },
    });
    const session = new AuthSessionController({ account, broadcast: null });
    await session.login({ email: 'bang@example.com', password: 'correct-horse' });
    await expect(session.updateProfile({ displayName: 'Other' })).rejects.toBeInstanceOf(CloudApiError);
    expect(session.getSnapshot().user?.displayName).toBe('Bang');
    session.destroy();
  });
});
