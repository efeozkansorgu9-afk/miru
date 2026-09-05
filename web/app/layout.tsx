import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";

import { NavBar } from "@/components/nav-bar";
import { ThemeProvider, themeScript } from "@/components/theme-provider";
import { SITE, pageTitle } from "@/lib/site";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
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
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang={SITE.lang}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
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
