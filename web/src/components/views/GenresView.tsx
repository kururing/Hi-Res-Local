import React from 'react';
import { Radio, Music2 } from 'lucide-react';
import { useLibrary } from '../../context/LibraryContext';
import { useSettings } from '../../context/SettingsContext';
import { t } from '../../i18n';
import { activateOnKeyboard } from '../../services/keyboard';

interface GenresViewProps {
  onNavigate: (view: string, payload?: unknown) => void;
}

export const GenresView: React.FC<GenresViewProps> = ({ onNavigate }) => {
  const { genres } = useLibrary();
  const { settings } = useSettings();

  return (
    <div className="view-page mx-auto w-full max-w-7xl space-y-6 p-6 select-none md:p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold font-display text-brand-foreground">
            {t('genres_title', settings.language)}
          </h1>
          <span className="text-xs text-brand-muted">
            {t('genres_count', settings.language, { count: genres.length })}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-5">
        {genres.map(genre => (
          <div
            key={genre.name}
            onClick={() => onNavigate('genre_detail', genre)}
            onKeyDown={event => activateOnKeyboard(event, () => onNavigate('genre_detail', genre))}
            role="button"
            tabIndex={0}
            aria-label={`Open genre ${genre.name}`}
            className={`group min-w-0 p-5 rounded-2xl bg-gradient-to-br ${genre.color_gradient} border border-brand-border/70 hover:border-brand-accent cursor-pointer transition-all duration-300 transform hover:-translate-y-1 hover:shadow-card-elevated flex flex-col justify-between h-36 relative overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-white/80 uppercase tracking-wider">
                {t('detail_genre_label', settings.language)}
              </span>
              <Radio className="w-5 h-5 text-white/60 group-hover:scale-110 transition-transform" />
            </div>

            <div>
              <h3 className="block min-w-0 max-w-full truncate text-lg sm:text-xl font-bold text-white font-display" title={genre.name}>
                {genre.name}
              </h3>
              <span className="text-xs text-white/80 font-mono">
                {t('genre_tracks_count', settings.language, { count: genre.track_count })}
              </span>
            </div>

            {/* Background subtle decoration */}
            <Music2 className="absolute -bottom-4 -right-4 w-20 h-20 text-white/10 pointer-events-none" />
          </div>
        ))}
      </div>
    </div>
  );
};
