import type { PresenceActivity, PresenceApi } from '../contracts';

/**
 * Browser cloud runtime has no Discord RPC. Calls are intentional no-ops so
 * callers that forget to check `capabilities.discordPresence` do not throw.
 */
export class WebPresenceApi implements PresenceApi {
  async setDiscordPresence(
    _enabled: boolean,
    _activity: PresenceActivity | null
  ): Promise<void> {
    return undefined;
  }
}
