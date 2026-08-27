import React from 'react';
import { Play, Shuffle, Heart, ArrowLeft, ChevronDown, ChevronUp } from 'lucide-react';
import { useLibrary } from '../../context/LibraryContext';
import { usePlayer } from '../../context/PlayerContext';
import { useSettings } from '../../context/SettingsContext';
import { Button } from '../common/Button';
import { Badge } from '../common/Badge';
import { Artist, Track } from '../../types/library';
import { t } from '../../i18n';
import { RemoteArtwork } from '../common/RemoteArtwork';
import { AlbumArtwork } from '../common/AlbumArtwork';
import { TrackPlayArtwork } from '../common/TrackPlayArtwork';
import { TrackMoreButton } from '../common/TrackMoreButton';
import { artistsShareIdentity } from '../../services/artistIdentity';

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

const TOP_TRACK_LIMIT = 5;

export const ArtistDetailView: React.FC<ArtistDetailViewProps> = ({
  artist,
  onNavigate,
  onOpenDetails,
}) => {
  const { tracks, toggleFavoriteArtist, favoriteArtistNames } = useLibrary();
  const { playTrack, playQueue, toggleShuffle, status } = usePlayer();
  const { settings } = useSettings();
  const [showAllTracks, setShowAllTracks] = React.useState(false);

  const artistTracks = React.useMemo(() => {
    const trackIds = new Set(artist.albums.flatMap(album => album.tracks.map(track => track.id)));
    return tracks.filter(track => (
      trackIds.has(track.id) || artistsShareIdentity(track.artist, artist.name)
    ));
  }, [tracks, artist.albums, artist.name]);

  React.useEffect(() => {
    setShowAllTracks(false);
  }, [artist.name]);

  const visibleTracks = showAllTracks
    ? artistTracks
    : artistTracks.slice(0, TOP_TRACK_LIMIT);

  const isFav = favoriteArtistNames.has(artist.name);

  return (
    <div className="view-page mx-auto w-full max-w-7xl space-y-8 p-6 select-none md:p-8">
      {/* Back Button */}
      <button
        onClick={() => onNavigate('artists')}
        className="inline-flex items-center gap-2 text-xs font-semibold text-brand-muted hover:text-brand-foreground transition-colors focus-visible:outline-none"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>{t('nav_back_to_artists', settings.language)}</span>
      </button>

      {/* Artist Header Banner */}
      <div className="flex flex-col sm:flex-row items-center sm:items-end gap-6 p-6 rounded-2xl bg-gradient-to-r from-brand-primary via-brand-primary/60 to-oled-card border border-brand-border shadow-card-elevated">
        <div className="w-36 h-36 sm:w-44 sm:h-44 rounded-full bg-gradient-to-tr from-brand-primary to-oled-card border-2 border-brand-border flex items-center justify-center shrink-0 shadow-2xl overflow-hidden">
          <RemoteArtwork kind="artist" artist={artist.name} alt={`${artist.name} portrait`} />
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

          <div className="flex flex-wrap items-center justify-center sm:justify-start gap-3 mt-4">
            <Button
              variant="accent"
              size="md"
              icon={<Play className="w-4 h-4 fill-current" />}
              onClick={() => artistTracks.length > 0 && playQueue(artistTracks, 0)}
            >
              {t('artist_play', settings.language)}
            </Button>
            <Button
              variant="secondary"
              size="md"
              icon={<Shuffle className="w-4 h-4" />}
              onClick={() => {
                if (!status.shuffle) void toggleShuffle();
                playQueue(artistTracks, 0);
              }}
              disabled={artistTracks.length === 0}
            >
              {t('tracks_shuffle_all', settings.language)}
            </Button>
            <button
              onClick={() => toggleFavoriteArtist(artist.name)}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl bg-oled-card border border-brand-border text-brand-muted hover:text-rose-400 transition-colors focus-visible:outline-none"
              aria-label={t('aria_toggle_artist_favorite', settings.language)}
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
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-bold font-display text-brand-foreground">
            {t('artist_top_tracks', settings.language)}
          </h2>

          {artistTracks.length > TOP_TRACK_LIMIT && (
            <button
              type="button"
              onClick={() => setShowAllTracks(current => !current)}
              className="min-h-[44px] inline-flex items-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-brand-accent hover:bg-brand-accent/10 transition-colors focus-visible:outline-none"
              aria-expanded={showAllTracks}
              aria-controls="artist-track-list"
            >
              <span>
                {showAllTracks
                  ? t('artist_collapse_tracks', settings.language)
                  : t('artist_view_all_tracks', settings.language, { count: artistTracks.length })}
              </span>
              {showAllTracks ? (
                <ChevronUp className="h-4 w-4" aria-hidden="true" />
              ) : (
                <ChevronDown className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
          )}
        </div>

        <div
          id="artist-track-list"
          className="rounded-xl border border-brand-border bg-oled-card/60 overflow-hidden divide-y divide-brand-border/30"
        >
          {visibleTracks.map(tr => {
            const isPlaying = status.current_track?.id === tr.id;
            return (
              <div
                key={tr.id}
                onDoubleClick={() => playTrack(tr, artistTracks)}
                className={`tracks-table-grid group grid items-center gap-3 px-4 py-3 text-xs transition-colors cursor-pointer ${
                  isPlaying ? 'bg-brand-accent/10 text-brand-accent font-medium' : 'hover:bg-oled-hover text-brand-foreground'
                }`}
              >
                <div className="flex items-center justify-center">
                  <TrackPlayArtwork
                    track={tr}
                    isPlaying={isPlaying}
                    onPlay={() => playTrack(tr, artistTracks)}
                  />
                </div>

                <div className="min-w-0 truncate font-semibold">{tr.title}</div>

                <div className="hidden min-w-0 sm:block truncate text-brand-muted">
                  <span title={artist.name}>{artist.name}</span>
                </div>

                <div className="hidden min-w-0 md:block truncate text-brand-muted">
                  <button type="button" className="max-w-full truncate text-left hover:text-brand-accent" onClick={e => { e.stopPropagation(); const target = artist.albums.find(item => item.name === tr.album); if (target) onNavigate('album_detail', target); }}>{tr.album}</button>
                </div>

                <div className="hidden min-w-0 min-[1180px]:flex items-center">
                  <Badge track={tr} />
                </div>

                <div className="flex items-center justify-end gap-3">
                  <span className="font-mono text-brand-muted">{formatDuration(tr.duration)}</span>
                  <TrackMoreButton
                    track={tr}
                    onOpenDetails={onOpenDetails}
                    onNavigateAlbum={() => { const target = artist.albums.find(item => item.name === tr.album); if (target) onNavigate('album_detail', target); }}
                    onNavigateArtist={() => onNavigate('artist_detail', artist)}
                  />
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
              className="group relative p-3.5 rounded-2xl bg-oled-card hover:bg-oled-hover border border-brand-border/60 hover:border-brand-border cursor-pointer transition-all flex flex-col shadow-card-elevated"
            >
              <button
                type="button"
                onClick={() => onNavigate('album_detail', album)}
                aria-label={`Open album ${album.name}`}
                className="absolute inset-0 z-10 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
              />
              <div className="relative aspect-square rounded-xl bg-gradient-to-tr from-brand-primary to-oled-card border border-brand-border/60 mb-3 flex items-center justify-center overflow-hidden">
                <AlbumArtwork album={album} alt={`${album.name} cover`} />
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                  <button
                    type="button"
                    onClick={e => {
                      e.stopPropagation();
                      playQueue(album.tracks, 0);
                    }}
                    className="relative z-20 w-11 h-11 min-h-[44px] min-w-[44px] rounded-full bg-brand-accent text-oled-base flex items-center justify-center shadow-glow-accent hover:scale-105 transition-transform focus-visible:outline-none"
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
