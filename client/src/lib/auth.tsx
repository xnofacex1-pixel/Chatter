import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, ApiError, type Settings, type User } from './api';

type AuthContextValue = {
  user: User | null;
  settings: Settings | null;
  loading: boolean;
  authenticated: boolean;
  login: (identifier: string, password: string) => Promise<void>;
  register: (input: { email: string; username: string; displayName?: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
  setUser: (user: User) => void;
  setSettings: (settings: Settings) => void;
  refresh: () => Promise<void>;
  saveSettings: (patch: Partial<Settings>) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  accent: 'violet',
  reducedMotion: false,
  compactMode: false,
  textScale: 1,
  messageDisplay: 'cozy',
  dmPrivacy: 'everyone',
  friendRequestPrivacy: 'everyone',
  presenceVisibility: 'everyone',
  readReceipts: true,
  notifications: { desktop: true, sounds: true, mentions: true, messages: true, calls: true },
};

const LOCAL_PREFS_KEY = 'chatter.prefs';

function readLocalPrefs(): Partial<Settings> | null {
  try {
    const raw = localStorage.getItem(LOCAL_PREFS_KEY);
    return raw ? (JSON.parse(raw) as Partial<Settings>) : null;
  } catch {
    return null;
  }
}

function writeLocalPrefs(settings: Settings) {
  try {
    localStorage.setItem(LOCAL_PREFS_KEY, JSON.stringify(settings));
  } catch {
    /* storage unavailable — preferences still live on the server */
  }
}

/** Applies appearance settings to the document so the whole UI reacts instantly. */
export function applyAppearance(settings: Settings) {
  const root = document.documentElement;
  root.dataset.theme = settings.theme;
  root.dataset.accent = settings.accent;
  root.dataset.motion = settings.reducedMotion ? 'reduced' : 'full';
  root.dataset.density = settings.compactMode ? 'compact' : 'comfortable';
  root.style.setProperty('--text-scale', String(settings.textScale));
  const themeColour = settings.theme === 'light' ? '#f4f7fc' : '#070d18';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeColour);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [settings, setSettingsState] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const heartbeat = useRef<number | null>(null);

  const setSettings = useCallback((next: Settings) => {
    setSettingsState(next);
    applyAppearance(next);
    writeLocalPrefs(next);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const data = await api.session();
      setUser(data.user);
      if (data.settings) setSettings(data.settings);
    } catch (error) {
      if (error instanceof ApiError && error.status === 0) {
        // Network failure: keep the cached appearance so the app is not jarring.
        const prefs = readLocalPrefs();
        if (prefs) applyAppearance({ ...DEFAULT_SETTINGS, ...prefs });
      }
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, [setSettings]);

  useEffect(() => {
    const prefs = readLocalPrefs();
    if (prefs) applyAppearance({ ...DEFAULT_SETTINGS, ...prefs });
    void refresh();
  }, [refresh]);

  // Presence heartbeat keeps "online" honest while the tab is open.
  useEffect(() => {
    if (!user) {
      if (heartbeat.current) window.clearInterval(heartbeat.current);
      heartbeat.current = null;
      return;
    }
    const ping = () => {
      if (document.visibilityState === 'visible') void api.heartbeat().catch(() => undefined);
    };
    ping();
    heartbeat.current = window.setInterval(ping, 45_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') ping();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      if (heartbeat.current) window.clearInterval(heartbeat.current);
      heartbeat.current = null;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [user]);

  const login = useCallback(
    async (identifier: string, password: string) => {
      const data = await api.login({ identifier, password });
      setUser(data.user);
      setSettings(data.settings);
    },
    [setSettings],
  );

  const register = useCallback(
    async (input: { email: string; username: string; displayName?: string; password: string }) => {
      const data = await api.register(input);
      setUser(data.user);
      setSettings(data.settings);
    },
    [setSettings],
  );

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setUser(null);
    }
  }, []);

  const saveSettings = useCallback(
    async (patch: Partial<Settings>) => {
      const current = settings ?? DEFAULT_SETTINGS;
      const optimistic: Settings = {
        ...current,
        ...patch,
        notifications: { ...current.notifications, ...(patch.notifications ?? {}) },
      };
      setSettings(optimistic);
      try {
        const data = await api.updateSettings(patch);
        setSettings(data.settings);
      } catch (error) {
        setSettings(current);
        throw error;
      }
    },
    [settings, setSettings],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      settings,
      loading,
      authenticated: Boolean(user),
      login,
      register,
      logout,
      setUser,
      setSettings,
      refresh,
      saveSettings,
    }),
    [user, settings, loading, login, register, logout, setSettings, refresh, saveSettings],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
