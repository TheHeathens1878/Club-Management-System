import { redirect } from "next/navigation";
import Link from "next/link";
import {
  BadgePoundSterling,
  Bell,
  Building2,
  CheckCircle2,
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
  Users,
  UserCheck,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

import { PageHeader } from "@/components/page-header";
import { ActionBar } from "@/components/ui/action-bar";
import { FoldCard } from "@/components/ui/fold-card";
import { IconTile } from "@/components/ui/icon-tile";
import { getSessionProfile, isSuperUser } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { settingsSummaries, type SettingsCounts } from "@/lib/settings-summaries";
import { isSumUpConfigured } from "@/lib/sumup";
import { createAdminClient } from "@/lib/supabase/admin";
import { TEMPLATE_DEFINITIONS, type TemplateKey } from "@/lib/template-engine";
import { UsersClient } from "@/app/(app)/super-users/users-client";

import { GeneralForm } from "./general-form";
import { BrandingForm } from "./branding-form";
import { PaymentsForm } from "./payments-form";
import { NotificationsForm, type StaffUser } from "./notifications-form";
import { FaqsClient } from "./faqs-client";

export const metadata = { title: "Settings" };

const STAFF_ROLES = ["super_user", "committee", "bar_manager", "bar"];

const VALID_TABS = ["general", "branding", "payments", "notifications", "users", "faqs", "email-templates"] as const;
type Tab = (typeof VALID_TABS)[number];

/**
 * Every other configuration screen in the app, from the one place an
 * administrator will look for it (2026-09-04 audit: eight scattered surfaces
 * and nothing joining them). Icons arrive RENDERED — this is a server
 * component and a function cannot cross into a client one.
 */
const ELSEWHERE: { href: string; label: string; detail: string; icon: React.ReactNode }[] = [
  { href: "/finance/fees", label: "Fees", detail: "Membership, subs and fines", icon: <BadgePoundSterling className="h-4 w-4" aria-hidden /> },
  { href: "/finance/settings", label: "Finance settings", detail: "Xero codes, cards on file", icon: <CreditCard className="h-4 w-4" aria-hidden /> },
  { href: "/registrations/form", label: "Registration form", detail: "The questions /join asks", icon: <ClipboardList className="h-4 w-4" aria-hidden /> },
  { href: "/pitches/manage", label: "Pitches", detail: "The pitches themselves", icon: <LandPlot className="h-4 w-4" aria-hidden /> },
  { href: "/venues", label: "Venues", detail: "Grounds and arrival notes", icon: <MapPin className="h-4 w-4" aria-hidden /> },
  { href: "/room-bookings/rooms", label: "Rooms", detail: "Function-room setup", icon: <DoorOpen className="h-4 w-4" aria-hidden /> },
  { href: "/waiting-list/manage/access", label: "Waiting-list access", detail: "Who works the list", icon: <UserCheck className="h-4 w-4" aria-hidden /> },
];

/** A notify setting holds a JSON array of user ids; a broken one is nobody. */
function parseIds(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

/**
 * The body of a fold whose data this render did not read. The four heavy
 * sections — accounts, staff, FAQs, saved templates — are still fetched only
 * when `?tab=` asks for them, so opening Settings costs one `site_settings`
 * read and nothing else. Pressing this link asks for that section, and the
 * fold it belongs to is the one open when the page comes back.
 */
function OpenToLoad({ tab, what }: { tab: Tab; what: string }) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{what}</p>
      <Link
        href={`/settings?tab=${tab}`}
        className="touch inline-flex items-center justify-center gap-2 rounded-md border px-4 py-2 text-sm font-medium transition-colors hover:bg-secondary/60"
      >
        Open
        <ChevronRight className="h-4 w-4" aria-hidden />
      </Link>
    </div>
  );
}

/**
 * `/settings` — the club's configuration as one page (P8.10).
 *
 * It used to be a strip of seven tabs, so checking the deposit cap meant
 * knowing which tab hid it and losing everything else off screen. Now:
 *
 *   1. A QUIET STATUS BAR — who the club is, where its booking email lands
 *      and whether card payments are on. There is nothing to press: this
 *      screen never needs anything, which is exactly what the bar says.
 *   2. THE INDEX — the seven configuration screens that live in other
 *      sections, as tiles, always visible rather than hidden on one tab.
 *   3. SEVEN FOLDS — each closed row shows its current VALUE ("Deposit: half
 *      the total, up to £100 · security £100 · reminders 14/7/0 days"), so
 *      most questions are answered without opening anything. Each fold keeps
 *      its own form and its own Save.
 *
 * `?tab=` survives with its old meaning turned inside out: the links into
 * this page (the email-template editor's back button, for one) still work,
 * and the tab they name is the fold that opens on load AND the only section
 * whose extra data is read.
 */
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await getSessionProfile();
  if (!session || !isSuperUser(session.profile?.role)) redirect("/lobby");

  const sp = await searchParams;
  // No `?tab=` means General: the three folds that need nothing but
  // `site_settings` are the ones a super user opens Settings for.
  const tab: Tab = VALID_TABS.includes(sp.tab as Tab) ? (sp.tab as Tab) : "general";

  const settings = await getSettings();
  const admin = createAdminClient();

  // Fetch users data only when the users fold was asked for
  let users: { id: string; email: string; full_name: string | null; role: string; last_sign_in: string | null }[] = [];
  if (tab === "users") {
    const [profilesResult, listUsersResult] = await Promise.all([
      admin.from("profiles").select("id,role,full_name"),
      admin.auth.admin.listUsers({ perPage: 1000 }),
    ]);
    const profiles = profilesResult.data;
    const authUsers = listUsersResult.data?.users ?? [];
    const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));
    users = authUsers.map((u) => ({
      id: u.id,
      email: u.email ?? "",
      full_name: profileMap.get(u.id)?.full_name ?? null,
      role: (profileMap.get(u.id)?.role ?? "member") as string,
      last_sign_in: u.last_sign_in_at ?? null,
    }));
  }

  // Fetch staff users only when the notifications fold was asked for
  let staff: StaffUser[] = [];
  if (tab === "notifications") {
    const [profilesResult, listUsersResult] = await Promise.all([
      admin.from("profiles").select("id,role,full_name"),
      admin.auth.admin.listUsers({ perPage: 1000 }),
    ]);
    const profileMap = new Map((profilesResult.data ?? []).map((p) => [p.id, p]));
    staff = (listUsersResult.data?.users ?? [])
      .map((u) => ({
        id: u.id,
        email: u.email ?? "",
        full_name: profileMap.get(u.id)?.full_name ?? null,
        role: (profileMap.get(u.id)?.role ?? "member") as string,
      }))
      .filter((u) => STAFF_ROLES.includes(u.role))
      .sort((a, b) => (a.full_name ?? a.email).localeCompare(b.full_name ?? b.email));
  }

  // Who is copied in is stored in `site_settings` itself, so the closed
  // summary is honest on every load — only the checkbox list needs the staff.
  const notifySelections: Record<string, string[]> = {
    notify_booking_request: parseIds(settings.notify_booking_request),
    notify_cancellation: parseIds(settings.notify_cancellation),
    notify_auto_cancellation: parseIds(settings.notify_auto_cancellation),
  };

  // Fetch FAQs only when the FAQs fold was asked for
  let faqs: { id: string; question: string; answer: string }[] = [];
  if (tab === "faqs") {
    const { data } = await admin.from("faqs").select("id,question,answer").eq("active", true).order("sort_order").order("created_at");
    faqs = (data ?? []).map((f) => ({ id: f.id as string, question: f.question as string, answer: f.answer as string }));
  }

  // Fetch saved template metadata only when the templates fold was asked for
  let savedTemplateMap = new Map<string, { key: string; updated_at: string | null; updated_by: string | null }>();
  if (tab === "email-templates") {
    const { data } = await admin.from("email_templates").select("key,updated_at,updated_by");
    savedTemplateMap = new Map((data ?? []).map((r) => [r.key, r]));
  }

  const templateKeys = Object.keys(TEMPLATE_DEFINITIONS) as TemplateKey[];
  const counts: SettingsCounts = {
    accounts: users.length,
    committee: users.filter((u) => u.role === "committee").length,
    superUsers: users.filter((u) => u.role === "super_user").length,
    faqs: faqs.length,
    notifyRecipients: new Set(Object.values(notifySelections).flat()).size,
    customTemplates: savedTemplateMap.size,
    totalTemplates: templateKeys.length,
  };
  const summaries = settingsSummaries(settings, counts);

  // A fold whose data this render did not read must not print a count of
  // zero: "No accounts" would be a lie told by a fetch that never ran. Those
  // three rows say what they hold instead, and load when pressed.
  const usersSummary = tab === "users" ? summaries.users : "Who can sign in, and as what";
  const faqsSummary = tab === "faqs" ? summaries.faqs : "The questions the public booking page answers";
  const templatesSummary =
    tab === "email-templates" ? summaries.emailTemplates : "The club's own wording for each email";

  const sumUpLine = isSumUpConfigured()
    ? "SumUp live — bookers can pay by card"
    : "SumUp not configured — card payments are off";

  return (
    <>
      <PageHeader title="Settings" subtitle="Site configuration and administration" />

      <div className="space-y-4 p-4 lg:space-y-6 lg:p-6">
        {/* Nothing on this screen is ever owed: it is a page of settings, not
            of work. The bar states the three facts a super user checks on
            arrival and offers no button at all. */}
        <ActionBar
          icon={<Settings2 className="h-4 w-4" aria-hidden />}
          tone="idle"
          status={summaries.general}
          detail={sumUpLine}
          action={<span className="text-xs text-muted-foreground">Nothing to do</span>}
        />

        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Configuration elsewhere
          </p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {ELSEWHERE.map((item) => (
              <Link
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
              </Link>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <FoldCard icon={<Building2 className="h-4 w-4" aria-hidden />} title="General" summary={summaries.general} defaultOpen={tab === "general"}>
            <GeneralForm settings={settings} />
          </FoldCard>

          <FoldCard icon={<Palette className="h-4 w-4" aria-hidden />} title="Branding" summary={summaries.branding} defaultOpen={tab === "branding"}>
            <BrandingForm settings={settings} />
          </FoldCard>

          <FoldCard icon={<BadgePoundSterling className="h-4 w-4" aria-hidden />} title="Payments" summary={summaries.payments} defaultOpen={tab === "payments"}>
            <PaymentsForm settings={settings} />
          </FoldCard>

          <FoldCard
            icon={<Bell className="h-4 w-4" aria-hidden />}
            title="Email notifications"
            summary={summaries.notifications}
            defaultOpen={tab === "notifications"}
          >
            {tab === "notifications" ? (
              <NotificationsForm staff={staff} selections={notifySelections} />
            ) : (
              <OpenToLoad tab="notifications" what="Which staff are copied in on each type of email." />
            )}
          </FoldCard>

          <FoldCard
            icon={<MessageCircleQuestion className="h-4 w-4" aria-hidden />}
            title="FAQs"
            summary={faqsSummary}
            defaultOpen={tab === "faqs"}
          >
            {tab === "faqs" ? (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  These FAQs appear on the public booking page. Add questions and answers that help
                  bookers understand the hire process.
                </p>
                <FaqsClient faqs={faqs} />
              </div>
            ) : (
              <OpenToLoad tab="faqs" what="The questions and answers shown on the public booking page." />
            )}
          </FoldCard>

          <FoldCard
            icon={<Users className="h-4 w-4" aria-hidden />}
            title="Users"
            summary={usersSummary}
            defaultOpen={tab === "users"}
          >
            {tab === "users" ? (
              <UsersClient users={users} currentUserId={session.userId} />
            ) : (
              <OpenToLoad tab="users" what="Every account that can sign in, with its role and last sign-in." />
            )}
          </FoldCard>

          <FoldCard
            icon={<Mail className="h-4 w-4" aria-hidden />}
            title="Email templates"
            summary={templatesSummary}
            defaultOpen={tab === "email-templates"}
          >
            {tab === "email-templates" ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Click a template to edit it. Changes take effect immediately.
                </p>
                {templateKeys.map((key) => {
                  const def = TEMPLATE_DEFINITIONS[key];
                  const custom = savedTemplateMap.get(key);
                  return (
                    <Link
                      key={key}
                      href={`/email-templates/${key}`}
                      className="flex items-center gap-4 rounded-lg border bg-card p-4 transition-colors hover:bg-muted/40"
                    >
                      <IconTile icon={<Mail className="h-4 w-4" aria-hidden />} shape="round" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{def.name}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">{def.description}</p>
                        {custom ? (
                          <p className="mt-1 flex items-center gap-1 text-xs text-success">
                            <CheckCircle2 className="h-3 w-3" aria-hidden />
                            Customised
                            {custom.updated_by && ` · by ${custom.updated_by}`}
                            {custom.updated_at && ` · ${formatDistanceToNow(new Date(custom.updated_at), { addSuffix: true })}`}
                          </p>
                        ) : (
                          <p className="mt-1 text-xs text-muted-foreground">Using default</p>
                        )}
                      </div>
                      <ChevronRight className="h-4 w-4 flex-none text-muted-foreground" aria-hidden />
                    </Link>
                  );
                })}
              </div>
            ) : (
              <OpenToLoad tab="email-templates" what="The club's own wording for each email the app sends." />
            )}
          </FoldCard>
        </div>
      </div>
    </>
  );
}
