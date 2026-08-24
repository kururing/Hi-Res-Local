import React from 'react';
import { User, Disc, Play, Heart, ArrowLeft } from 'lucide-react';
import { useLibrary } from '../../context/LibraryContext';
import { usePlayer } from '../../context/PlayerContext';
import { useSettings } from '../../context/SettingsContext';
import { Button } from '../common/Button';
import { Badge } from '../common/Badge';
import { Artist, Track } from '../../types/library';
import { t } from '../../i18n';

interface ArtistDetailViewProps {
  artist: Artist;
  onNavigate: (view: string, payload?: unknown) => void;
  onOpenDetails: (track: Track) => void;
}

function formatDuration(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

export const ArtistDetailView: React.FC<ArtistDetailViewProps> = ({
  artist,
  onNavigate,
}) => {
  const { tracks, toggleFavoriteArtist, favoriteArtistNames } = useLibrary();
  const { playTrack, playQueue, status } = usePlayer();
  const { settings } = useSettings();

  const artistTracks = React.useMemo(() => {
    return tracks.filter(t => t.artist.toLowerCase() === artist.name.toLowerCase());
  }, [tracks, artist.name]);

  const isFav = favoriteArtistNames.has(artist.name);

  return (
    <div className="p-6 md:p-8 space-y-8 max-w-7xl mx-auto w-full select-none">
      {/* Back Button */}
      <button
        onClick={() => onNavigate('artists')}
        className="inline-flex items-center gap-2 text-xs font-semibold text-brand-muted hover:text-brand-foreground transition-colors focus-visible:outline-none"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Back to Artists</span>
      </button>

      {/* Artist Header Banner */}
      <div className="flex flex-col sm:flex-row items-center sm:items-end gap-6 p-6 rounded-2xl bg-gradient-to-r from-brand-primary via-brand-primary/60 to-oled-card border border-brand-border shadow-card-elevated">
        <div className="w-36 h-36 sm:w-44 sm:h-44 rounded-full bg-gradient-to-tr from-brand-primary to-oled-card border-2 border-brand-border flex items-center justify-center shrink-0 shadow-2xl overflow-hidden">
          <User className="w-20 h-20 text-brand-accent/60" />
        </div>

        <div className="flex flex-col gap-2 min-w-0 text-center sm:text-left flex-1">
          <span className="text-xs font-bold uppercase tracking-wider text-brand-accent">
            Artist
          </span>
          <h1 className="text-2xl sm:text-4xl font-bold font-display text-brand-foreground truncate">
            {artist.name}
          </h1>

          <div className="flex flex-wrap items-center justify-center sm:justify-start gap-3 text-xs text-brand-muted mt-1 font-mono">
            <span>{artist.album_count || artist.albums.length} albums</span>
            <span>•</span>
            <span>{artistTracks.length} tracks</span>
            {artist.genres && artist.genres.length > 0 && (
              <>
                <span>•</span>
                <span>{artist.genres.join(', ')}</span>
              </>
            )}
          </div>

          <div className="flex items-center justify-center sm:justify-start gap-3 mt-4">
            <Button
              variant="accent"
              size="md"
              icon={<Play className="w-4 h-4 fill-current" />}
              onClick={() => artistTracks.length > 0 && playQueue(artistTracks, 0)}
            >
              Play Artist
            </Button>
            <button
              onClick={() => toggleFavoriteArtist(artist.name)}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl bg-oled-card border border-brand-border text-brand-muted hover:text-rose-400 transition-colors focus-visible:outline-none"
              aria-label="Toggle favorite artist"
              aria-pressed={isFav}
            >
              <Heart
                aria-hidden="true"
                className={`w-5 h-5 ${
                  isFav ? 'text-rose-500 fill-rose-500' : 'text-brand-muted'
                }`}
              />
            </button>
          </div>
        </div>
      </div>

      {/* Top Tracks by Artist */}
      <section className="space-y-4">
        <h2 className="text-lg font-bold font-display text-brand-foreground">
          {t('artist_top_tracks', settings.language)}
        </h2>

        <div className="rounded-xl border border-brand-border bg-oled-card/60 overflow-hidden divide-y divide-brand-border/30">
          {artistTracks.slice(0, 5).map((tr, idx) => {
            const isPlaying = status.current_track?.id === tr.id;
            return (
              <div
                key={tr.id}
                onDoubleClick={() => playTrack(tr, artistTracks)}
                className={`flex items-center justify-between px-4 py-3 text-xs transition-colors cursor-pointer ${
                  isPlaying ? 'bg-brand-accent/10 text-brand-accent font-medium' : 'hover:bg-oled-hover text-brand-foreground'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0 pr-2">
                  <button
                    onClick={() => playTrack(tr, artistTracks)}
                    className="w-11 h-11 min-h-[44px] min-w-[44px] rounded-full flex items-center justify-center text-brand-muted hover:text-brand-accent hover:bg-oled-base transition-all focus-visible:outline-none"
                    aria-label={`Play ${tr.title}`}
                  >
                    {isPlaying ? (
                      <span className="w-2.5 h-2.5 rounded-full bg-brand-accent animate-pulse" />
                    ) : (
                      <span className="font-mono text-brand-muted">{idx + 1}</span>
                    )}
                  </button>
                  <div className="flex flex-col min-w-0">
                    <span className="font-semibold truncate">{tr.title}</span>
                    <span className="text-[11px] text-brand-muted truncate">{tr.album}</span>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <Badge track={tr} />
                  <span className="font-mono text-brand-muted">{formatDuration(tr.duration)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Discography / Albums */}
      <section className="space-y-4">
        <h2 className="text-lg font-bold font-display text-brand-foreground">
          {t('artist_discography', settings.language)}
        </h2>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-5">
          {artist.albums.map(album => (
            <div
              key={album.id}
              onClick={() => onNavigate('album_detail', album)}
              className="group p-3.5 rounded-2xl bg-oled-card hover:bg-oled-hover border border-brand-border/60 hover:border-brand-border cursor-pointer transition-all flex flex-col shadow-card-elevated"
            >
              <div className="relative aspect-square rounded-xl bg-gradient-to-tr from-brand-primary to-oled-card border border-brand-border/60 mb-3 flex items-center justify-center overflow-hidden">
                <Disc className="w-14 h-14 text-brand-accent/40 group-hover:rotate-90 transition-transform duration-700" aria-hidden="true" />
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                  <button
                    onClick={e => {
                      e.stopPropagation();
                      playQueue(album.tracks, 0);
                    }}
                    className="w-11 h-11 min-h-[44px] min-w-[44px] rounded-full bg-brand-accent text-oled-base flex items-center justify-center shadow-glow-accent hover:scale-105 transition-transform focus-visible:outline-none"
                    aria-label={`Play ${album.name}`}
                  >
                    <Play className="w-5 h-5 fill-oled-base ml-0.5" aria-hidden="true" />
                  </button>
                </div>
              </div>
              <span className="font-semibold text-xs text-brand-foreground truncate group-hover:text-brand-accent transition-colors">
                {album.name}
              </span>
              <span className="text-[11px] text-brand-muted font-mono mt-1">
                {album.track_count} tracks {album.year ? `• ${album.year}` : ''}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};
