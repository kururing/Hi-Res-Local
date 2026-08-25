import React, { useState } from 'react';
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
} from 'lucide-react';
import { usePlaylists } from '../../context/PlaylistContext';
import { useSettings } from '../../context/SettingsContext';
import { useLibrary } from '../../context/LibraryContext';
import { t } from '../../i18n';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';

interface SidebarProps {
  currentView: string;
  onNavigate: (view: string, payload?: unknown) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ currentView, onNavigate }) => {
  const { playlists, createPlaylist, importM3uFile } = usePlaylists();
  const { settings } = useSettings();
  const { stats } = useLibrary();

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [newPlaylistDesc, setNewPlaylistDesc] = useState('');

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
    <aside className="app-sidebar relative z-20 m-3 mr-0 w-64 shrink-0 select-none overflow-y-auto rounded-[28px] border border-brand-border/70 flex flex-col justify-between">
      {/* Top: Branding & Navigation */}
      <div className="flex flex-col p-4 gap-6">
        {/* Brand */}
        <button
          type="button"
          onClick={() => onNavigate('home')}
          className="flex min-h-[44px] items-center gap-3 px-2 cursor-pointer group rounded-2xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
          aria-label="Go to home"
        >
          <div className="brand-orb w-10 h-10 rounded-2xl flex items-center justify-center group-hover:scale-105 transition-transform duration-300">
            <Music2 className="w-5 h-5 text-brand-accent" aria-hidden="true" />
          </div>
          <div className="flex flex-col">
            <span className="font-display text-base tracking-wide text-brand-foreground group-hover:text-brand-accent transition-colors">
              Nghe Nhac Pro Max
            </span>
            <span className="text-[10px] text-brand-muted tracking-wider uppercase font-semibold">
              Hi-Res Audio
            </span>
          </div>
        </button>

        {/* Main Navigation */}
        <nav className="flex flex-col gap-1" aria-label="Main Navigation">
          {navItems.map(item => {
            const isActive = currentView === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                className={`soft-nav-item min-h-[44px] flex items-center justify-between px-3.5 rounded-2xl font-medium text-xs sm:text-sm transition-all duration-300 focus-visible:outline-none ${
                  isActive
                    ? 'is-active text-white font-semibold'
                    : 'text-brand-muted hover:text-brand-foreground hover:bg-white/55'
                }`}
              >
                <div className="flex items-center gap-3">
                  {item.icon}
                  <span>{item.label}</span>
                </div>
                {item.count !== undefined && item.count > 0 && (
                  <span className={`text-[11px] px-2 py-0.5 rounded-full ${isActive ? 'bg-white/20 text-white' : 'bg-oled-card text-brand-muted'}`}>
                    {item.count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Playlists Header & Actions */}
        <div className="flex flex-col gap-2 pt-2 border-t border-brand-border/60">
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
              return (
                <button
                  key={pl.id}
                  onClick={() => onNavigate('playlist_detail', pl)}
                  className={`min-h-[44px] flex items-center justify-between px-3 rounded-lg text-xs transition-colors text-left truncate focus-visible:outline-none ${
                    currentView === 'playlist_detail'
                      ? 'bg-oled-hover text-brand-accent font-medium'
                      : 'text-brand-muted hover:text-brand-foreground hover:bg-oled-hover'
                  }`}
                >
                  <div className="flex items-center gap-2.5 truncate">
                    {pl.is_smart ? (
                      <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" aria-hidden="true" />
                    ) : (
                      <ListMusic className="w-3.5 h-3.5 text-brand-muted shrink-0" aria-hidden="true" />
                    )}
                    <span className="truncate">{pl.name}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Bottom: Settings & Storage stats */}
      <div className="p-4 border-t border-brand-border/60 flex flex-col gap-2">
        <button
          onClick={() => onNavigate('settings')}
          className={`min-h-[44px] flex items-center gap-3 px-3.5 rounded-xl font-medium text-xs sm:text-sm transition-all focus-visible:outline-none ${
            currentView === 'settings'
              ? 'is-active bg-brand-secondary text-white shadow-soft-button'
              : 'text-brand-muted hover:text-brand-foreground hover:bg-white/55'
          }`}
        >
          <Settings className="w-4 h-4" />
          <span>{t('nav_settings', settings.language)}</span>
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
