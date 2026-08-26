import React, { useState } from 'react';
import { Plus, ListMusic, Sparkles, Upload, Trash2 } from 'lucide-react';
import { usePlaylists } from '../../context/PlaylistContext';
import { useSettings } from '../../context/SettingsContext';
import { Button } from '../common/Button';
import { Modal } from '../common/Modal';
import { t } from '../../i18n';
import { activateOnKeyboard } from '../../services/keyboard';

interface PlaylistsViewProps {
  onNavigate: (view: string, payload?: unknown) => void;
}

export const PlaylistsView: React.FC<PlaylistsViewProps> = ({ onNavigate }) => {
  const { playlists, createPlaylist, importM3uFile, deletePlaylist } = usePlaylists();
  const { settings } = useSettings();

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

  return (
    <div className="view-page mx-auto w-full max-w-7xl space-y-6 p-6 select-none md:p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold font-display text-brand-foreground">
            {t('playlists_title', settings.language)}
          </h1>
          <span className="text-xs text-brand-muted">
            {playlists.length} playlists
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
            aria-label={`Open playlist ${pl.name}`}
            className="group p-5 rounded-2xl bg-oled-card hover:bg-oled-hover border border-brand-border/60 hover:border-brand-border cursor-pointer transition-all flex flex-col justify-between h-44 shadow-card-elevated relative overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
          >
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="w-10 h-10 rounded-xl bg-brand-primary/80 border border-brand-border flex items-center justify-center">
                  {pl.is_smart ? (
                    <Sparkles className="w-5 h-5 text-amber-400" />
                  ) : (
                    <ListMusic className="w-5 h-5 text-brand-accent" />
                  )}
                </div>

                {pl.is_smart ? (
                  <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[10px] font-semibold">
                    {t('smart_playlist_badge', settings.language)}
                  </span>
                ) : (
                  <button
                    onClick={e => {
                      e.stopPropagation();
                      if (confirm(t('delete_playlist_confirm', settings.language, { name: pl.name }))) {
                        deletePlaylist(pl.id);
                      }
                    }}
                    className="min-h-[44px] min-w-[44px] rounded text-brand-muted hover:text-rose-400 opacity-70 group-hover:opacity-100 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
                    aria-label="Delete playlist"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>

              <h3 className="font-bold text-base text-brand-foreground truncate group-hover:text-brand-accent transition-colors">
                {pl.name}
              </h3>
              <p className="text-xs text-brand-muted line-clamp-2 mt-1">
                {pl.description || 'No description'}
              </p>
            </div>

            <div className="flex items-center justify-between text-[11px] text-brand-muted font-mono pt-2 border-t border-brand-border/40">
              <span>{pl.track_ids.length} tracks</span>
              <span>{new Date(pl.updated_at).toLocaleDateString()}</span>
            </div>
          </div>
        ))}
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
              placeholder="e.g. Acoustic Chill"
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
