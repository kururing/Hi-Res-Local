import React from 'react';
import { Track } from '../../types/library';
import { formatPcmQuality, formatQualityLabel } from '../../services/trackPresentation';

interface BadgeProps {
  track?: Track;
  format?: string;
  bitrate?: number | null;
  sampleRate?: number | null;
  bitsPerSample?: number | null;
  variant?: 'quality' | 'genre' | 'accent';
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({
  track,
  format,
  sampleRate,
  bitsPerSample,
  variant = 'quality',
  className = '',
}) => {
  const rawFormat = format || track?.format || (track?.path.endsWith('.flac') ? 'FLAC' : track?.path.endsWith('.wav') ? 'WAV' : 'MP3');
  const isDsd = /^(dsf|dff|dsd)$/i.test(rawFormat);
  const isMqa = track?.is_mqa === true;
  const f = isMqa ? 'MQA' : isDsd ? 'DSD' : rawFormat;
  const sr = sampleRate ?? track?.sample_rate;
  const bits = bitsPerSample ?? track?.bit_depth ?? track?.bits_per_sample;

  const isHiRes = (sr && sr >= 88200) || (bits && bits >= 24) || isDsd || isMqa;
  const isLossless = ['FLAC', 'WAV', 'ALAC', 'AIFF', 'APE', 'DSD'].includes(f.toUpperCase());

  const text = variant === 'quality' && track
    ? formatQualityLabel(track)
    : f || 'Audio';
  const visibleQualityText = isMqa && track ? formatPcmQuality(track) || f : text;
  const qualityText = variant === 'quality' ? (
    <span className="whitespace-nowrap">
      <span className="quality-badge-compact">{f.toUpperCase()}</span>
      <span className="quality-badge-full">{visibleQualityText}</span>
    </span>
  ) : text;

  if (variant === 'accent') {
    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold tracking-wide bg-brand-accent/20 text-brand-accent border border-brand-accent/40 ${className}`}>
        {qualityText}
      </span>
    );
  }

  if (isHiRes) {
    return (
      <span
        title={`${f.toUpperCase()} · ${text}`}
        aria-label={`${f.toUpperCase()} · ${text}`}
        className={`inline-flex items-center rounded-md border border-cyan-400 bg-cyan-100 px-1.5 py-0.5 text-[10px] font-bold tracking-normal text-cyan-950 shadow-sm ${className}`}
      >
        {qualityText}
      </span>
    );
  }

  if (isLossless) {
    return (
      <span
        title={`${f.toUpperCase()} · ${text}`}
        aria-label={`${f.toUpperCase()} · ${text}`}
        className={`inline-flex items-center rounded-md border border-emerald-400 bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold tracking-normal text-emerald-950 shadow-sm ${className}`}
      >
        {qualityText}
      </span>
    );
  }

  return (
    <span
      title={`${f.toUpperCase()} · ${text}`}
      aria-label={`${f.toUpperCase()} · ${text}`}
      className={`inline-flex items-center rounded-md border border-amber-400 bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold tracking-normal text-amber-950 shadow-sm ${className}`}
    >
      {qualityText}
    </span>
  );
};
