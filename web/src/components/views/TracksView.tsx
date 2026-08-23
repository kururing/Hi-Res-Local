import React, { useState } from 'react';
import {
  Play,
  Shuffle,
  Heart,
  MoreVertical,
  Music2,
  FolderPlus,
  ArrowUpDown,
} from 'lucide-react';
import { useLibrary } from '../../context/LibraryContext';
import { usePlayer } from '../../context/PlayerContext';
import { useSettings } from '../../context/SettingsContext';
import { Badge } from '../common/Badge';
import { Rating } from '../common/Rating';
import { Button } from '../common/Button';
import { ContextMenu, ContextMenuState } from '../common/ContextMenu';
import { Track } from '../../types/library';
import { t } from '../../i18n';

function formatDuration(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

type SortKey = 'title' | 'artist' | 'album' | 'duration' | 'rating' | 'date_added';

interface TracksViewProps {
  onNavigate: (view: string, payload?: unknown) => void;
  onOpenDetails: (track: Track) => void;
}

export const TracksView: React.FC<TracksViewProps> = ({ onNavigate, onOpenDetails }) => {
  const { tracks, toggleFavoriteTrack, favoriteTrackIds, setTrackRating, scanDirectory } = useLibrary();
  const { playTrack, playQueue, status } = usePlayer();
  const { settings } = useSettings();

  const [sortKey, setSortKey] = useState<SortKey>('date_added');
  const [sortAsc, setSortAsc] = useState<boolean>(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    isOpen: false,
    x: 0,
    y: 0,
    track: null,
  });

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  };

  const sortedTracks = React.useMemo(() => {
    const list = [...tracks];
    list.sort((a, b) => {
      let valA: string | number = '';
      let valB: string | number = '';

      if (sortKey === 'title') {
        valA = a.title.toLowerCase();
        valB = b.title.toLowerCase();
      } else if (sortKey === 'artist') {
        valA = a.artist.toLowerCase();
        valB = b.artist.toLowerCase();
      } else if (sortKey === 'album') {
        valA = a.album.toLowerCase();
        valB = b.album.toLowerCase();
      } else if (sortKey === 'duration') {
        valA = a.duration || 0;
        valB = b.duration || 0;
      } else if (sortKey === 'rating') {
        valA = a.rating || 0;
        valB = b.rating || 0;
      } else if (sortKey === 'date_added') {
        valA = new Date(a.date_added).getTime();
        valB = new Date(b.date_added).getTime();
      }

      if (valA < valB) return sortAsc ? -1 : 1;
      if (valA > valB) return sortAsc ? 1 : -1;
      return 0;
    });
    return list;
  }, [tracks, sortKey, sortAsc]);

  const handleContextMenu = (e: React.MouseEvent, track: Track) => {
    e.preventDefault();
    setContextMenu({
      isOpen: true,
      x: e.clientX,
      y: e.clientY,
      track,
      onOpenDetails,
      onNavigateAlbum: name => {
        const al = { id: name, name, artist: track.artist, track_count: 1, total_duration: track.duration, tracks: [track] };
        onNavigate('album_detail', al);
      },
      onNavigateArtist: name => {
        const ar = { id: name, name, track_count: 1, album_count: 1, albums: [], genres: [] };
        onNavigate('artist_detail', ar);
      },
    });
  };

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-7xl mx-auto w-full select-none">
      {/* Header Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold font-display text-brand-foreground">
            {t('tracks_title', settings.language)}
          </h1>
          <span className="text-xs text-brand-muted">
            {tracks.length} tracks in library
          </span>
        </div>

        {tracks.length > 0 && (
          <div className="flex items-center gap-3">
            <Button
              variant="accent"
              size="md"
              icon={<Play className="w-4 h-4 fill-current" />}
              onClick={() => playQueue(sortedTracks, 0)}
            >
              {t('tracks_play_all', settings.language)}
            </Button>
            <Button
              variant="secondary"
              size="md"
              icon={<Shuffle className="w-4 h-4" />}
              onClick={() => {
                const shuffled = [...sortedTracks].sort(() => Math.random() - 0.5);
                playQueue(shuffled, 0);
              }}
            >
              {t('tracks_shuffle_all', settings.language)}
            </Button>
          </div>
        )}
      </div>

      {/* Tracks Table */}
      {tracks.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-16 rounded-2xl bg-oled-card/50 border border-brand-border/60 text-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-indigo-950/80 border border-brand-border flex items-center justify-center text-brand-muted">
            <Music2 className="w-8 h-8" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-brand-foreground">
              {t('empty_tracks_title', settings.language)}
            </h3>
            <p className="text-xs text-brand-muted max-w-sm mt-1">
              {t('empty_tracks_desc', settings.language)}
            </p>
          </div>
          <Button
            variant="accent"
            size="md"
            icon={<FolderPlus className="w-4 h-4" />}
            onClick={() => scanDirectory()}
          >
            {t('btn_add_folder', settings.language)}
          </Button>
        </div>
      ) : (
        <div className="rounded-xl border border-brand-border bg-oled-card/60 overflow-hidden shadow-card-elevated">
          {/* Table Header */}
          <div className="grid grid-cols-12 gap-4 px-4 py-3 border-b border-brand-border/60 text-[11px] font-semibold text-brand-muted uppercase tracking-wider items-center">
            <div className="col-span-1 text-center">#</div>
            <div
              className="col-span-4 sm:col-span-4 flex items-center gap-1.5 cursor-pointer hover:text-brand-foreground"
              onClick={() => handleSort('title')}
            >
              <span>{t('col_title', settings.language)}</span>
              <ArrowUpDown className="w-3 h-3" />
            </div>
            <div
              className="hidden sm:block col-span-3 cursor-pointer hover:text-brand-foreground"
              onClick={() => handleSort('artist')}
            >
              <span>{t('col_artist', settings.language)}</span>
            </div>
            <div
              className="hidden md:block col-span-2 cursor-pointer hover:text-brand-foreground"
              onClick={() => handleSort('album')}
            >
              <span>{t('col_album', settings.language)}</span>
            </div>
            <div
              className="col-span-2 sm:col-span-2 text-right cursor-pointer hover:text-brand-foreground"
              onClick={() => handleSort('duration')}
            >
              <span>{t('col_duration', settings.language)}</span>
            </div>
          </div>

          {/* Table Rows */}
          <div className="divide-y divide-brand-border/30 max-h-[650px] overflow-y-auto">
            {sortedTracks.map((tr, index) => {
              const isPlaying = status.current_track?.id === tr.id;
              const isFav = favoriteTrackIds.has(tr.id);

              return (
                <div
                  key={tr.id}
                  onContextMenu={e => handleContextMenu(e, tr)}
                  onDoubleClick={() => playTrack(tr, sortedTracks)}
                  className={`grid grid-cols-12 gap-4 px-4 py-3 text-xs items-center group transition-colors cursor-pointer select-none ${
                    isPlaying
                      ? 'bg-brand-accent/10 text-brand-accent font-medium'
                      : 'hover:bg-oled-hover text-brand-foreground'
                  }`}
                >
                  {/* # Index / Play Button */}
                  <div className="col-span-1 text-center font-mono flex items-center justify-center">
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        playTrack(tr, sortedTracks);
                      }}
                      className="w-11 h-11 min-h-[44px] min-w-[44px] rounded-full flex items-center justify-center text-brand-muted group-hover:text-brand-accent group-hover:bg-oled-base transition-all focus-visible:outline-none"
                      aria-label={`Play ${tr.title}`}
                    >
                      {isPlaying ? (
                        <span className="w-2.5 h-2.5 rounded-full bg-brand-accent animate-pulse" />
                      ) : (
                        <>
                          <span className="group-hover:hidden text-brand-muted">{index + 1}</span>
                          <Play className="w-3.5 h-3.5 fill-current hidden group-hover:block ml-0.5" aria-hidden="true" />
                        </>
                      )}
                    </button>
                  </div>

                  {/* Title & Format Badge */}
                  <div className="col-span-4 sm:col-span-4 flex flex-col min-w-0 pr-2">
                    <span className="font-semibold truncate group-hover:text-brand-accent transition-colors">
                      {tr.title}
                    </span>
                    <div className="flex items-center gap-2 mt-0.5">
                      <Badge track={tr} />
                      <span className="sm:hidden text-[10px] text-brand-muted truncate">
                        {tr.artist}
                      </span>
                    </div>
                  </div>

                  {/* Artist */}
                  <div className="hidden sm:block col-span-3 truncate text-brand-muted font-medium">
                    {tr.artist}
                  </div>

                  {/* Album */}
                  <div className="hidden md:block col-span-2 truncate text-brand-muted">
                    {tr.album}
                  </div>

                  {/* Duration, Rating, Favorite & Context Menu */}
                  <div className="col-span-2 sm:col-span-2 flex items-center justify-end gap-1">
                    <div className="hidden lg:block">
                      <Rating
                        value={tr.rating || 0}
                        onChange={r => setTrackRating(tr.id, r)}
                        size="sm"
                      />
                    </div>

                    <button
                      onClick={e => {
                        e.stopPropagation();
                        toggleFavoriteTrack(tr.id);
                      }}
                      className="p-1 min-h-[44px] min-w-[44px] flex items-center justify-center rounded hover:bg-white/10 transition-colors focus-visible:outline-none"
                      aria-label={isFav ? 'Remove from favorites' : 'Add to favorites'}
                      aria-pressed={isFav}
                    >
                      <Heart
                        aria-hidden="true"
                        className={`w-4 h-4 ${
                          isFav ? 'text-rose-500 fill-rose-500' : 'text-brand-muted hover:text-rose-400'
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
                      className="p-1 min-h-[44px] min-w-[44px] flex items-center justify-center rounded text-brand-muted hover:text-brand-foreground hover:bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity focus-visible:outline-none"
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
      )}

      {/* Global Context Menu */}
      <ContextMenu state={contextMenu} onClose={() => setContextMenu(prev => ({ ...prev, isOpen: false }))} />
    </div>
  );
};
