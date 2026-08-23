import React, { useState } from 'react';
import { Star } from 'lucide-react';

interface RatingProps {
  value: number; // 0 to 5
  onChange?: (rating: number) => void;
  readOnly?: boolean;
  size?: 'sm' | 'md';
}

export const Rating: React.FC<RatingProps> = ({
  value = 0,
  onChange,
  readOnly = false,
  size = 'md',
}) => {
  const [hoverValue, setHoverValue] = useState<number | null>(null);

  const starSize = size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4';
  const effectiveValue = hoverValue !== null ? hoverValue : value;

  const handleClick = (idx: number) => {
    if (readOnly || !onChange) return;
    if (value === idx) {
      onChange(0); // clear rating
    } else {
      onChange(idx);
    }
  };

  return (
    <div
      className="inline-flex items-center gap-0.5"
      role={readOnly ? 'img' : 'radiogroup'}
      aria-label={`Rating: ${value} of 5 stars`}
      onMouseLeave={() => !readOnly && setHoverValue(null)}
    >
      {[1, 2, 3, 4, 5].map(starIdx => {
        const isFilled = starIdx <= effectiveValue;

        if (readOnly) {
          return (
            <Star
              key={starIdx}
              className={`${starSize} ${
                isFilled ? 'text-amber-400 fill-amber-400' : 'text-slate-600'
              }`}
            />
          );
        }

        return (
          <button
            key={starIdx}
            type="button"
            className="p-1 min-h-[32px] min-w-[32px] flex items-center justify-center rounded hover:scale-110 transition-transform focus-visible:outline-none"
            onClick={() => handleClick(starIdx)}
            onMouseEnter={() => setHoverValue(starIdx)}
            aria-label={`${starIdx} star`}
          >
            <Star
              className={`${starSize} transition-colors ${
                isFilled ? 'text-amber-400 fill-amber-400' : 'text-slate-600 hover:text-amber-300'
              }`}
            />
          </button>
        );
      })}
    </div>
  );
};
