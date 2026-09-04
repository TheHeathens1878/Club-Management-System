import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, Mail, MapPin } from "lucide-react";

import { getSettings } from "@/lib/settings";

export const metadata: Metadata = { title: "Contact" };

/**
 * The public contact page. It was linked from the front door and the login
 * page for weeks without existing (2026-09-04 audit: a straight 404 behind a
 * /login bounce). The address comes from site settings, so the club changes
 * it in Settings, not in code.
 */
export default async function ContactPage() {
  const s = await getSettings();

  return (
    <main className="flex min-h-screen flex-col bg-background">
      <div className="mx-auto w-full max-w-lg flex-1 px-6 py-12">
        <Link
          href="/"
          className="inline-flex min-h-[40px] items-center gap-0.5 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
          {s.club_name}
        </Link>
        <h1 className="mt-4 font-display text-3xl font-semibold uppercase tracking-wide">Contact the club</h1>

        <div className="mt-8 space-y-4">
          <a
            href={`mailto:${s.contact_email}`}
            className="flex items-center gap-3 rounded-2xl border bg-card p-5 shadow-sm transition-colors hover:border-primary/40 hover:bg-primary/5"
          >
            <span className="inline-flex rounded-lg bg-primary/10 p-2.5 text-primary">
              <Mail className="h-5 w-5" />
            </span>
            <span>
              <span className="block text-sm font-semibold">Email us</span>
              <span className="block text-sm text-muted-foreground">{s.contact_email}</span>
            </span>
          </a>

          <div className="flex items-center gap-3 rounded-2xl border bg-card p-5 shadow-sm">
            <span className="inline-flex rounded-lg bg-primary/10 p-2.5 text-primary">
              <MapPin className="h-5 w-5" />
            </span>
            <span>
              <span className="block text-sm font-semibold">{s.club_name}</span>
              <span className="block text-sm text-muted-foreground">
                Function room hire, membership and anything else — the email above reaches the
                right person.
              </span>
            </span>
          </div>
        </div>

        <p className="mt-8 text-sm text-muted-foreground">
          A member with a safeguarding concern should use{" "}
          <Link href="/safeguarding/report" className="font-medium underline">
            Report a concern
          </Link>{" "}
          after signing in — it reaches the club&apos;s welfare officer directly.
        </p>
      </div>

      <footer className="border-t py-6 text-center text-xs text-muted-foreground">
        {s.club_name} ·{" "}
        <Link href="/privacy" className="hover:underline">Privacy notice</Link>
      </footer>
    </main>
  );
}
