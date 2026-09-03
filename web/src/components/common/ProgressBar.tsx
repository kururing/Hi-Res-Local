import React from 'react';

interface ProgressBarProps {
  value: number;
  label: string;
  statusText: string;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({ value, label, statusText }) => {
  const percent = Math.max(0, Math.min(100, value));
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-medium text-brand-foreground">{label}</span>
        <span className="text-brand-muted">{statusText}</span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="h-2.5 overflow-hidden rounded-full border border-brand-border/70 bg-oled-base"
      >
        <div
          className="h-full rounded-full bg-brand-accent motion-safe:transition-[width] motion-safe:duration-200"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
};
