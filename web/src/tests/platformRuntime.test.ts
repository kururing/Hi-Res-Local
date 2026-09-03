import { describe, expect, it } from 'vitest';
import {
  detectAppRuntime,
  hasTauriRuntime,
  parseConfiguredRuntime,
} from '../platform/runtime';

describe('platform runtime detection', () => {
  it('detects both supported Tauri markers', () => {
    expect(hasTauriRuntime({ __TAURI_INTERNALS__: {} })).toBe(true);
    expect(hasTauriRuntime({ __TAURI__: {} })).toBe(true);
    expect(hasTauriRuntime({})).toBe(false);
  });

  it('accepts only explicit browser runtimes', () => {
    expect(parseConfiguredRuntime('web')).toBe('web');
    expect(parseConfiguredRuntime(' MOCK ')).toBe('mock');
    expect(parseConfiguredRuntime('tauri')).toBeNull();
    expect(parseConfiguredRuntime('unknown')).toBeNull();
  });

  it('lets Tauri override build-time configuration', () => {
    expect(detectAppRuntime({
      configuredRuntime: 'web',
      scope: { __TAURI_INTERNALS__: {} },
    })).toBe('tauri');
  });

  it('keeps ordinary Vite development in mock mode by default', () => {
    expect(detectAppRuntime({ configuredRuntime: undefined, scope: {} })).toBe('mock');
    expect(detectAppRuntime({ configuredRuntime: 'web', scope: {} })).toBe('web');
  });
});
