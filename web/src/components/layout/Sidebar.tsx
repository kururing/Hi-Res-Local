import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Home,
  Music2,
  Disc,
  Users,
  Radio,
  Heart,
  ListMusic,
  History,
  Settings,
  Plus,
  Sparkles,
  Upload,
  MoreVertical,
  Pencil,
  ImagePlus,
  Trash2,
} from 'lucide-react';
import { usePlaylists } from '../../context/PlaylistContext';
import { usePlayer } from '../../context/PlayerContext';
import { useSettings } from '../../context/SettingsContext';
import { useLibrary } from '../../context/LibraryContext';
import { t } from '../../i18n';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { PlaylistArtwork } from '../common/PlaylistArtwork';
import { IpcService } from '../../services/ipc';

interface SidebarProps {
  currentView: string;
  onNavigate: (view: string, payload?: unknown) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ currentView, onNavigate }) => {
  const { playlists, createPlaylist, importM3uFile, getPlaylistTracks, updatePlaylist, deletePlaylist } = usePlaylists();
  const { status } = usePlayer();
  const { settings } = useSettings();
  const { stats } = useLibrary();

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [newPlaylistDesc, setNewPlaylistDesc] = useState('');
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [playlistMenuId, setPlaylistMenuId] = useState<string | null>(null);
  const [playlistMenuPosition, setPlaylistMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const playlistMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!playlistMenuId) return;

    const closeMenuOnOutsidePointer = (event: PointerEvent) => {
      if (!playlistMenuRef.current?.contains(event.target as Node)) {
        setPlaylistMenuId(null);
        setPlaylistMenuPosition(null);
      }
    };
    const closeMenuOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPlaylistMenuId(null);
        setPlaylistMenuPosition(null);
      }
    };

    document.addEventListener('pointerdown', closeMenuOnOutsidePointer);
    document.addEventListener('keydown', closeMenuOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeMenuOnOutsidePointer);
      document.removeEventListener('keydown', closeMenuOnEscape);
    };
  }, [playlistMenuId]);

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPlaylistName.trim()) return;
    const pl = await createPlaylist(newPlaylistName.trim(), newPlaylistDesc.trim());
    setNewPlaylistName('');
    setNewPlaylistDesc('');
    setIsCreateModalOpen(false);
    onNavigate('playlist_detail', pl);
  };

  const handleM3uImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async event => {
      const content = event.target?.result as string;
      if (content) {
        const name = file.name.replace(/\.[^/.]+$/, '');
        const pl = await importM3uFile(content, name);
        if (pl) onNavigate('playlist_detail', pl);
      }
    };
    reader.readAsText(file);
  };

  const renamePlaylist = async (playlist: typeof playlists[number]) => {
    setPlaylistMenuId(null);
    setPlaylistMenuPosition(null);
    const name = window.prompt(t('playlist_rename', settings.language), playlist.name);
    if (name?.trim()) await updatePlaylist(playlist.id, { name: name.trim() });
  };

  const changePlaylistCover = async (playlist: typeof playlists[number]) => {
    setPlaylistMenuId(null);
    setPlaylistMenuPosition(null);
    const path = await IpcService.invoke('open_image_dialog');
    if (path) {
      const cachedPath = await IpcService.invoke('cache_playlist_cover', { sourcePath: path });
      await updatePlaylist(playlist.id, { cover_url: cachedPath });
    }
  };

  const navItems = [
    { id: 'home', label: t('nav_home', settings.language), icon: <Home className="w-4 h-4" aria-hidden="true" /> },
    { id: 'tracks', label: t('nav_tracks', settings.language), icon: <Music2 className="w-4 h-4" aria-hidden="true" />, count: stats.total_tracks },
    { id: 'albums', label: t('nav_albums', settings.language), icon: <Disc className="w-4 h-4" aria-hidden="true" />, count: stats.total_albums },
    { id: 'artists', label: t('nav_artists', settings.language), icon: <Users className="w-4 h-4" aria-hidden="true" />, count: stats.total_artists },
    { id: 'genres', label: t('nav_genres', settings.language), icon: <Radio className="w-4 h-4" aria-hidden="true" /> },
    { id: 'favorites', label: t('nav_favorites', settings.language), icon: <Heart className="w-4 h-4 text-rose-400" aria-hidden="true" /> },
    { id: 'history', label: t('nav_history', settings.language), icon: <History className="w-4 h-4" aria-hidden="true" /> },
  ];

  return (
    <aside
      className={`app-sidebar relative z-20 m-3 mr-0 flex shrink-0 select-none flex-col justify-between border border-brand-border/70 transition-[width,height,border-radius] duration-300 ease-out ${
        isCollapsed
          ? 'w-[72px] self-stretch overflow-y-auto rounded-[28px]'
          : 'w-64 self-stretch overflow-y-auto rounded-[28px]'
      }`}
    >
      {/* Top: Branding & Navigation */}
      <div className={`flex flex-col gap-6 ${isCollapsed ? 'p-3' : 'p-4'}`}>
        {/* Brand */}
        <button
          type="button"
          onClick={() => setIsCollapsed(value => !value)}
          className={`group flex min-h-[44px] items-center rounded-2xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent ${
            isCollapsed ? 'w-11 justify-center p-0' : 'gap-3 px-2'
          }`}
          aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!isCollapsed}
          title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <div className="brand-orb flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl transition-transform duration-300 group-hover:scale-105">
            <Music2 className="w-5 h-5 text-brand-accent" aria-hidden="true" />
          </div>
          {!isCollapsed && (
            <div className="flex flex-col">
              <span className="font-display text-base tracking-wide text-brand-foreground transition-colors group-hover:text-brand-accent">
                Nghe Nhac Pro Max
              </span>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-brand-muted">
                Hi-Res Audio
              </span>
            </div>
          )}
        </button>

        {/* Main Navigation */}
        <nav className="flex flex-col gap-1" aria-label="Main Navigation">
          {navItems.map(item => {
            const isActive = currentView === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                className={`soft-nav-item flex min-h-[44px] items-center rounded-2xl font-medium text-xs transition-all duration-300 focus-visible:outline-none sm:text-sm ${
                  isCollapsed ? 'justify-center px-0' : 'justify-between px-3.5'
                } ${
                  isActive
                    ? 'is-active text-white font-semibold'
                    : 'text-brand-muted hover:text-brand-foreground hover:bg-white/55'
                }`}
                aria-label={isCollapsed ? item.label : undefined}
                title={isCollapsed ? item.label : undefined}
              >
                <div className={`flex items-center ${isCollapsed ? '' : 'gap-3'}`}>
                  {item.icon}
                  {!isCollapsed && <span>{item.label}</span>}
                </div>
                {!isCollapsed && item.count !== undefined && item.count > 0 && (
                  <span className={`text-[11px] px-2 py-0.5 rounded-full ${isActive ? 'bg-white/20 text-white' : 'bg-oled-card text-brand-muted'}`}>
                    {item.count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Playlists Header & Actions */}
        {isCollapsed ? (
          <div className="border-t border-brand-border/60 pt-2">
            <button
              type="button"
              onClick={() => onNavigate('playlists')}
              className={`flex min-h-[44px] w-full items-center justify-center rounded-2xl transition-colors focus-visible:outline-none ${
                currentView === 'playlists' || currentView === 'playlist_detail'
                  ? 'is-active text-white'
                  : 'text-brand-muted hover:bg-white/55 hover:text-brand-foreground'
              }`}
              aria-label={t('playlists_title', settings.language)}
              title={t('playlists_title', settings.language)}
            >
              <ListMusic className="h-4 w-4" aria-hidden="true" />
            </button>
            <div className="mt-1 flex flex-col gap-1">
              {playlists.map(pl => {
                const playlistTracks = getPlaylistTracks(pl);
                const isPlayingHere = status.state === 'playing' && Boolean(
                  status.current_track && playlistTracks.some(track => track.id === status.current_track?.id)
                );
                return (
                  <div key={pl.id} className="group relative">
                    <button
                      type="button"
                      onClick={() => onNavigate('playlist_detail', pl)}
                      className={`flex min-h-[48px] w-full items-center justify-center rounded-xl border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent ${
                        isPlayingHere
                          ? 'border-brand-accent bg-brand-accent/20 text-brand-accent shadow-[0_0_14px_rgba(34,197,94,0.25)]'
                          : currentView === 'playlist_detail'
                            ? 'border-brand-border bg-oled-hover text-brand-accent'
                            : 'border-transparent text-brand-muted hover:bg-white/55 hover:text-brand-foreground'
                      }`}
                      aria-label={pl.name}
                      title={pl.name}
                    >
                      {pl.is_smart ? (
                        <Sparkles className="h-5 w-5 text-amber-400" aria-hidden="true" />
                      ) : (
                        <span className="h-9 w-9 overflow-hidden rounded-lg border border-brand-border/70 bg-brand-primary/70">
                          <PlaylistArtwork playlist={pl} tracks={playlistTracks} />
                        </span>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ) : <div className="flex flex-col gap-2 pt-2 border-t border-brand-border/60">
          <div className="flex items-center justify-between px-2 text-xs font-semibold text-brand-muted uppercase tracking-wider">
            <span>{t('playlists_title', settings.language)}</span>
            <div className="flex items-center gap-0.5">
              <label
                className="min-w-[44px] min-h-[44px] flex items-center justify-center text-brand-muted hover:text-brand-foreground hover:bg-oled-hover rounded-lg cursor-pointer transition-colors"
                title={t('btn_import_m3u', settings.language)}
                aria-label={t('btn_import_m3u', settings.language)}
              >
                <Upload className="w-4 h-4" aria-hidden="true" />
                <input
                  type="file"
                  accept=".m3u,.m3u8"
                  onChange={handleM3uImport}
                  className="sr-only"
                />
              </label>
              <button
                onClick={() => setIsCreateModalOpen(true)}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center text-brand-muted hover:text-brand-foreground hover:bg-oled-hover rounded-lg transition-colors focus-visible:outline-none"
                title={t('btn_create_playlist', settings.language)}
                aria-label={t('btn_create_playlist', settings.language)}
              >
                <Plus className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
          </div>

          {/* Playlist Links */}
          <div className="flex flex-col gap-0.5 max-h-48 overflow-y-auto pr-1">
            {playlists.map(pl => {
              const playlistTracks = getPlaylistTracks(pl);
              return (
                <div key={pl.id} className="group relative">
                  <button
                    onClick={() => onNavigate('playlist_detail', pl)}
                    className={`min-h-[44px] flex w-full items-center justify-between px-3 rounded-lg text-xs transition-colors text-left truncate focus-visible:outline-none ${
                      currentView === 'playlist_detail'
                        ? 'bg-oled-hover text-brand-accent font-medium'
                        : 'text-brand-muted hover:text-brand-foreground hover:bg-oled-hover'
                    }`}
                  >
                    <div className="flex min-w-0 items-center gap-2.5 truncate">
                      {pl.is_smart ? (
                        <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" aria-hidden="true" />
                      ) : (
                        <span className="h-6 w-6 shrink-0 overflow-hidden rounded-md border border-brand-border/70 bg-brand-primary/70">
                          <PlaylistArtwork playlist={pl} tracks={playlistTracks} />
                        </span>
                      )}
                      <span className="truncate">{pl.name}</span>
                    </div>
                  </button>
                  {!pl.is_smart && (
                    <button
                      type="button"
                      onPointerDown={event => event.stopPropagation()}
                      onClick={e => {
                        e.stopPropagation();
                        if (playlistMenuId === pl.id) {
                          setPlaylistMenuId(null);
                          setPlaylistMenuPosition(null);
                          return;
                        }
                        const rect = e.currentTarget.getBoundingClientRect();
                        const menuWidth = 208;
                        const menuHeight = 112;
                        const canOpenRight = rect.right + 8 + menuWidth <= window.innerWidth;
                        setPlaylistMenuId(pl.id);
                        setPlaylistMenuPosition({
                          top: Math.min(Math.max(8, rect.top), window.innerHeight - menuHeight - 8),
                          left: canOpenRight
                            ? rect.right + 8
                            : Math.max(8, rect.left - menuWidth - 8),
                        });
                      }}
                      className="absolute right-1 top-1/2 z-10 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg bg-oled-card/90 text-brand-muted opacity-0 shadow-sm transition-opacity group-hover:opacity-100 hover:text-brand-foreground focus-visible:opacity-100 focus-visible:outline-none"
                      aria-label={t('playlist_menu_aria', settings.language)}
                    >
                      <MoreVertical className="h-4 w-4" />
                    </button>
                  )}
                  {playlistMenuId === pl.id && !pl.is_smart && (
                    createPortal(
                      <div
                        ref={playlistMenuRef}
                        onPointerDown={event => event.stopPropagation()}
                        className="fixed z-[100] w-52 rounded-xl border border-brand-border bg-oled-card/95 py-1 text-left text-xs shadow-card-elevated backdrop-blur-md"
                        style={playlistMenuPosition ?? undefined}
                      >
                        <button type="button" onClick={() => void renamePlaylist(pl)} className="flex w-full items-center gap-2 px-3 py-2 hover:bg-oled-hover">
                          <Pencil className="h-4 w-4 text-brand-muted" /> {t('playlist_rename', settings.language)}
                        </button>
                        <button type="button" onClick={() => void changePlaylistCover(pl)} className="flex w-full items-center gap-2 px-3 py-2 hover:bg-oled-hover">
                          <ImagePlus className="h-4 w-4 text-brand-muted" /> {t('playlist_change_cover', settings.language)}
                        </button>
                        <button type="button" onClick={() => { setPlaylistMenuId(null); setPlaylistMenuPosition(null); if (confirm(t('delete_playlist_confirm', settings.language, { name: pl.name }))) void deletePlaylist(pl.id); }} className="flex w-full items-center gap-2 px-3 py-2 text-rose-400 hover:bg-rose-950/40">
                          <Trash2 className="h-4 w-4" /> {t('btn_delete', settings.language)}
                        </button>
                      </div>,
                      document.body,
                    )
                  )}
                </div>
              );
            })}
          </div>
        </div>}
      </div>

      {/* Bottom: Settings & Storage stats */}
      <div className={`flex flex-col gap-2 border-t border-brand-border/60 ${isCollapsed ? 'p-3' : 'p-4'}`}>
        <button
          onClick={() => onNavigate('settings')}
          className={`flex min-h-[44px] items-center rounded-xl font-medium text-xs transition-all focus-visible:outline-none sm:text-sm ${
            isCollapsed ? 'justify-center px-0' : 'gap-3 px-3.5'
          } ${
            currentView === 'settings'
              ? 'is-active bg-brand-secondary text-white shadow-soft-button'
              : 'text-brand-muted hover:text-brand-foreground hover:bg-white/55'
          }`}
          aria-label={isCollapsed ? t('nav_settings', settings.language) : undefined}
          title={isCollapsed ? t('nav_settings', settings.language) : undefined}
        >
          <Settings className="w-4 h-4" aria-hidden="true" />
          {!isCollapsed && <span>{t('nav_settings', settings.language)}</span>}
        </button>
      </div>

      {/* Create Playlist Modal */}
      <Modal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        title={t('modal_create_playlist_title', settings.language)}
      >
        <form onSubmit={handleCreateSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-brand-muted">
              {t('input_playlist_name', settings.language)}
            </label>
            <input
              type="text"
              required
              value={newPlaylistName}
              onChange={e => setNewPlaylistName(e.target.value)}
              placeholder="e.g. Acoustic Chill, Hi-Res Masters"
              className="bg-oled-base border border-brand-border rounded-lg px-3.5 py-2 text-sm text-brand-foreground focus-visible:outline-none"
              autoFocus
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-brand-muted">
              {t('input_playlist_desc', settings.language)}
            </label>
            <textarea
              value={newPlaylistDesc}
              onChange={e => setNewPlaylistDesc(e.target.value)}
              placeholder="Optional description"
              rows={3}
              className="bg-oled-base border border-brand-border rounded-lg px-3.5 py-2 text-sm text-brand-foreground focus-visible:outline-none resize-none"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setIsCreateModalOpen(false)}
            >
              {t('btn_cancel', settings.language)}
            </Button>
            <Button type="submit" variant="accent" size="sm">
              {t('btn_save', settings.language)}
            </Button>
          </div>
        </form>
      </Modal>
    </aside>
  );
};
