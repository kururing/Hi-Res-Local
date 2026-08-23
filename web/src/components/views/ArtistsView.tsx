import React from 'react';
import { User } from 'lucide-react';
import { useLibrary } from '../../context/LibraryContext';
import { useSettings } from '../../context/SettingsContext';
import { t } from '../../i18n';

interface ArtistsViewProps {
  onNavigate: (view: string, payload?: unknown) => void;
}

export const ArtistsView: React.FC<ArtistsViewProps> = ({ onNavigate }) => {
  const { artists } = useLibrary();
  const { settings } = useSettings();

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-7xl mx-auto w-full select-none">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold font-display text-brand-foreground">
            {t('artists_title', settings.language)}
          </h1>
          <span className="text-xs text-brand-muted">
            {artists.length} artists in library
          </span>
        </div>
      </div>

      {artists.length === 0 ? (
        <div className="p-12 text-center text-brand-muted">No artists found in library.</div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
          {artists.map(artist => (
            <div
              key={artist.id}
              onClick={() => onNavigate('artist_detail', artist)}
              className="group p-4 rounded-2xl bg-oled-card hover:bg-oled-hover border border-brand-border/60 hover:border-brand-border cursor-pointer transition-all flex flex-col items-center text-center shadow-card-elevated"
            >
              {/* Circle Avatar */}
              <div className="relative w-28 h-28 rounded-full bg-gradient-to-tr from-indigo-950 to-slate-900 border-2 border-brand-border/80 mb-3 flex items-center justify-center overflow-hidden group-hover:scale-105 group-hover:border-brand-accent transition-all duration-300 shadow-md">
                <User className="w-12 h-12 text-indigo-400/60" />
              </div>

              {/* Name & Counts */}
              <span className="font-semibold text-sm text-brand-foreground truncate w-full group-hover:text-brand-accent transition-colors">
                {artist.name}
              </span>
              <span className="text-xs text-brand-muted mt-1 font-mono">
                {artist.album_count} albums • {artist.track_count} tracks
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
