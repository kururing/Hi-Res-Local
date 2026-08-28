import React, { useState } from 'react';
import {
  Play,
  Shuffle,
  Download,
  Trash2,
  ArrowUp,
  ArrowDown,
  X,
  Heart,
  MoreVertical,
} from 'lucide-react';
import { usePlaylists } from '../../context/PlaylistContext';
import { usePlayer } from '../../context/PlayerContext';
import { useLibrary } from '../../context/LibraryContext';
import { useSettings } from '../../context/SettingsContext';
import { useToast } from '../../context/ToastContext';
import { Button } from '../common/Button';
import { Badge } from '../common/Badge';
import { ContextMenu, ContextMenuState } from '../common/ContextMenu';
import { VirtualList } from '../common/VirtualList';
import { TrackPlayArtwork } from '../common/TrackPlayArtwork';
import { PlaylistArtwork } from '../common/PlaylistArtwork';
import { Playlist } from '../../types/playlist';
import { Track } from '../../types/library';
import { t } from '../../i18n';

function formatDuration(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

interface PlaylistDetailViewProps {
  playlist: Playlist;
  onNavigate: (view: string, payload?: unknown) => void;
  onOpenDetails: (track: Track) => void;
}

export const PlaylistDetailView: React.FC<PlaylistDetailViewProps> = ({
  playlist,
  onNavigate,
  onOpenDetails,
}) => {
  const { getPlaylistTracks, deletePlaylist, removeTrackFromPlaylist, reorderPlaylist, exportM3uFile } = usePlaylists();
  const { playTrack, playQueue, playRandomQueue, status } = usePlayer();
  const { albums, artists } = useLibrary();
  const { toggleFavoriteTrack, favoriteTrackIds } = useLibrary();
  const { settings } = useSettings();
  const { showToast } = useToast();

  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    isOpen: false,
    x: 0,
    y: 0,
    track: null,
  });

  const playlistTracks = getPlaylistTracks(playlist);
  const totalDuration = playlistTracks.reduce((acc, t) => acc + t.duration, 0);

  const handleExportM3u = () => {
    const m3uContent = exportM3uFile(playlist.id);
    if (!m3uContent) return;

    const blob = new Blob([m3uContent], { type: 'audio/x-mpegurl' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${playlist.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.m3u8`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Exported M3U playlist file', 'success');
  };

  const handleDelete = async () => {
    if (confirm(t('delete_playlist_confirm', settings.language, { name: playlist.name }))) {
      await deletePlaylist(playlist.id);
      onNavigate('playlists');
    }
  };

  const handleContextMenu = (e: React.MouseEvent, track: Track) => {
    e.preventDefault();
    setContextMenu({
      isOpen: true,
      x: e.clientX,
      y: e.clientY,
      track,
      playlistId: playlist.id,
      onOpenDetails,
      onNavigateAlbum: name => {
        onNavigate('album_detail', { id: name, name, artist: track.artist, track_count: 1, total_duration: track.duration, tracks: [track] });
      },
      onNavigateArtist: name => {
        onNavigate('artist_detail', { id: name, name, track_count: 1, album_count: 1, albums: [], genres: [] });
      },
    });
  };

  return (
    <div className="view-page mx-auto flex h-full min-h-0 w-full max-w-7xl flex-col gap-6 !overflow-hidden p-6 select-none md:p-8">
      {/* Playlist Header Banner */}
      <div className="flex shrink-0 flex-col items-center gap-6 rounded-2xl border border-brand-border bg-gradient-to-r from-brand-primary via-brand-primary/60 to-oled-card p-6 shadow-card-elevated sm:flex-row sm:items-end">
        <div className="w-40 h-40 sm:w-48 sm:h-48 rounded-2xl border border-brand-border flex items-center justify-center shrink-0 shadow-2xl overflow-hidden">
          <PlaylistArtwork playlist={playlist} tracks={playlistTracks} />
        </div>

        <div className="flex flex-col gap-2 min-w-0 text-center sm:text-left flex-1">
          <div className="flex items-center justify-center sm:justify-start gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-brand-accent">
              Playlist
            </span>
            {playlist.is_smart && (
              <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-[10px] font-semibold">
                {t('smart_playlist_badge', settings.language)}
              </span>
            )}
          </div>

          <h1 className="text-2xl sm:text-4xl font-bold font-display text-brand-foreground truncate">
            {playlist.name}
          </h1>

          {playlist.description && (
            <p className="text-xs sm:text-sm text-brand-muted line-clamp-2">
              {playlist.description}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-center sm:justify-start gap-3 text-xs text-brand-muted mt-1 font-mono">
            <span>{playlistTracks.length} tracks</span>
            <span>•</span>
            <span>{formatDuration(totalDuration)}</span>
          </div>

          <div className="flex flex-wrap items-center justify-center sm:justify-start gap-3 mt-4">
            <Button
              variant="accent"
              size="md"
              icon={<Play className="w-4 h-4 fill-current" />}
              onClick={() => playlistTracks.length > 0 && playQueue(playlistTracks, 0, playlist.id)}
            >
            {t('detail_play', settings.language)}
            </Button>
            <Button
              variant="secondary"
              size="md"
              icon={<Shuffle className="w-4 h-4" />}
              onClick={() => void playRandomQueue(playlistTracks, playlist.id)}
            >
              {t('detail_shuffle', settings.language)}
            </Button>
            <Button
              variant="primary"
              size="md"
              icon={<Download className="w-4 h-4" />}
              onClick={handleExportM3u}
            >
              {t('btn_export_m3u', settings.language)}
            </Button>
            {!playlist.is_smart && (
              <Button
                variant="danger"
                size="md"
                icon={<Trash2 className="w-4 h-4" />}
                onClick={handleDelete}
              >
                {t('btn_delete', settings.language)}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Tracks Table */}
      {playlistTracks.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center rounded-2xl border border-brand-border/60 bg-oled-card/50 p-12 text-center text-brand-muted">
          {t('empty_playlist_tracks', settings.language)}
        </div>
      ) : (
        <VirtualList
          items={playlistTracks}
          rowHeight={68}
          className="min-h-0 flex-1 rounded-xl border border-brand-border bg-oled-card/60"
          getKey={(tr, idx) => `${tr.id}-${idx}`}
          renderRow={(tr, idx) => {
            const isPlaying = status.current_track?.id === tr.id;
            const isFav = favoriteTrackIds.has(tr.id);

            return (
              <div
                onContextMenu={e => handleContextMenu(e, tr)}
                onDoubleClick={() => playTrack(tr, playlistTracks, playlist.id)}
                className={`tracks-table-grid grid gap-3 px-4 h-full text-xs items-center group cursor-pointer select-none ${
                  isPlaying ? 'bg-brand-accent/10 text-brand-accent font-medium' : 'hover:bg-oled-hover text-brand-foreground'
                }`}
              >
                <div className="flex items-center justify-center">
                  <TrackPlayArtwork
                    track={tr}
                    isPlaying={isPlaying}
                    onPlay={() => playTrack(tr, playlistTracks, playlist.id)}
                  />
                </div>

                <div className="min-w-0 pr-2">
                  <span className="block min-w-0 max-w-full truncate font-semibold group-hover:text-brand-accent" title={tr.title}>
                    {tr.title}
                  </span>
                </div>

                <div className="hidden min-w-0 sm:block">
                  <button
                    type="button"
                    className="block max-w-full truncate rounded-md px-1 py-1 text-left text-[10px] text-brand-muted hover:text-brand-accent"
                    onClick={e => {
                      e.stopPropagation();
                      const target = artists.find(item => item.name === tr.artist);
                      if (target) onNavigate('artist_detail', target);
                    }}
                  >
                    {tr.artist}
                  </button>
                </div>

                <div className="hidden min-w-0 md:block truncate text-brand-muted">
                  <button type="button" className="max-w-full truncate text-left hover:text-brand-accent" onClick={e => { e.stopPropagation(); const target = albums.find(item => item.name === tr.album && item.artist === tr.artist); if (target) onNavigate('album_detail', target); }}>{tr.album}</button>
                </div>

                <div className="hidden min-w-0 min-[1180px]:flex items-center">
                  <Badge track={tr} />
                </div>

                <div className="flex items-center justify-end gap-1">
                  {!playlist.is_smart && (
                    <>
                      <button
                        disabled={idx === 0}
                        onClick={e => {
                          e.stopPropagation();
                          reorderPlaylist(playlist.id, idx, idx - 1);
                        }}
                        className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded text-brand-muted hover:bg-brand-accent/10 disabled:opacity-20 focus-visible:outline-none"
                        aria-label={`Move ${tr.title} up`}
                      >
                        <ArrowUp className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                      <button
                        disabled={idx === playlistTracks.length - 1}
                        onClick={e => {
                          e.stopPropagation();
                          reorderPlaylist(playlist.id, idx, idx + 1);
                        }}
                        className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded text-brand-muted hover:bg-brand-accent/10 disabled:opacity-20 focus-visible:outline-none"
                        aria-label={`Move ${tr.title} down`}
                      >
                        <ArrowDown className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          removeTrackFromPlaylist(playlist.id, tr.id);
                        }}
                        className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded text-brand-muted hover:text-rose-500 hover:bg-brand-accent/10 focus-visible:outline-none"
                        aria-label={`Remove ${tr.title} from playlist`}
                      >
                        <X className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    </>
                  )}

                  <button
                    onClick={e => {
                      e.stopPropagation();
                      toggleFavoriteTrack(tr.id);
                    }}
                    className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded text-brand-muted hover:text-rose-400 focus-visible:outline-none"
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

                  <span className="font-mono text-brand-muted tabular-nums ml-2">
                    {formatDuration(tr.duration)}
                  </span>
                  <button
                    type="button"
                    onClick={e => {
                      e.stopPropagation();
                      handleContextMenu(e, tr);
                    }}
                    className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded text-brand-muted opacity-0 transition-opacity hover:bg-brand-accent/10 hover:text-brand-foreground group-hover:opacity-100 focus:opacity-100 focus-visible:outline-none"
                    aria-label={t('aria_more_actions', settings.language)}
                  >
                    <MoreVertical className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </div>
            );
          }}
        />
      )}

      <ContextMenu state={contextMenu} onClose={() => setContextMenu(prev => ({ ...prev, isOpen: false }))} />
    </div>
  );
};
