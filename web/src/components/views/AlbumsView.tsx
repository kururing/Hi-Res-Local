import React from 'react';
import { Play } from 'lucide-react';
import { useLibrary } from '../../context/LibraryContext';
import { usePlayer } from '../../context/PlayerContext';
import { useSettings } from '../../context/SettingsContext';
import { VirtualGrid } from '../common/VirtualGrid';
import { t } from '../../i18n';
import { AlbumArtwork } from '../common/AlbumArtwork';

interface AlbumsViewProps {
  onNavigate: (view: string, payload?: unknown) => void;
}

export const AlbumsView: React.FC<AlbumsViewProps> = ({ onNavigate }) => {
  const { albums } = useLibrary();
  const { playQueue } = usePlayer();
  const { settings } = useSettings();

  return (
    <div className="view-page mx-auto flex h-full min-h-0 w-full max-w-7xl flex-col gap-6 p-6 select-none md:p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold font-display text-brand-foreground">
            {t('albums_title', settings.language)}
          </h1>
          <span className="text-xs text-brand-muted">
            {t('library_albums_count', settings.language, { count: albums.length })}
          </span>
        </div>
      </div>

      {albums.length === 0 ? (
        <div className="p-12 text-center text-brand-muted">{t('empty_albums', settings.language)}</div>
      ) : (
        <VirtualGrid
          items={albums}
          minColumnWidth={170}
          gap={20}
          getRowHeight={colWidth => colWidth + 66}
          className="min-h-0 flex-1"
          getKey={album => album.id}
          renderItem={album => (
            <div
              className="group relative min-w-0 p-3.5 rounded-2xl bg-oled-card hover:bg-oled-hover border border-brand-border/60 hover:border-brand-border cursor-pointer transition-all flex flex-col shadow-card-elevated"
            >
              <button
                type="button"
                onClick={() => onNavigate('album_detail', album)}
                aria-label={t('home_open_album', settings.language, { name: album.name, artist: album.artist })}
                className="absolute inset-0 z-10 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
              />
              {/* Artwork Box */}
              <div className="relative aspect-square rounded-xl bg-gradient-to-tr from-brand-primary to-oled-card border border-brand-border/60 mb-3 flex items-center justify-center overflow-hidden">
                <AlbumArtwork album={album} alt={`${album.name} cover`} />
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                  <button
                    type="button"
                    onClick={e => {
                      e.stopPropagation();
                      if (album.tracks.length > 0) playQueue(album.tracks, 0);
                    }}
                    className="relative z-20 w-11 h-11 min-h-[44px] min-w-[44px] rounded-full bg-brand-accent text-oled-base flex items-center justify-center shadow-glow-accent hover:scale-105 active:scale-95 transition-all focus-visible:outline-none"
                    aria-label={t('home_play_album', settings.language, { name: album.name })}
                  >
                    <Play className="w-5 h-5 fill-current ml-0.5" aria-hidden="true" />
                  </button>
                </div>
              </div>

              {/* Title & Artist */}
              <span className="block min-w-0 max-w-full truncate font-semibold text-xs sm:text-sm text-brand-foreground group-hover:text-brand-accent transition-colors" title={album.name}>
                {album.name}
              </span>
              <span className="mt-0.5 block min-w-0 max-w-full truncate text-xs text-brand-muted font-medium" title={album.artist}>
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
