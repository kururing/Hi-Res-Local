import { isAuthNetworkError, isUnauthorizedError } from './mapper';
import { createAuthBroadcast, withRefreshLock } from './broadcast';
import type {
  AccountApi,
  AuthBroadcast,
  AuthSessionResult,
  AuthSnapshot,
  AuthStatus,
  AuthUser,
  LoginRequest,
  RegisterRequest,
  UpdateProfileRequest,
} from './types';

export interface AuthSessionControllerOptions {
  account: AccountApi | null;
  enabled?: boolean;
  broadcast?: AuthBroadcast | null;
  now?: () => number;
}

type Listener = () => void;

const REFRESH_SKEW_MS = 60_000;
const MIN_REFRESH_DELAY_MS = 1_000;

export class AuthSessionController {
  private readonly account: AccountApi | null;
  private readonly enabled: boolean;
  private readonly now: () => number;
  private readonly listeners = new Set<Listener>();
  private broadcast: AuthBroadcast | null;
  private unsubscribeBroadcast: (() => void) | null = null;
  private accessToken: string | null = null;
  private expiresAt = 0;
  private user: AuthUser | null = null;
  private status: AuthStatus;
  private refreshPromise: Promise<AuthSessionResult> | null = null;
  private bootstrapPromise: Promise<void> | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  constructor(options: AuthSessionControllerOptions) {
    this.account = options.account;
    this.enabled = options.enabled ?? options.account != null;
    this.now = options.now ?? Date.now;
    this.broadcast = options.broadcast === undefined
      ? createAuthBroadcast()
      : options.broadcast;
    this.status = this.enabled ? 'bootstrapping' : 'anonymous';
    this.unsubscribeBroadcast = this.broadcast?.subscribe((message) => {
      void this.onBroadcast(message);
    }) ?? null;
  }

  getSnapshot(): AuthSnapshot {
    return { status: this.status, user: this.user };
  }

  getAccessToken(): string | null {
    return this.accessToken;
  }

  getExpiresAt(): number {
    return this.expiresAt;
  }

  subscribe(listener: Listener): () => void {
    if (this.destroyed) return () => undefined;
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async bootstrap(): Promise<void> {
    if (this.destroyed) return;
    if (!this.enabled || !this.account) {
      this.setStatus('anonymous');
      return;
    }
    if (this.bootstrapPromise) return this.bootstrapPromise;
    this.bootstrapPromise = this.runBootstrap();
    return this.bootstrapPromise;
  }

  async retryBootstrap(): Promise<void> {
    if (this.destroyed) return;
    this.bootstrapPromise = null;
    if (this.enabled) this.setStatus('bootstrapping');
    await this.bootstrap();
  }

  async login(request: LoginRequest): Promise<void> {
    const result = await this.requireAccount().login(request);
    this.applySession(result);
    this.broadcast?.post({ type: 'session-changed' });
  }

  async register(request: RegisterRequest): Promise<void> {
    const result = await this.requireAccount().register(request);
    this.applySession(result);
    this.broadcast?.post({ type: 'session-changed' });
  }

  async refresh(): Promise<AuthSessionResult> {
    this.requireAccount();
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.runRefresh().finally(() => {
      this.refreshPromise = null;
    });
    return this.refreshPromise;
  }

  async handleUnauthorized(): Promise<boolean> {
    if (this.destroyed || !this.enabled || !this.account) return false;
    try {
      await this.refresh();
      return this.accessToken != null && this.status === 'authenticated';
    } catch {
      return false;
    }
  }

  async logout(): Promise<void> {
    this.clearSession();
    this.broadcast?.post({ type: 'logout' });
    if (!this.account) return;
    try {
      await this.account.logout();
    } catch {
      // Memory is already cleared even if the server request fails.
    }
  }

  async updateProfile(request: UpdateProfileRequest): Promise<AuthUser> {
    const account = this.requireAccount();
    const previous = this.user;
    const nextName = request.displayName?.trim();
    if (nextName && this.user) {
      this.setUser({ ...this.user, displayName: nextName });
    }
    try {
      const user = await account.updateProfile(request);
      this.setUser(user);
      return user;
    } catch (error) {
      this.setUser(previous);
      throw error;
    }
  }

  clearSession(): void {
    this.clearRefreshTimer();
    this.accessToken = null;
    this.expiresAt = 0;
    this.user = null;
    this.setStatus('anonymous');
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.clearRefreshTimer();
    this.listeners.clear();
    this.unsubscribeBroadcast?.();
    this.unsubscribeBroadcast = null;
    this.broadcast?.close();
    this.broadcast = null;
    this.accessToken = null;
    this.expiresAt = 0;
    this.user = null;
    this.refreshPromise = null;
    this.bootstrapPromise = null;
  }

  private async runBootstrap(): Promise<void> {
    this.setStatus('bootstrapping');
    try {
      const result = await this.refresh();
      this.applySession(result);
    } catch (error) {
      if (isUnauthorizedError(error)) {
        this.clearSession();
        return;
      }
      if (isAuthNetworkError(error)) {
        this.clearRefreshTimer();
        this.accessToken = null;
        this.expiresAt = 0;
        this.setStatus('offline');
        return;
      }
      this.clearRefreshTimer();
      this.accessToken = null;
      this.expiresAt = 0;
      this.setStatus('offline');
    }
  }

  private async runRefresh(): Promise<AuthSessionResult> {
    const account = this.requireAccount();
    try {
      const result = await withRefreshLock(() => account.refresh());
      this.applySession(result);
      return result;
    } catch (error) {
      if (isUnauthorizedError(error)) {
        this.clearSession();
      }
      throw error;
    }
  }

  private async onBroadcast(message: { type: 'session-changed' | 'logout' }): Promise<void> {
    if (this.destroyed || !this.enabled) return;
    if (message.type === 'logout') {
      this.clearSession();
      return;
    }
    if (this.status === 'authenticated') return;
    try {
      await this.refresh();
    } catch {
      // Stay anonymous/offline; the user can retry from this tab.
    }
  }

  private applySession(result: AuthSessionResult): void {
    this.accessToken = result.accessToken;
    this.expiresAt = this.now() + result.expiresIn * 1000;
    this.user = result.user;
    this.setStatus('authenticated');
    this.scheduleProactiveRefresh();
  }

  private scheduleProactiveRefresh(): void {
    this.clearRefreshTimer();
    if (this.destroyed || !this.enabled || !this.accessToken || this.expiresAt <= 0) return;
    const remaining = this.expiresAt - this.now();
    if (remaining <= 0) return;
    const delay = Math.max(MIN_REFRESH_DELAY_MS, remaining - REFRESH_SKEW_MS);
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      void this.refresh().catch(() => undefined);
    }, delay);
  }

  private clearRefreshTimer(): void {
    if (this.refreshTimer == null) return;
    clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
  }

  private setUser(user: AuthUser | null): void {
    this.user = user;
    this.notify();
  }

  private setStatus(status: AuthStatus): void {
    this.status = status;
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  private requireAccount(): AccountApi {
    if (!this.enabled || !this.account) {
      throw new Error('Account is not available in this runtime.');
    }
    return this.account;
  }
}
