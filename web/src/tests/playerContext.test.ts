import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BrowserAudioEngine } from '../audio/BrowserAudioEngine';
import { MockAudioEngine } from '../audio/MockAudioEngine';
import { TauriAudioEngine } from '../audio/TauriAudioEngine';
import { createMockPlatform } from '../platform/mock/MockPlatform';
import { createTauriPlatform } from '../platform/tauri/TauriPlatform';
import { createWebPlatform } from '../platform/web/WebPlatform';

function source(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), 'utf8');
}

describe('PlayerContext engine migration', () => {
  it('does not import IpcService or isTauri', () => {
    const player = source('../context/PlayerContext.tsx');
    expect(player).not.toMatch(/IpcService/);
    expect(player).not.toMatch(/isTauri/);
    expect(player).not.toMatch(/useBackendQueue/);
    expect(player).not.toMatch(/runtime === 'web'/);
    expect(player).not.toMatch(/CloudApiClient/);
  });

  it('uses platform audioEngine, presence, and declared queue ownership', () => {
    const player = source('../context/PlayerContext.tsx');
    expect(player).toMatch(/audioEngine\.queueOwnership === 'engine'/);
    expect(player).toMatch(/audioEngine\.subscribe\(/);
    expect(player).toMatch(/presence\.setDiscordPresence/);
    expect(player).toMatch(/audioEngine\.getSavedPlaybackState\(/);
    expect(player).toMatch(/audioEngine\.playQueue\(/);
    expect(player).toMatch(/audioEngine\.playTrack\(/);
    expect(player).not.toMatch(/audioEngine\.next\(/);
    expect(player).not.toMatch(/audioEngine\.previous\(/);
    expect(player).toMatch(/Manual navigation is resolved in the UI/);
    expect(player).toMatch(/audioEngine\.replaceQueue\(/);
    expect(player).toMatch(/shouldIgnoreEarlyResumePosition/);
    expect(player).toMatch(/beginHistorySession/);
    expect(player).toMatch(/sameTrackIdentity/);
    expect(player).not.toMatch(/track\.path === nativeTrack\.path/);
    expect(player).toMatch(/current\?\.trackId === track\.id && !current\.finalized/);
    expect(player).toMatch(/lastAutoAdvanceRef/);
    expect(player).toMatch(/disposed = true/);
    expect(player).toMatch(/unsubscribe\(\);/);
    expect(player).toMatch(/audioEngineRef\.current\.stop\(\)/);
  });

  it('keeps engine-owned queue on Tauri and client-owned queue on mock/web', () => {
    const tauri = createTauriPlatform();
    const mock = createMockPlatform();
    const web = createWebPlatform('/api');

    expect(tauri.audioEngine).toBeInstanceOf(TauriAudioEngine);
    expect(tauri.audioEngine.queueOwnership).toBe('engine');
    expect(mock.audioEngine).toBeInstanceOf(MockAudioEngine);
    expect(mock.audioEngine.queueOwnership).toBe('client');
    expect(web.audioEngine).toBeInstanceOf(BrowserAudioEngine);
    expect(web.audioEngine.queueOwnership).toBe('client');
    expect(web.capabilities.remotePlayback).toBe(true);
    expect(web.capabilities.nativeAudio).toBe(false);
    expect(web.capabilities.directoryScanning).toBe(false);
    expect(web.capabilities.localFileSystem).toBe(false);
    expect(web.capabilities.discordPresence).toBe(false);
    expect(web.capabilities.databaseBackup).toBe(false);
  });
});
