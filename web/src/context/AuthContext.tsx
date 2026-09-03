import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  AuthStatus,
  AuthUser,
  LoginRequest,
  RegisterRequest,
  UpdateProfileRequest,
} from '../auth/types';
import { useAuthSessionController, usePlatform } from '../platform';
import { useSettings } from './SettingsContext';

export interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  login(request: LoginRequest): Promise<void>;
  register(request: RegisterRequest): Promise<void>;
  logout(): Promise<void>;
  updateProfile(request: UpdateProfileRequest): Promise<void>;
  retryBootstrap(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const session = useAuthSessionController();
  const { account } = usePlatform();
  const { settings, updateSettings } = useSettings();
  const [snapshot, setSnapshot] = useState(() => session.getSnapshot());
  const [preferenceRevision, setPreferenceRevision] = useState(0);
  const preferencesHydrated = useRef(false);

  useEffect(() => {
    const unsubscribe = session.subscribe(() => {
      setSnapshot(session.getSnapshot());
    });
    setSnapshot(session.getSnapshot());
    void session.bootstrap();
    return unsubscribe;
  }, [session]);

  const login = useCallback(async (request: LoginRequest) => {
    await session.login(request);
  }, [session]);

  const register = useCallback(async (request: RegisterRequest) => {
    await session.register(request);
  }, [session]);

  const logout = useCallback(async () => {
    await session.logout();
  }, [session]);

  const updateProfile = useCallback(async (request: UpdateProfileRequest) => {
    await session.updateProfile(request);
  }, [session]);

  const retryBootstrap = useCallback(async () => {
    await session.retryBootstrap();
  }, [session]);

  useEffect(() => {
    if (snapshot.status !== 'authenticated' || !account?.getPreferences) return;
    let cancelled = false;
    void account.getPreferences().then((remote) => {
      if (cancelled) return;
      setPreferenceRevision(remote.revision);
      preferencesHydrated.current = true;
      const portable = pickPortablePreferences(remote.preferences);
      if (Object.keys(portable).length > 0) updateSettings(portable);
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [account, snapshot.status, updateSettings]);

  useEffect(() => {
    if (snapshot.status !== 'authenticated' || !account?.putPreferences) return;
    if (!preferencesHydrated.current) return;
    const handle = window.setTimeout(() => {
      void account.putPreferences?.({
        revision: preferenceRevision > 0 ? preferenceRevision : undefined,
        preferences: pickPortablePreferences(settings),
      }).then((saved) => {
        if (saved) setPreferenceRevision(saved.revision);
      }).catch(() => undefined);
    }, 400);
    return () => window.clearTimeout(handle);
  }, [
    account,
    snapshot.status,
    preferenceRevision,
    settings.language,
    settings.theme,
    settings.font_family,
    settings.streaming_quality,
    settings.eq_enabled,
    settings.eq_preset_id,
    JSON.stringify(settings.eq_custom_gains),
    settings.artwork_adaptive_theme,
    settings.custom_theme_blur,
    settings.custom_theme_blur_percent,
  ]);

  const value = useMemo<AuthContextValue>(() => ({
    status: snapshot.status,
    user: snapshot.user,
    login,
    register,
    logout,
    updateProfile,
    retryBootstrap,
  }), [snapshot, login, register, logout, updateProfile, retryBootstrap]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error('useAuth must be used within AuthProvider.');
  }
  return value;
}

function pickPortablePreferences(source: Record<string, unknown> | { language?: unknown; theme?: unknown; font_family?: unknown; streaming_quality?: unknown; eq_enabled?: unknown; eq_preset_id?: unknown; eq_custom_gains?: unknown; artwork_adaptive_theme?: unknown; custom_theme_blur?: unknown; custom_theme_blur_percent?: unknown }) {
  const out: Record<string, unknown> = {};
  const keys = [
    'language', 'theme', 'font_family', 'eq_enabled',
    'eq_preset_id', 'eq_custom_gains', 'artwork_adaptive_theme',
    'custom_theme_blur', 'custom_theme_blur_percent',
  ] as const;
  for (const key of keys) {
    const value = (source as Record<string, unknown>)[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}
