import type { AppRuntime, PlatformApi } from './contracts';
import { createRuntimeEnvironment } from './environment';

export function createPlatform(runtime: AppRuntime): PlatformApi {
  return createRuntimeEnvironment(runtime).platform;
}
