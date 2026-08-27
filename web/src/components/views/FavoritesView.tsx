import React, { useState } from 'react';
import { Heart, Play, Shuffle, Disc, User } from 'lucide-react';
import { useLibrary } from '../../context/LibraryContext';
import { usePlayer } from '../../context/PlayerContext';
import { useSettings } from '../../context/SettingsContext';
import { Button } from '../common/Button';
import { Badge } from '../common/Badge';
import { VirtualList } from '../common/VirtualList';
import { TrackPlayArtwork } from '../common/TrackPlayArtwork';
import { Track } from '../../types/library';
import { t } from '../../i18n';
import { activateOnKeyboard } from '../../services/keyboard';
import { TrackMoreButton } from '../common/TrackMoreButton';

type FavTab = 'tracks' | 'albums' | 'artists';

interface FavoritesViewProps {
  onNavigate: (view: string, payload?: unknown) => void;
  onOpenDetails: (track: Track) => void;
}

export const FavoritesView: React.FC<FavoritesViewProps> = ({
  onNavigate,
  onOpenDetails,
}) => {
  const {
    tracks,
    albums,
    artists,
    favoriteTrackIds,
    favoriteAlbumKeys,
    favoriteArtistNames,
    toggleFavoriteTrack,
  } = useLibrary();

  const { playTrack, playQueue, toggleShuffle, status } = usePlayer();
  const { settings } = useSettings();
  const [activeTab, setActiveTab] = useState<FavTab>('tracks');

  const favTracks = React.useMemo(() => {
    return tracks.filter(t => favoriteTrackIds.has(t.id));
  }, [tracks, favoriteTrackIds]);

  const favAlbums = React.useMemo(() => {
    return albums.filter(a => favoriteAlbumKeys.has(a.id));
  }, [albums, favoriteAlbumKeys]);

  const favArtists = React.useMemo(() => {
    return artists.filter(ar => favoriteArtistNames.has(ar.name));
  }, [artists, favoriteArtistNames]);

  return (
    <div className="view-page mx-auto flex h-full min-h-0 w-full max-w-7xl flex-col gap-6 p-6 select-none md:p-8">
      {/* Header */}
      <div className="flex shrink-0 flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold font-display text-brand-foreground flex items-center gap-2.5">
            <Heart className="w-6 h-6 text-rose-500 fill-rose-500" />
            <span>{t('favorites_title', settings.language)}</span>
          </h1>
          <span className="text-xs text-brand-muted">
            {t('favorites_summary', settings.language, { tracks: favTracks.length, albums: favAlbums.length, artists: favArtists.length })}
          </span>
        </div>

        {activeTab === 'tracks' && favTracks.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="accent"
              size="md"
              icon={<Play className="w-4 h-4 fill-current" />}
              onClick={() => playQueue(favTracks, 0)}
            >
              {t('tracks_play_all', settings.language)}
            </Button>
            <Button
              variant="secondary"
              size="md"
              icon={<Shuffle className="w-4 h-4" />}
              onClick={() => {
                if (!status.shuffle) void toggleShuffle();
                playQueue(favTracks, 0);
              }}
            >
              {t('tracks_shuffle_all', settings.language)}
            </Button>
          </div>
        )}
      </div>

      {/* Sub Tabs */}
      <div className="flex shrink-0 items-center gap-2 border-b border-brand-border/60 pb-3">
        <button
          onClick={() => setActiveTab('tracks')}
          className={`min-h-[44px] px-4 py-2 rounded-lg text-xs font-semibold transition-colors focus-visible:outline-none ${
            activeTab === 'tracks'
              ? 'bg-brand-secondary text-white shadow-sm'
              : 'text-brand-muted hover:text-brand-foreground hover:bg-oled-hover'
          }`}
          aria-pressed={activeTab === 'tracks'}
        >
          {t('tab_favorite_tracks', settings.language, { count: favTracks.length })}
        </button>

        <button
          onClick={() => setActiveTab('albums')}
          className={`min-h-[44px] px-4 py-2 rounded-lg text-xs font-semibold transition-colors focus-visible:outline-none ${
            activeTab === 'albums'
              ? 'bg-brand-secondary text-white shadow-sm'
              : 'text-brand-muted hover:text-brand-foreground hover:bg-oled-hover'
          }`}
          aria-pressed={activeTab === 'albums'}
        >
          {t('tab_favorite_albums', settings.language, { count: favAlbums.length })}
        </button>

        <button
          onClick={() => setActiveTab('artists')}
          className={`min-h-[44px] px-4 py-2 rounded-lg text-xs font-semibold transition-colors focus-visible:outline-none ${
            activeTab === 'artists'
              ? 'bg-brand-secondary text-white shadow-sm'
              : 'text-brand-muted hover:text-brand-foreground hover:bg-oled-hover'
          }`}
          aria-pressed={activeTab === 'artists'}
        >
          {t('tab_favorite_artists', settings.language, { count: favArtists.length })}
        </button>
      </div>

      {/* Tab Contents */}
      {activeTab === 'tracks' && (
        <div className="min-h-0 flex-1">
          {favTracks.length === 0 ? (
            <div className="p-12 text-center text-brand-muted">
              {t('empty_favorites_desc', settings.language)}
            </div>
          ) : (
            <VirtualList
              items={favTracks}
              rowHeight={64}
              className="h-full min-h-0 rounded-xl border border-brand-border bg-oled-card/60"
              getKey={item => item.id}
              renderRow={tr => {
                const isPlaying = status.current_track?.id === tr.id;
                return (
                  <div
                    onDoubleClick={() => playTrack(tr, favTracks)}
                    className={`tracks-table-grid group grid h-full items-center gap-3 px-4 text-xs cursor-pointer ${
                      isPlaying ? 'bg-brand-accent/10 text-brand-accent font-medium' : 'hover:bg-oled-hover text-brand-foreground'
                    }`}
                  >
                    <div className="flex items-center justify-center">
                      <TrackPlayArtwork
                        track={tr}
                        isPlaying={isPlaying}
                        onPlay={() => playTrack(tr, favTracks)}
                      />
                    </div>

                    <div className="min-w-0 truncate font-semibold">{tr.title}</div>

                    <div className="hidden min-w-0 sm:block truncate text-brand-muted">
                      <button type="button" className="max-w-full truncate text-left hover:text-brand-accent" onClick={e => { e.stopPropagation(); const target = artists.find(item => item.name === tr.artist); if (target) onNavigate('artist_detail', target); }}>{tr.artist}</button>
                    </div>

                    <div className="hidden min-w-0 md:block truncate text-brand-muted">
                      <button type="button" className="max-w-full truncate text-left hover:text-brand-accent" onClick={e => { e.stopPropagation(); const target = albums.find(item => item.name === tr.album && item.artist === tr.artist); if (target) onNavigate('album_detail', target); }}>{tr.album}</button>
                    </div>

                    <div className="hidden min-w-0 min-[1180px]:flex items-center">
                      <Badge track={tr} />
                    </div>

                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => toggleFavoriteTrack(tr.id)}
                        className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded text-rose-500 hover:text-rose-400 focus-visible:outline-none"
                        aria-label={t('favorite_track_remove', settings.language)}
                        aria-pressed={true}
                      >
                        <Heart className="w-4 h-4 fill-current" aria-hidden="true" />
                      </button>
                      <span className="font-mono text-brand-muted tabular-nums">
                        {tr.duration >= 0 ? `${Math.floor(tr.duration / 60)}:${Math.floor(tr.duration % 60).toString().padStart(2, '0')}` : '0:00'}
                      </span>
                      <TrackMoreButton
                        track={tr}
                        onOpenDetails={onOpenDetails}
                        onNavigateAlbum={() => { const target = albums.find(item => item.name === tr.album && item.artist === tr.artist); if (target) onNavigate('album_detail', target); }}
                        onNavigateArtist={() => { const target = artists.find(item => item.name === tr.artist); if (target) onNavigate('artist_detail', target); }}
                      />
                    </div>
                  </div>
                );
              }}
            />
          )}
        </div>
      )}

      {activeTab === 'albums' && (
        <div className="grid min-h-0 flex-1 grid-cols-2 content-start gap-5 overflow-y-auto overscroll-contain sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {favAlbums.length === 0 ? (
            <div className="col-span-full p-12 text-center text-brand-muted">
              {t('empty_favorites_desc', settings.language)}
            </div>
          ) : (
            favAlbums.map(al => (
              <div
                key={al.id}
                onClick={() => onNavigate('album_detail', al)}
                onKeyDown={event => activateOnKeyboard(event, () => onNavigate('album_detail', al))}
                role="button"
                tabIndex={0}
                aria-label={t('home_open_album', settings.language, { name: al.name, artist: al.artist })}
                className="group p-3.5 rounded-2xl bg-oled-card hover:bg-oled-hover border border-brand-border/60 hover:border-brand-border cursor-pointer transition-all flex flex-col focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
              >
                <div className="relative aspect-square rounded-xl bg-gradient-to-tr from-brand-primary to-oled-card border border-brand-border/60 mb-3 flex items-center justify-center overflow-hidden">
                  <Disc className="w-14 h-14 text-brand-accent/40" />
                </div>
                <span className="font-semibold text-xs text-brand-foreground truncate">
                  {al.name}
                </span>
                <span className="text-xs text-brand-muted truncate">{al.artist}</span>
              </div>
            ))
          )}
        </div>
      )}

      {activeTab === 'artists' && (
        <div className="grid min-h-0 flex-1 grid-cols-2 content-start gap-5 overflow-y-auto overscroll-contain sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {favArtists.length === 0 ? (
            <div className="col-span-full p-12 text-center text-brand-muted">
              {t('empty_favorites_desc', settings.language)}
            </div>
          ) : (
            favArtists.map(ar => (
              <div
                key={ar.id}
                onClick={() => onNavigate('artist_detail', ar)}
                onKeyDown={event => activateOnKeyboard(event, () => onNavigate('artist_detail', ar))}
                role="button"
                tabIndex={0}
                aria-label={t('favorite_artist_open', settings.language, { name: ar.name })}
                className="group p-4 rounded-2xl bg-oled-card hover:bg-oled-hover border border-brand-border/60 hover:border-brand-border cursor-pointer transition-all flex flex-col items-center text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
              >
                <div className="relative w-24 h-24 rounded-full bg-gradient-to-tr from-brand-primary to-oled-card border border-brand-border mb-3 flex items-center justify-center">
                  <User className="w-10 h-10 text-brand-accent/60" />
                </div>
                <span className="font-semibold text-xs text-brand-foreground truncate w-full">
                  {ar.name}
                </span>
                <span className="text-[11px] text-brand-muted mt-0.5">
                  {t('favorite_artist_track_count', settings.language, { count: ar.track_count })}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};
