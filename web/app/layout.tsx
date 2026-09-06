import type { Metadata } from "next";
import { Bricolage_Grotesque, Geist_Mono, Plus_Jakarta_Sans } from "next/font/google";
import Script from "next/script";

import { NavBar } from "@/components/nav-bar";
import { ThemeProvider, themeScript } from "@/components/theme-provider";
import { SITE, pageTitle } from "@/lib/site";
import "./globals.css";

/**
 * Two families, doing two different jobs.
 *
 * Bricolage Grotesque is the voice: a grotesque with actual character in its
 * letterforms, and an optical size axis, so a heading at 44px is drawn
 * tighter than the same shapes scaled up would be. It is on headings only.
 * At paragraph size its personality becomes noise, which is the usual reason
 * a display face makes a page worse rather than better.
 *
 * Plus Jakarta Sans is the reading: geometric humanist, high x-height, and
 * unremarkable in the way body copy has to be. It carries every word anyone
 * actually reads on this page, plus every number.
 *
 * Both are loaded with `latin-ext`, which is the subset holding ğ, ı, İ and
 * ş; `latin` alone would leave a Turkish page falling back to a system font
 * on exactly those letters, mid-word. Both were checked glyph by glyph
 * against the full Turkish set, and both carry `tnum`, which is what makes
 * `tabular-nums` line the money columns up.
 */
const display = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin", "latin-ext"],
  // Only the weights headings use, so the display face costs one file.
  weight: ["600", "700"],
});

const sans = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin", "latin-ext"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin", "latin-ext"],
});

export const metadata: Metadata = {
  // `template` puts the product name after every page title without any page
  // having to know it.
  title: { default: pageTitle(), template: `%s · ${SITE.name}` },
  description: SITE.description,
  // The same file the header draws, rather than a second exported asset that
  // can drift from it. It carries its own palette and its own dark scheme
  // rule, because a favicon is loaded as its own document and cannot read
  // this page's tokens — see the comment in `public/logo.svg`.
  icons: { icon: [{ url: "/logo.svg", type: "image/svg+xml" }] },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang={SITE.lang}
      className={`${sans.variable} ${display.variable} ${geistMono.variable} h-full antialiased`}
      // The inline script below sets this before paint. React is told not to
      // mind the mismatch, because on a dark themed visit the class is
      // already there when hydration compares.
      suppressHydrationWarning
    >
      <body className="theme-transition flex min-h-full flex-col bg-canvas text-ink">
        {/* `beforeInteractive` puts this in <head> and runs it ahead of any
            Next.js code, which is what stops a dark theme user seeing a white
            flash. Writing a <head> tag here by hand instead would be the
            documented way to break hydration for the whole tree. */}
        <Script
          id="theme"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: themeScript }}
        />
        <ThemeProvider>
          <NavBar />
          <main className="flex flex-1 flex-col">{children}</main>
        </ThemeProvider>
      </body>
    </html>
  );
}
