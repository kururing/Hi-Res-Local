import React from 'react';
import { Track } from '../../types/library';

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
  bitrate,
  sampleRate,
  bitsPerSample,
  variant = 'quality',
  className = '',
}) => {
  const f = format || track?.format || (track?.path.endsWith('.flac') ? 'FLAC' : track?.path.endsWith('.wav') ? 'WAV' : 'MP3');
  const sr = sampleRate ?? track?.sample_rate;
  const br = bitrate ?? track?.bitrate;
  const bits = bitsPerSample ?? track?.bits_per_sample;

  const isHiRes = (sr && sr >= 88200) || (bits && bits >= 24) || f === 'DSD';

  let text = f;
  if (isHiRes) {
    const srKhz = sr ? `${Math.round(sr / 1000)}kHz` : '';
    const bitsText = bits ? `${bits}B` : '';
    text = `HI-RES • ${f} ${bitsText} ${srKhz}`.trim();
  } else if (f === 'FLAC') {
    text = 'FLAC LOSSLESS';
  } else if (br) {
    text = `${f} ${br}kbps`;
  }

  if (variant === 'accent') {
    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold tracking-wide bg-brand-accent/20 text-brand-accent border border-brand-accent/40 ${className}`}>
        {text}
      </span>
    );
  }

  if (isHiRes) {
    return (
      <span
        title="High-Resolution Audio Lossless Master"
        className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase bg-amber-500/15 text-amber-300 border border-amber-500/40 shadow-sm ${className}`}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 mr-1.5 animate-pulse" />
        {text}
      </span>
    );
  }

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium tracking-wider uppercase bg-indigo-950/80 text-brand-muted border border-brand-border/60 ${className}`}>
      {text}
    </span>
  );
};
