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
import { PlaybackStatus, PlaybackState, LoopMode } from '../types/audio';
import { IpcService, isTauri } from '../services/ipc';
import { Storage } from '../services/storage';
import { useToast } from './ToastContext';
import { t } from '../i18n';
import { useSettings } from './SettingsContext';
import { useLibrary } from './LibraryContext';
import {
  clampPlaybackPosition,
  normalizePlaybackProgress,
  restoreLastPlayback,
} from '../services/playbackState';

interface PlayerContextType {
  status: PlaybackStatus;
  queue: Track[];
  queueIndex: number;
  playTrack: (track: Track, newQueue?: Track[]) => Promise<void>;
  playQueue: (tracks: Track[], startIndex?: number) => Promise<void>;
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

const PlayerContext = createContext<PlayerContextType | undefined>(undefined);
const PlaybackProgressContext = createContext<PlaybackProgressValue>({ position: 0, duration: 0 });

const LAST_PLAYBACK_SAVE_MS = 2000;

// In the Tauri desktop shell the Rust backend owns the queue: next/previous,
// weighted shuffle, gapless preloading and auto-advance all happen there.
// The browser/mock build keeps the legacy local queue logic as a fallback.
const useBackendQueue = isTauri();

export const PlayerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { showToast } = useToast();
  const { settings } = useSettings();
  const { tracks, isLoading: isLibraryLoading } = useLibrary();

  const [status, setStatus] = useState<PlaybackStatus>({
    state: 'stopped',
    current_track: null,
    position: 0,
    duration: 0,
    volume: 0.85,
    is_muted: false,
    loop_mode: 'off',
    shuffle: false,
  });
  const [queue, setQueue] = useState<Track[]>([]);
  const [queueIndex, setQueueIndex] = useState<number>(-1);
  const [isQueueDrawerOpen, setIsQueueDrawerOpen] = useState<boolean>(false);
  const [isEqualizerOpen, setIsEqualizerOpen] = useState<boolean>(false);

  const queueRef = useRef(queue);
  queueRef.current = queue;
  const queueIndexRef = useRef(queueIndex);
  queueIndexRef.current = queueIndex;
  const statusRef = useRef(status);
  statusRef.current = status;
  const progressRef = useRef<PlaybackProgressValue>({ position: 0, duration: 0 });
  const setProgressRef = useRef<(value: PlaybackProgressValue) => void>(() => {});
  const hasRestoredPlaybackRef = useRef(false);
  // The queue array reference last pushed to the backend. When the user plays
  // another track from the same (unchanged) queue we only jump the index
  // instead of re-sending the whole track list over IPC.
  const lastSyncedQueueRef = useRef<Track[] | null>(null);

  useEffect(() => {
    const track = status.current_track;
    const activity = track && status.state === 'playing'
      ? {
          title: track.title,
          artist: track.artist,
          position_secs: progressRef.current.position,
          duration_secs: progressRef.current.duration || status.duration || track.duration,
        }
      : null;

    void IpcService.invoke('set_discord_presence', {
      enabled: settings.discord_presence_enabled,
      activity,
    }).catch(error => console.warn('Failed to sync Discord activity', error));
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

  const persistLastPlayback = useCallback((trackId: string, position: number, force = false) => {
    const now = Date.now();
    if (!force && now - lastPlaybackSavedAtRef.current < LAST_PLAYBACK_SAVE_MS) {
      return;
    }
    lastPlaybackSavedAtRef.current = now;
    Storage.saveLastPlayback(trackId, position);
  }, []);

  useEffect(() => {
    if (hasRestoredPlaybackRef.current || isLibraryLoading) return;
    hasRestoredPlaybackRef.current = true;

    const restored = restoreLastPlayback(tracks, Storage.getLastPlayback());
    if (!restored) return;

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

    (async () => {
      unlistenPos = await IpcService.listen('audio://position', ({ position_secs, duration_secs }) => {
        const progressValue = normalizePlaybackProgress(
          position_secs,
          duration_secs,
          statusRef.current.duration || progressRef.current.duration
        );
        progressRef.current = progressValue;
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

      unlistenState = await IpcService.listen('audio://state_changed', ({ state }) => {
        if (state === 'ended') {
          // Backend queue: auto-advance happens in Rust; either a
          // track_changed or a stopped event follows immediately.
          if (!useBackendQueue) {
            handleTrackEndedRef.current();
          }
          return;
        }
        setStatus(prev => ({ ...prev, state: state as PlaybackState }));
      });

      unlistenTrack = await IpcService.listen('audio://track_changed', nativeTrack => {
        if (!nativeTrack) return;
        const nextIndex = queueRef.current.findIndex(track =>
          track.id === nativeTrack.id || track.path === nativeTrack.path
        );
        const nextTrack = nextIndex >= 0 ? queueRef.current[nextIndex] : nativeTrack;
        const duration = nextTrack.duration || (nextTrack.duration_ms ?? 0) / 1000;
        const changedTrack = statusRef.current.current_track?.id !== nextTrack.id;

        if (nextIndex >= 0) {
          queueIndexRef.current = nextIndex;
          setQueueIndex(nextIndex);
        }
        progressRef.current = { position: 0, duration };
        setProgressRef.current({ position: 0, duration });
        setStatus(prev => ({
          ...prev,
          state: 'playing',
          current_track: nextTrack,
          position: 0,
          duration,
        }));

        if (changedTrack) {
          void IpcService.invoke('record_play', {
            input: {
              track_id: nextTrack.id,
              completed_duration_ms: 0,
              fully_played: false,
            },
          })
            .then(() => window.dispatchEvent(new Event('nghenhac:history-updated')))
            .catch(error => console.warn('Failed to record transitioned track', error));
        }
      });

      unlistenEnded = await IpcService.listen('audio://track_ended', () => {
        if (!useBackendQueue) {
          handleTrackEndedRef.current();
        }
      });
    })();

    return () => {
      if (unlistenPos) unlistenPos();
      if (unlistenState) unlistenState();
      if (unlistenTrack) unlistenTrack();
      if (unlistenEnded) unlistenEnded();
    };
  }, [persistLastPlayback]);

  const playTrackAtPosition = useCallback(async (track: Track, startPosition = 0, newQueue?: Track[]) => {
    const requestId = ++playRequestIdRef.current;
    let activeQueue = newQueue || queueRef.current;
    if (!newQueue && !activeQueue.some(t => t.id === track.id)) {
      activeQueue = [track, ...activeQueue];
    }
    const idx = activeQueue.findIndex(t => t.id === track.id);
    const targetPosition = clampPlaybackPosition(startPosition, track.duration || 180);

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
    void IpcService.invoke('record_play', {
      input: {
        track_id: track.id,
        completed_duration_ms: 0,
        fully_played: false,
      },
    })
      .then(() => window.dispatchEvent(new Event('nghenhac:history-updated')))
      .catch(error => console.warn('Failed to record listening history', error));
    if (targetPosition > 0) {
      await IpcService.invoke('seek_playback', { positionSecs: targetPosition });
    }
    if (requestId !== playRequestIdRef.current) return;
    persistLastPlayback(track.id, targetPosition, true);
  }, [persistLastPlayback]);

  const playTrack = useCallback(async (track: Track, newQueue?: Track[]) => {
    await playTrackAtPosition(track, 0, newQueue);
  }, [playTrackAtPosition]);

  const playQueue = useCallback(async (nextTracks: Track[], startIndex = 0) => {
    if (nextTracks.length === 0) return;
    const targetIdx = Math.min(Math.max(0, startIndex), nextTracks.length - 1);
    await playTrack(nextTracks[targetIdx], nextTracks);
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
    setStatus(prev => ({ ...prev, state: 'stopped', position: 0 }));
    setProgressRef.current({ position: 0, duration: progressRef.current.duration });
    await IpcService.invoke('stop_playback');
  }, []);

  // Local queue navigation (browser/mock fallback only).
  const computeNextIndex = useCallback((isAuto = false): number => {
    const q = queueRef.current;
    const curr = queueIndexRef.current;
    const loop = statusRef.current.loop_mode;
    const shuffle = statusRef.current.shuffle;

    if (q.length === 0) return -1;
    if (isAuto && loop === 'track') return curr;

    if (shuffle && q.length > 1) {
      let randIdx = curr;
      while (randIdx === curr) {
        randIdx = Math.floor(Math.random() * q.length);
      }
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
      await playTrack(queueRef.current[nextIdx]);
    } else {
      await stop();
    }
  }, [computeNextIndex, playTrack, stop]);

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
      void playTrack(queueRef.current[nextIdx]);
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
      await playTrack(queueRef.current[prevIdx]);
    } else {
      await seekRef.current(0);
    }
  }, [computePrevIndex, playTrack]);

  const seek = useCallback(async (positionSecs: number) => {
    const currentStatus = statusRef.current;
    const duration = progressRef.current.duration || currentStatus.duration;
    const clamped = clampPlaybackPosition(positionSecs, duration);
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
        queueRef.current
      );
    } else if (queueRef.current.length > 0) {
      await playTrack(queueRef.current[0]);
    }
  }, [pause, playTrack, playTrackAtPosition, resume]);

  const setVolume = useCallback(async (vol: number) => {
    const clamped = Math.max(0, Math.min(1, vol));
    setStatus(prev => ({ ...prev, volume: clamped, is_muted: false }));
    await IpcService.invoke('set_volume', { volume: clamped });
  }, []);

  const toggleMute = useCallback(async () => {
    const newMute = !statusRef.current.is_muted;
    setStatus(prev => ({ ...prev, is_muted: newMute }));
    await IpcService.invoke('toggle_mute');
  }, []);

  const setLoopMode = useCallback(async (mode: LoopMode) => {
    setStatus(prev => ({ ...prev, loop_mode: mode }));
    await IpcService.invoke('set_loop_mode', { mode });
  }, []);

  const toggleShuffle = useCallback(async () => {
    const newShuffle = !statusRef.current.shuffle;
    setStatus(prev => ({ ...prev, shuffle: newShuffle }));
    await IpcService.invoke('set_shuffle', { shuffle: newShuffle });
  }, []);

  /** Apply an optimistic local queue update and remember it as backend-synced. */
  const applyQueueUpdate = useCallback((nextQueue: Track[]) => {
    queueRef.current = nextQueue;
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
      queue,
      queueIndex,
      playTrack,
      playQueue,
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
      queue,
      queueIndex,
      playTrack,
      playQueue,
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
