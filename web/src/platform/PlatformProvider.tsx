import React, { createContext, useContext, useMemo } from 'react';
import type { PlatformApi } from './contracts';
import {
  getOrCreateDefaultRuntimeEnvironment,
  type RuntimeEnvironment,
} from './environment';
import { AuthSessionController } from '../auth/AuthSessionController';

const PlatformContext = createContext<PlatformApi | null>(null);
const RuntimeEnvironmentContext = createContext<RuntimeEnvironment | null>(null);

export interface PlatformProviderProps {
  children: React.ReactNode;
  platform?: PlatformApi;
  environment?: RuntimeEnvironment;
}

export const PlatformProvider: React.FC<PlatformProviderProps> = ({
  children,
  platform,
  environment,
}) => {
  const value = useMemo<RuntimeEnvironment>(() => {
    if (environment) return environment;
    if (platform) {
      return {
        platform,
        authSession: new AuthSessionController({
          account: platform.account,
          enabled: platform.capabilities.account,
        }),
      };
    }
    return getOrCreateDefaultRuntimeEnvironment();
  }, [environment, platform]);

  return (
    <RuntimeEnvironmentContext.Provider value={value}>
      <PlatformContext.Provider value={value.platform}>
        {children}
      </PlatformContext.Provider>
    </RuntimeEnvironmentContext.Provider>
  );
};

export function usePlatform(): PlatformApi {
  const platform = useContext(PlatformContext);
  if (!platform) {
    throw new Error('usePlatform must be used within PlatformProvider.');
  }
  return platform;
}

export function useRuntimeEnvironment(): RuntimeEnvironment {
  const environment = useContext(RuntimeEnvironmentContext);
  if (!environment) {
    throw new Error('useRuntimeEnvironment must be used within PlatformProvider.');
  }
  return environment;
}

export function useAuthSessionController(): AuthSessionController {
  return useRuntimeEnvironment().authSession;
}
