import React, { useEffect, useId, useState } from 'react';
import { LoaderCircle, LogOut, UserRound } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useSettings } from '../../context/SettingsContext';
import { useToast } from '../../context/ToastContext';
import { t } from '../../i18n';
import { Button } from '../common/Button';
import { Input } from '../common/Input';

export const AccountSettingsSection: React.FC = () => {
  const { user, updateProfile, logout } = useAuth();
  const { settings } = useSettings();
  const { showToast } = useToast();
  const nameId = useId();
  const emailId = useId();
  const errorId = useId();
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [saving, setSaving] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDisplayName(user?.displayName ?? '');
  }, [user?.displayName]);

  if (!user) return null;

  const trimmed = displayName.trim();
  const canSave = trimmed.length > 0 && trimmed.length <= 64 && trimmed !== user.displayName && !saving;

  return (
    <section className="space-y-4 rounded-2xl border border-brand-border bg-oled-card p-6 shadow-card-elevated">
      <div className="flex items-center gap-2.5 border-b border-brand-border/60 pb-3">
        <UserRound className="h-5 w-5 text-brand-accent" aria-hidden="true" />
        <h2 className="font-display text-base font-bold text-brand-foreground">
          {t('settings_account_section', settings.language)}
        </h2>
      </div>

      <div className="space-y-2">
        <label htmlFor={emailId} className="text-sm font-medium text-brand-foreground">
          {t('settings_account_email', settings.language)}
        </label>
        <Input
          id={emailId}
          type="email"
          value={user.email}
          readOnly
          autoComplete="email"
          className="cursor-default opacity-90"
        />
      </div>

      <div className="space-y-2">
        <label htmlFor={nameId} className="text-sm font-medium text-brand-foreground">
          {t('settings_account_display_name', settings.language)}
        </label>
        <Input
          id={nameId}
          type="text"
          name="name"
          autoComplete="name"
          maxLength={64}
          value={displayName}
          disabled={saving || loggingOut}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          onChange={event => {
            setDisplayName(event.target.value);
            setError(null);
          }}
        />
        {error && (
          <p id={errorId} className="text-xs text-rose-300">{error}</p>
        )}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <Button
          type="button"
          variant="accent"
          disabled={!canSave}
          aria-busy={saving}
          icon={saving ? <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : undefined}
          onClick={async () => {
            setSaving(true);
            setError(null);
            try {
              await updateProfile({ displayName: trimmed });
              showToast(t('settings_account_saved', settings.language), 'success');
            } catch {
              setDisplayName(user.displayName);
              const message = t('settings_account_save_failed', settings.language);
              setError(message);
              showToast(message, 'error');
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving
            ? t('settings_account_saving', settings.language)
            : t('settings_account_save', settings.language)}
        </Button>
        <Button
          type="button"
          variant="danger"
          disabled={loggingOut}
          aria-busy={loggingOut}
          icon={loggingOut
            ? <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            : <LogOut className="h-4 w-4" aria-hidden="true" />}
          onClick={async () => {
            setLoggingOut(true);
            await logout();
            setLoggingOut(false);
          }}
        >
          {loggingOut
            ? t('settings_account_logging_out', settings.language)
            : t('settings_account_logout', settings.language)}
        </Button>
      </div>
    </section>
  );
};
