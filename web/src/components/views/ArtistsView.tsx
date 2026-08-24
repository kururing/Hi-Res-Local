import React from 'react';
import { User } from 'lucide-react';
import { useLibrary } from '../../context/LibraryContext';
import { useSettings } from '../../context/SettingsContext';
import { VirtualGrid } from '../common/VirtualGrid';
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
        <VirtualGrid
          items={artists}
          minColumnWidth={170}
          gap={24}
          getRowHeight={() => 204}
          className="max-h-[75vh]"
          getKey={artist => artist.id}
          renderItem={artist => (
            <div
              onClick={() => onNavigate('artist_detail', artist)}
              className="group p-4 rounded-2xl bg-oled-card hover:bg-oled-hover border border-brand-border/60 hover:border-brand-border cursor-pointer transition-all flex flex-col items-center text-center shadow-card-elevated"
            >
              {/* Circle Avatar */}
              <div className="relative w-28 h-28 rounded-full bg-gradient-to-tr from-brand-primary to-oled-card border-2 border-brand-border/80 mb-3 flex items-center justify-center overflow-hidden group-hover:scale-105 group-hover:border-brand-accent transition-all duration-300 shadow-md">
                <User className="w-12 h-12 text-brand-accent/60" />
              </div>

              {/* Name & Counts */}
              <span className="font-semibold text-sm text-brand-foreground truncate w-full group-hover:text-brand-accent transition-colors">
                {artist.name}
              </span>
              <span className="text-xs text-brand-muted mt-1 font-mono">
                {artist.album_count} albums • {artist.track_count} tracks
              </span>
            </div>
          )}
        />
      )}
    </div>
  );
};
