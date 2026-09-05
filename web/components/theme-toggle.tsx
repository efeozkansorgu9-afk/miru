"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

import { useTheme } from "./theme-provider";

/**
 * Sun and moon, crossfading through a small rotation.
 *
 * The icon shows what you will get, not what you have: on a dark page the
 * button offers a sun. That is the convention users arrive with, and the
 * label says it in words for anyone who cannot see the difference.
 */
export function ThemeToggle() {
  const { resolved, toggle } = useTheme();
  const reduceMotion = useReducedMotion();

  const nextIsDark = resolved === "light";
  const label = nextIsDark ? "Koyu temaya geç" : "Açık temaya geç";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className="relative grid size-10 place-items-center rounded-control border border-border bg-surface text-ink-muted transition-colors hover:border-border-strong hover:text-ink"
    >
      <AnimatePresence initial={false} mode="wait">
        <motion.span
          key={resolved}
          initial={reduceMotion ? false : { opacity: 0, rotate: -70, scale: 0.6 }}
          animate={{ opacity: 1, rotate: 0, scale: 1 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, rotate: 70, scale: 0.6 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          className="absolute grid place-items-center"
        >
          {nextIsDark ? <MoonIcon /> : <SunIcon />}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}

function SunIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      className="size-5"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.4v2.2M12 19.4v2.2M4.4 12H2.2M21.8 12h-2.2M6.3 6.3 4.8 4.8M19.2 19.2l-1.5-1.5M17.7 6.3l1.5-1.5M4.8 19.2l1.5-1.5" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-5"
      aria-hidden="true"
    >
      <path d="M20.5 14.6A8.6 8.6 0 0 1 9.4 3.5a8.6 8.6 0 1 0 11.1 11.1Z" />
    </svg>
  );
}
