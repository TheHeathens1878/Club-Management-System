import type { MetadataRoute } from "next";

/**
 * The installable web app (Club CRM mobile design: "suitable for use as a web
 * app and future deployment as an iOS and Android app"). Crest palette: ink
 * chrome over paper. `start_url` is `/` — the middleware already lands a
 * signed-in person on their view's home and everyone else on the login page.
 *
 * No service worker yet, deliberately: nothing here claims offline. Icons are
 * the crest centred on ink with a maskable-safe margin (public/icon-*.png).
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
