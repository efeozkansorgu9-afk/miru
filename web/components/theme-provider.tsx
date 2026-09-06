"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";

/**
 * Three states, not two. "system" is a real choice and the default: a user
 * who has set their laptop to go dark in the evening expects this page to
 * follow, and collapsing that into a stored "light" on first paint quietly
 * overrides them.
 */
export type ThemePreference = "light" | "dark" | "system";

/** What is actually on screen once "system" has been resolved. */
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "miru-theme";

const DARK_QUERY = "(prefers-color-scheme: dark)";

/* ------------------------------------------------------------------ */
/* The preference, as an external store                                */
/* ------------------------------------------------------------------ */
/*
 * localStorage and matchMedia are state that lives outside React, so they are
 * read through `useSyncExternalStore` rather than copied into state by an
 * effect. That is not a style preference: reading them in an effect means
 * rendering once with the wrong value and again with the right one, and
 * during hydration it is React that decides which snapshot to use, so the
 * server markup and the first client render always agree.
 */

let cached: ThemePreference | null = null;
const listeners = new Set<() => void>();

function readStored(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") {
      return stored;
    }
  } catch {
    // Private mode, or storage switched off. Not worth failing over.
  }
  return "system";
}

function getPreference(): ThemePreference {
  cached ??= readStored();
  return cached;
}

/** The server has no storage and no monitor, so it renders the default. */
function getServerPreference(): ThemePreference {
  return "system";
}

function subscribePreference(onChange: () => void): () => void {
  listeners.add(onChange);
  // Another tab switching theme should switch this one too: the preference is
  // the user's, not the window's.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== THEME_STORAGE_KEY) return;
    cached = null;
    onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

function writePreference(next: ThemePreference): void {
  cached = next;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    // The theme still applies for this visit; it just will not be
    // remembered for the next one.
  }
  for (const listener of listeners) listener();
}

/* ------------------------------------------------------------------ */
/* The operating system's setting, likewise                            */
/* ------------------------------------------------------------------ */

function subscribeSystem(onChange: () => void): () => void {
  const query = window.matchMedia(DARK_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function getSystemIsDark(): boolean {
  return window.matchMedia(DARK_QUERY).matches;
}

function getServerSystemIsDark(): boolean {
  return false;
}

/* ------------------------------------------------------------------ */
/* Context                                                             */
/* ------------------------------------------------------------------ */

interface ThemeContextValue {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (next: ThemePreference) => void;
  /** Flips to the opposite of what is currently on screen. */
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const preference = useSyncExternalStore(
    subscribePreference,
    getPreference,
    getServerPreference,
  );

  const systemIsDark = useSyncExternalStore(
    subscribeSystem,
    getSystemIsDark,
    getServerSystemIsDark,
  );

  const resolved: ResolvedTheme =
    preference === "system" ? (systemIsDark ? "dark" : "light") : preference;

  // Writing the class onto <html> is updating an external system with React's
  // latest state, which is what an effect is for. The inline script in the
  // layout has already done it for the first paint; this keeps it in step.
  useEffect(() => {
    document.documentElement.classList.toggle("dark", resolved === "dark");
  }, [resolved]);

  const setPreference = useCallback((next: ThemePreference) => {
    writePreference(next);
  }, []);

  const toggle = useCallback(() => {
    // Deliberately toggles against what is on screen rather than cycling
    // through all three: a user on "system" in the dark who presses the
    // button wants light, and would not thank us for "light, dark, system".
    writePreference(resolved === "dark" ? "light" : "dark");
  }, [resolved]);

  const value = useMemo(
    () => ({ preference, resolved, setPreference, toggle }),
    [preference, resolved, setPreference, toggle],
  );

  return <ThemeContext value={value}>{children}</ThemeContext>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used inside a ThemeProvider");
  }
  return context;
}

/**
 * Runs before the first paint, ahead of React, to put the theme class on
 * <html>.
 *
 * Without it the page paints light, hydrates, then jumps to dark: a flash on
 * every single load for every dark theme user. It has to be inline and
 * synchronous in <head> for that reason, which is why it is a string rather
 * than a module.
 */
export const themeScript = `
(function () {
  try {
    var stored = localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
    var dark = stored === "dark" ||
      ((!stored || stored === "system") &&
        window.matchMedia(${JSON.stringify(DARK_QUERY)}).matches);
    document.documentElement.classList.toggle("dark", dark);
  } catch (e) {}
})();
`;
