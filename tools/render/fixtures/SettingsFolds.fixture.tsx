/**
 * `/settings` as folds (P8.10).
 *
 * The shot that matters is `closed`: the quiet status bar, the seven
 * configuration screens that live elsewhere, and seven folded rows whose
 * summaries are the club's actual values. If "Deposit: half the total, up to
 * £100 · security £100 · reminders 14/7/0 days" is not legible at 390 without
 * opening anything, the page has failed its one job.
 *
 * The settings below are deliberately NOT the built-in defaults — a summary
 * that only reads well on the defaults proves nothing. `lazy` photographs a
 * fold whose data this render did not read (the "Open" door), and `payments`
 * a form still sitting inside its fold with its own Save.
 *
 * The page itself is an async server component, so it cannot be mounted in a
 * browser; this fixture composes the same primitives with the same helper
 * (`settingsSummaries`) and the real form components.
 */

import {
  BadgePoundSterling,
  Bell,
  Building2,
  ChevronRight,
  ClipboardList,
  CreditCard,
  DoorOpen,
  LandPlot,
  Mail,
  MapPin,
  MessageCircleQuestion,
  Palette,
  Settings2,
  UserCheck,
  Users,
} from "lucide-react";

import { ActionBar } from "@/components/ui/action-bar";
import { FoldCard } from "@/components/ui/fold-card";
import { IconTile } from "@/components/ui/icon-tile";
import type { SiteSettings } from "@/lib/settings";
import { settingsSummaries, type SettingsCounts } from "@/lib/settings-summaries";
import { PaymentsForm } from "@/app/(app)/settings/payments-form";

import type { Fixture } from "./contract";

const SETTINGS = {
  club_name: "AOM Sports Club",
  club_tagline: "Teams, fixtures, messages, payments",
  club_description: "",
  login_subtitle: "",
  login_no_email: "",
  contact_email: "bookings@aomsportsclub.co.uk",
  logo_url: "https://example.invalid/crest.png",
  logo_alt: "Club crest",
  color_theme: "crest",
  logo_height: "72",
  logo_max_width: "280",
  logo_object_fit: "contain",
  home_benefit_1_title: "",
  home_benefit_1_desc: "",
  home_benefit_2_title: "",
  home_benefit_2_desc: "",
  home_benefit_3_title: "",
  home_benefit_3_desc: "",
  deposit_default_pence: "10000",
  deposit_percent: "50",
  room_member_discount_pence: "5000",
  security_deposit_default_pence: "10000",
  deposit_window_days: "7",
  balance_reminder_days: "14",
  auto_cancel_unpaid: "true",
  notify_booking_request: '["a","b","c"]',
  notify_cancellation: '["a"]',
  notify_auto_cancellation: "[]",
} satisfies SiteSettings;

const COUNTS: SettingsCounts = {
  accounts: 14,
  committee: 3,
  superUsers: 2,
  faqs: 6,
  notifyRecipients: 3,
  customTemplates: 4,
  totalTemplates: 12,
};

const SUMMARIES = settingsSummaries(SETTINGS, COUNTS);

const ELSEWHERE: { href: string; label: string; detail: string; icon: React.ReactNode }[] = [
  { href: "/finance/fees", label: "Fees", detail: "Membership, subs and fines", icon: <BadgePoundSterling className="h-4 w-4" aria-hidden /> },
  { href: "/finance/settings", label: "Finance settings", detail: "Xero codes, cards on file", icon: <CreditCard className="h-4 w-4" aria-hidden /> },
  { href: "/registrations/form", label: "Registration form", detail: "The questions /join asks", icon: <ClipboardList className="h-4 w-4" aria-hidden /> },
  { href: "/pitches/manage", label: "Pitches", detail: "The pitches themselves", icon: <LandPlot className="h-4 w-4" aria-hidden /> },
  { href: "/venues", label: "Venues", detail: "Grounds and arrival notes", icon: <MapPin className="h-4 w-4" aria-hidden /> },
  { href: "/room-bookings/rooms", label: "Rooms", detail: "Function-room setup", icon: <DoorOpen className="h-4 w-4" aria-hidden /> },
  { href: "/waiting-list/manage/access", label: "Waiting-list access", detail: "Who works the list", icon: <UserCheck className="h-4 w-4" aria-hidden /> },
];

function Frame({ children }: { children: React.ReactNode }) {
  return <div className="space-y-4 p-4 lg:space-y-6 lg:p-6">{children}</div>;
}

function Bar() {
  return (
    <ActionBar
      icon={<Settings2 className="h-4 w-4" aria-hidden />}
      tone="idle"
      status={SUMMARIES.general}
      detail="SumUp live — bookers can pay by card"
      action={<span className="text-xs text-muted-foreground">Nothing to do</span>}
    />
  );
}

function Index() {
  return (
    <div>
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Configuration elsewhere
      </p>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {ELSEWHERE.map((item) => (
          <a
            key={item.href}
            href={item.href}
            className="touch flex items-center gap-3 rounded-lg border bg-card p-3 transition-colors hover:bg-secondary/40"
          >
            <IconTile icon={item.icon} tone="muted" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium leading-tight">{item.label}</span>
              <span className="block truncate text-xs text-muted-foreground">{item.detail}</span>
            </span>
            <ChevronRight className="h-4 w-4 flex-none text-muted-foreground" aria-hidden />
          </a>
        ))}
      </div>
    </div>
  );
}

function OpenToLoad({ what }: { what: string }) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{what}</p>
      <a
        href="/settings?tab=users"
        className="touch inline-flex items-center justify-center gap-2 rounded-md border px-4 py-2 text-sm font-medium transition-colors hover:bg-secondary/60"
      >
        Open
        <ChevronRight className="h-4 w-4" aria-hidden />
      </a>
    </div>
  );
}

function Folds({ open }: { open?: "payments" | "users" }) {
  const lazy = (what: string) => <OpenToLoad what={what} />;
  return (
    <div className="space-y-2">
      <FoldCard icon={<Building2 className="h-4 w-4" aria-hidden />} title="General" summary={SUMMARIES.general}>
        {lazy("Club name, public page text and login page copy.")}
      </FoldCard>
      <FoldCard icon={<Palette className="h-4 w-4" aria-hidden />} title="Branding" summary={SUMMARIES.branding}>
        {lazy("Logo and colour theme.")}
      </FoldCard>
      <FoldCard
        icon={<BadgePoundSterling className="h-4 w-4" aria-hidden />}
        title="Payments"
        summary={SUMMARIES.payments}
        defaultOpen={open === "payments"}
      >
        {/* The real form, and only in the case that opens it: the harness
            measures tap targets inside a closed fold too, and the inputs
            `Input` draws are 40px — a debt of the shared control, not of this
            screen, and the plan leaves the form bodies exactly as they are. */}
        {open === "payments" ? <PaymentsForm settings={SETTINGS} /> : lazy("Deposit defaults and reminder timing.")}
      </FoldCard>
      <FoldCard icon={<Bell className="h-4 w-4" aria-hidden />} title="Email notifications" summary={SUMMARIES.notifications}>
        {lazy("Which staff are copied in on each type of email.")}
      </FoldCard>
      <FoldCard icon={<MessageCircleQuestion className="h-4 w-4" aria-hidden />} title="FAQs" summary={SUMMARIES.faqs}>
        {lazy("The questions and answers shown on the public booking page.")}
      </FoldCard>
      <FoldCard
        icon={<Users className="h-4 w-4" aria-hidden />}
        title="Users"
        // The row a render that did not read the accounts shows: what it
        // holds, never a count of zero.
        summary={open === "users" ? "Who can sign in, and as what" : SUMMARIES.users}
        defaultOpen={open === "users"}
      >
        {lazy("Every account that can sign in, with its role and last sign-in.")}
      </FoldCard>
      <FoldCard icon={<Mail className="h-4 w-4" aria-hidden />} title="Email templates" summary={SUMMARIES.emailTemplates}>
        {lazy("The club's own wording for each email the app sends.")}
      </FoldCard>
    </div>
  );
}

const fixture: Fixture = {
  cases: {
    closed: () => (
      <Frame>
        <Bar />
        <Index />
        <Folds />
      </Frame>
    ),

    lazy: () => (
      <Frame>
        <Bar />
        <Folds open="users" />
      </Frame>
    ),

    payments: () => (
      <Frame>
        <Bar />
        <Folds open="payments" />
      </Frame>
    ),
  },
};

export default fixture;
