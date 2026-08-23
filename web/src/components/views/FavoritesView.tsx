import React, { useState } from 'react';
import { Heart, Play, Disc, User } from 'lucide-react';
import { useLibrary } from '../../context/LibraryContext';
import { usePlayer } from '../../context/PlayerContext';
import { useSettings } from '../../context/SettingsContext';
import { Button } from '../common/Button';
import { Badge } from '../common/Badge';
import { Track } from '../../types/library';
import { t } from '../../i18n';

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
    <div className="p-6 md:p-8 space-y-6 max-w-7xl mx-auto w-full select-none">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
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
      <div className="flex items-center gap-2 border-b border-brand-border/60 pb-3">
        <button
          onClick={() => setActiveTab('tracks')}
          className={`px-4 py-2 rounded-lg text-xs font-semibold transition-colors focus-visible:outline-none ${
            activeTab === 'tracks'
              ? 'bg-brand-secondary text-white shadow-sm'
              : 'text-brand-muted hover:text-brand-foreground hover:bg-oled-hover'
          }`}
        >
          {t('tab_favorite_tracks', settings.language, { count: favTracks.length })}
        </button>

        <button
          onClick={() => setActiveTab('albums')}
          className={`px-4 py-2 rounded-lg text-xs font-semibold transition-colors focus-visible:outline-none ${
            activeTab === 'albums'
              ? 'bg-brand-secondary text-white shadow-sm'
              : 'text-brand-muted hover:text-brand-foreground hover:bg-oled-hover'
          }`}
        >
          {t('tab_favorite_albums', settings.language, { count: favAlbums.length })}
        </button>

        <button
          onClick={() => setActiveTab('artists')}
          className={`px-4 py-2 rounded-lg text-xs font-semibold transition-colors focus-visible:outline-none ${
            activeTab === 'artists'
              ? 'bg-brand-secondary text-white shadow-sm'
              : 'text-brand-muted hover:text-brand-foreground hover:bg-oled-hover'
          }`}
        >
          {t('tab_favorite_artists', settings.language, { count: favArtists.length })}
        </button>
      </div>

      {/* Tab Contents */}
      {activeTab === 'tracks' && (
        <div>
          {favTracks.length === 0 ? (
            <div className="p-12 text-center text-brand-muted">
              {t('empty_favorites_desc', settings.language)}
            </div>
          ) : (
            <div className="rounded-xl border border-brand-border bg-oled-card/60 overflow-hidden divide-y divide-brand-border/30">
              {favTracks.map((tr, idx) => {
                const isPlaying = status.current_track?.id === tr.id;
                return (
                  <div
                    key={tr.id}
                    onDoubleClick={() => playTrack(tr, favTracks)}
                    className={`flex items-center justify-between px-4 py-3 text-xs transition-colors cursor-pointer ${
                      isPlaying ? 'bg-brand-accent/10 text-brand-accent font-medium' : 'hover:bg-oled-hover text-brand-foreground'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0 pr-2">
                      <button
                        onClick={() => playTrack(tr, favTracks)}
                        className="w-7 h-7 rounded-full flex items-center justify-center text-brand-muted hover:text-brand-accent hover:bg-oled-base transition-all"
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

                    <div className="flex items-center gap-3">
                      <Badge track={tr} />
                      <button
                        onClick={() => toggleFavoriteTrack(tr.id)}
                        className="p-1 rounded text-rose-500 hover:text-rose-400 focus-visible:outline-none"
                      >
                        <Heart className="w-4 h-4 fill-current" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {activeTab === 'albums' && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-5">
          {favAlbums.length === 0 ? (
            <div className="col-span-full p-12 text-center text-brand-muted">
              {t('empty_favorites_desc', settings.language)}
            </div>
          ) : (
            favAlbums.map(al => (
              <div
                key={al.id}
                onClick={() => onNavigate('album_detail', al)}
                className="group p-3.5 rounded-2xl bg-oled-card hover:bg-oled-hover border border-brand-border/60 hover:border-brand-border cursor-pointer transition-all flex flex-col"
              >
                <div className="relative aspect-square rounded-xl bg-gradient-to-tr from-indigo-950 to-slate-900 border border-brand-border/60 mb-3 flex items-center justify-center overflow-hidden">
                  <Disc className="w-14 h-14 text-indigo-400/40" />
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
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-5">
          {favArtists.length === 0 ? (
            <div className="col-span-full p-12 text-center text-brand-muted">
              {t('empty_favorites_desc', settings.language)}
            </div>
          ) : (
            favArtists.map(ar => (
              <div
                key={ar.id}
                onClick={() => onNavigate('artist_detail', ar)}
                className="group p-4 rounded-2xl bg-oled-card hover:bg-oled-hover border border-brand-border/60 hover:border-brand-border cursor-pointer transition-all flex flex-col items-center text-center"
              >
                <div className="relative w-24 h-24 rounded-full bg-gradient-to-tr from-indigo-950 to-slate-900 border border-brand-border mb-3 flex items-center justify-center">
                  <User className="w-10 h-10 text-indigo-400/60" />
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
