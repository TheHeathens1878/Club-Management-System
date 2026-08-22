import type { Metadata } from "next";
import "./globals.css";
import { getSettings, themeVars } from "@/lib/settings";

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
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
