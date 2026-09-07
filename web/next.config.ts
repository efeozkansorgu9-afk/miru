import type { NextConfig } from "next";

import { TOOL } from "./lib/site";

/**
 * Hostnames the dev server will serve its own internals to.
 *
 * Next blocks cross-origin requests to `/_next` in development, and from the
 * browser's side the block is close to invisible: the page HTML arrives, all
 * 23 scripts load with a 200, no exception is thrown, and only the HMR socket
 * and the dev endpoints come back 403. Hydration never finishes, so the page
 * renders and then does nothing at all — no clicks, no fetches. It looks
 * exactly like a backend that will not answer, and it is not one: the app
 * never gets far enough to ask.
 *
 * That is what a phone hits. The page is opened at the laptop's address on
 * the local network, so the Origin is that address, and the only host allowed
 * by default is the one the server was started with. Binding with
 * `-H <address>` allows that address implicitly, but then localhost stops
 * working, so the hosts are listed here instead and `-H 0.0.0.0` keeps both.
 *
 * Matching is on hostname alone, right to left across dot separated segments,
 * so `*` covers exactly one octet. These are the same private IPv4 ranges
 * `api/main.py` opens, for the same reason. The two lists guard different
 * servers and are meant to agree.
 *
 * Development only. `next build` and `next start` never consult it, so unlike
 * the API's switch there is nothing here that could be left on in production.
 */
const PRIVATE_HOSTS = [
  "10.*.*.*",
  "192.168.*.*",
  // 172.16 through 172.31. Written out because a wildcard takes a whole
  // segment or nothing, and `172.*.*.*` would hand the same access to public
  // addresses in 172.0 through 172.15 and 172.32 up.
  ...Array.from({ length: 16 }, (_, i) => `172.${16 + i}.*.*`),
  // Bonjour, so `http://<laptop>.local:3000` works without looking up
  // whatever address the router handed out this morning.
  "*.local",
];

const nextConfig: NextConfig = {
  allowedDevOrigins: PRIVATE_HOSTS,
  /**
   * The root, until there is a page to put there.
   *
   * The tool moved off `/` so the brand can have a home page above it, and
   * that page is not written yet, so `/` sends the reader to the one tool
   * there is. The destination is `TOOL.href` rather than a path typed here:
   * the header links to the same constant, so the redirect cannot point
   * somewhere the navigation does not.
   *
   * `permanent: false` — a 307, and it matters which. A 308 is cached by the
   * browser indefinitely and is not re-checked, so every reader who visited
   * once during this window would keep being bounced off the home page after
   * it exists, on a machine no deploy can reach. The temporary code says
   * exactly what is true: this is where `/` goes today.
   */
  async redirects() {
    return [{ source: "/", destination: TOOL.href, permanent: false }];
  },
};

export default nextConfig;
