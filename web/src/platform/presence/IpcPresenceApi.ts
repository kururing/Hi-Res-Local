import type { PlatformCommandGateway, PresenceActivity, PresenceApi } from '../contracts';

/** IPC-backed Discord presence adapter for the Tauri desktop runtime. */
export class IpcPresenceApi implements PresenceApi {
  constructor(private readonly commands: PlatformCommandGateway) {}

  setDiscordPresence(enabled: boolean, activity: PresenceActivity | null): Promise<void> {
    return this.commands.invoke('set_discord_presence', { enabled, activity });
  }
}

export class TauriPresenceApi extends IpcPresenceApi {}
