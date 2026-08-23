import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { ShieldCheck, LogIn, CalendarDays, ChevronRight } from "lucide-react";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

/**
 * The portal front door: two ways in, nothing else. Members, parents and
 * staff log in; anyone hiring the function room goes straight to /book with
 * no account. The full booking experience (rooms, availability calendar,
 * FAQs) lives on /book — this page only chooses.
 */
export default async function Home() {
  const s = await getSettings();

  const logoHeight = Number(s.logo_height) || 80;
  const logoMaxWidth = Number(s.logo_max_width) || 300;
  const objectFit = (s.logo_object_fit ?? "contain") as "contain" | "cover" | "fill";

  return (
    <main className="flex min-h-screen flex-col bg-gradient-to-b from-primary/8 via-background to-background">
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center px-4 py-12">
        {/* Club identity */}
        <div className="mb-10 flex flex-col items-center text-center">
          {s.logo_url ? (
            <div style={{ height: logoHeight, maxWidth: logoMaxWidth }} className="mb-4 overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={s.logo_url} alt={s.logo_alt} style={{ width: "100%", height: "100%", objectFit }} />
            </div>
          ) : (
            <div className="mb-4 inline-flex rounded-2xl bg-primary/10 p-4 text-primary">
              <ShieldCheck className="h-10 w-10" />
            </div>
          )}
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{s.club_name}</h1>
          {s.club_tagline && <p className="mt-2 text-base text-muted-foreground">{s.club_tagline}</p>}
        </div>

        {/* The two ways in */}
        <div className="grid w-full gap-4 sm:grid-cols-2">
          <Link
            href="/login"
            className="group flex flex-col rounded-2xl border bg-card p-6 shadow-sm transition-colors hover:border-primary/40 hover:bg-primary/5"
          >
            <span className="mb-3 inline-flex w-fit rounded-lg bg-primary/10 p-2.5 text-primary">
              <LogIn className="h-6 w-6" />
            </span>
            <span className="text-lg font-semibold">Log in</span>
            <span className="mt-1 flex-1 text-sm text-muted-foreground">
              Members, parents, coaches and committee — fixtures, teams, payments and messages.
            </span>
            <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary">
              Sign in <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </span>
          </Link>

          <Link
            href="/book"
            className="group flex flex-col rounded-2xl border bg-card p-6 shadow-sm transition-colors hover:border-primary/40 hover:bg-primary/5"
          >
            <span className="mb-3 inline-flex w-fit rounded-lg bg-primary/10 p-2.5 text-primary">
              <CalendarDays className="h-6 w-6" />
            </span>
            <span className="text-lg font-semibold">Book the function room</span>
            <span className="mt-1 flex-1 text-sm text-muted-foreground">
              Private hire for parties, meetings and celebrations. Check availability and request a
              booking — no account needed.
            </span>
            <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary">
              Check availability <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </span>
          </Link>
        </div>

        {s.club_description && (
          <p className="mt-10 max-w-xl text-center text-sm text-muted-foreground">{s.club_description}</p>
        )}
      </div>

      <footer className="border-t py-6 text-center text-xs text-muted-foreground">
        {s.club_name} ·{" "}
        <Link href="/contact" className="hover:underline">Contact</Link>
        {" · "}
        <Link href="/privacy" className="hover:underline">Privacy notice</Link>
      </footer>
    </main>
  );
}
