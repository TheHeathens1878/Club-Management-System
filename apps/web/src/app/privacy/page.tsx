import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { getSettings } from "@/lib/settings";

export const metadata: Metadata = { title: "Privacy notice" };

/**
 * The public privacy notice. Linked from the front door and the login page —
 * and, until the 2026-09-04 navigation audit, a 404. The text is the
 * store-readiness draft (docs/mobile/store-readiness.md §2) brought up to
 * date with what the platform actually runs today: SumUp for payments,
 * Microsoft 365 for email, Supabase for hosting.
 */
export default async function PrivacyPage() {
  const s = await getSettings();

  const sections: { title: string; body: React.ReactNode }[] = [
    {
      title: "Who we are",
      body: (
        <>
          {s.club_name} (&ldquo;the club&rdquo;) operates this app for its members, players,
          parents and guardians, coaches, staff and function-room hirers. The club is the data
          controller. Contact:{" "}
          <a className="underline" href={`mailto:${s.contact_email}`}>{s.contact_email}</a>.
        </>
      ),
    },
    {
      title: "What we collect",
      body: (
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Account</strong> — name, email, phone (optional), date of birth (used to work
            out whether a member is under 18 and to apply the club&apos;s safeguarding rules).
          </li>
          <li>
            <strong>Membership and playing</strong> — teams, seasons, registrations, availability
            for fixtures, membership numbers, charges and payments. Card payments are processed by
            SumUp; the club stores amounts, dates and SumUp references, never card numbers.
          </li>
          <li>
            <strong>Guardianship and consent</strong> — which adults are guardians of which
            children, and the consents those guardians give (app account, messaging, photo
            consent by purpose).
          </li>
          <li><strong>Messaging</strong> — messages, attachments and read receipts in club conversations.</li>
          <li><strong>Photos and videos</strong> — media uploaded by club staff, and who is pictured.</li>
          <li><strong>Device</strong> — a push-notification token when you enable notifications.</li>
          <li><strong>Safeguarding</strong> — concerns reported through the app and the club&apos;s case notes.</li>
          <li><strong>Function room hire</strong> — booking details and contact information for hirers.</li>
        </ul>
      ),
    },
    {
      title: "Why, and the legal basis",
      body: (
        <>
          To run the club&apos;s teams, fixtures, bookings, membership and subs (contract and
          legitimate interests); to meet the club&apos;s safeguarding duties under FA and Cheshire
          FA policy (legal obligation and substantial public interest); photos only with consent;
          marketing messages only with consent.
        </>
      ),
    },
    {
      title: "Children",
      body: (
        <>
          Members under 18 may hold an app account only from the age set by the club and only with
          a guardian&apos;s consent. The app enforces the club&apos;s safeguarding rules in its
          database: an adult and a child cannot be alone in a private conversation unless the adult
          is that child&apos;s guardian or the conversation is flagged as visible to the club&apos;s
          safeguarding lead. Conversations involving a child can be opened and exported by the
          club&apos;s safeguarding lead or administrators, and every such access is recorded — a
          banner in the conversation tells every participant when this applies. Photos of a child
          are shown or exported only where that child&apos;s guardian has consented for that
          purpose.
        </>
      ),
    },
    {
      title: "Who we share it with",
      body: (
        <>
          Supabase (hosting and database), Vercel (web hosting), SumUp (card payments), Microsoft
          365 (club email), Expo (push notifications for the mobile app), and the FA&apos;s
          Full-Time service (fixtures are imported from its public pages; nothing about you is sent
          to it). The club does not sell data.
        </>
      ),
    },
    {
      title: "How long we keep it",
      body: (
        <>
          Membership and financial records are kept while you are a member and afterwards for as
          long as accounting and FA rules require; messages are retained for the period set in the
          club&apos;s retention policy and then deleted; safeguarding records are kept for the
          period required by FA guidance; audit records for seven years. Anything under a
          safeguarding legal hold is kept until the hold is lifted.
        </>
      ),
    },
    {
      title: "Your rights",
      body: (
        <>
          Access, correction, deletion (subject to safeguarding and legal-hold exceptions),
          objection and portability — write to{" "}
          <a className="underline" href={`mailto:${s.contact_email}`}>{s.contact_email}</a>.
          Guardians exercise these rights on behalf of their children; from 18 the member does.
          You can complain to the Information Commissioner&apos;s Office (ico.org.uk).
        </>
      ),
    },
  ];

  return (
    <main className="flex min-h-screen flex-col bg-background">
      <div className="mx-auto w-full max-w-2xl flex-1 px-6 py-12">
        <Link
          href="/"
          className="inline-flex min-h-[40px] items-center gap-0.5 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
          {s.club_name}
        </Link>
        <h1 className="mt-4 font-display text-3xl font-semibold uppercase tracking-wide">Privacy notice</h1>

        <div className="mt-8 space-y-8">
          {sections.map((section) => (
            <section key={section.title}>
              <h2 className="text-lg font-semibold">{section.title}</h2>
              <div className="mt-2 text-sm leading-relaxed text-muted-foreground">{section.body}</div>
            </section>
          ))}
        </div>
      </div>

      <footer className="border-t py-6 text-center text-xs text-muted-foreground">
        {s.club_name} ·{" "}
        <Link href="/contact" className="hover:underline">Contact</Link>
      </footer>
    </main>
  );
}
