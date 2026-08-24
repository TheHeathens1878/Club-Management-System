import type { Metadata } from "next";
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
  title: "AoM Sports Club — Function Room Hire",
  description: "Function room hire and booking management for AoM Sports Club.",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "AoM Function Room",
  },
  other: {
    "mobile-web-app-capable": "yes",
  },
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
