import React, { useRef } from 'react';

interface SliderProps {
  value: number; // 0 to max
  min?: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  ariaLabel?: string;
  className?: string;
  showTooltip?: boolean;
  formatTooltip?: (value: number) => string;
  compact?: boolean;
  disabled?: boolean;
}

export const Slider: React.FC<SliderProps> = ({
  value,
  min = 0,
  max,
  step = 1,
  onChange,
  ariaLabel = 'Seek Slider',
  className = '',
  compact = false,
  disabled = false,
}) => {
  const percentage = max > min ? Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100)) : 0;
  const sliderRef = useRef<HTMLDivElement>(null);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || !sliderRef.current) return;
    const rect = sliderRef.current.getBoundingClientRect();
    const calculateValue = (clientX: number) => {
      const offsetX = Math.max(0, Math.min(clientX - rect.left, rect.width));
      const ratio = rect.width > 0 ? offsetX / rect.width : 0;
      const rawVal = min + ratio * (max - min);
      const steppedVal = Math.round(rawVal / step) * step;
      onChange(Math.min(max, Math.max(min, steppedVal)));
    };

    calculateValue(e.clientX);

    const onPointerMove = (moveEvt: PointerEvent) => {
      calculateValue(moveEvt.clientX);
    };

    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault();
      onChange(Math.min(max, value + (step || 1)));
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      onChange(Math.max(min, value - (step || 1)));
    } else if (e.key === 'Home') {
      e.preventDefault();
      onChange(min);
    } else if (e.key === 'End') {
      e.preventDefault();
      onChange(max);
    }
  };

  return (
    <div
      ref={sliderRef}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={ariaLabel}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-disabled={disabled}
      onPointerDown={handlePointerDown}
      onKeyDown={handleKeyDown}
      className={`group relative ${compact ? 'min-h-9' : 'min-h-[44px]'} flex items-center ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'} touch-none select-none rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent/70 ${className}`}
    >
      {/* Background Track */}
      <div className="w-full h-1.5 bg-oled-base/80 border border-brand-border/50 rounded-full relative overflow-hidden transition-all duration-150 group-hover:h-2">
        {/* Filled Progress */}
        <div
          className="absolute left-0 top-0 bottom-0 bg-brand-accent rounded-full transition-[width] duration-75 group-hover:bg-brand-accentHover"
          style={{ width: `${percentage}%` }}
        />
      </div>

      {/* Thumb Handle */}
      <div
        className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 bg-brand-accent rounded-full shadow-glow-accent opacity-0 scale-75 group-hover:opacity-100 group-hover:scale-110 group-focus-visible:opacity-100 group-focus-visible:scale-125 transition-all duration-150 pointer-events-none"
        style={{ left: `${percentage}%` }}
      />
    </div>
  );
};
