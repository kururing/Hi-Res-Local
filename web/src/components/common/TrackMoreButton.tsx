import React from 'react';
import { MoreVertical } from 'lucide-react';
import { Track } from '../../types/library';
import { useSettings } from '../../context/SettingsContext';
import { t } from '../../i18n';
import { ContextMenu, ContextMenuState } from './ContextMenu';

interface TrackMoreButtonProps {
  track: Track;
  playlistId?: string;
  onOpenDetails?: (track: Track) => void;
  onNavigateAlbum?: (albumName: string) => void;
  onNavigateArtist?: (artistName: string) => void;
}

export const TrackMoreButton: React.FC<TrackMoreButtonProps> = ({
  track,
  playlistId,
  onOpenDetails,
  onNavigateAlbum,
  onNavigateArtist,
}) => {
  const { settings } = useSettings();
  const [state, setState] = React.useState<ContextMenuState>({
    isOpen: false,
    x: 0,
    y: 0,
    track: null,
  });

  const openMenu = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    setState({
      isOpen: true,
      x: rect.right,
      y: rect.bottom,
      track,
      playlistId,
      onOpenDetails,
      onNavigateAlbum,
      onNavigateArtist,
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={openMenu}
        className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded text-brand-muted opacity-0 transition-opacity hover:bg-brand-accent/10 hover:text-brand-foreground group-hover:opacity-100 focus:opacity-100 focus-visible:outline-none"
        aria-label={t('aria_more_actions', settings.language)}
      >
        <MoreVertical className="h-4 w-4" aria-hidden="true" />
      </button>
      <ContextMenu
        state={state}
        onClose={() => setState(current => ({ ...current, isOpen: false }))}
      />
    </>
  );
};
