import React from 'react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { Track } from '../../types/library';
import { useSettings } from '../../context/SettingsContext';
import { useToast } from '../../context/ToastContext';
import { Copy, FileAudio, HardDrive } from 'lucide-react';
import { t } from '../../i18n';

interface TrackDetailsModalProps {
  track: Track | null;
  isOpen: boolean;
  onClose: () => void;
}

export const TrackDetailsModal: React.FC<TrackDetailsModalProps> = ({
  track,
  isOpen,
  onClose,
}) => {
  const { settings } = useSettings();
  const { showToast } = useToast();

  if (!track || !isOpen) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(track.path);
    showToast(t('toast_copied', settings.language), 'info');
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('track_details_title', settings.language)}
      maxWidth="lg"
    >
      <div className="flex flex-col gap-5">
        {/* Track Title Banner */}
        <div className="flex items-center gap-3 p-4 rounded-xl bg-oled-base/80 border border-brand-border">
          <div className="w-12 h-12 rounded-xl bg-indigo-950 flex items-center justify-center text-brand-accent shrink-0">
            <FileAudio className="w-6 h-6" />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="font-bold text-base text-white truncate">{track.title}</span>
            <span className="text-xs text-brand-muted truncate">
              {track.artist} • {track.album}
            </span>
          </div>
        </div>

        {/* Technical Audio Specs Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div className="p-3 rounded-xl bg-oled-base/50 border border-brand-border/60 flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-brand-muted uppercase">
              {t('detail_format', settings.language)}
            </span>
            <span className="font-mono text-sm font-bold text-brand-accent">
              {track.format || 'FLAC'} {track.bits_per_sample ? `${track.bits_per_sample}-bit` : ''}
            </span>
          </div>

          <div className="p-3 rounded-xl bg-oled-base/50 border border-brand-border/60 flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-brand-muted uppercase">
              {t('detail_sample_rate', settings.language)}
            </span>
            <span className="font-mono text-sm font-bold text-indigo-300">
              {track.sample_rate ? `${track.sample_rate / 1000} kHz` : '44.1 kHz'}
            </span>
          </div>

          <div className="p-3 rounded-xl bg-oled-base/50 border border-brand-border/60 flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-brand-muted uppercase">
              {t('detail_bitrate', settings.language)}
            </span>
            <span className="font-mono text-sm font-bold text-emerald-400">
              {track.bitrate ? `${track.bitrate} kbps` : '1411 kbps'}
            </span>
          </div>

          <div className="p-3 rounded-xl bg-oled-base/50 border border-brand-border/60 flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-brand-muted uppercase">
              {t('detail_channels', settings.language)}
            </span>
            <span className="font-mono text-sm font-bold text-brand-foreground">
              {track.channels === 1 ? 'Mono (1ch)' : 'Stereo (2ch)'}
            </span>
          </div>

          <div className="p-3 rounded-xl bg-oled-base/50 border border-brand-border/60 flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-brand-muted uppercase">
              Genre & Year
            </span>
            <span className="font-mono text-sm font-bold text-brand-foreground truncate">
              {track.genre || 'Music'} {track.year ? `(${track.year})` : ''}
            </span>
          </div>

          <div className="p-3 rounded-xl bg-oled-base/50 border border-brand-border/60 flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-brand-muted uppercase">
              Plays & Rating
            </span>
            <span className="font-mono text-sm font-bold text-amber-400">
              {track.play_count || 0} plays • {track.rating || 0}★
            </span>
          </div>
        </div>

        {/* File Path */}
        <div className="flex flex-col gap-1.5 p-3 rounded-xl bg-oled-base/50 border border-brand-border/60">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-brand-muted uppercase flex items-center gap-1.5">
              <HardDrive className="w-3.5 h-3.5" aria-hidden="true" />
              {t('detail_path', settings.language)}
            </span>
            <button
              onClick={handleCopy}
              className="min-h-[44px] px-2 text-xs text-brand-accent hover:underline flex items-center gap-1 focus-visible:outline-none"
              aria-label="Copy track file path"
            >
              <Copy className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Copy</span>
            </button>
          </div>
          <span className="font-mono text-xs text-brand-foreground break-all bg-oled-card p-2 rounded border border-brand-border/40 select-all">
            {track.path}
          </span>
        </div>

        <div className="flex items-center justify-end pt-2">
          <Button size="sm" variant="secondary" onClick={onClose}>
            {t('btn_close', settings.language)}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
