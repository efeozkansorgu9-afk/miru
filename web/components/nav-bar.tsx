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

/** A radar sweep over concentric rings. Currentcolor, so the theme owns it. */
function Logo() {
  return (
    <span className="grid size-8 shrink-0 place-items-center rounded-control bg-accent text-accent-ink">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        className="size-5"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="8.2" />
        <circle cx="12" cy="12" r="3.6" />
        <path d="M12 12 18 6.2" />
      </svg>
    </span>
  );
}
