import type { MetadataRoute } from "next";

/**
 * The installable web app (Club CRM mobile design: "suitable for use as a web
 * app and future deployment as an iOS and Android app"). Crest palette: ink
 * chrome over paper. `start_url` is `/` — the middleware already lands a
 * signed-in person on their view's home and everyone else on the login page.
 *
 * There IS a service worker now (public/sw.js), and it still claims nothing
 * about offline: it exists because no browser will issue a Web Push
 * subscription without one, and iOS Safari will not issue one at all until the
 * site is on the Home Screen. It has no `fetch` handler, so every screen is
 * still a live read under the member's own RLS — the reason for not caching a
 * safeguarding-scoped app has not changed.
 *
 * Icons are the crest centred on ink with a maskable-safe margin
 * (public/icon-*.png); the same badge is the icon on a push notification.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "AoM Sports Club",
    short_name: "AoM Club",
    description:
      "Ashton-on-Mersey Sports Club — teams, fixtures, availability, messages, subs and bookings.",
    start_url: "/",
    display: "standalone",
    background_color: "#F7F4F0",
    theme_color: "#14100E",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
