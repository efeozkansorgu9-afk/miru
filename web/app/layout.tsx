import type { Metadata } from "next";
import { Bricolage_Grotesque, Geist_Mono, Plus_Jakarta_Sans } from "next/font/google";
import Script from "next/script";

import { NavBar } from "@/components/nav-bar";
import { SiteFooter } from "@/components/site-footer";
import { ThemeProvider, themeScript } from "@/components/theme-provider";
import { motionScript } from "@/lib/motion";
import { SITE, TOOL, pageTitle } from "@/lib/site";
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
  // `template` puts the tool and the brand after every page title without
  // any page having to know either.
  title: { default: pageTitle(), template: `%s · ${TOOL.name} · ${SITE.brand}` },
  description: TOOL.description,
  /*
   * The mark, four ways, because no single file is read by everything.
   *
   * `logo.svg` is the primary and the only one that is drawn rather than
   * generated: it is the same file the header draws, it scales, and it
   * carries its own dark scheme rule. Safari does not use an SVG favicon,
   * so it needs a raster to fall back to, and a bare `/favicon.ico` is
   * requested by clients that never read this list at all.
   *
   * Order is the fallback order, weakest first. A browser takes the last
   * `rel="icon"` it can decode, so the SVG is listed last and everything
   * that can render it does; the PNG catches what cannot, and the ICO
   * catches what predates both.
   *
   * The three raster files are generated from `logo.svg` and committed, not
   * built. If the mark changes, regenerate them — the geometry lives in
   * three places now, and `public/logo.svg` says which. They bake in the
   * light palette, since a raster cannot answer `prefers-color-scheme`, and
   * that is the half of the pair chosen to clear 3:1 on either ground.
   */
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "32x32" },
      { url: "/icon-32.png", type: "image/png", sizes: "32x32" },
      { url: "/logo.svg", type: "image/svg+xml" },
    ],
    // iOS composites a transparent home screen icon onto black, so this one
    // is the only one with a ground of its own.
    apple: [{ url: "/apple-touch-icon.png", type: "image/png", sizes: "180x180" }],
  },
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
        {/* Tells the stylesheet that scripts run, so `Appear` may start a
            block hidden. Before paint, for the same reason as the theme. */}
        <Script
          id="motion"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: motionScript }}
        />
        <ThemeProvider>
          <NavBar />
          <main className="flex flex-1 flex-col">{children}</main>
          <SiteFooter />
        </ThemeProvider>
      </body>
    </html>
  );
}
