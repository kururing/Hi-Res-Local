import React from 'react';
import { Disc, Play } from 'lucide-react';
import { useLibrary } from '../../context/LibraryContext';
import { usePlayer } from '../../context/PlayerContext';
import { useSettings } from '../../context/SettingsContext';
import { VirtualGrid } from '../common/VirtualGrid';
import { t } from '../../i18n';

interface AlbumsViewProps {
  onNavigate: (view: string, payload?: unknown) => void;
}

export const AlbumsView: React.FC<AlbumsViewProps> = ({ onNavigate }) => {
  const { albums } = useLibrary();
  const { playQueue } = usePlayer();
  const { settings } = useSettings();

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-7xl mx-auto w-full select-none">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold font-display text-brand-foreground">
            {t('albums_title', settings.language)}
          </h1>
          <span className="text-xs text-brand-muted">
            {albums.length} albums in library
          </span>
        </div>
      </div>

      {albums.length === 0 ? (
        <div className="p-12 text-center text-brand-muted">No albums found in library.</div>
      ) : (
        <VirtualGrid
          items={albums}
          minColumnWidth={170}
          gap={20}
          getRowHeight={colWidth => colWidth + 66}
          className="max-h-[75vh]"
          getKey={album => album.id}
          renderItem={album => (
            <div
              className="group relative p-3.5 rounded-2xl bg-oled-card hover:bg-oled-hover border border-brand-border/60 hover:border-brand-border cursor-pointer transition-all flex flex-col shadow-card-elevated"
            >
              <button
                type="button"
                onClick={() => onNavigate('album_detail', album)}
                aria-label={`Open album ${album.name} by ${album.artist}`}
                className="absolute inset-0 z-10 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
              />
              {/* Artwork Box */}
              <div className="relative aspect-square rounded-xl bg-gradient-to-tr from-brand-primary to-oled-card border border-brand-border/60 mb-3 flex items-center justify-center overflow-hidden">
                <Disc className="w-16 h-16 text-brand-accent/40 group-hover:rotate-90 transition-transform duration-700" aria-hidden="true" />
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                  <button
                    type="button"
                    onClick={e => {
                      e.stopPropagation();
                      if (album.tracks.length > 0) playQueue(album.tracks, 0);
                    }}
                    className="relative z-20 w-11 h-11 min-h-[44px] min-w-[44px] rounded-full bg-brand-accent text-oled-base flex items-center justify-center shadow-glow-accent hover:scale-105 active:scale-95 transition-all focus-visible:outline-none"
                    aria-label={`Play ${album.name}`}
                  >
                    <Play className="w-5 h-5 fill-current ml-0.5" aria-hidden="true" />
                  </button>
                </div>
              </div>

              {/* Title & Artist */}
              <span className="font-semibold text-xs sm:text-sm text-brand-foreground truncate group-hover:text-brand-accent transition-colors">
                {album.name}
              </span>
              <span className="text-xs text-brand-muted truncate mt-0.5 font-medium">
                {album.artist}
              </span>
              <span className="text-[10px] text-brand-muted font-mono mt-1">
                {album.track_count} tracks {album.year ? `• ${album.year}` : ''}
              </span>
            </div>
          )}
        />
      )}
    </div>
  );
};
