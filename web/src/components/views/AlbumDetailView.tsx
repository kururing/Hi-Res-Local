import React, { useState } from 'react';
import {
  Play,
  Shuffle,
  Heart,
  Disc,
  ArrowLeft,
  MoreVertical,
} from 'lucide-react';
import { useLibrary } from '../../context/LibraryContext';
import { usePlayer } from '../../context/PlayerContext';
import { useSettings } from '../../context/SettingsContext';
import { Button } from '../common/Button';
import { Badge } from '../common/Badge';
import { ContextMenu, ContextMenuState } from '../common/ContextMenu';
import { Album, Track } from '../../types/library';
import { t } from '../../i18n';

function formatDuration(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

interface AlbumDetailViewProps {
  album: Album;
  onNavigate: (view: string, payload?: unknown) => void;
  onOpenDetails: (track: Track) => void;
}

export const AlbumDetailView: React.FC<AlbumDetailViewProps> = ({
  album,
  onNavigate,
  onOpenDetails,
}) => {
  const { toggleFavoriteTrack, favoriteTrackIds, toggleFavoriteAlbum, favoriteAlbumKeys } = useLibrary();
  const { playTrack, playQueue, status } = usePlayer();
  const { settings } = useSettings();

  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    isOpen: false,
    x: 0,
    y: 0,
    track: null,
  });

  const isAlbumFav = favoriteAlbumKeys.has(album.id);

  // Group tracks by disc number
  const discGroups = React.useMemo(() => {
    const groups = new Map<number, Track[]>();
    for (const track of album.tracks) {
      const disc = track.disc_number || 1;
      const list = groups.get(disc) || [];
      list.push(track);
      groups.set(disc, list);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a - b);
  }, [album.tracks]);

  const handleContextMenu = (e: React.MouseEvent, track: Track) => {
    e.preventDefault();
    setContextMenu({
      isOpen: true,
      x: e.clientX,
      y: e.clientY,
      track,
      onOpenDetails,
      onNavigateArtist: name => {
        onNavigate('artist_detail', { id: name, name, track_count: 1, album_count: 1, albums: [], genres: [] });
      },
    });
  };

  return (
    <div className="p-6 md:p-8 space-y-8 max-w-7xl mx-auto w-full select-none">
      {/* Back Button */}
      <button
        onClick={() => onNavigate('albums')}
        className="inline-flex items-center gap-2 text-xs font-semibold text-brand-muted hover:text-brand-foreground transition-colors focus-visible:outline-none"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Back to Albums</span>
      </button>

      {/* Album Header Banner */}
      <div className="flex flex-col sm:flex-row items-center sm:items-end gap-6 p-6 rounded-2xl bg-gradient-to-r from-brand-primary via-brand-primary/60 to-oled-card border border-brand-border shadow-card-elevated">
        <div className="w-44 h-44 sm:w-52 sm:h-52 rounded-2xl bg-gradient-to-tr from-brand-primary to-oled-card border border-brand-border flex items-center justify-center shrink-0 shadow-2xl overflow-hidden">
          <Disc className="w-24 h-24 text-brand-accent/40" />
        </div>

        <div className="flex flex-col gap-2 min-w-0 text-center sm:text-left flex-1">
          <span className="text-xs font-bold uppercase tracking-wider text-brand-accent">
            Album
          </span>
          <h1 className="text-2xl sm:text-4xl font-bold font-display text-brand-foreground truncate">
            {album.name}
          </h1>
          <p
            onClick={() => onNavigate('artist_detail', { id: album.artist, name: album.artist, track_count: 1, album_count: 1, albums: [album], genres: [] })}
            className="text-base sm:text-lg font-medium text-brand-muted hover:text-brand-accent cursor-pointer transition-colors"
          >
            {album.artist}
          </p>

          <div className="flex flex-wrap items-center justify-center sm:justify-start gap-3 text-xs text-brand-muted mt-1 font-mono">
            {album.year && <span>{album.year}</span>}
            <span>•</span>
            <span>{album.track_count} tracks</span>
            <span>•</span>
            <span>{formatDuration(album.total_duration)}</span>
            {album.genre && (
              <>
                <span>•</span>
                <span className="px-2 py-0.5 rounded-full bg-brand-primary/80 text-brand-muted text-[10px]">
                  {album.genre}
                </span>
              </>
            )}
          </div>

          <div className="flex items-center justify-center sm:justify-start gap-3 mt-4">
            <Button
              variant="accent"
              size="md"
              icon={<Play className="w-4 h-4 fill-current" />}
              onClick={() => playQueue(album.tracks, 0)}
            >
              Play Album
            </Button>
            <Button
              variant="secondary"
              size="md"
              icon={<Shuffle className="w-4 h-4" />}
              onClick={() => {
                const shuffled = [...album.tracks].sort(() => Math.random() - 0.5);
                playQueue(shuffled, 0);
              }}
            >
              Shuffle
            </Button>
            <button
              onClick={() => toggleFavoriteAlbum(album.id)}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl bg-oled-card border border-brand-border text-brand-muted hover:text-rose-400 transition-colors focus-visible:outline-none"
              aria-label="Toggle album favorite"
              aria-pressed={isAlbumFav}
            >
              <Heart
                aria-hidden="true"
                className={`w-5 h-5 ${
                  isAlbumFav ? 'text-rose-500 fill-rose-500' : 'text-brand-muted'
                }`}
              />
            </button>
          </div>
        </div>
      </div>

      {/* Discs & Tracklists */}
      <div className="space-y-6">
        {discGroups.map(([discNum, discTracks]) => (
          <div key={discNum} className="space-y-3">
            {discGroups.length > 1 && (
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-brand-muted px-2">
                <Disc className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{t('disc_number', settings.language, { disc: discNum })}</span>
              </div>
            )}

            <div className="rounded-xl border border-brand-border bg-oled-card/60 overflow-hidden divide-y divide-brand-border/30">
              {discTracks.map((tr, index) => {
                const isPlaying = status.current_track?.id === tr.id;
                const isFav = favoriteTrackIds.has(tr.id);

                return (
                  <div
                    key={tr.id}
                    onContextMenu={e => handleContextMenu(e, tr)}
                    onDoubleClick={() => playTrack(tr, album.tracks)}
                    className={`grid grid-cols-12 gap-4 px-4 py-3 text-xs items-center group transition-colors cursor-pointer select-none ${
                      isPlaying
                        ? 'bg-brand-accent/10 text-brand-accent font-medium'
                        : 'hover:bg-oled-hover text-brand-foreground'
                    }`}
                  >
                    <div className="col-span-1 text-center font-mono flex items-center justify-center">
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          playTrack(tr, album.tracks);
                        }}
                        className="w-11 h-11 min-h-[44px] min-w-[44px] rounded-full flex items-center justify-center text-brand-muted group-hover:text-brand-accent group-hover:bg-oled-base transition-all focus-visible:outline-none"
                        aria-label={`Play ${tr.title}`}
                      >
                        {isPlaying ? (
                          <span className="w-2.5 h-2.5 rounded-full bg-brand-accent animate-pulse" />
                        ) : (
                          <>
                            <span className="group-hover:hidden text-brand-muted">
                              {tr.track_number || index + 1}
                            </span>
                            <Play className="w-3.5 h-3.5 fill-current hidden group-hover:block ml-0.5" aria-hidden="true" />
                          </>
                        )}
                      </button>
                    </div>

                    <div className="col-span-6 flex flex-col min-w-0 pr-2">
                      <span className="font-semibold truncate group-hover:text-brand-accent transition-colors">
                        {tr.title}
                      </span>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Badge track={tr} />
                      </div>
                    </div>

                    <div className="col-span-5 flex items-center justify-end gap-1">
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          toggleFavoriteTrack(tr.id);
                        }}
                        className="p-1 min-h-[44px] min-w-[44px] flex items-center justify-center rounded hover:bg-brand-accent/10 text-brand-muted hover:text-rose-500 transition-colors focus-visible:outline-none"
                        aria-label={isFav ? 'Remove from favorites' : 'Add to favorites'}
                        aria-pressed={isFav}
                      >
                        <Heart
                          aria-hidden="true"
                          className={`w-4 h-4 ${
                            isFav ? 'text-rose-500 fill-rose-500' : 'text-brand-muted'
                          }`}
                        />
                      </button>

                      <span className="font-mono text-brand-muted tabular-nums">
                        {formatDuration(tr.duration)}
                      </span>

                      <button
                        onClick={e => {
                          e.stopPropagation();
                          handleContextMenu(e, tr);
                        }}
                        className="p-1 min-h-[44px] min-w-[44px] flex items-center justify-center rounded text-brand-muted hover:text-brand-foreground hover:bg-brand-accent/10 opacity-0 group-hover:opacity-100 transition-opacity focus-visible:outline-none"
                        aria-label="More actions"
                      >
                        <MoreVertical className="w-4 h-4" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <ContextMenu state={contextMenu} onClose={() => setContextMenu(prev => ({ ...prev, isOpen: false }))} />
    </div>
  );
};
