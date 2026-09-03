import type { AppRuntime } from './contracts';

type RuntimeScope = Record<string, unknown>;

export interface DetectRuntimeOptions {
  configuredRuntime?: string;
  scope?: RuntimeScope;
}

export function hasTauriRuntime(scope: RuntimeScope = globalThis as RuntimeScope): boolean {
  return '__TAURI_INTERNALS__' in scope || '__TAURI__' in scope;
}

export function parseConfiguredRuntime(value?: string): Exclude<AppRuntime, 'tauri'> | null {
  const normalized = value?.trim().toLowerCase();
  return normalized === 'web' || normalized === 'mock' ? normalized : null;
}

/**
 * Tauri always wins over build-time configuration. Standard Vite development
 * remains a mock preview until the real web runtime is explicitly enabled.
 */
export function detectAppRuntime(options: DetectRuntimeOptions = {}): AppRuntime {
  const scope = options.scope ?? (globalThis as RuntimeScope);
  if (hasTauriRuntime(scope)) return 'tauri';

  const configured = 'configuredRuntime' in options
    ? options.configuredRuntime
    : import.meta.env.VITE_APP_RUNTIME;

  return parseConfiguredRuntime(configured) ?? 'mock';
}
