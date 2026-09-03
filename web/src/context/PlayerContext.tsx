import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Track } from '../types/library';
import { PlaybackStatus, PlaybackState, LoopMode, EngineStatus } from '../types/audio';
import { getArtworkUrlForDiscord } from '../services/remoteArtwork';
import { Storage } from '../services/storage';
import { useToast } from './ToastContext';
import { localizeAudioError, t } from '../i18n';
import { cloudTrackIdOf } from '../platform/hybrid/mergeLibrary';
import { useSettings } from './SettingsContext';
import { useLibrary } from './LibraryContext';
import { usePlatform } from '../platform';
import {
  BEFORE_APP_QUIT_EVENT,
  backendPlaybackToLastPlayback,
  clampPlaybackPosition,
  normalizePlaybackProgress,
  restoreLastPlayback,
  shouldIgnoreEarlyResumePosition,
} from '../services/playbackState';
import { isExpectedPlaybackAbort } from '../audio/browserErrors';
import { mergeTrackPresentation } from '../audio/browserMedia';

function sameTrackIdentity(
  left: { id?: string | null; trackId?: string | null; path?: string | null } | null | undefined,
  right: { id?: string | null; trackId?: string | null; path?: string | null } | null | undefined,
): boolean {
  if (!left || !right) return false;
  const leftId = left.id || left.trackId;
  const rightId = right.id || right.trackId;
  if (leftId && leftId === rightId) return true;
  return Boolean(left.path) && Boolean(right.path) && left.path === right.path;
}

/** Baseline for synthesizing an EngineStatus before the engine reports one. */
const EMPTY_ENGINE_STATUS: EngineStatus = {
  output_mode: '',
  bit_perfect: false,
  is_native: false,
  output_sample_rate: 0,
  output_bit_depth: 0,
  source_label: '',
  source_format: '',
  source_sample_rate: 0,
  source_bit_depth: 0,
  output_format: '',
  volume: 1,
  volume_control_kind: 'software',
};

interface PlayerContextType {
  status: PlaybackStatus;
  engineStatus: EngineStatus | null;
  queue: Track[];
  queueIndex: number;
  activePlaylistId: string | null;
  playTrack: (track: Track, newQueue?: Track[], sourcePlaylistId?: string | null) => Promise<void>;
  playQueue: (tracks: Track[], startIndex?: number, sourcePlaylistId?: string | null) => Promise<void>;
  playRandomQueue: (tracks: Track[], sourcePlaylistId?: string | null) => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  togglePlayPause: () => Promise<void>;
  stop: () => Promise<void>;
  next: () => Promise<void>;
  prev: () => Promise<void>;
  seek: (positionSecs: number) => Promise<void>;
  setVolume: (volume: number) => Promise<void>;
  toggleMute: () => Promise<void>;
  setLoopMode: (mode: LoopMode) => Promise<void>;
  toggleShuffle: () => Promise<void>;
  playNext: (track: Track) => void;
  addToQueue: (track: Track) => void;
  removeFromQueue: (index: number) => void;
  reorderQueue: (fromIndex: number, toIndex: number) => void;
  clearQueue: () => void;
  isQueueDrawerOpen: boolean;
  setIsQueueDrawerOpen: (open: boolean) => void;
  isEqualizerOpen: boolean;
  setIsEqualizerOpen: (open: boolean) => void;
}

interface PlaybackProgressValue {
  position: number;
  duration: number;
}

interface PlaybackHistorySession {
  trackId: string;
  catalogTrackId: string | null;
  listenedSeconds: number;
  lastPosition: number;
  duration: number;
  finalized: boolean;
}

const PlayerContext = createContext<PlayerContextType | undefined>(undefined);
const PlaybackProgressContext = createContext<PlaybackProgressValue>({ position: 0, duration: 0 });

const LAST_PLAYBACK_SAVE_MS = 2000;
const DISCORD_RECONNECT_INTERVAL_MS = 15_000;

export const PlayerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { showToast } = useToast();
  const { settings } = useSettings();
  const { tracks, isLoading: isLibraryLoading } = useLibrary();
  const { history, audioEngine, presence, capabilities } = usePlatform();
  const engineOwnsQueue = audioEngine.queueOwnership === 'engine';
  const initialAudioState = useMemo(() => Storage.getAudioState(), []);

  const [status, setStatus] = useState<PlaybackStatus>({
    state: 'stopped',
    current_track: null,
    position: 0,
    duration: 0,
    volume: initialAudioState.volume,
    is_muted: initialAudioState.isMuted,
    loop_mode: 'off',
    shuffle: false,
  });
  const [queue, setQueue] = useState<Track[]>([]);
  const [queueIndex, setQueueIndex] = useState<number>(-1);
  const [activePlaylistId, setActivePlaylistId] = useState<string | null>(null);
  const [isQueueDrawerOpen, setIsQueueDrawerOpen] = useState<boolean>(false);
  const [isEqualizerOpen, setIsEqualizerOpen] = useState<boolean>(false);
  const [engineStatus, setEngineStatus] = useState<EngineStatus | null>(null);

  const queueRef = useRef(queue);
  queueRef.current = queue;
  const queueIndexRef = useRef(queueIndex);
  queueIndexRef.current = queueIndex;
  const activePlaylistIdRef = useRef(activePlaylistId);
  activePlaylistIdRef.current = activePlaylistId;
  const statusRef = useRef(status);
  statusRef.current = status;
  const progressRef = useRef<PlaybackProgressValue>({ position: 0, duration: 0 });
  const setProgressRef = useRef<(value: PlaybackProgressValue) => void>(() => {});
  const languageRef = useRef(settings.language);
  languageRef.current = settings.language;
  const showToastRef = useRef(showToast);
  showToastRef.current = showToast;
  const audioEngineRef = useRef(audioEngine);
  audioEngineRef.current = audioEngine;
  const hasRestoredPlaybackRef = useRef(false);
  const pendingStartPositionRef = useRef<{
    trackId: string;
    path: string;
    position: number;
    startedAt: number;
  } | null>(null);
  // The queue array reference last pushed to the backend. When the user plays
  // another track from the same (unchanged) queue we only jump the index
  // instead of re-sending the whole track list over IPC.
  const lastSyncedQueueRef = useRef<Track[] | null>(null);
  // Keep the user's original playlist separate from the temporary shuffle order.
  const baseQueueRef = useRef<Track[]>([]);
  const shuffleQueueRef = useRef<Track[] | null>(null);

  useEffect(() => {
    if (!capabilities.discordPresence) {
      return;
    }
    let cancelled = false;
    const syncDiscordActivity = async () => {
      if (!settings.discord_presence_enabled) {
        await presence.setDiscordPresence(false, null);
        return;
      }
      const track = status.current_track;
      const artworkUrl = track && status.state === 'playing'
        ? await getArtworkUrlForDiscord(track.artist, track.album)
        : null;
      const activity = track && status.state === 'playing'
        ? {
            title: track.title,
            artist: track.artist,
            position_secs: progressRef.current.position,
            duration_secs: progressRef.current.duration || status.duration || track.duration,
            artwork_url: artworkUrl,
          }
        : null;

      if (cancelled) return;
      void presence.setDiscordPresence(true, activity)
        .catch(error => console.warn('Failed to sync Discord activity', error));
    };

    syncDiscordActivity();
    if (!settings.discord_presence_enabled) return () => { cancelled = true; };

    const reconnectTimer = window.setInterval(
      syncDiscordActivity,
      DISCORD_RECONNECT_INTERVAL_MS
    );
    return () => { cancelled = true; window.clearInterval(reconnectTimer); };
  }, [
    capabilities.discordPresence,
    presence,
    settings.discord_presence_enabled,
    status.current_track,
    status.duration,
    status.state,
  ]);
  const playRequestIdRef = useRef(0);
  const lastAutoAdvanceRef = useRef<{ trackId: string | null; at: number }>({
    trackId: null,
    at: 0,
  });
  const lastPlaybackSavedAtRef = useRef(0);
  const historySessionRef = useRef<PlaybackHistorySession | null>(null);
  const historyWriteChainRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    void Promise.all([
      audioEngine.setVolume(initialAudioState.volume),
      audioEngine.setMuted(initialAudioState.isMuted),
    ]).catch(error => console.warn('Failed to restore saved audio state', error));
  }, [audioEngine, initialAudioState]);

  const persistLastPlayback = useCallback((trackId: string, position: number, force = false) => {
    const now = Date.now();
    if (!force && now - lastPlaybackSavedAtRef.current < LAST_PLAYBACK_SAVE_MS) {
      return;
    }
    lastPlaybackSavedAtRef.current = now;
    Storage.saveLastPlayback(trackId, position);
  }, []);

  const writePlaybackHistory = useCallback((input: {
    track_id: string;
    completed_duration_ms: number;
    fully_played: boolean;
  }) => {
    historyWriteChainRef.current = historyWriteChainRef.current
      .catch(() => undefined)
      .then(async () => {
        await history.record(input);
        window.dispatchEvent(new Event('nghenhac:history-updated'));
      })
      .catch(error => console.warn('Failed to record playback history', error));
  }, [history]);

  const finalizeHistorySession = useCallback((fullyPlayed = false) => {
    const session = historySessionRef.current;
    if (!session || session.finalized) return;
    session.finalized = true;
    const completedDurationMs = Math.round(session.listenedSeconds * 1000);
    if (completedDurationMs === 0 && !fullyPlayed) return;
    if (!session.catalogTrackId) return;
    writePlaybackHistory({
      track_id: session.catalogTrackId,
      completed_duration_ms: completedDurationMs,
      fully_played: fullyPlayed,
    });
  }, [writePlaybackHistory]);

  const beginHistorySession = useCallback((track: Track, startPosition: number) => {
    const current = historySessionRef.current;
    if (current?.trackId === track.id && !current.finalized) return;
    const catalogTrackId = cloudTrackIdOf(track);
    historySessionRef.current = {
      trackId: track.id,
      catalogTrackId,
      listenedSeconds: 0,
      lastPosition: startPosition,
      duration: track.duration || (track.duration_ms ?? 0) / 1000,
      finalized: false,
    };
    if (catalogTrackId) {
      writePlaybackHistory({
        track_id: catalogTrackId,
        completed_duration_ms: 0,
        fully_played: false,
      });
    }
  }, [writePlaybackHistory]);

  // Persist immediately when the Tauri window is closed, so reopening the app
  // can resume from the most recent position even if the periodic save has not
  // fired yet.
  useEffect(() => {
    const saveBeforeClose = () => {
      const track = statusRef.current.current_track;
      if (track) {
        Storage.saveLastPlayback(track.id, progressRef.current.position);
      }
      finalizeHistorySession(false);
    };
    window.addEventListener('beforeunload', saveBeforeClose);
    window.addEventListener('pagehide', saveBeforeClose);
    window.addEventListener(BEFORE_APP_QUIT_EVENT, saveBeforeClose);
    return () => {
      window.removeEventListener('beforeunload', saveBeforeClose);
      window.removeEventListener('pagehide', saveBeforeClose);
      window.removeEventListener(BEFORE_APP_QUIT_EVENT, saveBeforeClose);
    };
  }, [finalizeHistorySession]);

  useEffect(() => {
    if (
      hasRestoredPlaybackRef.current ||
      isLibraryLoading ||
      tracks.length === 0
    ) return;

    let cancelled = false;
    void (async () => {
      let saved = Storage.getLastPlayback();
      try {
        const backendSaved = backendPlaybackToLastPlayback(
          await audioEngine.getSavedPlaybackState()
        );
        if (backendSaved) saved = backendSaved;
      } catch (error) {
        console.warn('Failed to load SQLite playback position; using local fallback', error);
      }

      if (cancelled) return;
      // A user-started play must win over a late restore. Mock/web library
      // loads are async, so this callback can resolve after playQueue.
      if (
        playRequestIdRef.current > 0
        || statusRef.current.state === 'playing'
        || statusRef.current.state === 'loading'
      ) {
        hasRestoredPlaybackRef.current = true;
        return;
      }
      hasRestoredPlaybackRef.current = true;
      const restored = restoreLastPlayback(tracks, saved);
      if (!restored) return;

      Storage.saveLastPlayback(restored.track.id, restored.position);
      baseQueueRef.current = [...tracks];
      queueRef.current = tracks;
      queueIndexRef.current = restored.queueIndex;
      setQueue(tracks);
      setQueueIndex(restored.queueIndex);
      setStatus(prev => ({
        ...prev,
        state: 'stopped',
        current_track: restored.track,
        duration: restored.track.duration || 0,
        position: restored.position,
      }));
      progressRef.current = {
        position: restored.position,
        duration: restored.track.duration || 0,
      };
      setProgressRef.current(progressRef.current);
    })();

    return () => {
      cancelled = true;
    };
  }, [audioEngine, isLibraryLoading, tracks]);

  useEffect(() => {
    let disposed = false;
    const unsubscribe = audioEngine.subscribe({
      onPositionChange: (positionSeconds, durationSeconds) => {
        if (disposed) return;
        const progressValue = normalizePlaybackProgress(
          positionSeconds,
          durationSeconds,
          statusRef.current.duration || progressRef.current.duration
        );
        const pendingStart = pendingStartPositionRef.current;
        if (
          pendingStart &&
          sameTrackIdentity(pendingStart, statusRef.current.current_track)
        ) {
          if (shouldIgnoreEarlyResumePosition(
            progressValue.position,
            pendingStart.position,
            Date.now() - pendingStart.startedAt
          )) {
            return;
          }
          pendingStartPositionRef.current = null;
        }
        progressRef.current = progressValue;
        const session = historySessionRef.current;
        if (session && session.trackId === statusRef.current.current_track?.id && !session.finalized) {
          const delta = progressValue.position - session.lastPosition;
          // Position ticks are ~100 ms apart. Ignore large jumps caused by seeks
          // or restoring a saved position; count only time actually listened.
          if (statusRef.current.state === 'playing' && delta >= 0 && delta <= 5) {
            session.listenedSeconds += delta;
          }
          session.lastPosition = progressValue.position;
          session.duration = progressValue.duration || session.duration;
        }
        statusRef.current = {
          ...statusRef.current,
          position: progressValue.position,
          duration: progressValue.duration,
        };
        setProgressRef.current(progressValue);
        if (statusRef.current.current_track) {
          persistLastPlayback(statusRef.current.current_track.id, progressValue.position);
        }
      },
      onStateChange: state => {
        if (disposed) return;
        if (state === 'ended') {
          finalizeHistorySession(true);
          // Engine-owned queue: auto-advance happens in Rust; either a
          // track_changed or a stopped event follows immediately.
          if (audioEngineRef.current.queueOwnership !== 'engine') {
            handleTrackEndedRef.current();
          }
          return;
        }
        setStatus(prev => ({ ...prev, state: state as PlaybackState }));
      },
      onTrackChange: nativeTrack => {
        if (disposed || !nativeTrack) return;
        const nextIndex = queueRef.current.findIndex(track =>
          sameTrackIdentity(track, nativeTrack)
        );
        const queued = nextIndex >= 0 ? queueRef.current[nextIndex] : nativeTrack;
        const nextTrack = mergeTrackPresentation(queued, nativeTrack);
        const duration = nextTrack.duration || (nextTrack.duration_ms ?? 0) / 1000;
        const changedTrack = statusRef.current.current_track?.id !== nextTrack.id;

        if (changedTrack) {
          const previousDuration = progressRef.current.duration;
          const previousPosition = progressRef.current.position;
          finalizeHistorySession(
            previousDuration > 0 && previousPosition >= Math.max(0, previousDuration - 2)
          );
          beginHistorySession(nextTrack, 0);
        } else if (!historySessionRef.current) {
          beginHistorySession(nextTrack, progressRef.current.position);
        }

        if (nextIndex >= 0) {
          queueIndexRef.current = nextIndex;
          setQueueIndex(nextIndex);
        }
        // Keep the restored position visible while the decoder opens directly
        // at that offset. Early 0-second ticks are filtered above.
        const pendingStart = pendingStartPositionRef.current;
        const shouldApplyPendingStart = Boolean(
          pendingStart &&
          sameTrackIdentity(pendingStart, nextTrack)
        );
        const retainedPosition = shouldApplyPendingStart
          ? clampPlaybackPosition(pendingStart?.position ?? 0, duration)
          : changedTrack ? 0 : progressRef.current.position;
        progressRef.current = { position: retainedPosition, duration };
        setProgressRef.current({ position: retainedPosition, duration });
        setStatus(prev => ({
          ...prev,
          current_track: nextTrack,
          position: retainedPosition,
          duration,
        }));
      },
      onTrackEnded: () => {
        if (disposed) return;
        if (audioEngineRef.current.queueOwnership !== 'engine') {
          handleTrackEndedRef.current();
        }
      },
      onEngineStatus: statusPayload => {
        if (disposed) return;
        const empty =
          !statusPayload?.source_label &&
          !statusPayload?.output_sample_rate &&
          !statusPayload?.output_mode;
        setEngineStatus(empty ? null : statusPayload);
      },
      onExclusiveMode: payload => {
        if (disposed) return;
        if (!payload?.enabled) {
          setEngineStatus(prev =>
            prev
              ? { ...prev, output_mode: payload.outputMode || 'WASAPI Shared', bit_perfect: false }
              : {
                  ...EMPTY_ENGINE_STATUS,
                  output_mode: payload.outputMode || 'WASAPI Shared',
                }
          );
        } else if (payload.outputMode) {
          setEngineStatus(prev =>
            prev
              ? { ...prev, output_mode: payload.outputMode }
              : {
                  ...EMPTY_ENGINE_STATUS,
                  output_mode: payload.outputMode,
                }
          );
        }
      },
      onNativeDsdStatus: payload => {
        if (disposed) return;
        if (payload.active) {
          setEngineStatus(previous => ({
            ...(previous || {
              ...EMPTY_ENGINE_STATUS,
              output_mode: 'ASIO Native DSD',
              output_bit_depth: 1,
            }),
            output_mode: 'ASIO Native DSD',
            is_native: true,
            dsd_output_mode: 'native_dsd',
            dsd_transport: 'native_dsd',
            dsd_rate: payload.dsdRate as EngineStatus['dsd_rate'],
            native_dsd_error: payload.error || null,
          }));
          return;
        }
        // Inactive: engine_status is the source of truth. Do not invent
        // "ASIO Native DSD unavailable" or keep a stale Native transport.
        setEngineStatus(previous => {
          if (!previous) return previous;
          return {
            ...previous,
            is_native: false,
            dsd_transport: previous.dsd_transport === 'native_dsd' ? null : previous.dsd_transport,
            native_dsd_error: payload.error || null,
          };
        });
      },
      onError: error => {
        if (disposed) return;
        if (isExpectedPlaybackAbort(error)) return;
        if (statusRef.current.state === 'playing' || statusRef.current.state === 'loading') {
          setStatus(prev => ({ ...prev, state: 'paused' }));
        }
        if (error.message) {
          showToastRef.current(localizeAudioError(error.message, languageRef.current), 'error');
        }
      },
      onDeviceLost: message => {
        if (disposed) return;
        setStatus(previous => ({ ...previous, state: 'paused' }));
        setEngineStatus(null);
        showToastRef.current(
          localizeAudioError(message || 'Audio device unavailable or disconnected', languageRef.current),
          'error'
        );
      },
      onVolumeChange: payload => {
        if (disposed) return;
        const volume = payload?.volume;
        const isMuted = payload?.isMuted;
        if (typeof volume !== 'number') return;
        Storage.saveAudioState(volume, Boolean(isMuted));
        setStatus(prev => ({
          ...prev,
          volume,
          is_muted: Boolean(isMuted),
        }));
      },
    });

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [audioEngine, beginHistorySession, finalizeHistorySession, persistLastPlayback]);

  useEffect(() => {
    return () => {
      void audioEngineRef.current.stop();
    };
  }, []);

  // In Bit-Perfect mode the UI mirrors Windows Endpoint Volume. Polling also
  // catches hardware keys and taskbar changes made outside this application.
  useEffect(() => {
    if (!engineStatus?.bit_perfect || audioEngine.kind !== 'tauri') return;
    let disposed = false;

    const syncEndpointVolume = async () => {
      try {
        const endpoint = await audioEngine.getSystemAudioState();
        if (disposed) return;
        const current = statusRef.current;
        if (
          Math.abs(current.volume - endpoint.volume) > 0.0005 ||
          current.is_muted !== endpoint.is_muted
        ) {
          setStatus(prev => ({
            ...prev,
            volume: endpoint.volume,
            is_muted: endpoint.is_muted,
          }));
        }
      } catch (error) {
        console.warn('Failed to sync Windows endpoint volume', error);
      }
    };

    void syncEndpointVolume();
    const intervalId = window.setInterval(() => void syncEndpointVolume(), 400);
    return () => {
      disposed = true;
      window.clearInterval(intervalId);
    };
  }, [audioEngine, engineStatus?.bit_perfect]);

  const playTrackAtPosition = useCallback(async (
    track: Track,
    startPosition = 0,
    newQueue?: Track[],
    sourcePlaylistId: string | null = null,
  ) => {
    const requestId = ++playRequestIdRef.current;
    activePlaylistIdRef.current = sourcePlaylistId;
    setActivePlaylistId(sourcePlaylistId);
    let activeQueue = newQueue || queueRef.current;
    if (newQueue) {
      baseQueueRef.current = [...newQueue];
      if (statusRef.current.shuffle) {
        const rest = [...newQueue].filter(item => item.id !== track.id);
        for (let i = rest.length - 1; i > 0; i -= 1) {
          const j = Math.floor(Math.random() * (i + 1));
          [rest[i], rest[j]] = [rest[j], rest[i]];
        }
        activeQueue = [track, ...rest];
        shuffleQueueRef.current = activeQueue;
      }
    }
    if (!newQueue && !activeQueue.some(t => t.id === track.id)) {
      activeQueue = [track, ...activeQueue];
    }
    const idx = activeQueue.findIndex(t => t.id === track.id);
    const resolvedIndex = idx !== -1 ? idx : 0;
    // Keep refs current before the engine can emit ended/track-change during
    // the same turn, and skip a late last-playback restore.
    hasRestoredPlaybackRef.current = true;
    queueRef.current = activeQueue;
    queueIndexRef.current = resolvedIndex;
    const targetPosition = clampPlaybackPosition(startPosition, track.duration || 180);
    pendingStartPositionRef.current = targetPosition > 0
      ? { trackId: track.id, path: track.path, position: targetPosition, startedAt: Date.now() }
      : null;

    finalizeHistorySession(false);
    beginHistorySession(track, targetPosition);

    setQueue(activeQueue);
    setQueueIndex(resolvedIndex);
    statusRef.current = {
      ...statusRef.current,
      state: 'loading',
      current_track: track,
      duration: track.duration || 180,
      position: targetPosition,
    };
    setStatus(prev => ({
      ...prev,
      state: 'loading',
      current_track: track,
      duration: track.duration || 180,
      position: targetPosition,
    }));
    setProgressRef.current({ position: targetPosition, duration: track.duration || 180 });

    try {
      if (engineOwnsQueue) {
        if (lastSyncedQueueRef.current === activeQueue && idx !== -1) {
          await audioEngine.setQueueIndex(idx);
        } else {
          await audioEngine.playQueue(
            activeQueue,
            idx !== -1 ? idx : 0,
            targetPosition,
          );
          lastSyncedQueueRef.current = activeQueue;
        }
      } else {
        await audioEngine.playTrack(track, targetPosition);
        if (targetPosition > 0) {
          await audioEngine.seek(targetPosition);
          pendingStartPositionRef.current = null;
        }
      }
    } catch (error) {
      if (requestId !== playRequestIdRef.current) return;
      if (isExpectedPlaybackAbort(error)) return;
      setStatus(prev => ({ ...prev, state: 'paused' }));
      return;
    }
    if (requestId !== playRequestIdRef.current) return;
    persistLastPlayback(track.id, targetPosition, true);
  }, [audioEngine, beginHistorySession, engineOwnsQueue, finalizeHistorySession, persistLastPlayback]);

  const playTrack = useCallback(async (
    track: Track,
    newQueue?: Track[],
    sourcePlaylistId: string | null = null,
  ) => {
    await playTrackAtPosition(track, 0, newQueue, sourcePlaylistId);
  }, [playTrackAtPosition]);

  const playQueue = useCallback(async (
    nextTracks: Track[],
    startIndex = 0,
    sourcePlaylistId: string | null = null,
  ) => {
    if (nextTracks.length === 0) return;
    const targetIdx = Math.min(Math.max(0, startIndex), nextTracks.length - 1);
    await playTrack(nextTracks[targetIdx], nextTracks, sourcePlaylistId);
  }, [playTrack]);

  const pause = useCallback(async () => {
    setStatus(prev => ({ ...prev, state: 'paused' }));
    if (statusRef.current.current_track) {
      persistLastPlayback(statusRef.current.current_track.id, progressRef.current.position, true);
    }
    await audioEngine.pause();
  }, [audioEngine, persistLastPlayback]);

  const resume = useCallback(async () => {
    if (!statusRef.current.current_track) return;
    try {
      await audioEngine.resume();
    } catch (error) {
      if (isExpectedPlaybackAbort(error)) return;
      setStatus(prev => ({ ...prev, state: 'paused' }));
    }
  }, [audioEngine]);

  const stop = useCallback(async () => {
    finalizeHistorySession(false);
    setStatus(prev => ({ ...prev, state: 'stopped', position: 0 }));
    setProgressRef.current({ position: 0, duration: progressRef.current.duration });
    await audioEngine.stop();
  }, [audioEngine, finalizeHistorySession]);

  // Local queue navigation (browser/mock fallback only).
  const computeNextIndex = useCallback((isAuto = false): number => {
    const q = queueRef.current;
    const curr = queueIndexRef.current;
    const loop = statusRef.current.loop_mode;
    const shuffle = statusRef.current.shuffle;

    if (q.length === 0) return -1;
    if (isAuto && loop === 'track') return curr;

    if (shuffle && q.length > 1) {
      // Shuffle uses a dedicated randomized queue, then advances through it
      // normally so each song is heard once before any repeat.
      if (shuffleQueueRef.current) {
        if (curr + 1 < q.length) return curr + 1;
        return loop === 'playlist' ? 0 : -1;
      }
      let randIdx = curr;
      while (randIdx === curr) randIdx = Math.floor(Math.random() * q.length);
      return randIdx;
    }

    if (curr + 1 < q.length) {
      return curr + 1;
    } else if (loop === 'playlist') {
      return 0;
    }
    return -1;
  }, []);

  const computePrevIndex = useCallback((): number => {
    const q = queueRef.current;
    const curr = queueIndexRef.current;
    if (q.length === 0) return -1;
    if (curr > 0) return curr - 1;
    if (statusRef.current.loop_mode === 'playlist') return q.length - 1;
    return 0;
  }, []);

  const next = useCallback(async () => {
    // Manual navigation is resolved in the UI even when Rust owns automatic
    // queue advancement. This lets the desktop adapter obtain/refresh a cloud
    // URL and cancel an older click before changing the native queue index.
    const nextIdx = computeNextIndex(false);
    if (nextIdx !== -1 && queueRef.current[nextIdx]) {
      await playTrackAtPosition(
        queueRef.current[nextIdx],
        0,
        undefined,
        activePlaylistIdRef.current,
      );
    } else {
      await stop();
    }
  }, [computeNextIndex, playTrackAtPosition, stop]);

  const handleTrackEndedRef = useRef(() => {});
  handleTrackEndedRef.current = () => {
    const endedTrackId = statusRef.current.current_track?.id;
    const now = Date.now();
    if (
      endedTrackId &&
      lastAutoAdvanceRef.current.trackId === endedTrackId &&
      now - lastAutoAdvanceRef.current.at < 1000
    ) return;
    lastAutoAdvanceRef.current = { trackId: endedTrackId ?? null, at: now };
    const nextIdx = computeNextIndex(true);
    if (nextIdx !== -1 && queueRef.current[nextIdx]) {
      void playTrackAtPosition(
        queueRef.current[nextIdx],
        0,
        undefined,
        activePlaylistIdRef.current,
      );
    } else {
      void stop();
    }
  };

  const prev = useCallback(async () => {
    if (progressRef.current.position > 3) {
      await seekRef.current(0);
      return;
    }
    const prevIdx = computePrevIndex();
    if (prevIdx !== -1 && queueRef.current[prevIdx]) {
      await playTrackAtPosition(
        queueRef.current[prevIdx],
        0,
        undefined,
        activePlaylistIdRef.current,
      );
    } else {
      await seekRef.current(0);
    }
  }, [computePrevIndex, playTrackAtPosition]);

  const seek = useCallback(async (positionSecs: number) => {
    const currentStatus = statusRef.current;
    const duration = progressRef.current.duration || currentStatus.duration;
    const clamped = clampPlaybackPosition(positionSecs, duration);
    if (historySessionRef.current) {
      historySessionRef.current.lastPosition = clamped;
    }
    setProgressRef.current({ position: clamped, duration });
    setStatus(prev => ({ ...prev, position: clamped }));
    if (currentStatus.current_track) {
      persistLastPlayback(currentStatus.current_track.id, clamped, true);
    }
    if (currentStatus.state !== 'stopped') {
      await audioEngine.seek(clamped);
    }
  }, [audioEngine, persistLastPlayback]);

  const seekRef = useRef(seek);
  seekRef.current = seek;

  const togglePlayPause = useCallback(async () => {
    if (statusRef.current.state === 'playing') {
      await pause();
    } else if (statusRef.current.state === 'paused') {
      await resume();
    } else if (statusRef.current.current_track) {
      await playTrackAtPosition(
        statusRef.current.current_track,
        progressRef.current.position,
        queueRef.current,
        activePlaylistIdRef.current,
      );
    } else if (queueRef.current.length > 0) {
      await playTrackAtPosition(
        queueRef.current[0],
        0,
        queueRef.current,
        activePlaylistIdRef.current,
      );
    }
  }, [pause, playTrackAtPosition, resume]);

  const setVolume = useCallback(async (vol: number) => {
    const clamped = Math.max(0, Math.min(1, vol));
    const shouldUnmute = statusRef.current.is_muted;
    statusRef.current = {
      ...statusRef.current,
      volume: clamped,
      is_muted: false,
    };
    Storage.saveAudioState(clamped, false);
    setStatus(prev => ({ ...prev, volume: clamped, is_muted: false }));
    await Promise.all([
      audioEngine.setVolume(clamped),
      ...(shouldUnmute ? [audioEngine.setMuted(false)] : []),
    ]);
  }, [audioEngine]);

  const toggleMute = useCallback(async () => {
    const newMute = !statusRef.current.is_muted;
    Storage.saveAudioState(statusRef.current.volume, newMute);
    setStatus(prev => ({ ...prev, is_muted: newMute }));
    await audioEngine.setMuted(newMute);
  }, [audioEngine]);

  const setLoopMode = useCallback(async (mode: LoopMode) => {
    setStatus(prev => ({ ...prev, loop_mode: mode }));
    await audioEngine.setLoopMode(mode);
  }, [audioEngine]);

  const toggleShuffle = useCallback(async () => {
    const newShuffle = !statusRef.current.shuffle;
    statusRef.current = { ...statusRef.current, shuffle: newShuffle };
    setStatus(prev => ({ ...prev, shuffle: newShuffle }));
    const current = statusRef.current.current_track;
    if (newShuffle && queueRef.current.length > 1) {
      const source = baseQueueRef.current.length > 0 ? baseQueueRef.current : queueRef.current;
      const rest = [...source];
      if (current) {
        const currentOccurrence = rest.findIndex(track => track.id === current.id);
        if (currentOccurrence >= 0) rest.splice(currentOccurrence, 1);
      }
      for (let i = rest.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [rest[i], rest[j]] = [rest[j], rest[i]];
      }
      const shuffled = current ? [current, ...rest] : rest;
      shuffleQueueRef.current = shuffled;
      queueRef.current = shuffled;
      setQueue(shuffled);
      setQueueIndex(current ? 0 : -1);
      if (engineOwnsQueue) {
        await audioEngine.replaceQueue(shuffled, 0);
        lastSyncedQueueRef.current = shuffled;
      }
    } else if (!newShuffle && baseQueueRef.current.length > 0) {
      const restored = baseQueueRef.current;
      const restoredIndex = current ? restored.findIndex(track => track.id === current.id) : -1;
      queueRef.current = restored;
      setQueue(restored);
      setQueueIndex(restoredIndex);
      shuffleQueueRef.current = null;
      if (engineOwnsQueue) {
        await audioEngine.replaceQueue(restored, restoredIndex >= 0 ? restoredIndex : 0);
        lastSyncedQueueRef.current = restored;
      }
    }
    // The randomized queue is already materialized above. Keep backend
    // navigation sequential so it consumes that playlist once, instead of
    // applying weighted random picks that can revisit songs.
    await audioEngine.setShuffle(false);
  }, [audioEngine, engineOwnsQueue]);

  const playRandomQueue = useCallback(async (
    nextTracks: Track[],
    sourcePlaylistId: string | null = null,
  ) => {
    if (nextTracks.length === 0) return;

    if (!statusRef.current.shuffle) {
      await toggleShuffle();
    }

    // Pick the first track randomly as well. `playTrackAtPosition` shuffles
    // the remaining tracks around the selected track when shuffle is active.
    const randomIndex = Math.floor(Math.random() * nextTracks.length);
    await playTrack(nextTracks[randomIndex], nextTracks, sourcePlaylistId);
  }, [playTrack, toggleShuffle]);

  /** Apply an optimistic local queue update and remember it as backend-synced. */
  const applyQueueUpdate = useCallback((nextQueue: Track[]) => {
    activePlaylistIdRef.current = null;
    setActivePlaylistId(null);
    queueRef.current = nextQueue;
    if (!statusRef.current.shuffle) baseQueueRef.current = [...nextQueue];
    lastSyncedQueueRef.current = nextQueue;
    setQueue(nextQueue);
  }, []);

  const playNext = useCallback((track: Track) => {
    const copy = [...queueRef.current];
    const insertAt = queueIndexRef.current >= 0 ? queueIndexRef.current + 1 : 0;
    copy.splice(insertAt, 0, track);
    applyQueueUpdate(copy);
    if (engineOwnsQueue) {
      void audioEngine.playNext(track).catch(error =>
        console.warn('queue_play_next failed', error)
      );
    }
    showToast(t('toast_added_to_queue', settings.language), 'info');
  }, [applyQueueUpdate, audioEngine, engineOwnsQueue, settings.language, showToast]);

  const addToQueue = useCallback((track: Track) => {
    applyQueueUpdate([...queueRef.current, track]);
    if (engineOwnsQueue) {
      void audioEngine.addToQueue([track]).catch(error =>
        console.warn('queue_add failed', error)
      );
    }
    showToast(t('toast_added_to_queue', settings.language), 'info');
  }, [applyQueueUpdate, audioEngine, engineOwnsQueue, settings.language, showToast]);

  const removeFromQueue = useCallback((index: number) => {
    const isCurrent = index === queueIndexRef.current;
    const copy = [...queueRef.current];
    copy.splice(index, 1);
    applyQueueUpdate(copy);

    if (engineOwnsQueue) {
      void audioEngine.removeFromQueue(index)
        .then(() => {
          if (isCurrent) {
            // Backend now points at the following track; start it (or stop when
            // the queue ran out).
            if (copy.length > 0) {
              return audioEngine.playCurrent();
            }
            return stop();
          }
          return undefined;
        })
        .catch(error => console.warn('queue_remove failed', error));
      if (index < queueIndexRef.current) {
        setQueueIndex(prevIdx => prevIdx - 1);
      }
      return;
    }

    if (isCurrent) {
      void next();
    } else if (index < queueIndexRef.current) {
      setQueueIndex(prevIdx => prevIdx - 1);
    }
  }, [applyQueueUpdate, audioEngine, engineOwnsQueue, next, stop]);

  const reorderQueue = useCallback((fromIndex: number, toIndex: number) => {
    const copy = [...queueRef.current];
    const [moved] = copy.splice(fromIndex, 1);
    copy.splice(toIndex, 0, moved);
    applyQueueUpdate(copy);

    if (engineOwnsQueue) {
      void audioEngine.reorderQueue(fromIndex, toIndex).catch(error =>
        console.warn('queue_reorder failed', error)
      );
    }

    const current = queueIndexRef.current;
    if (current === fromIndex) {
      setQueueIndex(toIndex);
    } else if (fromIndex < current && toIndex >= current) {
      setQueueIndex(prevIdx => prevIdx - 1);
    } else if (fromIndex > current && toIndex <= current) {
      setQueueIndex(prevIdx => prevIdx + 1);
    }
  }, [applyQueueUpdate, audioEngine, engineOwnsQueue]);

  const clearQueue = useCallback(() => {
    const current = statusRef.current.current_track;
    applyQueueUpdate(current ? [current] : []);
    setQueueIndex(current ? 0 : -1);
    if (engineOwnsQueue) {
      void audioEngine.clearUpcoming().catch(error =>
        console.warn('queue_clear_upcoming failed', error)
      );
    }
  }, [applyQueueUpdate, audioEngine, engineOwnsQueue]);

  const playerValue = useMemo<PlayerContextType>(
    () => ({
      status,
      engineStatus,
      queue,
      queueIndex,
      activePlaylistId,
      playTrack,
      playQueue,
      playRandomQueue,
      pause,
      resume,
      togglePlayPause,
      stop,
      next,
      prev,
      seek,
      setVolume,
      toggleMute,
      setLoopMode,
      toggleShuffle,
      playNext,
      addToQueue,
      removeFromQueue,
      reorderQueue,
      clearQueue,
      isQueueDrawerOpen,
      setIsQueueDrawerOpen,
      isEqualizerOpen,
      setIsEqualizerOpen,
    }),
    [
      status,
      engineStatus,
      queue,
      queueIndex,
      activePlaylistId,
      playTrack,
      playQueue,
      playRandomQueue,
      pause,
      resume,
      togglePlayPause,
      stop,
      next,
      prev,
      seek,
      setVolume,
      toggleMute,
      setLoopMode,
      toggleShuffle,
      playNext,
      addToQueue,
      removeFromQueue,
      reorderQueue,
      clearQueue,
      isQueueDrawerOpen,
      isEqualizerOpen,
    ]
  );

  return (
    <PlayerContext.Provider value={playerValue}>
      <PlaybackProgressGate progressRef={progressRef} setProgressRef={setProgressRef}>
        {children}
      </PlaybackProgressGate>
    </PlayerContext.Provider>
  );
};

const PlaybackProgressGate: React.FC<{
  children: React.ReactNode;
  progressRef: React.MutableRefObject<PlaybackProgressValue>;
  setProgressRef: React.MutableRefObject<(value: PlaybackProgressValue) => void>;
}> = ({ children, progressRef, setProgressRef }) => {
  const [progress, setProgress] = useState<PlaybackProgressValue>(progressRef.current);
  setProgressRef.current = setProgress;

  return (
    <PlaybackProgressContext.Provider value={progress}>
      {children}
    </PlaybackProgressContext.Provider>
  );
};

export function usePlayer(): PlayerContextType {
  const context = useContext(PlayerContext);
  if (!context) {
    throw new Error('usePlayer must be used within PlayerProvider');
  }
  return context;
}

export function usePlaybackProgress(): PlaybackProgressValue {
  return useContext(PlaybackProgressContext);
}
