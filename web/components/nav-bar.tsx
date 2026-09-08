"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Column } from "@/components/column";
import { SITE, TOOL, sectionLabel } from "@/lib/site";
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
  // Prerendered into the HTML of every page and re-read on navigation
  // without a refetch, so the word beside the brand is right on arrival
  // rather than after hydration. `usePathname` does not opt a page out of
  // static rendering the way `useSearchParams` does.
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-canvas/80 backdrop-blur-md">
      <Column className="flex h-16 items-center justify-between gap-3 sm:gap-6">
        {/* Brand, then tool. Two weights rather than two sizes: the brand
            is the heavier of the pair at the same optical scale, which
            reads as a hierarchy without the tool name shrinking into a
            caption. The rule between them does the separating, so neither
            needs a bracket or a slash. */}
        <Link
          href={TOOL.href}
          // `min-w-0` here and `truncate` on the tool name are what keep the
          // lockup from pushing the theme toggle off a 320px screen: the tool
          // name gives up characters before the row gives up its layout.
          className="flex min-w-0 items-center gap-2.5 rounded-control text-ink"
        >
          <Logo />
          {/* The display face, and the only place off a heading that uses
              it: a wordmark is set, not read, and Bricolage at 700 with the
              tracking pulled in is what makes it look drawn rather than
              typed. `lowercase` is not a class here on purpose, the brand
              is lower case in `lib/site` where the title tag can see it. */}
          <span className="shrink-0 font-display text-lead font-bold tracking-[-0.04em]">
            {SITE.brand}
          </span>
          <span
            aria-hidden
            className="h-4 w-px shrink-0 bg-border-strong"
          />
          {/* The section, not the tool. A fund page is under the brand but
              not inside the basket tool, and `lib/site` owns which word goes
              here so it cannot drift from the paths it describes. */}
          <span className="truncate text-body font-medium tracking-tight text-ink-muted">
            {sectionLabel(pathname)}
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
