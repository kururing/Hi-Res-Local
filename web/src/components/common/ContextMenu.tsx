import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Play,
  ListPlus,
  Radio,
  Heart,
  FolderPlus,
  Disc,
  User,
  Info,
  Copy,
  Trash2,
  Plus,
} from 'lucide-react';
import { Track } from '../../types/library';
import { usePlayer } from '../../context/PlayerContext';
import { useLibrary } from '../../context/LibraryContext';
import { usePlaylists } from '../../context/PlaylistContext';
import { useToast } from '../../context/ToastContext';
import { useSettings } from '../../context/SettingsContext';
import { t } from '../../i18n';
import { isLocalFilePath } from '../../platform/web/WebLibraryApi';

export interface ContextMenuState {
  isOpen: boolean;
  x: number;
  y: number;
  track: Track | null;
  playlistId?: string; // If clicked from inside a playlist
  onOpenDetails?: (track: Track) => void;
  onNavigateAlbum?: (albumName: string) => void;
  onNavigateArtist?: (artistName: string) => void;
}

interface ContextMenuProps {
  state: ContextMenuState;
  onClose: () => void;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({ state, onClose }) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const { playTrack, playNext, addToQueue } = usePlayer();
  const { toggleFavoriteTrack, favoriteTrackIds } = useLibrary();
  const { playlists, createPlaylist, addTrackToPlaylist, removeTrackFromPlaylist } = usePlaylists();
  const { showToast } = useToast();
  const { settings } = useSettings();

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleScroll = () => onClose();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    if (state.isOpen) {
      previousFocusRef.current = document.activeElement as HTMLElement | null;
      window.requestAnimationFrame(() => menuRef.current?.querySelector<HTMLElement>('button')?.focus());
      window.addEventListener('mousedown', handleClickOutside);
      window.addEventListener('scroll', handleScroll, true);
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      window.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('keydown', handleKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [state.isOpen, onClose]);

  if (!state.isOpen || !state.track) return null;

  const track = state.track;
  const isFav = favoriteTrackIds.has(track.id);

  // Position clamping to keep inside viewport
  const menuWidth = 220;
  const menuHeight = 360;
  const submenuWidth = 192;
  const viewportGap = 10;
  const x = Math.max(viewportGap, Math.min(state.x, window.innerWidth - menuWidth - viewportGap));
  const y = Math.max(viewportGap, Math.min(state.y, window.innerHeight - menuHeight - viewportGap));
  const openSubmenuLeft = x + menuWidth + submenuWidth + viewportGap > window.innerWidth;

  const handleCreatePlaylist = async () => {
    const playlist = await createPlaylist(track.title, '');
    await addTrackToPlaylist(playlist.id, track.id, false);
    onClose();
  };

  const handleCopyPath = () => {
    if (!isLocalFilePath(track.path)) return;
    navigator.clipboard.writeText(track.path);
    showToast(t('toast_copied', settings.language), 'info');
    onClose();
  };

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? []);
    const current = items.indexOf(document.activeElement as HTMLElement);
    let next = current;
    if (event.key === 'ArrowDown') next = (current + 1) % items.length;
    else if (event.key === 'ArrowUp') next = (current - 1 + items.length) % items.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else return;
    event.preventDefault();
    items[next]?.focus();
  };

  return createPortal(
    <>
    {state.isOpen && <div
      ref={menuRef}
      aria-label={t('aria_track_actions', settings.language)}
      onKeyDown={handleMenuKeyDown}
      style={{ top: `${y}px`, left: `${x}px` }}
      className="fixed z-50 w-56 bg-oled-card/95 border border-brand-border rounded-xl shadow-card-elevated backdrop-blur-md py-1.5 text-xs text-brand-foreground flex flex-col gap-0.5 animate-fadeIn select-none"
    >
      {/* Play Now */}
      <button
        onClick={() => {
          playTrack(track);
          onClose();
        }}
        className="flex items-center gap-2.5 px-3 py-2 hover:bg-oled-hover text-left transition-colors font-medium"
      >
        <Play className="w-4 h-4 text-brand-accent fill-brand-accent" />
        <span>{t('menu_play_now', settings.language)}</span>
      </button>

      {/* Play Next */}
      <button
        onClick={() => {
          playNext(track);
          onClose();
        }}
        className="flex items-center gap-2.5 px-3 py-2 hover:bg-oled-hover text-left transition-colors"
      >
        <Radio className="w-4 h-4 text-brand-accent" />
        <span>{t('menu_play_next', settings.language)}</span>
      </button>

      {/* Add to Queue */}
      <button
        onClick={() => {
          addToQueue(track);
          onClose();
        }}
        className="flex items-center gap-2.5 px-3 py-2 hover:bg-oled-hover text-left transition-colors"
      >
        <ListPlus className="w-4 h-4 text-brand-muted" />
        <span>{t('menu_add_queue', settings.language)}</span>
      </button>

      <div className="h-px bg-brand-border/60 my-1" />

      {/* Toggle Favorite */}
      <button
        onClick={() => {
          toggleFavoriteTrack(track.id);
          onClose();
        }}
        className="flex items-center gap-2.5 px-3 py-2 hover:bg-oled-hover text-left transition-colors"
      >
        <Heart
          className={`w-4 h-4 ${
            isFav ? 'text-rose-500 fill-rose-500' : 'text-brand-muted'
          }`}
        />
        <span>{isFav ? t('menu_unfavorite', settings.language) : t('menu_favorite', settings.language)}</span>
      </button>

      {/* Add to Playlist Submenu */}
      <div className="relative group">
        <button aria-haspopup="menu" className="flex w-full items-center justify-between px-3 py-2 hover:bg-oled-hover cursor-pointer transition-colors text-left">
          <div className="flex items-center gap-2.5">
            <FolderPlus className="w-4 h-4 text-brand-muted" />
            <span>{t('menu_add_to_playlist', settings.language)}</span>
          </div>
          <span className="text-[10px] text-brand-muted">▶</span>
        </button>

        {/* Submenu Flyout */}
        <div
          className={`invisible pointer-events-none absolute top-0 z-50 flex w-48 flex-col rounded-xl border border-brand-border bg-oled-card py-1 opacity-0 shadow-card-elevated transition-opacity group-hover:visible group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:visible group-focus-within:pointer-events-auto group-focus-within:opacity-100 ${
            openSubmenuLeft ? 'right-full' : 'left-full'
          }`}
        >
          <button
            type="button"
            onClick={() => void handleCreatePlaylist()}
            className="mx-1 flex min-w-0 items-center gap-2.5 whitespace-nowrap rounded-lg bg-emerald-500/15 px-3 py-2 text-left font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/25 hover:text-emerald-200"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            <span className="min-w-0 truncate">{t('menu_create_playlist', settings.language)}</span>
          </button>
          <div className="my-1 h-px bg-brand-border/60" />
          {playlists.filter(p => !p.is_smart).length === 0 ? (
            <span className="px-3 py-2 text-[11px] text-brand-muted">No custom playlists</span>
          ) : (
            playlists
              .filter(p => !p.is_smart)
              .map(pl => (
                <button
                  key={pl.id}
                  onClick={() => {
                    addTrackToPlaylist(pl.id, track.id);
                    onClose();
                  }}
                  className="px-3 py-1.5 text-left hover:bg-oled-hover truncate transition-colors text-xs"
                >
                  {pl.name}
                </button>
              ))
          )}
        </div>
      </div>

      {/* Remove from playlist if applicable */}
      {state.playlistId && (
        <button
          onClick={() => {
            removeTrackFromPlaylist(state.playlistId!, track.id);
            onClose();
          }}
          className="flex items-center gap-2.5 px-3 py-2 hover:bg-rose-950/40 text-rose-300 text-left transition-colors"
        >
          <Trash2 className="w-4 h-4 text-rose-400" />
          <span>{t('menu_remove_from_playlist', settings.language)}</span>
        </button>
      )}

      <div className="h-px bg-brand-border/60 my-1" />

      {/* Navigate to Album */}
      {state.onNavigateAlbum && (
        <button
          onClick={() => {
            state.onNavigateAlbum!(track.album);
            onClose();
          }}
          className="flex items-center gap-2.5 px-3 py-2 hover:bg-oled-hover text-left transition-colors"
        >
          <Disc className="w-4 h-4 text-brand-muted" />
          <span>{t('menu_view_album', settings.language)}</span>
        </button>
      )}

      {/* Navigate to Artist */}
      {state.onNavigateArtist && (
        <button
          onClick={() => {
            state.onNavigateArtist!(track.artist);
            onClose();
          }}
          className="flex items-center gap-2.5 px-3 py-2 hover:bg-oled-hover text-left transition-colors"
        >
          <User className="w-4 h-4 text-brand-muted" />
          <span>{t('menu_view_artist', settings.language)}</span>
        </button>
      )}

      {/* Track Details */}
      {state.onOpenDetails && (
        <button
          onClick={() => {
            state.onOpenDetails!(track);
            onClose();
          }}
          className="flex items-center gap-2.5 px-3 py-2 hover:bg-oled-hover text-left transition-colors"
        >
          <Info className="w-4 h-4 text-brand-muted" />
          <span>{t('menu_track_details', settings.language)}</span>
        </button>
      )}

      {/* Copy Path */}
      {isLocalFilePath(track.path) && (
      <button
        onClick={handleCopyPath}
        className="flex items-center gap-2.5 px-3 py-2 hover:bg-oled-hover text-left transition-colors"
      >
        <Copy className="w-4 h-4 text-brand-muted" />
        <span>{t('menu_copy_path', settings.language)}</span>
      </button>
      )}
    </div>}
    </>,
    document.body
  );
};
