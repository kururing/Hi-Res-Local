import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { Track } from '../types/library';
import { PlaybackStatus, PlaybackState, LoopMode } from '../types/audio';
import { IpcService } from '../services/ipc';
import { Storage } from '../services/storage';
import { useToast } from './ToastContext';
import { t } from '../i18n';
import { useSettings } from './SettingsContext';

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
  // UI states
  isNowPlayingExpanded: boolean;
  setIsNowPlayingExpanded: (expanded: boolean) => void;
  isQueueDrawerOpen: boolean;
  setIsQueueDrawerOpen: (open: boolean) => void;
  isEqualizerOpen: boolean;
  setIsEqualizerOpen: (open: boolean) => void;
}

const PlayerContext = createContext<PlayerContextType | undefined>(undefined);

export const PlayerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { showToast } = useToast();
  const { settings } = useSettings();

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

  const [isNowPlayingExpanded, setIsNowPlayingExpanded] = useState<boolean>(false);
  const [isQueueDrawerOpen, setIsQueueDrawerOpen] = useState<boolean>(false);
  const [isEqualizerOpen, setIsEqualizerOpen] = useState<boolean>(false);

  const queueRef = useRef(queue);
  queueRef.current = queue;
  const queueIndexRef = useRef(queueIndex);
  queueIndexRef.current = queueIndex;
  const statusRef = useRef(status);
  statusRef.current = status;

  // Restore last played position / track metadata on initial mount
  useEffect(() => {
    const last = Storage.getLastPlayback();
    if (last.position > 0) {
      setStatus(prev => ({ ...prev, position: last.position }));
    }
  }, []);

  // Sync IPC events
  useEffect(() => {
    let unlistenPos: (() => void) | undefined;
    let unlistenState: (() => void) | undefined;
    let unlistenEnded: (() => void) | undefined;

    (async () => {
      unlistenPos = await IpcService.listen('audio://position', ({ position_secs }) => {
        setStatus(prev => ({ ...prev, position: position_secs }));
        if (statusRef.current.current_track) {
          Storage.saveLastPlayback(statusRef.current.current_track.id, position_secs);
        }
      });

      unlistenState = await IpcService.listen('audio://state_changed', ({ state }) => {
        setStatus(prev => ({ ...prev, state: state as PlaybackState }));
      });

      unlistenEnded = await IpcService.listen('audio://track_ended', () => {
        handleTrackEnded();
      });
    })();

    return () => {
      if (unlistenPos) unlistenPos();
      if (unlistenState) unlistenState();
      if (unlistenEnded) unlistenEnded();
    };
  }, []);

  const playTrack = async (track: Track, newQueue?: Track[]) => {
    let activeQueue = newQueue || queueRef.current;
    if (!newQueue && !activeQueue.some(t => t.id === track.id)) {
      activeQueue = [track, ...activeQueue];
    }
    const idx = activeQueue.findIndex(t => t.id === track.id);

    setQueue(activeQueue);
    setQueueIndex(idx !== -1 ? idx : 0);

    setStatus(prev => ({
      ...prev,
      state: 'playing',
      current_track: track,
      duration: track.duration || 180,
      position: 0,
    }));

    await IpcService.invoke('play_track', { track });
    Storage.saveLastPlayback(track.id, 0);
  };

  const playQueue = async (tracks: Track[], startIndex = 0) => {
    if (tracks.length === 0) return;
    const targetIdx = Math.min(Math.max(0, startIndex), tracks.length - 1);
    await playTrack(tracks[targetIdx], tracks);
  };

  const pause = async () => {
    setStatus(prev => ({ ...prev, state: 'paused' }));
    await IpcService.invoke('pause_playback');
  };

  const resume = async () => {
    if (status.current_track) {
      setStatus(prev => ({ ...prev, state: 'playing' }));
      await IpcService.invoke('resume_playback');
    }
  };

  const togglePlayPause = async () => {
    if (status.state === 'playing') {
      await pause();
    } else if (status.state === 'paused') {
      await resume();
    } else if (status.current_track) {
      await playTrack(status.current_track);
    } else if (queue.length > 0) {
      await playTrack(queue[0]);
    }
  };

  const stop = async () => {
    setStatus(prev => ({ ...prev, state: 'stopped', position: 0 }));
    await IpcService.invoke('stop_playback');
  };

  const computeNextIndex = (isAuto = false): number => {
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
  };

  const computePrevIndex = (): number => {
    const q = queueRef.current;
    const curr = queueIndexRef.current;
    if (q.length === 0) return -1;
    if (curr > 0) return curr - 1;
    if (statusRef.current.loop_mode === 'playlist') return q.length - 1;
    return 0;
  };

  const next = async () => {
    const nextIdx = computeNextIndex(false);
    if (nextIdx !== -1 && queueRef.current[nextIdx]) {
      await playTrack(queueRef.current[nextIdx]);
    } else {
      await stop();
    }
  };

  const prev = async () => {
    if (status.position > 3) {
      await seek(0);
      return;
    }
    const prevIdx = computePrevIndex();
    if (prevIdx !== -1 && queueRef.current[prevIdx]) {
      await playTrack(queueRef.current[prevIdx]);
    } else {
      await seek(0);
    }
  };

  const handleTrackEnded = () => {
    const nextIdx = computeNextIndex(true);
    if (nextIdx !== -1 && queueRef.current[nextIdx]) {
      playTrack(queueRef.current[nextIdx]);
    } else {
      stop();
    }
  };

  const seek = async (positionSecs: number) => {
    const clamped = Math.max(0, Math.min(positionSecs, status.duration));
    setStatus(prev => ({ ...prev, position: clamped }));
    await IpcService.invoke('seek_playback', { position_secs: clamped });
  };

  const setVolume = async (vol: number) => {
    const clamped = Math.max(0, Math.min(1, vol));
    setStatus(prev => ({ ...prev, volume: clamped, is_muted: false }));
    await IpcService.invoke('set_volume', { volume: clamped });
  };

  const toggleMute = async () => {
    const newMute = !status.is_muted;
    setStatus(prev => ({ ...prev, is_muted: newMute }));
    await IpcService.invoke('toggle_mute');
  };

  const setLoopMode = async (mode: LoopMode) => {
    setStatus(prev => ({ ...prev, loop_mode: mode }));
    await IpcService.invoke('set_loop_mode', { mode });
  };

  const toggleShuffle = async () => {
    const newShuffle = !status.shuffle;
    setStatus(prev => ({ ...prev, shuffle: newShuffle }));
    await IpcService.invoke('set_shuffle', { shuffle: newShuffle });
  };

  const playNext = (track: Track) => {
    setQueue(prev => {
      const copy = [...prev];
      const insertAt = queueIndex >= 0 ? queueIndex + 1 : 0;
      copy.splice(insertAt, 0, track);
      return copy;
    });
    showToast(t('toast_added_to_queue', settings.language), 'info');
  };

  const addToQueue = (track: Track) => {
    setQueue(prev => [...prev, track]);
    showToast(t('toast_added_to_queue', settings.language), 'info');
  };

  const removeFromQueue = (index: number) => {
    setQueue(prev => {
      const copy = [...prev];
      copy.splice(index, 1);
      return copy;
    });
    if (index === queueIndex) {
      next();
    } else if (index < queueIndex) {
      setQueueIndex(prev => prev - 1);
    }
  };

  const reorderQueue = (fromIndex: number, toIndex: number) => {
    setQueue(prev => {
      const copy = [...prev];
      const [moved] = copy.splice(fromIndex, 1);
      copy.splice(toIndex, 0, moved);
      return copy;
    });
    if (queueIndex === fromIndex) {
      setQueueIndex(toIndex);
    } else if (fromIndex < queueIndex && toIndex >= queueIndex) {
      setQueueIndex(prev => prev - 1);
    } else if (fromIndex > queueIndex && toIndex <= queueIndex) {
      setQueueIndex(prev => prev + 1);
    }
  };

  const clearQueue = () => {
    setQueue(status.current_track ? [status.current_track] : []);
    setQueueIndex(status.current_track ? 0 : -1);
  };

  return (
    <PlayerContext.Provider
      value={{
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
        isNowPlayingExpanded,
        setIsNowPlayingExpanded,
        isQueueDrawerOpen,
        setIsQueueDrawerOpen,
        isEqualizerOpen,
        setIsEqualizerOpen,
      }}
    >
      {children}
    </PlayerContext.Provider>
  );
};

export function usePlayer(): PlayerContextType {
  const context = useContext(PlayerContext);
  if (!context) {
    throw new Error('usePlayer must be used within PlayerProvider');
  }
  return context;
}
