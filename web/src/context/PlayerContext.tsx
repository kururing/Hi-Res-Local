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
import { IpcService, isTauri } from '../services/ipc';
import { getArtworkUrlForDiscord } from '../services/remoteArtwork';
import { Storage } from '../services/storage';
import { useToast } from './ToastContext';
import { localizeAudioError, t } from '../i18n';
import { useSettings } from './SettingsContext';
import { useLibrary } from './LibraryContext';
import {
  clampPlaybackPosition,
  normalizePlaybackProgress,
  restoreLastPlayback,
} from '../services/playbackState';

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
  listenedSeconds: number;
  lastPosition: number;
  duration: number;
  finalized: boolean;
}

const PlayerContext = createContext<PlayerContextType | undefined>(undefined);
const PlaybackProgressContext = createContext<PlaybackProgressValue>({ position: 0, duration: 0 });

const LAST_PLAYBACK_SAVE_MS = 2000;
const DISCORD_RECONNECT_INTERVAL_MS = 15_000;

// In the Tauri desktop shell the Rust backend owns the queue: next/previous,
// weighted shuffle, gapless preloading and auto-advance all happen there.
// The browser/mock build keeps the legacy local queue logic as a fallback.
const useBackendQueue = isTauri();

export const PlayerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { showToast } = useToast();
  const { settings } = useSettings();
  const { tracks, isLoading: isLibraryLoading } = useLibrary();
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
  const hasRestoredPlaybackRef = useRef(false);
  // The queue array reference last pushed to the backend. When the user plays
  // another track from the same (unchanged) queue we only jump the index
  // instead of re-sending the whole track list over IPC.
  const lastSyncedQueueRef = useRef<Track[] | null>(null);
  // Keep the user's original playlist separate from the temporary shuffle order.
  const baseQueueRef = useRef<Track[]>([]);
  const shuffleQueueRef = useRef<Track[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const syncDiscordActivity = async () => {
      if (!settings.discord_presence_enabled) {
        await IpcService.invoke('set_discord_presence', { enabled: false, activity: null });
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
      void IpcService.invoke('set_discord_presence', {
        enabled: true,
        activity,
      }).catch(error => console.warn('Failed to sync Discord activity', error));
    };

    syncDiscordActivity();
    if (!settings.discord_presence_enabled) return () => { cancelled = true; };

    const reconnectTimer = window.setInterval(
      syncDiscordActivity,
      DISCORD_RECONNECT_INTERVAL_MS
    );
    return () => { cancelled = true; window.clearInterval(reconnectTimer); };
  }, [
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
      IpcService.invoke('set_volume', { volume: initialAudioState.volume }),
      IpcService.invoke('set_muted', { muted: initialAudioState.isMuted }),
    ]).catch(error => console.warn('Failed to restore saved audio state', error));
  }, [initialAudioState]);

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
        await IpcService.invoke('record_play', { input });
        window.dispatchEvent(new Event('nghenhac:history-updated'));
      })
      .catch(error => console.warn('Failed to record playback history', error));
  }, []);

  const finalizeHistorySession = useCallback((fullyPlayed = false) => {
    const session = historySessionRef.current;
    if (!session || session.finalized) return;
    session.finalized = true;
    const completedDurationMs = Math.round(session.listenedSeconds * 1000);
    if (completedDurationMs === 0 && !fullyPlayed) return;
    writePlaybackHistory({
      track_id: session.trackId,
      completed_duration_ms: completedDurationMs,
      fully_played: fullyPlayed,
    });
  }, [writePlaybackHistory]);

  const beginHistorySession = useCallback((track: Track, startPosition: number) => {
    const current = historySessionRef.current;
    if (current?.trackId === track.id && !current.finalized) return;
    historySessionRef.current = {
      trackId: track.id,
      listenedSeconds: 0,
      lastPosition: startPosition,
      duration: track.duration || (track.duration_ms ?? 0) / 1000,
      finalized: false,
    };
    writePlaybackHistory({
      track_id: track.id,
      completed_duration_ms: 0,
      fully_played: false,
    });
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
    return () => {
      window.removeEventListener('beforeunload', saveBeforeClose);
      window.removeEventListener('pagehide', saveBeforeClose);
    };
  }, [finalizeHistorySession]);

  useEffect(() => {
    if (hasRestoredPlaybackRef.current || isLibraryLoading) return;
    hasRestoredPlaybackRef.current = true;

    const restored = restoreLastPlayback(tracks, Storage.getLastPlayback());
    if (!restored) return;

    baseQueueRef.current = [...tracks];
    setQueue(tracks);
    setQueueIndex(restored.queueIndex);
    setStatus(prev => ({
      ...prev,
      state: 'stopped',
      current_track: restored.track,
      duration: restored.track.duration || 0,
      position: restored.position,
    }));
    setProgressRef.current({ position: restored.position, duration: restored.track.duration || 0 });
  }, [isLibraryLoading, tracks]);

  useEffect(() => {
    let unlistenPos: (() => void) | undefined;
    let unlistenState: (() => void) | undefined;
    let unlistenTrack: (() => void) | undefined;
    let unlistenEnded: (() => void) | undefined;
    let unlistenEngine: (() => void) | undefined;
    let unlistenExclusive: (() => void) | undefined;
    let unlistenNativeDsd: (() => void) | undefined;
    let unlistenAudioError: (() => void) | undefined;
    let unlistenDeviceLost: (() => void) | undefined;
    let unlistenVolume: (() => void) | undefined;
    let disposed = false;

    (async () => {
      const disposePos = await IpcService.listen('audio://position', ({ position_secs, duration_secs }) => {
        const progressValue = normalizePlaybackProgress(
          position_secs,
          duration_secs,
          statusRef.current.duration || progressRef.current.duration
        );
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
      });
      if (disposed) {
        disposePos();
        return;
      }
      unlistenPos = disposePos;

      const disposeState = await IpcService.listen('audio://state_changed', ({ state }) => {
        if (state === 'ended') {
          finalizeHistorySession(true);
          // Backend queue: auto-advance happens in Rust; either a
          // track_changed or a stopped event follows immediately.
          if (!useBackendQueue) {
            handleTrackEndedRef.current();
          }
          return;
        }
        setStatus(prev => ({ ...prev, state: state as PlaybackState }));
      });
      if (disposed) {
        disposeState();
        return;
      }
      unlistenState = disposeState;

      const disposeTrack = await IpcService.listen('audio://track_changed', nativeTrack => {
        if (!nativeTrack) return;
        const nextIndex = queueRef.current.findIndex(track =>
          track.id === nativeTrack.id || track.path === nativeTrack.path
        );
        const nextTrack = nextIndex >= 0 ? queueRef.current[nextIndex] : nativeTrack;
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
        // Replaying a restored track emits track_changed from the backend
        // even though it is still the same track. Keep the saved position;
        // genuinely new tracks must start at zero.
        const retainedPosition = changedTrack ? 0 : progressRef.current.position;
        progressRef.current = { position: retainedPosition, duration };
        setProgressRef.current({ position: retainedPosition, duration });
        setStatus(prev => ({
          ...prev,
          state: 'playing',
          current_track: nextTrack,
          position: retainedPosition,
          duration,
        }));

      });
      if (disposed) {
        disposeTrack();
        return;
      }
      unlistenTrack = disposeTrack;

      const disposeEnded = await IpcService.listen('audio://track_ended', () => {
        if (!useBackendQueue) {
          handleTrackEndedRef.current();
        }
      });
      if (disposed) {
        disposeEnded();
        return;
      }
      unlistenEnded = disposeEnded;

      const disposeEngine = await IpcService.listen('audio://engine_status', statusPayload => {
        const empty =
          !statusPayload?.source_label &&
          !statusPayload?.output_sample_rate &&
          !statusPayload?.output_mode;
        setEngineStatus(empty ? null : statusPayload);
      });
      if (disposed) {
        disposeEngine();
        return;
      }
      unlistenEngine = disposeEngine;

      const disposeExclusive = await IpcService.listen('audio://exclusive_mode', payload => {
        if (!payload?.enabled) {
          setEngineStatus(prev =>
            prev
              ? { ...prev, output_mode: payload.output_mode || 'WASAPI Shared', bit_perfect: false }
              : {
                  ...EMPTY_ENGINE_STATUS,
                  output_mode: payload.output_mode || 'WASAPI Shared',
                }
          );
        } else if (payload.output_mode) {
          setEngineStatus(prev =>
            prev
              ? { ...prev, output_mode: payload.output_mode }
              : {
                  ...EMPTY_ENGINE_STATUS,
                  output_mode: payload.output_mode,
                }
          );
        }
      });
      if (disposed) {
        disposeExclusive();
        return;
      }
      unlistenExclusive = disposeExclusive;

      const disposeNativeDsd = await IpcService.listen('audio://native_dsd_status', payload => {
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
            dsd_rate: payload.dsd_rate as EngineStatus['dsd_rate'],
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
      });
      if (disposed) {
        disposeNativeDsd();
        return;
      }
      unlistenNativeDsd = disposeNativeDsd;

      const disposeAudioError = await IpcService.listen('audio://error', payload => {
        if (payload?.message) {
          showToast(localizeAudioError(payload.message, settings.language), 'error');
        }
      });
      if (disposed) {
        disposeAudioError();
        return;
      }
      unlistenAudioError = disposeAudioError;

      const disposeDeviceLost = await IpcService.listen('audio://device_lost', payload => {
        setStatus(previous => ({ ...previous, state: 'paused' }));
        setEngineStatus(null);
        showToast(
          localizeAudioError(payload?.error || 'Audio device unavailable or disconnected', settings.language),
          'error'
        );
      });
      if (disposed) {
        disposeDeviceLost();
        return;
      }
      unlistenDeviceLost = disposeDeviceLost;

      const disposeVolume = await IpcService.listen('audio://volume_changed', payload => {
        const volume = payload?.volume;
        const isMuted = payload?.is_muted;
        if (typeof volume !== 'number') return;
        Storage.saveAudioState(volume, Boolean(isMuted));
        setStatus(prev => ({
          ...prev,
          volume,
          is_muted: Boolean(isMuted),
        }));
      });
      if (disposed) {
        disposeVolume();
        return;
      }
      unlistenVolume = disposeVolume;
    })();

    return () => {
      disposed = true;
      if (unlistenPos) unlistenPos();
      if (unlistenState) unlistenState();
      if (unlistenTrack) unlistenTrack();
      if (unlistenEnded) unlistenEnded();
      if (unlistenEngine) unlistenEngine();
      if (unlistenExclusive) unlistenExclusive();
      if (unlistenNativeDsd) unlistenNativeDsd();
      if (unlistenAudioError) unlistenAudioError();
      if (unlistenDeviceLost) unlistenDeviceLost();
      if (unlistenVolume) unlistenVolume();
    };
  }, [beginHistorySession, finalizeHistorySession, persistLastPlayback, settings.language, showToast]);

  // In Bit-Perfect mode the UI mirrors Windows Endpoint Volume. Polling also
  // catches hardware keys and taskbar changes made outside this application.
  useEffect(() => {
    if (!engineStatus?.bit_perfect || !isTauri()) return;
    let disposed = false;

    const syncEndpointVolume = async () => {
      try {
        const endpoint = await IpcService.invoke('get_system_audio_state', {});
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
  }, [engineStatus?.bit_perfect]);

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
    const targetPosition = clampPlaybackPosition(startPosition, track.duration || 180);

    finalizeHistorySession(false);
    beginHistorySession(track, targetPosition);

    setQueue(activeQueue);
    setQueueIndex(idx !== -1 ? idx : 0);
    setStatus(prev => ({
      ...prev,
      state: 'playing',
      current_track: track,
      duration: track.duration || 180,
      position: targetPosition,
    }));
    setProgressRef.current({ position: targetPosition, duration: track.duration || 180 });

    if (useBackendQueue) {
      if (lastSyncedQueueRef.current === activeQueue && idx !== -1) {
        await IpcService.invoke('queue_set_index', { index: idx });
      } else {
        await IpcService.invoke('play_queue', {
          tracks: activeQueue,
          startIndex: idx !== -1 ? idx : 0,
        });
        lastSyncedQueueRef.current = activeQueue;
      }
    } else {
      await IpcService.invoke('play_track', { track });
    }
    if (requestId !== playRequestIdRef.current) return;
    if (targetPosition > 0) {
      await IpcService.invoke('seek_playback', { positionSecs: targetPosition });
    }
    if (requestId !== playRequestIdRef.current) return;
    persistLastPlayback(track.id, targetPosition, true);
  }, [beginHistorySession, finalizeHistorySession, persistLastPlayback]);

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
    await IpcService.invoke('pause_playback');
  }, [persistLastPlayback]);

  const resume = useCallback(async () => {
    if (statusRef.current.current_track) {
      setStatus(prev => ({ ...prev, state: 'playing' }));
      await IpcService.invoke('resume_playback');
    }
  }, []);

  const stop = useCallback(async () => {
    finalizeHistorySession(false);
    setStatus(prev => ({ ...prev, state: 'stopped', position: 0 }));
    setProgressRef.current({ position: 0, duration: progressRef.current.duration });
    await IpcService.invoke('stop_playback');
  }, [finalizeHistorySession]);

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
    if (useBackendQueue) {
      await IpcService.invoke('next_track').catch(error =>
        console.warn('next_track failed', error)
      );
      return;
    }
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
    if (useBackendQueue) {
      // The backend restarts the current track when >3s in, otherwise goes back.
      await IpcService.invoke('previous_track').catch(error =>
        console.warn('previous_track failed', error)
      );
      return;
    }
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
      await IpcService.invoke('seek_playback', { positionSecs: clamped });
    }
  }, [persistLastPlayback]);

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
      IpcService.invoke('set_volume', { volume: clamped }),
      ...(shouldUnmute ? [IpcService.invoke('set_muted', { muted: false })] : []),
    ]);
  }, []);

  const toggleMute = useCallback(async () => {
    const newMute = !statusRef.current.is_muted;
    Storage.saveAudioState(statusRef.current.volume, newMute);
    setStatus(prev => ({ ...prev, is_muted: newMute }));
    await IpcService.invoke('set_muted', { muted: newMute });
  }, []);

  const setLoopMode = useCallback(async (mode: LoopMode) => {
    setStatus(prev => ({ ...prev, loop_mode: mode }));
    await IpcService.invoke('set_loop_mode', { mode });
  }, []);

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
      if (useBackendQueue) {
        await IpcService.invoke('queue_replace', { tracks: shuffled, currentIndex: 0 });
        lastSyncedQueueRef.current = shuffled;
      }
    } else if (!newShuffle && baseQueueRef.current.length > 0) {
      const restored = baseQueueRef.current;
      const restoredIndex = current ? restored.findIndex(track => track.id === current.id) : -1;
      queueRef.current = restored;
      setQueue(restored);
      setQueueIndex(restoredIndex);
      shuffleQueueRef.current = null;
      if (useBackendQueue) {
        await IpcService.invoke('queue_replace', { tracks: restored, currentIndex: restoredIndex >= 0 ? restoredIndex : 0 });
        lastSyncedQueueRef.current = restored;
      }
    }
    // The randomized queue is already materialized above. Keep backend
    // navigation sequential so it consumes that playlist once, instead of
    // applying weighted random picks that can revisit songs.
    await IpcService.invoke('set_shuffle', { shuffle: false });
  }, [useBackendQueue]);

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
    if (useBackendQueue) {
      void IpcService.invoke('queue_play_next', { track }).catch(error =>
        console.warn('queue_play_next failed', error)
      );
    }
    showToast(t('toast_added_to_queue', settings.language), 'info');
  }, [applyQueueUpdate, settings.language, showToast]);

  const addToQueue = useCallback((track: Track) => {
    applyQueueUpdate([...queueRef.current, track]);
    if (useBackendQueue) {
      void IpcService.invoke('queue_add', { tracks: [track] }).catch(error =>
        console.warn('queue_add failed', error)
      );
    }
    showToast(t('toast_added_to_queue', settings.language), 'info');
  }, [applyQueueUpdate, settings.language, showToast]);

  const removeFromQueue = useCallback((index: number) => {
    const isCurrent = index === queueIndexRef.current;
    const copy = [...queueRef.current];
    copy.splice(index, 1);
    applyQueueUpdate(copy);

    if (useBackendQueue) {
      void IpcService.invoke('queue_remove', { index })
        .then(() => {
          if (isCurrent) {
            // Backend now points at the following track; start it (or stop when
            // the queue ran out).
            if (copy.length > 0) {
              return IpcService.invoke('play_current');
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
  }, [applyQueueUpdate, next, stop]);

  const reorderQueue = useCallback((fromIndex: number, toIndex: number) => {
    const copy = [...queueRef.current];
    const [moved] = copy.splice(fromIndex, 1);
    copy.splice(toIndex, 0, moved);
    applyQueueUpdate(copy);

    if (useBackendQueue) {
      void IpcService.invoke('queue_reorder', { from: fromIndex, to: toIndex }).catch(error =>
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
  }, [applyQueueUpdate]);

  const clearQueue = useCallback(() => {
    const current = statusRef.current.current_track;
    applyQueueUpdate(current ? [current] : []);
    setQueueIndex(current ? 0 : -1);
    if (useBackendQueue) {
      void IpcService.invoke('queue_clear_upcoming').catch(error =>
        console.warn('queue_clear_upcoming failed', error)
      );
    }
  }, [applyQueueUpdate]);

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
