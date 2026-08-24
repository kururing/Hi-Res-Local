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
import { Button } from '../common/Button';
import { ContextMenu, ContextMenuState } from '../common/ContextMenu';
import { VirtualList } from '../common/VirtualList';
import { Track } from '../../types/library';
import { t } from '../../i18n';

function formatDuration(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

const TRACK_ROW_HEIGHT = 68;

const TrackRow = React.memo(function TrackRow({
  tr,
  index,
  isPlaying,
  isFav,
  onPlay,
  onFavorite,
  onContextMenu,
  onOpenArtist,
  onOpenAlbum,
}: {
  tr: Track;
  index: number;
  isPlaying: boolean;
  isFav: boolean;
  onPlay: (track: Track) => void;
  onFavorite: (id: string) => void;
  onContextMenu: (e: React.MouseEvent, track: Track) => void;
  onOpenArtist: (track: Track) => void;
  onOpenAlbum: (track: Track) => void;
}) {
  return (
    <div
      onContextMenu={e => onContextMenu(e, tr)}
      onDoubleClick={() => onPlay(tr)}
      className={`tracks-table-grid grid gap-3 px-4 h-full text-sm items-center group cursor-pointer select-none ${
        isPlaying
          ? 'bg-brand-accent/12 text-brand-accent font-semibold'
          : 'bg-oled-card hover:bg-oled-hover text-brand-foreground'
      }`}
    >
      <div className="text-center font-mono flex items-center justify-center">
        <button
          onClick={e => {
            e.stopPropagation();
            onPlay(tr);
          }}
          className="w-11 h-11 min-h-[44px] min-w-[44px] rounded-full flex items-center justify-center text-brand-muted group-hover:text-brand-accent group-hover:bg-oled-base focus-visible:outline-none"
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

      <div className="flex flex-col min-w-0 pr-2">
        <span className="font-semibold truncate group-hover:text-brand-accent">
          {tr.title}
        </span>
        <span className="sm:hidden mt-0.5 text-xs text-brand-muted truncate">
          {tr.artist}
        </span>
      </div>

      <div className="hidden sm:block min-w-0">
        <button
          type="button"
          onClick={() => onOpenArtist(tr)}
          className="block max-w-full truncate rounded-md px-1 py-1 text-left font-semibold text-brand-muted hover:text-brand-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
          title={tr.artist}
        >
          {tr.artist}
        </button>
      </div>

      <div className="hidden md:block min-w-0">
        <button
          type="button"
          onClick={() => onOpenAlbum(tr)}
          className="block max-w-full truncate rounded-md px-1 py-1 text-left font-medium text-brand-muted hover:text-brand-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
          title={tr.album}
        >
          {tr.album}
        </button>
      </div>

      <div className="hidden min-[1180px]:flex min-w-0 items-center">
        <Badge track={tr} />
      </div>

      <div className="grid grid-cols-[44px_minmax(44px,auto)_44px] items-center justify-end">
        <button
          onClick={e => {
            e.stopPropagation();
            onFavorite(tr.id);
          }}
          className="p-1 min-h-[44px] min-w-[44px] flex items-center justify-center rounded hover:bg-brand-accent/10 focus-visible:outline-none"
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

        <span className="text-center font-mono text-brand-muted tabular-nums">
          {formatDuration(tr.duration)}
        </span>

        <button
          onClick={e => {
            e.stopPropagation();
            onContextMenu(e, tr);
          }}
          className="p-1 min-h-[44px] min-w-[44px] flex items-center justify-center rounded text-brand-muted hover:text-brand-foreground hover:bg-brand-accent/10 opacity-0 group-hover:opacity-100 focus-visible:outline-none"
          aria-label="More actions"
        >
          <MoreVertical className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
});

type SortKey = 'title' | 'artist' | 'album' | 'duration' | 'date_added';

interface TracksViewProps {
  onNavigate: (view: string, payload?: unknown) => void;
  onOpenDetails: (track: Track) => void;
}

export const TracksView: React.FC<TracksViewProps> = ({ onNavigate, onOpenDetails }) => {
  const { tracks, albums, artists, toggleFavoriteTrack, favoriteTrackIds, scanDirectory } = useLibrary();
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

  const openArtistDetails = (track: Track) => {
    const matchesArtist = (value: string) => value.localeCompare(track.artist, undefined, { sensitivity: 'accent' }) === 0;
    const matchingAlbums = albums.filter(item => matchesArtist(item.artist));
    const artist = artists.find(item => matchesArtist(item.name)) ?? {
      id: track.artist,
      name: track.artist,
      track_count: tracks.filter(item => matchesArtist(item.artist)).length,
      album_count: matchingAlbums.length,
      albums: matchingAlbums,
      genres: [...new Set(tracks.filter(item => matchesArtist(item.artist)).map(item => item.genre).filter((genre): genre is string => Boolean(genre)))],
    };
    onNavigate('artist_detail', artist);
  };

  const openAlbumDetails = (track: Track) => {
    const album = albums.find(item =>
      item.name.localeCompare(track.album, undefined, { sensitivity: 'accent' }) === 0
      && item.artist.localeCompare(track.artist, undefined, { sensitivity: 'accent' }) === 0
    );
    const resolvedAlbum = album ?? {
      id: `${track.artist}-${track.album}`,
      name: track.album,
      artist: track.artist,
      track_count: tracks.filter(item => item.album === track.album && item.artist === track.artist).length,
      total_duration: tracks
        .filter(item => item.album === track.album && item.artist === track.artist)
        .reduce((total, item) => total + item.duration, 0),
      tracks: tracks.filter(item => item.album === track.album && item.artist === track.artist),
    };
    onNavigate('album_detail', resolvedAlbum);
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
          <div className="w-16 h-16 rounded-2xl bg-brand-primary/80 border border-brand-border flex items-center justify-center text-brand-muted">
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
        <div className="rounded-2xl border border-brand-border bg-oled-card/95 backdrop-blur-xl overflow-hidden shadow-card-elevated">
          {/* Table Header */}
          <div className="tracks-table-grid grid gap-3 px-4 py-3.5 bg-oled-card border-b border-brand-border text-xs font-bold text-brand-muted uppercase tracking-wider items-center whitespace-nowrap">
            <div className="text-center">#</div>
            <div
              className="flex items-center gap-1.5 cursor-pointer hover:text-brand-foreground"
              onClick={() => handleSort('title')}
            >
              <span>{t('col_title', settings.language)}</span>
              <ArrowUpDown className="w-3 h-3" />
            </div>
            <div
              className="hidden sm:block cursor-pointer hover:text-brand-foreground"
              onClick={() => handleSort('artist')}
            >
              <span>{t('col_artist', settings.language)}</span>
            </div>
            <div
              className="hidden md:block cursor-pointer hover:text-brand-foreground"
              onClick={() => handleSort('album')}
            >
              <span>{t('col_album', settings.language)}</span>
            </div>
            <div className="hidden min-[1180px]:block">
              <span>{t('col_quality', settings.language)}</span>
            </div>
            <div
              className="grid grid-cols-[44px_minmax(44px,auto)_44px] items-center cursor-pointer hover:text-brand-foreground"
              onClick={() => handleSort('duration')}
            >
              <span className="col-start-2 text-center">{t('col_duration', settings.language)}</span>
            </div>
          </div>

          {/* Table Rows */}
          <VirtualList
            items={sortedTracks}
            rowHeight={TRACK_ROW_HEIGHT}
            className="divide-y divide-brand-border/45 max-h-[650px] bg-oled-card"
            style={{ maxHeight: 650 }}
            getKey={item => item.id}
            renderRow={(tr, index) => (
              <TrackRow
                tr={tr}
                index={index}
                isPlaying={status.current_track?.id === tr.id}
                isFav={favoriteTrackIds.has(tr.id)}
                onPlay={track => playTrack(track, sortedTracks)}
                onFavorite={toggleFavoriteTrack}
                onContextMenu={handleContextMenu}
                onOpenArtist={openArtistDetails}
                onOpenAlbum={openAlbumDetails}
              />
            )}
          />
        </div>
      )}

      {/* Global Context Menu */}
      <ContextMenu state={contextMenu} onClose={() => setContextMenu(prev => ({ ...prev, isOpen: false }))} />
    </div>
  );
};
