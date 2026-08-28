import React from 'react';
import { Minus, Square, X } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isTauri } from '../../services/ipc';
import { BEFORE_APP_QUIT_EVENT } from '../../services/playbackState';
import { useSettings } from '../../context/SettingsContext';
import { t } from '../../i18n';

const runWindowAction = (
  action: 'minimize' | 'maximize' | 'close',
  closeToTray = false
) => {
  if (!isTauri()) return;

  const appWindow = getCurrentWindow();
  if (action === 'minimize') void appWindow.minimize();
  else if (action === 'maximize') void appWindow.toggleMaximize();
  else if (closeToTray) void appWindow.hide();
  else {
    window.dispatchEvent(new Event(BEFORE_APP_QUIT_EVENT));
    void import('@tauri-apps/api/core').then(({ invoke }) => invoke('quit_app'));
  }
};

export const WindowTitleBar: React.FC = () => {
  const { settings } = useSettings();

  return (
    <div
      className="window-titlebar flex h-10 shrink-0 items-stretch text-brand-foreground"
      onDoubleClick={event => {
        if ((event.target as HTMLElement).closest('button')) return;
        runWindowAction('maximize');
      }}
    >
      <div
        className="flex min-w-0 flex-1 items-center px-3"
        data-tauri-drag-region
      >
        <span
          className="min-w-0 truncate text-[12px] font-semibold tracking-[-0.01em]"
          data-tauri-drag-region
        >
          {t('app_title', settings.language)}
        </span>
      </div>

      <div className="relative z-10 flex shrink-0">
        <button
          type="button"
          onClick={() => runWindowAction('minimize')}
          onMouseDown={event => event.stopPropagation()}
          className="window-control"
          aria-label="Thu nhỏ cửa sổ"
          title="Thu nhỏ"
        >
          <Minus className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => runWindowAction('maximize')}
          onMouseDown={event => event.stopPropagation()}
          className="window-control"
          aria-label="Phóng to hoặc khôi phục cửa sổ"
          title="Phóng to / Khôi phục"
        >
          <Square className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => runWindowAction('close', settings.close_to_tray)}
          onMouseDown={event => event.stopPropagation()}
          className="window-control window-control-close"
          aria-label="Đóng cửa sổ"
          title="Đóng"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
};
