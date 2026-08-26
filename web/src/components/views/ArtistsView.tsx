import React from 'react';
import { useLibrary } from '../../context/LibraryContext';
import { useSettings } from '../../context/SettingsContext';
import { VirtualGrid } from '../common/VirtualGrid';
import { t } from '../../i18n';
import { activateOnKeyboard } from '../../services/keyboard';
import { RemoteArtwork } from '../common/RemoteArtwork';

interface ArtistsViewProps {
  onNavigate: (view: string, payload?: unknown) => void;
}

export const ArtistsView: React.FC<ArtistsViewProps> = ({ onNavigate }) => {
  const { artists } = useLibrary();
  const { settings } = useSettings();

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-7xl flex-col gap-6 p-6 select-none md:p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold font-display text-brand-foreground">
            {t('artists_title', settings.language)}
          </h1>
          <span className="text-xs text-brand-muted">
            {t('library_artists_count', settings.language, { count: artists.length })}
          </span>
        </div>
      </div>

      {artists.length === 0 ? (
        <div className="p-12 text-center text-brand-muted">{t('empty_artists', settings.language)}</div>
      ) : (
        <VirtualGrid
          items={artists}
          minColumnWidth={170}
          gap={24}
          getRowHeight={() => 204}
          className="min-h-0 flex-1"
          getKey={artist => artist.id}
          renderItem={artist => (
            <div
              onClick={() => onNavigate('artist_detail', artist)}
              onKeyDown={event => activateOnKeyboard(event, () => onNavigate('artist_detail', artist))}
              role="button"
              tabIndex={0}
              aria-label={t('favorite_artist_open', settings.language, { name: artist.name })}
              className="group p-4 rounded-2xl bg-oled-card hover:bg-oled-hover border border-brand-border/60 hover:border-brand-border cursor-pointer transition-all flex flex-col items-center text-center shadow-card-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
            >
              {/* Circle Avatar */}
              <div className="relative w-28 h-28 rounded-full bg-gradient-to-tr from-brand-primary to-oled-card border-2 border-brand-border/80 mb-3 flex items-center justify-center overflow-hidden group-hover:scale-105 group-hover:border-brand-accent transition-all duration-300 shadow-md">
                <RemoteArtwork kind="artist" artist={artist.name} alt={`${artist.name} portrait`} />
              </div>

              {/* Name & Counts */}
              <span className="font-semibold text-sm text-brand-foreground truncate w-full group-hover:text-brand-accent transition-colors">
                {artist.name}
              </span>
              <span className="text-xs text-brand-muted mt-1 font-mono">
                {t('artist_library_summary', settings.language, { albums: artist.album_count, tracks: artist.track_count })}
              </span>
            </div>
          )}
        />
      )}
    </div>
  );
};
