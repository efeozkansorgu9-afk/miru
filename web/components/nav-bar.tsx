"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Column } from "@/components/column";
import { FUND_BASE, SITE, TOOL, sectionLabel } from "@/lib/site";
import { ThemeToggle } from "./theme-toggle";

/**
 * One entry of the top navigation.
 *
 * The two areas of the site. The fund pages had no way in from inside it —
 * they were reached from a search engine or from each other, and someone on
 * the basket tool could not get to one at all — so the bar now names both.
 */
export interface NavItem {
  /** Turkish. Every visible string in this product is written on this side. */
  label: string;
  /** What a phone shows, where the full label and the lockup do not both fit. */
  short: string;
  href: string;
}

export const NAV_ITEMS: NavItem[] = [
  { label: TOOL.name, short: "Sepet", href: TOOL.href },
  { label: "Fonlar", short: "Fonlar", href: FUND_BASE },
];

/** The item whose area the reader is in: its own path or anything under it. */
function isCurrent(item: NavItem, pathname: string): boolean {
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

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
          {/* Below `sm` the rule and the section give way to the menu,
              whose current item already says where the reader is. */}
          <span
            aria-hidden
            className="hidden h-4 w-px shrink-0 bg-border-strong sm:block"
          />
          {/* The section, not the tool. A fund page is under the brand but
              not inside the basket tool, and `lib/site` owns which word goes
              here so it cannot drift from the paths it describes. */}
          <span className="hidden truncate text-body font-medium tracking-tight text-ink-muted sm:inline">
            {sectionLabel(pathname)}
          </span>
        </Link>

        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          <nav aria-label="Ana menü" className="flex items-center gap-0.5 sm:mr-2 sm:gap-1">
            {NAV_ITEMS.map((item) => {
              const current = isCurrent(item, pathname);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={current ? "page" : undefined}
                  className={`rounded-control px-2.5 py-2 text-label transition-colors hover:bg-canvas-sunken hover:text-ink sm:px-3 ${
                    current ? "font-medium text-ink" : "text-ink-muted"
                  }`}
                >
                  <span className="sm:hidden">{item.short}</span>
                  <span className="hidden sm:inline">{item.label}</span>
                </Link>
              );
            })}
          </nav>
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
