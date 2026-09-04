import type { Metadata, Viewport } from "next";
import { Oswald, Source_Sans_3 } from "next/font/google";
import "./globals.css";
import { getSettings, themeVars } from "@/lib/settings";

// The crest type pairing (Claude Design "Football club management system"):
// Oswald condensed caps for display — it picks up the crest lettering —
// Source Sans 3 for everything that carries data.
const sourceSans = Source_Sans_3({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});
const oswald = Oswald({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  // A tab that says only "AoM Sports Club" is no use to somebody with six of
  // them open. Each page names itself and the template adds the club.
  title: { template: "%s · AoM Sports Club", default: "AoM Sports Club" },
  description:
    "Ashton-on-Mersey Sports Club — teams, fixtures, availability, messages, subs and bookings.",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "AoM Club",
  },
  icons: {
    apple: "/apple-touch-icon.png",
  },
  other: {
    "mobile-web-app-capable": "yes",
  },
};

/**
 * The phone shell needs the real viewport: edge-to-edge (`viewportFit: cover`)
 * so the tab bar can pad itself with `env(safe-area-inset-bottom)`, and ink as
 * the browser chrome colour to match the header strip.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#14100E",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const settings = await getSettings();
  const vars = themeVars(settings.color_theme);

  return (
    <html lang="en-GB" suppressHydrationWarning>
      <head>
        {vars && <style>{`:root{${vars}}`}</style>}
      </head>
      <body className={`${sourceSans.variable} ${oswald.variable} min-h-screen font-sans antialiased`}>
        {children}
      </body>
    </html>
  );
}
