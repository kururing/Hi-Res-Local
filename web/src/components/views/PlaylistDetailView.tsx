import React, { useState } from 'react';
import {
  Play,
  Shuffle,
  Download,
  Trash2,
  ListMusic,
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  X,
  Sparkles,
  Heart,
} from 'lucide-react';
import { usePlaylists } from '../../context/PlaylistContext';
import { usePlayer } from '../../context/PlayerContext';
import { useLibrary } from '../../context/LibraryContext';
import { useSettings } from '../../context/SettingsContext';
import { useToast } from '../../context/ToastContext';
import { Button } from '../common/Button';
import { Badge } from '../common/Badge';
import { ContextMenu, ContextMenuState } from '../common/ContextMenu';
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
  const { playTrack, playQueue, status } = usePlayer();
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
    <div className="p-6 md:p-8 space-y-8 max-w-7xl mx-auto w-full select-none">
      {/* Back Button */}
      <button
        onClick={() => onNavigate('playlists')}
        className="inline-flex items-center gap-2 text-xs font-semibold text-brand-muted hover:text-brand-foreground transition-colors focus-visible:outline-none"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Back to Playlists</span>
      </button>

      {/* Playlist Header Banner */}
      <div className="flex flex-col sm:flex-row items-center sm:items-end gap-6 p-6 rounded-2xl bg-gradient-to-r from-brand-primary via-indigo-950/80 to-oled-card border border-brand-border shadow-card-elevated">
        <div className="w-40 h-40 sm:w-48 sm:h-48 rounded-2xl bg-gradient-to-tr from-indigo-950 to-slate-900 border border-brand-border flex items-center justify-center shrink-0 shadow-2xl overflow-hidden">
          {playlist.is_smart ? (
            <Sparkles className="w-20 h-20 text-amber-400" />
          ) : (
            <ListMusic className="w-20 h-20 text-brand-accent" />
          )}
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

          <h1 className="text-2xl sm:text-4xl font-bold font-display text-white truncate">
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
              onClick={() => playlistTracks.length > 0 && playQueue(playlistTracks, 0)}
            >
              Play
            </Button>
            <Button
              variant="secondary"
              size="md"
              icon={<Shuffle className="w-4 h-4" />}
              onClick={() => {
                const shuffled = [...playlistTracks].sort(() => Math.random() - 0.5);
                playQueue(shuffled, 0);
              }}
            >
              Shuffle
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
        <div className="p-12 text-center text-brand-muted bg-oled-card/50 rounded-2xl border border-brand-border/60">
          No tracks in this playlist. Right-click on any song in library and choose &quot;Add to Playlist&quot;.
        </div>
      ) : (
        <div className="rounded-xl border border-brand-border bg-oled-card/60 overflow-hidden divide-y divide-brand-border/30">
          {playlistTracks.map((tr, idx) => {
            const isPlaying = status.current_track?.id === tr.id;
            const isFav = favoriteTrackIds.has(tr.id);

            return (
              <div
                key={`${tr.id}-${idx}`}
                onContextMenu={e => handleContextMenu(e, tr)}
                onDoubleClick={() => playTrack(tr, playlistTracks)}
                className={`grid grid-cols-12 gap-4 px-4 py-3 text-xs items-center group transition-colors cursor-pointer select-none ${
                  isPlaying ? 'bg-brand-accent/10 text-brand-accent font-medium' : 'hover:bg-oled-hover text-brand-foreground'
                }`}
              >
                <div className="col-span-1 text-center font-mono flex items-center justify-center">
                  <button
                    onClick={() => playTrack(tr, playlistTracks)}
                    className="w-7 h-7 rounded-full flex items-center justify-center text-brand-muted group-hover:text-brand-accent group-hover:bg-oled-base transition-all"
                  >
                    {isPlaying ? (
                      <span className="w-2.5 h-2.5 rounded-full bg-brand-accent animate-pulse" />
                    ) : (
                      <>
                        <span className="group-hover:hidden text-brand-muted">{idx + 1}</span>
                        <Play className="w-3.5 h-3.5 fill-current hidden group-hover:block ml-0.5" />
                      </>
                    )}
                  </button>
                </div>

                <div className="col-span-5 flex flex-col min-w-0 pr-2">
                  <span className="font-semibold truncate group-hover:text-brand-accent transition-colors">
                    {tr.title}
                  </span>
                  <div className="flex items-center gap-2 mt-0.5">
                    <Badge track={tr} />
                    <span className="text-[10px] text-brand-muted truncate">{tr.artist}</span>
                  </div>
                </div>

                <div className="hidden sm:block col-span-3 truncate text-brand-muted">
                  {tr.album}
                </div>

                <div className="col-span-6 sm:col-span-3 flex items-center justify-end gap-1.5">
                  {!playlist.is_smart && (
                    <>
                      <button
                        disabled={idx === 0}
                        onClick={e => {
                          e.stopPropagation();
                          reorderPlaylist(playlist.id, idx, idx - 1);
                        }}
                        className="p-1 rounded text-brand-muted hover:bg-white/10 disabled:opacity-20 transition-opacity"
                        aria-label="Move track up"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        disabled={idx === playlistTracks.length - 1}
                        onClick={e => {
                          e.stopPropagation();
                          reorderPlaylist(playlist.id, idx, idx + 1);
                        }}
                        className="p-1 rounded text-brand-muted hover:bg-white/10 disabled:opacity-20 transition-opacity"
                        aria-label="Move track down"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          removeTrackFromPlaylist(playlist.id, tr.id);
                        }}
                        className="p-1 rounded text-brand-muted hover:text-rose-400 hover:bg-white/10 transition-colors"
                        aria-label="Remove from playlist"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}

                  <button
                    onClick={e => {
                      e.stopPropagation();
                      toggleFavoriteTrack(tr.id);
                    }}
                    className="p-1 rounded text-brand-muted hover:text-rose-400"
                  >
                    <Heart
                      className={`w-4 h-4 ${
                        isFav ? 'text-rose-500 fill-rose-500' : 'text-brand-muted'
                      }`}
                    />
                  </button>

                  <span className="font-mono text-brand-muted tabular-nums ml-2">
                    {formatDuration(tr.duration)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ContextMenu state={contextMenu} onClose={() => setContextMenu(prev => ({ ...prev, isOpen: false }))} />
    </div>
  );
};
