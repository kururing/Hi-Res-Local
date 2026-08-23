import { Track } from '../types/library';
import { PlaybackState, LoopMode, PlaybackStatus } from '../types/audio';

export interface AudioEngineListener {
  onPositionChange: (pos: number) => void;
  onStateChange: (state: PlaybackState) => void;
  onTrackEnded: () => void;
  onError: (err: string) => void;
}

const EQ_FREQUENCIES = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

/**
 * Web Audio / Mock audio engine for dev preview in standard browser.
 */
class BrowserAudioEngine {
  private audioCtx: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private eqFilters: BiquadFilterNode[] = [];

  private currentTrack: Track | null = null;
  private state: PlaybackState = 'stopped';
  private position: number = 0;
  private duration: number = 0;
  private volume: number = 1.0;
  private isMuted: boolean = false;
  private loopMode: LoopMode = 'off';
  private shuffle: boolean = false;

  private listeners: Set<AudioEngineListener> = new Set();
  private timerId: number | null = null;

  constructor() {
    // Lazy init audio context on user action
  }

  private initAudioNodes() {
    if (this.audioCtx) return;
    try {
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.audioCtx = new AudioContextClass();
      this.gainNode = this.audioCtx.createGain();
      this.gainNode.gain.value = this.isMuted ? 0 : this.volume;

      // Create 10 band filters
      this.eqFilters = EQ_FREQUENCIES.map((freq, index) => {
        const filter = this.audioCtx!.createBiquadFilter();
        if (index === 0) {
          filter.type = 'lowshelf';
        } else if (index === EQ_FREQUENCIES.length - 1) {
          filter.type = 'highshelf';
        } else {
          filter.type = 'peaking';
          filter.Q.value = 1.4;
        }
        filter.frequency.value = freq;
        filter.gain.value = 0;
        return filter;
      });

      // Chain filters: filter0 -> filter1 -> ... -> gain -> destination
      for (let i = 0; i < this.eqFilters.length - 1; i++) {
        this.eqFilters[i].connect(this.eqFilters[i + 1]);
      }
      if (this.eqFilters.length > 0) {
        this.eqFilters[this.eqFilters.length - 1].connect(this.gainNode);
      }
      this.gainNode.connect(this.audioCtx.destination);
    } catch (e) {
      console.warn('Web Audio API not supported or initialized', e);
    }
  }

  public subscribe(listener: AudioEngineListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public play(track: Track): void {
    this.initAudioNodes();
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }

    this.currentTrack = track;
    this.duration = track.duration || 180;
    this.position = 0;
    this.setState('playing');

    this.startSimulationTimer();
  }

  public pause(): void {
    if (this.state === 'playing') {
      this.setState('paused');
      this.stopSimulationTimer();
    }
  }

  public resume(): void {
    if (this.state === 'paused' && this.currentTrack) {
      this.setState('playing');
      this.startSimulationTimer();
    }
  }

  public stop(): void {
    this.setState('stopped');
    this.position = 0;
    this.stopSimulationTimer();
    this.notifyPosition();
  }

  public seek(positionSecs: number): void {
    this.position = Math.max(0, Math.min(positionSecs, this.duration));
    this.notifyPosition();
  }

  public setVolume(vol: number): void {
    this.volume = Math.max(0, Math.min(1, vol));
    if (this.gainNode) {
      this.gainNode.gain.value = this.isMuted ? 0 : this.volume;
    }
  }

  public toggleMute(): boolean {
    this.isMuted = !this.isMuted;
    if (this.gainNode) {
      this.gainNode.gain.value = this.isMuted ? 0 : this.volume;
    }
    return this.isMuted;
  }

  public setLoopMode(mode: LoopMode): void {
    this.loopMode = mode;
  }

  public setShuffle(shuffle: boolean): void {
    this.shuffle = shuffle;
  }

  public setEqualizer(enabled: boolean, gains: number[]): void {
    if (!this.eqFilters || this.eqFilters.length === 0) return;
    this.eqFilters.forEach((filter, idx) => {
      const g = enabled && gains[idx] !== undefined ? gains[idx] : 0;
      filter.gain.value = g;
    });
  }

  public getStatus(): PlaybackStatus {
    return {
      state: this.state,
      current_track: this.currentTrack,
      position: this.position,
      duration: this.duration,
      volume: this.volume,
      is_muted: this.isMuted,
      loop_mode: this.loopMode,
      shuffle: this.shuffle,
    };
  }

  private setState(state: PlaybackState) {
    this.state = state;
    for (const l of this.listeners) {
      l.onStateChange(state);
    }
  }

  private notifyPosition() {
    for (const l of this.listeners) {
      l.onPositionChange(this.position);
    }
  }

  private startSimulationTimer() {
    this.stopSimulationTimer();
    this.timerId = window.setInterval(() => {
      if (this.state !== 'playing') return;
      this.position += 0.25;
      this.notifyPosition();

      if (this.position >= this.duration) {
        if (this.loopMode === 'track') {
          this.position = 0;
          this.notifyPosition();
        } else {
          this.stopSimulationTimer();
          for (const l of this.listeners) {
            l.onTrackEnded();
          }
        }
      }
    }, 250);
  }

  private stopSimulationTimer() {
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }
}

export const browserAudioEngine = new BrowserAudioEngine();
