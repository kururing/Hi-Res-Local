import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { PlatformCommandGateway } from '../platform/contracts';
import { createMockPlatform } from '../platform/mock/MockPlatform';
import { MockPresenceApi } from '../platform/mock/MockPresenceApi';
import { TauriPresenceApi } from '../platform/presence/IpcPresenceApi';
import { createTauriPlatform } from '../platform/tauri/TauriPlatform';
import { createWebPlatform } from '../platform/web/WebPlatform';
import { WebPresenceApi } from '../platform/web/WebPresenceApi';

function createGateway() {
  const invoke = vi.fn<(command: string, args?: unknown) => Promise<unknown>>();
  const listen = vi.fn<(event: string, callback: (...args: unknown[]) => void) => Promise<() => void>>();
  const commands = { invoke, listen } as unknown as PlatformCommandGateway;
  return { invoke, listen, commands };
}

function source(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), 'utf8');
}

describe('TauriPresenceApi', () => {
  it('invokes set_discord_presence with the activity payload', async () => {
    const { invoke, commands } = createGateway();
    const api = new TauriPresenceApi(commands);
    const activity = {
      title: 'Light',
      artist: 'Wanna One',
      artwork_url: 'https://example.test/cover.jpg',
      position_secs: 12,
      duration_secs: 183,
    };

    invoke.mockResolvedValueOnce(undefined);
    await api.setDiscordPresence(true, activity);
    expect(invoke).toHaveBeenLastCalledWith('set_discord_presence', {
      enabled: true,
      activity,
    });

    invoke.mockResolvedValueOnce(undefined);
    await api.setDiscordPresence(false, null);
    expect(invoke).toHaveBeenLastCalledWith('set_discord_presence', {
      enabled: false,
      activity: null,
    });
  });
});

describe('platform wiring', () => {
  it('enables Discord presence only on Tauri', () => {
    const tauri = createTauriPlatform();
    const mock = createMockPlatform();
    const web = createWebPlatform('/api');

    expect(tauri.presence).toBeInstanceOf(TauriPresenceApi);
    expect(mock.presence).toBeInstanceOf(MockPresenceApi);
    expect(web.presence).toBeInstanceOf(WebPresenceApi);
    expect(tauri.capabilities.discordPresence).toBe(true);
    expect(mock.capabilities.discordPresence).toBe(false);
    expect(web.capabilities.discordPresence).toBe(false);
  });
});

describe('WebPresenceApi', () => {
  it('is a safe no-op when Discord is unavailable', async () => {
    const api = new WebPresenceApi();
    await expect(api.setDiscordPresence(true, {
      title: 'Light',
      artist: 'Wanna One',
      position_secs: 0,
      duration_secs: 183,
    })).resolves.toBeUndefined();
    await expect(api.setDiscordPresence(false, null)).resolves.toBeUndefined();
  });
});

describe('presence consumers', () => {
  it('does not fetch Discord artwork unless the capability is enabled', () => {
    const player = source('../context/PlayerContext.tsx');
    const capabilityGuard = player.indexOf('if (!capabilities.discordPresence)');
    const artworkCall = player.indexOf('await getArtworkUrlForDiscord');

    expect(capabilityGuard).toBeGreaterThan(-1);
    expect(artworkCall).toBeGreaterThan(capabilityGuard);
    expect(player).toMatch(/presence\.setDiscordPresence/);
    expect(player).not.toMatch(/IpcService/);
  });

  it('disables the Discord setting when the capability is false', () => {
    const settings = source('../components/views/SettingsView.tsx');
    expect(settings).toMatch(/canUseDiscordPresence/);
    expect(settings).toMatch(/disabled=\{!canUseDiscordPresence\}/);
  });
});
