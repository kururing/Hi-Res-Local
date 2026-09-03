import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useSettings } from '../../context/SettingsContext';
import { t } from '../../i18n';
import { AccountSettingsSection } from '../auth/AccountSettingsSection';
import { AuthForm } from '../auth/AuthForm';

export const AccountView: React.FC = () => {
  const { settings } = useSettings();
  const { user, login, register } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');

  return (
    <div className="view-page mx-auto w-full max-w-4xl space-y-8 p-6 select-none md:p-8">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold font-display text-brand-foreground">
          {t('account_title', settings.language)}
        </h1>
        <span className="text-xs text-brand-muted">
          {t(user ? 'account_subtitle' : 'account_guest_subtitle', settings.language)}
        </span>
      </div>
      {user ? (
        <AccountSettingsSection />
      ) : (
        <section className="mx-auto w-full max-w-md rounded-2xl border border-brand-border bg-oled-card p-6 shadow-card-elevated sm:p-8">
          <AuthForm
            mode={mode}
            language={settings.language}
            onLogin={login}
            onRegister={register}
            onSwitchMode={setMode}
          />
        </section>
      )}
    </div>
  );
};
