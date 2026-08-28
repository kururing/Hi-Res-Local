import React from 'react';
import {
  Play,
  Shuffle,
  Clock,
  Music2,
  Disc,
  Users,
  Sparkles,
  ArrowRight,
  Plus,
  FileText,
} from 'lucide-react';
import { useLibrary } from '../../context/LibraryContext';
import { usePlayer } from '../../context/PlayerContext';
import { usePlaylists } from '../../context/PlaylistContext';
import { useSettings } from '../../context/SettingsContext';
import { Badge } from '../common/Badge';
import { Button } from '../common/Button';
import { t } from '../../i18n';
import { activateOnKeyboard } from '../../services/keyboard';
import { AlbumArtwork } from '../common/AlbumArtwork';
import { PlaylistArtwork } from '../common/PlaylistArtwork';
import { TrackArtwork } from '../common/TrackArtwork';

function formatDurationSecs(totalSecs: number): string {
  const hours = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

interface HomeViewProps {
  onNavigate: (view: string, payload?: unknown) => void;
}

export const HomeView: React.FC<HomeViewProps> = ({ onNavigate }) => {
  const { tracks, albums, artists, stats, scanDirectory } = useLibrary();
  const { playTrack, playQueue, playRandomQueue, status } = usePlayer();
  const { playlists, getPlaylistTracks } = usePlaylists();
  const { settings } = useSettings();

  // Dynamic greeting based on time of day
  const hour = new Date().getHours();
  const greeting =
    hour < 12
      ? t('home_greeting_morning', settings.language)
      : hour < 18
      ? t('home_greeting_afternoon', settings.language)
      : t('home_greeting_evening', settings.language);

  // Recently Added (top 6 newest)
  const recentlyAdded = React.useMemo(() => {
    return [...tracks]
      .sort((a, b) => new Date(b.date_added).getTime() - new Date(a.date_added).getTime())
      .slice(0, 6);
  }, [tracks]);



  return (
    <div className="view-page mx-auto w-full max-w-7xl space-y-8 p-6 select-none md:p-8">
      {/* Header Greeting Banner */}
      <div className="home-hero flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 rounded-2xl bg-gradient-to-r from-brand-accent/16 via-oled-card to-brand-secondary/12 border border-brand-border shadow-card-elevated backdrop-blur-xl">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-brand-accent uppercase tracking-wider">
            Nghe Nhac Pro Max 2.0
          </span>
          <h1 className="text-2xl sm:text-3xl font-bold font-display text-brand-foreground">
            {greeting}
          </h1>
          <p className="text-xs sm:text-sm text-brand-muted">
            {t('tracks_subtitle', settings.language)}
          </p>
        </div>

        <div className="home-hero-actions flex flex-nowrap items-center gap-3">
          <Button
            variant="accent"
            size="md"
            icon={<Play className="w-4 h-4 fill-current" />}
            onClick={() => tracks.length > 0 && playQueue(tracks, 0)}
          >
            {t('tracks_play_all', settings.language)}
          </Button>
          <Button
            variant="secondary"
            size="md"
            icon={<Shuffle className="w-4 h-4" />}
            onClick={() => void playRandomQueue(tracks)}
            disabled={tracks.length === 0}
          >
            {t('tracks_shuffle_all', settings.language)}
          </Button>
          <Button
            variant="primary"
            size="md"
            icon={<Plus className="w-4 h-4" />}
            onClick={() => scanDirectory()}
          >
            {t('btn_add_folder', settings.language)}
          </Button>
        </div>
      </div>

      {/* Library Summary Stats Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl bg-oled-card border border-brand-border/80 flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-lg bg-brand-accent/12 border border-brand-accent/25 flex items-center justify-center text-brand-accent">
            <Music2 className="w-5 h-5" />
          </div>
          <div>
            <span className="text-xl font-bold text-brand-foreground font-mono">
              {stats.total_tracks}
            </span>
            <span className="block text-xs text-brand-muted font-medium">
              {t('home_stat_tracks', settings.language)}
            </span>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-oled-card border border-brand-border/80 flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-lg bg-brand-accent/12 border border-brand-accent/25 flex items-center justify-center text-brand-accent">
            <Disc className="w-5 h-5" />
          </div>
          <div>
            <span className="text-xl font-bold text-brand-foreground font-mono">
              {stats.total_albums}
            </span>
            <span className="block text-xs text-brand-muted font-medium">
              {t('home_stat_albums', settings.language)}
            </span>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-oled-card border border-brand-border/80 flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-lg bg-brand-primary/80 flex items-center justify-center text-amber-400">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <span className="text-xl font-bold text-brand-foreground font-mono">
              {stats.total_artists}
            </span>
            <span className="block text-xs text-brand-muted font-medium">
              {t('home_stat_artists', settings.language)}
            </span>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-oled-card border border-brand-border/80 flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-lg bg-brand-primary/80 flex items-center justify-center text-rose-400">
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <span className="text-xl font-bold text-brand-foreground font-mono">
              {formatDurationSecs(stats.total_duration_secs)}
            </span>
            <span className="block text-xs text-brand-muted font-medium">
              {t('home_stat_duration', settings.language)}
            </span>
          </div>
        </div>
      </div>

      {/* Continue Listening (if a track is loaded or active) */}
      {status.current_track && (
        <div className="continue-listening-card p-5 rounded-2xl bg-oled-card/90 border border-brand-border/60 flex items-center justify-between gap-4 shadow-sm">
          <div className="flex items-center gap-4 min-w-0">
            <TrackArtwork
              track={status.current_track}
              className="w-14 h-14 rounded-xl bg-brand-primary/80 border border-brand-border shrink-0"
              iconClassName="w-6 h-6 text-brand-accent"
            />
            <div className="flex flex-col min-w-0">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-brand-accent">
                {t('home_continue_listening', settings.language)}
              </span>
              <span className="block min-w-0 max-w-full truncate text-base font-semibold text-brand-foreground" title={status.current_track.title}>
                {status.current_track.title}
              </span>
              <span className="block min-w-0 max-w-full truncate text-xs text-brand-muted" title={`${status.current_track.artist} • ${status.current_track.album}`}>
                {status.current_track.artist} • {status.current_track.album}
              </span>
            </div>
          </div>

          <Button
            variant="accent"
            size="md"
            icon={<FileText className="w-4 h-4" />}
            onClick={() => onNavigate('lyrics')}
          >
            {t('home_lyrics', settings.language)}
          </Button>
        </div>
      )}

      {/* Recently Added Section */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold font-display text-brand-foreground flex items-center gap-2">
            <span>{t('home_recently_added', settings.language)}</span>
          </h2>
          <button
            onClick={() => onNavigate('tracks')}
            className="text-xs font-semibold text-brand-accent hover:underline flex items-center gap-1 focus-visible:outline-none"
          >
            <span>{t('home_view_all', settings.language)}</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {recentlyAdded.map(tr => (
            <div
              key={tr.id}
              onClick={() => playTrack(tr, recentlyAdded)}
              onKeyDown={event => activateOnKeyboard(event, () => void playTrack(tr, recentlyAdded))}
              role="button"
              tabIndex={0}
              aria-label={t('home_play_track', settings.language, { title: tr.title, artist: tr.artist })}
              className="group p-3 rounded-xl bg-oled-card hover:bg-oled-hover border border-brand-border/60 hover:border-brand-border cursor-pointer transition-all flex items-center justify-between gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
            >
              <div className="flex items-center gap-3 min-w-0">
                <TrackArtwork
                  track={tr}
                  className="w-11 h-11 rounded-lg bg-brand-primary/90 border border-brand-border shrink-0 group-hover:scale-105 transition-transform"
                  iconClassName="w-5 h-5 text-brand-muted group-hover:text-brand-accent transition-colors"
                />
                <div className="flex flex-col min-w-0">
                  <span className="block min-w-0 max-w-full truncate text-xs font-semibold text-brand-foreground group-hover:text-brand-accent transition-colors" title={tr.title}>
                    {tr.title}
                  </span>
                  <div className="flex min-w-0 items-center gap-1 text-[11px] text-brand-muted truncate">
                    <button type="button" className="min-w-0 max-w-full truncate hover:text-brand-accent" title={tr.artist} onClick={e => { e.stopPropagation(); const target = artists.find(item => item.name === tr.artist); if (target) onNavigate('artist_detail', target); }}>{tr.artist}</button>
                    <span>•</span>
                    <button type="button" className="min-w-0 max-w-full truncate hover:text-brand-accent" title={tr.album} onClick={e => { e.stopPropagation(); const target = albums.find(item => item.name === tr.album && item.artist === tr.artist); if (target) onNavigate('album_detail', target); }}>{tr.album}</button>
                  </div>
                </div>
              </div>
              <Badge track={tr} />
            </div>
          ))}
        </div>
      </section>

      {/* Featured Albums Grid */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold font-display text-brand-foreground">
            {t('albums_title', settings.language)}
          </h2>
          <button
            onClick={() => onNavigate('albums')}
            className="text-xs font-semibold text-brand-accent hover:underline flex items-center gap-1 focus-visible:outline-none"
          >
            <span>{t('home_view_all', settings.language)}</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {albums.slice(0, 6).map(al => (
            <div
              key={al.id}
              className="group relative min-w-0 p-3 rounded-xl bg-oled-card hover:bg-oled-hover border border-brand-border/60 hover:border-brand-border cursor-pointer transition-all flex flex-col"
            >
              <button
                type="button"
                onClick={() => onNavigate('album_detail', al)}
                aria-label={t('home_open_album', settings.language, { name: al.name, artist: al.artist })}
                className="absolute inset-0 z-10 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
              />
              <div className="relative aspect-square rounded-lg bg-gradient-to-tr from-brand-primary to-oled-card border border-brand-border/60 mb-2.5 flex items-center justify-center overflow-hidden">
            <AlbumArtwork album={al} alt={`${al.name} cover`} />
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                  <button
                    type="button"
                    onClick={e => {
                      e.stopPropagation();
                      if (al.tracks.length > 0) playQueue(al.tracks, 0);
                    }}
                    className="relative z-20 w-10 h-10 rounded-full bg-brand-accent text-oled-base flex items-center justify-center shadow-glow-accent hover:scale-110 active:scale-95 transition-all"
                    aria-label={t('home_play_album', settings.language, { name: al.name })}
                  >
                    <Play className="w-4 h-4 fill-current ml-0.5" />
                  </button>
                </div>
              </div>
              <span className="block min-w-0 max-w-full truncate text-xs font-semibold text-brand-foreground group-hover:text-brand-accent transition-colors" title={al.name}>
                {al.name}
              </span>
              <span className="block min-w-0 max-w-full truncate text-[11px] text-brand-muted" title={al.artist}>{al.artist}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Featured Playlists */}
      {playlists.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold font-display text-brand-foreground">
              {t('playlists_title', settings.language)}
            </h2>
            <button
              onClick={() => onNavigate('playlists')}
              className="text-xs font-semibold text-brand-accent hover:underline flex items-center gap-1 focus-visible:outline-none"
            >
              <span>{t('home_view_all', settings.language)}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {playlists.slice(0, 4).map(pl => (
              <div
                key={pl.id}
                onClick={() => onNavigate('playlist_detail', pl)}
                onKeyDown={event => activateOnKeyboard(event, () => onNavigate('playlist_detail', pl))}
                role="button"
                tabIndex={0}
                aria-label={t('home_open_playlist', settings.language, { name: pl.name })}
                className="group flex h-32 cursor-pointer items-center gap-3 overflow-hidden rounded-xl border border-brand-border/60 bg-oled-card p-3 transition-all hover:border-brand-border hover:bg-oled-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
              >
                <div className="h-24 w-24 shrink-0 overflow-hidden rounded-lg border border-brand-border/60 bg-brand-primary/80 shadow-sm">
                  <PlaylistArtwork
                    playlist={pl}
                    tracks={getPlaylistTracks(pl)}
                    className="motion-safe:transition-transform motion-safe:duration-200 group-hover:scale-105"
                  />
                </div>

                <div className="flex h-full min-w-0 flex-1 flex-col justify-between py-1">
                  <div className="flex items-center justify-between mb-1">
                    <span className="block min-w-0 max-w-full truncate text-xs font-semibold text-brand-foreground transition-colors group-hover:text-brand-accent" title={pl.name}>
                      {pl.name}
                    </span>
                    {pl.is_smart && <Sparkles className="h-3.5 w-3.5 shrink-0 text-amber-400" aria-hidden="true" />}
                  </div>
                  <p className="line-clamp-2 text-[11px] leading-relaxed text-brand-muted">
                    {pl.description || t('no_description', settings.language)}
                  </p>
                  <span className="mt-auto text-[10px] font-mono text-brand-muted">
                    {t('home_playlist_track_count', settings.language, { count: pl.track_ids.length })}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};
