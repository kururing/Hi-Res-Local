import React, { useEffect, useRef, useState } from 'react';
import { LogOut, Settings, User, UserRound } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useSettings } from '../../context/SettingsContext';
import { usePlatform } from '../../platform';
import { t } from '../../i18n';

interface UserMenuProps {
  onNavigate: (view: string, payload?: unknown) => void;
}

function avatarInitial(displayName: string | undefined): string | null {
  const trimmed = displayName?.trim();
  if (!trimmed) return null;
  return Array.from(trimmed)[0]?.toUpperCase() ?? null;
}

export const UserMenu: React.FC<UserMenuProps> = ({ onNavigate }) => {
  const { user, status, logout, retryBootstrap } = useAuth();
  const { settings } = useSettings();
  const { capabilities } = usePlatform();
  const [open, setOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const showAccountActions = capabilities.account && Boolean(user);
  const showSignIn = capabilities.account && !user;
  const initial = showAccountActions ? avatarInitial(user?.displayName) : null;

  useEffect(() => {
    if (!open) return;

    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  const goTo = (view: string) => {
    setOpen(false);
    onNavigate(view);
  };

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await logout();
    } finally {
      setLoggingOut(false);
      setOpen(false);
    }
  };

  return (
    <div ref={menuRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        className="group flex h-11 w-11 items-center justify-center rounded-full border border-brand-border bg-oled-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
        title={t('aria_user_menu', settings.language)}
        aria-label={t('aria_user_menu', settings.language)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-brand-accent/80 to-brand-secondary text-sm font-semibold text-white shadow-sm group-hover:brightness-110">
          {initial ? (
            <span aria-hidden="true">{initial}</span>
          ) : (
            <User className="h-4 w-4" aria-hidden="true" />
          )}
        </span>
      </button>

      {open && (
        <div
          role="menu"
          aria-label={t('aria_user_menu', settings.language)}
          className="absolute right-0 top-full z-50 mt-2 w-52 rounded-xl border border-brand-border bg-oled-card/95 py-1 text-left text-xs shadow-card-elevated backdrop-blur-md"
        >
          {showSignIn && (
            <button
              type="button"
              role="menuitem"
              onClick={() => goTo('account')}
              className="flex min-h-[44px] w-full items-center gap-2 px-3 py-2 text-brand-foreground hover:bg-oled-hover focus-visible:bg-oled-hover focus-visible:outline-none"
            >
              <UserRound className="h-4 w-4 text-brand-muted" aria-hidden="true" />
              {t('nav_sign_in', settings.language)}
            </button>
          )}
          {showAccountActions && (
            <button
              type="button"
              role="menuitem"
              onClick={() => goTo('account')}
              className="flex min-h-[44px] w-full items-center gap-2 px-3 py-2 text-brand-foreground hover:bg-oled-hover focus-visible:bg-oled-hover focus-visible:outline-none"
            >
              <UserRound className="h-4 w-4 text-brand-muted" aria-hidden="true" />
              {t('nav_account', settings.language)}
            </button>
          )}
          {capabilities.account && status === 'offline' && (
            <button
              type="button"
              role="menuitem"
              disabled={retrying}
              onClick={() => {
                setRetrying(true);
                void retryBootstrap().finally(() => setRetrying(false));
              }}
              className="flex min-h-[44px] w-full items-center gap-2 px-3 py-2 text-brand-foreground hover:bg-oled-hover focus-visible:bg-oled-hover focus-visible:outline-none disabled:opacity-60"
            >
              {t('account_offline_retry', settings.language)}
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => goTo('settings')}
            className="flex min-h-[44px] w-full items-center gap-2 px-3 py-2 text-brand-foreground hover:bg-oled-hover focus-visible:bg-oled-hover focus-visible:outline-none"
          >
            <Settings className="h-4 w-4 text-brand-muted" aria-hidden="true" />
            {t('nav_settings', settings.language)}
          </button>
          {showAccountActions && (
            <>
              <div className="my-1 border-t border-brand-border/60" role="separator" />
              <button
                type="button"
                role="menuitem"
                disabled={loggingOut}
                aria-busy={loggingOut}
                onClick={() => void handleLogout()}
                className="flex min-h-[44px] w-full items-center gap-2 px-3 py-2 text-rose-400 hover:bg-rose-950/40 focus-visible:bg-rose-950/40 focus-visible:outline-none disabled:opacity-60"
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
                {loggingOut
                  ? t('settings_account_logging_out', settings.language)
                  : t('settings_account_logout', settings.language)}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
};
