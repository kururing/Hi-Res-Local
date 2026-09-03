import type { PresenceActivity, PresenceApi } from '../contracts';

/** Mock preview has no Discord RPC. Presence calls are safe no-ops. */
export class MockPresenceApi implements PresenceApi {
  setDiscordPresence(
    _enabled: boolean,
    _activity: PresenceActivity | null
  ): Promise<void> {
    return Promise.resolve();
  }
}
