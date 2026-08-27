import React, { useState } from 'react';
import { Plus, Upload, Trash2, MoreVertical, Pencil, ImagePlus } from 'lucide-react';
import { usePlaylists } from '../../context/PlaylistContext';
import { useSettings } from '../../context/SettingsContext';
import { Button } from '../common/Button';
import { Modal } from '../common/Modal';
import { t } from '../../i18n';
import { activateOnKeyboard } from '../../services/keyboard';
import { PlaylistArtwork } from '../common/PlaylistArtwork';
import { IpcService } from '../../services/ipc';
import { Playlist } from '../../types/playlist';

interface PlaylistsViewProps {
  onNavigate: (view: string, payload?: unknown) => void;
}

export const PlaylistsView: React.FC<PlaylistsViewProps> = ({ onNavigate }) => {
  const { playlists, createPlaylist, importM3uFile, deletePlaylist, updatePlaylist, getPlaylistTracks } = usePlaylists();
  const { settings } = useSettings();

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [newPlaylistDesc, setNewPlaylistDesc] = useState('');
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [editingPlaylist, setEditingPlaylist] = useState<Playlist | null>(null);
  const [editingName, setEditingName] = useState('');

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

  const handleRename = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPlaylist || !editingName.trim()) return;
    await updatePlaylist(editingPlaylist.id, { name: editingName.trim() });
    setEditingPlaylist(null);
  };

  const handleChangeCover = async (playlist: Playlist) => {
    setOpenMenuId(null);
    const path = await IpcService.invoke('open_image_dialog');
    if (path) {
      const cachedPath = await IpcService.invoke('cache_playlist_cover', { sourcePath: path });
      await updatePlaylist(playlist.id, { cover_url: cachedPath });
    }
  };

  return (
    <div className="view-page mx-auto w-full max-w-7xl space-y-6 p-6 select-none md:p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold font-display text-brand-foreground">
            {t('playlists_title', settings.language)}
          </h1>
          <span className="text-xs text-brand-muted">
            {t('playlists_count', settings.language, { count: playlists.length })}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <label className="inline-flex items-center justify-center font-medium rounded-lg transition-all duration-200 focus-visible:outline-none min-h-[44px] px-4 py-2 text-sm gap-2 bg-brand-primary text-white hover:brightness-110 border border-brand-border cursor-pointer shadow-sm">
            <Upload className="w-4 h-4" />
            <span>{t('btn_import_m3u', settings.language)}</span>
            <input
              type="file"
              accept=".m3u,.m3u8"
              onChange={handleM3uImport}
              className="sr-only"
            />
          </label>
          <Button
            variant="accent"
            size="md"
            icon={<Plus className="w-4 h-4" />}
            onClick={() => setIsCreateModalOpen(true)}
          >
            {t('btn_create_playlist', settings.language)}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
        {playlists.map(pl => (
          <div
            key={pl.id}
            onClick={() => onNavigate('playlist_detail', pl)}
            onKeyDown={event => activateOnKeyboard(event, () => onNavigate('playlist_detail', pl))}
            role="button"
            tabIndex={0}
            aria-label={t('home_open_playlist', settings.language, { name: pl.name })}
            className="group p-5 rounded-2xl bg-oled-card hover:bg-oled-hover border border-brand-border/60 hover:border-brand-border cursor-pointer transition-all flex flex-col justify-between h-44 shadow-card-elevated relative overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
          >
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="h-10 w-10 overflow-hidden rounded-xl border border-brand-border bg-brand-primary/80">
                  <PlaylistArtwork playlist={pl} tracks={getPlaylistTracks(pl)} />
                </div>

                {pl.is_smart ? (
                  <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[10px] font-semibold">
                    {t('smart_playlist_badge', settings.language)}
                  </span>
                ) : (
                  <button
                    onClick={e => {
                      e.stopPropagation();
                      setOpenMenuId(current => current === pl.id ? null : pl.id);
                    }}
                    className="min-h-[44px] min-w-[44px] rounded text-brand-muted hover:text-brand-foreground opacity-70 group-hover:opacity-100 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
                    aria-label={t('playlist_menu_aria', settings.language)}
                  >
                    <MoreVertical className="mx-auto h-4 w-4" />
                  </button>
                )}
                {openMenuId === pl.id && !pl.is_smart && (
                  <div className="absolute right-4 top-14 z-20 w-44 rounded-xl border border-brand-border bg-oled-card/95 py-1 shadow-card-elevated backdrop-blur-md">
                    <button
                      type="button"
                      onClick={e => {
                        e.stopPropagation();
                        setEditingPlaylist(pl);
                        setEditingName(pl.name);
                        setOpenMenuId(null);
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-oled-hover"
                    >
                      <Pencil className="h-4 w-4 text-brand-muted" />
                      {t('playlist_rename', settings.language)}
                    </button>
                    <button
                      type="button"
                      onClick={e => { e.stopPropagation(); void handleChangeCover(pl); }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-oled-hover"
                    >
                      <ImagePlus className="h-4 w-4 text-brand-muted" />
                      {t('playlist_change_cover', settings.language)}
                    </button>
                    <button
                      type="button"
                      onClick={e => {
                        e.stopPropagation();
                        setOpenMenuId(null);
                        if (confirm(t('delete_playlist_confirm', settings.language, { name: pl.name }))) void deletePlaylist(pl.id);
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-rose-400 hover:bg-rose-950/40"
                    >
                      <Trash2 className="h-4 w-4" />
                      {t('btn_delete', settings.language)}
                    </button>
                  </div>
                )}
              </div>

              <h3 className="font-bold text-base text-brand-foreground truncate group-hover:text-brand-accent transition-colors">
                {pl.name}
              </h3>
              <p className="text-xs text-brand-muted line-clamp-2 mt-1">
                {pl.description || t('no_description', settings.language)}
              </p>
            </div>

            <div className="flex items-center justify-between text-[11px] text-brand-muted font-mono pt-2 border-t border-brand-border/40">
              <span>{t('home_playlist_track_count', settings.language, { count: pl.track_ids.length })}</span>
              <span>{new Date(pl.updated_at).toLocaleDateString()}</span>
            </div>
          </div>
        ))}
      </div>

      <Modal
        isOpen={Boolean(editingPlaylist)}
        onClose={() => setEditingPlaylist(null)}
        title={t('playlist_rename', settings.language)}
      >
        <form onSubmit={handleRename} className="flex flex-col gap-4">
          <input
            value={editingName}
            onChange={e => setEditingName(e.target.value)}
            className="rounded-lg border border-brand-border bg-oled-base px-3.5 py-2 text-sm text-brand-foreground focus-visible:outline-none"
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setEditingPlaylist(null)}>{t('btn_cancel', settings.language)}</Button>
            <Button type="submit" variant="accent" size="sm">{t('btn_save', settings.language)}</Button>
          </div>
        </form>
      </Modal>

      {/* Create Playlist Modal */}
      <Modal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        title={t('modal_create_playlist_title', settings.language)}
      >
        <form onSubmit={handleCreateSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="page-new-playlist-name" className="text-xs font-medium text-brand-muted">
              {t('input_playlist_name', settings.language)}
            </label>
            <input
              id="page-new-playlist-name"
              type="text"
              required
              value={newPlaylistName}
              onChange={e => setNewPlaylistName(e.target.value)}
              placeholder="e.g. Acoustic Chill"
              className="bg-oled-base border border-brand-border rounded-lg px-3.5 py-2 text-sm text-brand-foreground focus-visible:outline-none"
              autoFocus
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="page-new-playlist-description" className="text-xs font-medium text-brand-muted">
              {t('input_playlist_desc', settings.language)}
            </label>
            <textarea
              id="page-new-playlist-description"
              value={newPlaylistDesc}
              onChange={e => setNewPlaylistDesc(e.target.value)}
              placeholder="Optional playlist notes"
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
    </div>
  );
};
