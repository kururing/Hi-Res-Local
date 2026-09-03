import { CloudApiClient } from '../api/client';
import { AuthSessionController } from '../auth/AuthSessionController';
import type { AccountApi } from '../auth/types';
import type { AppRuntime, PlatformApi } from './contracts';
import { createMockPlatform } from './mock/MockPlatform';
import { detectAppRuntime } from './runtime';
import { createTauriPlatform } from './tauri/TauriPlatform';
import { WebAccountApi } from './web/WebAccountApi';
import { createWebPlatform } from './web/WebPlatform';

export interface RuntimeEnvironment {
  platform: PlatformApi;
  authSession: AuthSessionController;
}

export interface CreateRuntimeEnvironmentOptions {
  cloudApiUrl?: string;
}

interface CloudAccessors {
  getAccessToken: () => string | null;
  onUnauthorized: () => Promise<boolean>;
  isAuthenticated: () => boolean;
}

function resolveCloudApiUrl(explicit?: string): string {
  return explicit?.trim() || import.meta.env.VITE_CLOUD_API_URL?.trim() || '/api';
}

function createCloudAccessors(): CloudAccessors {
  return {
    getAccessToken: () => null,
    onUnauthorized: async () => false,
    isAuthenticated: () => false,
  };
}

function bindSessionAccessors(accessors: CloudAccessors, authSession: AuthSessionController): void {
  accessors.getAccessToken = () => authSession.getAccessToken();
  accessors.onUnauthorized = () => authSession.handleUnauthorized();
  accessors.isAuthenticated = () => authSession.getSnapshot().status === 'authenticated';
}

export function createWebRuntimeEnvironment(baseUrl?: string): RuntimeEnvironment {
  const url = resolveCloudApiUrl(baseUrl);
  const accessors = createCloudAccessors();

  const cloud = new CloudApiClient({
    baseUrl: url,
    getAccessToken: () => accessors.getAccessToken(),
    onUnauthorized: () => accessors.onUnauthorized(),
  });
  const account: AccountApi = new WebAccountApi(cloud);
  const authSession = new AuthSessionController({
    account,
    enabled: true,
  });

  bindSessionAccessors(accessors, authSession);

  return {
    platform: createWebPlatform(url, cloud, account),
    authSession,
  };
}

export function createTauriRuntimeEnvironment(baseUrl?: string): RuntimeEnvironment {
  const url = resolveCloudApiUrl(baseUrl);
  const accessors = createCloudAccessors();

  const cloud = new CloudApiClient({
    baseUrl: url,
    getAccessToken: () => accessors.getAccessToken(),
    onUnauthorized: () => accessors.onUnauthorized(),
  });
  const account: AccountApi = new WebAccountApi(cloud);
  const authSession = new AuthSessionController({
    account,
    enabled: true,
  });

  bindSessionAccessors(accessors, authSession);

  return {
    platform: createTauriPlatform({
      cloud,
      account,
      isAuthenticated: () => accessors.isAuthenticated(),
    }),
    authSession,
  };
}

export function createRuntimeEnvironment(
  runtime: AppRuntime,
  options: CreateRuntimeEnvironmentOptions = {}
): RuntimeEnvironment {
  switch (runtime) {
    case 'tauri':
      return createTauriRuntimeEnvironment(options.cloudApiUrl);
    case 'web':
      return createWebRuntimeEnvironment(options.cloudApiUrl);
    case 'mock':
      return {
        platform: createMockPlatform(),
        authSession: new AuthSessionController({ account: null, enabled: false }),
      };
  }
}

let defaultEnvironment: RuntimeEnvironment | undefined;

export function getOrCreateDefaultRuntimeEnvironment(): RuntimeEnvironment {
  defaultEnvironment ??= createRuntimeEnvironment(detectAppRuntime());
  return defaultEnvironment;
}

export function resetDefaultRuntimeEnvironment(): void {
  defaultEnvironment?.authSession.destroy();
  defaultEnvironment = undefined;
}
