import { vi } from 'vitest';
import type { AccountApi, AuthSessionResult, AuthUser, UpdateProfileRequest } from '../../auth/types';

export const SAMPLE_USER: AuthUser = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'bang@example.com',
  displayName: 'Bang',
  createdAt: '2026-01-01T00:00:00.000Z',
};

export const SAMPLE_SESSION: AuthSessionResult = {
  accessToken: 'access-token-memory-only',
  expiresIn: 900,
  user: SAMPLE_USER,
};

export function createFakeAccount(overrides: Partial<AccountApi> = {}): AccountApi & { calls: string[] } {
  const calls: string[] = [];
  let user: AuthUser = { ...SAMPLE_USER };
  const api: AccountApi & { calls: string[] } = {
    calls,
    async register() {
      calls.push('register');
      return { ...SAMPLE_SESSION, user };
    },
    async login() {
      calls.push('login');
      return { ...SAMPLE_SESSION, user };
    },
    async refresh() {
      calls.push('refresh');
      return { ...SAMPLE_SESSION, user };
    },
    async logout() {
      calls.push('logout');
    },
    async getProfile() {
      calls.push('getProfile');
      return user;
    },
    async updateProfile(request: UpdateProfileRequest) {
      calls.push('updateProfile');
      user = { ...user, displayName: request.displayName?.trim() || user.displayName };
      return user;
    },
    ...overrides,
  };
  return api;
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export const recordLocalStorage = () => {
  const setItem = vi.fn();
  const getItem = vi.fn(() => null);
  const removeItem = vi.fn();
  const clear = vi.fn();
  vi.stubGlobal('localStorage', { getItem, setItem, removeItem, clear });
  vi.stubGlobal('sessionStorage', { getItem, setItem, removeItem, clear });
  return { setItem, getItem, removeItem, clear };
};
