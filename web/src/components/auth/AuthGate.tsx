import React, { useState } from 'react';
import { LoaderCircle, Music2, RefreshCw, WifiOff } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useSettings } from '../../context/SettingsContext';
import { usePlatform } from '../../platform';
import { t } from '../../i18n';
import { Button } from '../common/Button';
import { AuthForm } from './AuthForm';

function AuthChrome({ children }: { children: React.ReactNode }) {
  const { settings } = useSettings();
  return (
    <div className="flex h-full min-h-0 w-full overflow-y-auto overflow-x-hidden">
      <div className="mx-auto flex w-full max-w-md flex-col justify-center gap-8 px-4 py-10 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="brand-orb flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl">
            <Music2 className="h-6 w-6 text-brand-accent" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="font-display text-lg font-semibold text-brand-foreground">
              {t('app_title', settings.language)}
            </p>
            <p className="text-xs font-medium uppercase tracking-wider text-brand-muted">
              {t('auth_tagline', settings.language)}
            </p>
          </div>
        </div>
        <section className="rounded-2xl border border-brand-border bg-oled-card p-6 shadow-card-elevated sm:p-8">
          {children}
        </section>
      </div>
    </div>
  );
}

const AuthSplash: React.FC = () => {
  const { settings } = useSettings();
  return (
    <AuthChrome>
      <div
        className="flex flex-col items-center gap-4 py-8 text-center"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <LoaderCircle className="h-8 w-8 animate-spin text-brand-accent motion-reduce:animate-none" aria-hidden="true" />
        <p className="text-sm text-brand-muted">{t('auth_bootstrapping', settings.language)}</p>
      </div>
    </AuthChrome>
  );
};

const AuthOffline: React.FC = () => {
  const { retryBootstrap } = useAuth();
  const { settings } = useSettings();
  const [retrying, setRetrying] = useState(false);

  return (
    <AuthChrome>
      <div className="flex flex-col gap-5" role="alert">
        <div className="flex items-center gap-3">
          <WifiOff className="h-5 w-5 text-brand-accent" aria-hidden="true" />
          <h1 className="font-display text-xl font-bold text-brand-foreground">
            {t('auth_offline_title', settings.language)}
          </h1>
        </div>
        <p className="text-sm leading-relaxed text-brand-muted">
          {t('auth_offline_body', settings.language)}
        </p>
        <Button
          type="button"
          variant="accent"
          disabled={retrying}
          icon={retrying
            ? <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
          onClick={() => {
            setRetrying(true);
            void retryBootstrap().finally(() => setRetrying(false));
          }}
        >
          {t('auth_offline_retry', settings.language)}
        </Button>
      </div>
    </AuthChrome>
  );
};

export const AuthGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { capabilities } = usePlatform();
  const { status, login, register } = useAuth();
  const { settings } = useSettings();
  const [mode, setMode] = useState<'login' | 'register'>('login');

  if (!capabilities.account || !capabilities.accountRequired) return <>{children}</>;
  if (status === 'bootstrapping') return <AuthSplash />;
  if (status === 'offline') return <AuthOffline />;
  if (status === 'authenticated') return <>{children}</>;

  return (
    <AuthChrome>
      <AuthForm
        mode={mode}
        language={settings.language}
        onLogin={login}
        onRegister={register}
        onSwitchMode={setMode}
      />
    </AuthChrome>
  );
};
