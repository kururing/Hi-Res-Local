import React, { useState } from 'react';
import { Heart, Play, Disc, User } from 'lucide-react';
import { useLibrary } from '../../context/LibraryContext';
import { usePlayer } from '../../context/PlayerContext';
import { useSettings } from '../../context/SettingsContext';
import { Button } from '../common/Button';
import { Badge } from '../common/Badge';
import { VirtualList } from '../common/VirtualList';
import { Track } from '../../types/library';
import { t } from '../../i18n';
import { activateOnKeyboard } from '../../services/keyboard';

type FavTab = 'tracks' | 'albums' | 'artists';

interface FavoritesViewProps {
  onNavigate: (view: string, payload?: unknown) => void;
  onOpenDetails: (track: Track) => void;
}

export const FavoritesView: React.FC<FavoritesViewProps> = ({
  onNavigate,
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

  const { playTrack, playQueue, status } = usePlayer();
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
    <div className="mx-auto flex h-full min-h-0 w-full max-w-7xl flex-col gap-6 p-6 select-none md:p-8">
      {/* Header */}
      <div className="flex shrink-0 flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold font-display text-brand-foreground flex items-center gap-2.5">
            <Heart className="w-6 h-6 text-rose-500 fill-rose-500" />
            <span>{t('favorites_title', settings.language)}</span>
          </h1>
          <span className="text-xs text-brand-muted">
            {favTracks.length} tracks • {favAlbums.length} albums • {favArtists.length} artists
          </span>
        </div>

        {activeTab === 'tracks' && favTracks.length > 0 && (
          <Button
            variant="accent"
            size="md"
            icon={<Play className="w-4 h-4 fill-current" />}
            onClick={() => playQueue(favTracks, 0)}
          >
            {t('tracks_play_all', settings.language)}
          </Button>
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
              renderRow={(tr, idx) => {
                const isPlaying = status.current_track?.id === tr.id;
                return (
                  <div
                    onDoubleClick={() => playTrack(tr, favTracks)}
                    className={`flex h-full items-center justify-between px-4 text-xs cursor-pointer ${
                      isPlaying ? 'bg-brand-accent/10 text-brand-accent font-medium' : 'hover:bg-oled-hover text-brand-foreground'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0 pr-2">
                      <button
                        onClick={() => playTrack(tr, favTracks)}
                        className="w-11 h-11 min-h-[44px] min-w-[44px] rounded-full flex items-center justify-center text-brand-muted hover:text-brand-accent hover:bg-oled-base focus-visible:outline-none"
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
                        <span className="text-[11px] text-brand-muted truncate">
                          {tr.artist} • {tr.album}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge track={tr} />
                      <button
                        onClick={() => toggleFavoriteTrack(tr.id)}
                        className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded text-rose-500 hover:text-rose-400 focus-visible:outline-none"
                        aria-label="Remove from favorites"
                        aria-pressed={true}
                      >
                        <Heart className="w-4 h-4 fill-current" aria-hidden="true" />
                      </button>
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
                aria-label={`Open album ${al.name} by ${al.artist}`}
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
                aria-label={`Open artist ${ar.name}`}
                className="group p-4 rounded-2xl bg-oled-card hover:bg-oled-hover border border-brand-border/60 hover:border-brand-border cursor-pointer transition-all flex flex-col items-center text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
              >
                <div className="relative w-24 h-24 rounded-full bg-gradient-to-tr from-brand-primary to-oled-card border border-brand-border mb-3 flex items-center justify-center">
                  <User className="w-10 h-10 text-brand-accent/60" />
                </div>
                <span className="font-semibold text-xs text-brand-foreground truncate w-full">
                  {ar.name}
                </span>
                <span className="text-[11px] text-brand-muted mt-0.5">
                  {ar.track_count} tracks
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};
