"use client";

import Link from "next/link";

import { Column } from "@/components/column";
import { SITE } from "@/lib/site";
import { ThemeToggle } from "./theme-toggle";

/**
 * One entry of the top navigation.
 *
 * The list is empty for now. The structure is here so that adding a page is
 * one line in `NAV_ITEMS` rather than a rewrite of this component, and so the
 * bar is already laid out for the day it holds something.
 */
export interface NavItem {
  /** Turkish. Every visible string in this product is written on this side. */
  label: string;
  href: string;
}

export const NAV_ITEMS: NavItem[] = [];

export function NavBar() {
  return (
    <header className="sticky top-0 z-50 border-b border-border bg-canvas/80 backdrop-blur-md">
      <Column className="flex h-16 items-center justify-between gap-6">
        <Link
          href="/"
          className="flex items-center gap-2.5 rounded-control text-ink"
        >
          <Logo />
          <span className="text-lead font-semibold tracking-tight">
            {SITE.name}
          </span>
        </Link>

        <div className="flex items-center gap-2">
          {NAV_ITEMS.length > 0 && (
            <nav aria-label="Ana menü" className="mr-2 hidden items-center gap-1 sm:flex">
              {NAV_ITEMS.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-control px-3 py-2 text-label text-ink-muted transition-colors hover:bg-canvas-sunken hover:text-ink"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          )}
          <ThemeToggle />
        </div>
      </Column>
    </header>
  );
}

/**
 * The mark: two funds, and the part of them that is the same thing.
 *
 * The same geometry as `public/logo.svg`, which is the favicon, and it has
 * to stay the same geometry — the two are a pair and there is no way to
 * share one file between them. Circles of r=9.5 at (12.5,16) and (19.5,16),
 * 7 apart, crossing at x=16 and y=16 +/- sqrt(90.25 - 12.25). If one moves,
 * move the other.
 *
 * What differs, on purpose, is the outline colour. The file is dropped into
 * tab strips and bookmark bars it cannot see, so it carries one mid grey
 * that can never vanish on either ground. This copy is inside the page: it
 * knows it is sitting on `--canvas`, so it takes the app's own ink and
 * accent, which flip with the theme toggle rather than with the reader's
 * system setting. That is the whole reason it is inline rather than an
 * `img` tag pointed at the file.
 *
 * No tile behind it any more. The mark now has its own brand colour in the
 * lens, and a purple lens on a purple tile is one purple too many.
 */
function Logo() {
  return (
    <svg
      viewBox="0 0 32 32"
      className="size-8 shrink-0"
      aria-hidden="true"
    >
      <path
        d="M16 7.17A9.5 9.5 0 0 1 16 24.83A9.5 9.5 0 0 1 16 7.17Z"
        fill="var(--accent)"
      />
      <g fill="none" stroke="var(--ink)" strokeWidth={1.5}>
        <circle cx="12.5" cy="16" r="9.5" />
        <circle cx="19.5" cy="16" r="9.5" />
      </g>
    </svg>
  );
}
