import { redirect } from "next/navigation";
import Link from "next/link";
import { getSessionProfile, isSuperUser } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GeneralForm } from "./general-form";
import { BrandingForm } from "./branding-form";
import { PaymentsForm } from "./payments-form";
import { NotificationsForm, type StaffUser } from "./notifications-form";

const STAFF_ROLES = ["super_user", "committee", "bar_manager", "bar"];
import { UsersClient } from "@/app/(app)/super-users/users-client";
import { FaqsClient } from "./faqs-client";
import { TEMPLATE_DEFINITIONS, type TemplateKey } from "@/lib/template-engine";
import { formatDistanceToNow } from "date-fns";
import { Mail, ChevronRight, CheckCircle2 } from "lucide-react";

const VALID_TABS = ["general", "branding", "payments", "notifications", "users", "faqs", "email-templates"] as const;
type Tab = (typeof VALID_TABS)[number];

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await getSessionProfile();
  if (!session || !isSuperUser(session.profile?.role)) redirect("/lobby");

  const sp = await searchParams;
  const tab: Tab = VALID_TABS.includes(sp.tab as Tab) ? (sp.tab as Tab) : "general";

  const settings = await getSettings();
  const admin = createAdminClient();

  // Fetch users data only when on the users tab
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

  // Fetch staff users only when on the notifications tab
  let staff: StaffUser[] = [];
  let notifySelections: Record<string, string[]> = {};
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

    const parse = (v: string): string[] => { try { return JSON.parse(v) as string[]; } catch { return []; } };
    notifySelections = {
      notify_booking_request: parse(settings.notify_booking_request),
      notify_cancellation: parse(settings.notify_cancellation),
      notify_auto_cancellation: parse(settings.notify_auto_cancellation),
    };
  }

  // Fetch FAQs only when on the faqs tab
  let faqs: { id: string; question: string; answer: string }[] = [];
  if (tab === "faqs") {
    const { data } = await admin.from("faqs").select("id,question,answer").eq("active", true).order("sort_order").order("created_at");
    faqs = (data ?? []).map((f) => ({ id: f.id as string, question: f.question as string, answer: f.answer as string }));
  }

  // Fetch saved template metadata only when on the email-templates tab
  let savedTemplateMap = new Map<string, { key: string; updated_at: string | null; updated_by: string | null }>();
  if (tab === "email-templates") {
    const { data } = await admin.from("email_templates").select("key,updated_at,updated_by");
    savedTemplateMap = new Map((data ?? []).map((r) => [r.key, r]));
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: "general", label: "General" },
    { key: "branding", label: "Branding" },
    { key: "payments", label: "Payments" },
    { key: "notifications", label: "Notifications" },
    { key: "users", label: "Users" },
    { key: "faqs", label: "FAQs" },
    { key: "email-templates", label: "Email Templates" },
  ];

  return (
    <>
      <PageHeader title="Settings" subtitle="Site configuration and administration" />
      <div className="p-4 space-y-4 lg:p-6 lg:space-y-6">
        {/* The strip scrolls sideways on a phone rather than wrapping into
            three rows; from lg it wraps as it always has. */}
        <div className="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:overflow-x-visible lg:px-0">
          <div className="inline-flex flex-nowrap rounded-lg bg-secondary p-1 lg:flex-wrap lg:gap-y-1">
            {tabs.map((t) => (
              <a
                key={t.key}
                href={`/settings?tab=${t.key}`}
                className={`flex min-h-[44px] items-center rounded-md px-4 py-1.5 text-sm font-medium transition whitespace-nowrap lg:block lg:min-h-0
                  ${tab === t.key ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              >
                {t.label}
              </a>
            ))}
          </div>
        </div>

        {tab === "general" && (
          <Card className="max-w-2xl">
            <CardHeader className="p-4 lg:p-6">
              <CardTitle>General</CardTitle>
              <p className="text-sm text-muted-foreground">Club name, public page text and login page copy.</p>
            </CardHeader>
            <CardContent className="p-4 pt-0 lg:p-6 lg:pt-0">
              <GeneralForm settings={settings} />
            </CardContent>
          </Card>
        )}

        {tab === "branding" && (
          <Card className="max-w-2xl">
            <CardHeader className="p-4 lg:p-6">
              <CardTitle>Branding</CardTitle>
              <p className="text-sm text-muted-foreground">Logo and colour theme.</p>
            </CardHeader>
            <CardContent className="p-4 pt-0 lg:p-6 lg:pt-0">
              <BrandingForm settings={settings} />
            </CardContent>
          </Card>
        )}

        {tab === "payments" && (
          <Card className="max-w-2xl">
            <CardHeader className="p-4 lg:p-6">
              <CardTitle>Payments</CardTitle>
              <p className="text-sm text-muted-foreground">Deposit defaults and reminder timing for bookings.</p>
            </CardHeader>
            <CardContent className="p-4 pt-0 lg:p-6 lg:pt-0">
              <PaymentsForm settings={settings} />
            </CardContent>
          </Card>
        )}

        {tab === "notifications" && (
          <Card className="max-w-2xl">
            <CardHeader className="p-4 lg:p-6">
              <CardTitle>Email Notifications</CardTitle>
              <p className="text-sm text-muted-foreground">Choose which staff are copied in on each type of email.</p>
            </CardHeader>
            <CardContent className="p-4 pt-0 lg:p-6 lg:pt-0">
              <NotificationsForm staff={staff} selections={notifySelections} />
            </CardContent>
          </Card>
        )}

        {tab === "users" && (
          <div className="max-w-3xl">
            <UsersClient users={users} currentUserId={session.userId} />
          </div>
        )}

        {tab === "faqs" && (
          <div className="max-w-2xl">
            <p className="text-sm text-muted-foreground mb-4">
              These FAQs appear on the public booking page. Add questions and answers that help bookers understand the hire process.
            </p>
            <FaqsClient faqs={faqs} />
          </div>
        )}

        {tab === "email-templates" && (
          <div className="max-w-2xl space-y-3">
            <p className="text-sm text-muted-foreground">
              Click a template to edit it. Changes take effect immediately.
            </p>
            {(Object.keys(TEMPLATE_DEFINITIONS) as TemplateKey[]).map((key) => {
              const def = TEMPLATE_DEFINITIONS[key];
              const custom = savedTemplateMap.get(key);
              return (
                <Link
                  key={key}
                  href={`/email-templates/${key}`}
                  className="flex items-center gap-4 rounded-lg border bg-card p-4 hover:bg-muted/40 transition-colors"
                >
                  <div className="flex-shrink-0 rounded-full bg-primary/10 p-2 text-primary">
                    <Mail className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{def.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{def.description}</p>
                    {custom ? (
                      <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" />
                        Customised
                        {custom.updated_by && ` · by ${custom.updated_by}`}
                        {custom.updated_at && ` · ${formatDistanceToNow(new Date(custom.updated_at), { addSuffix: true })}`}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground mt-1">Using default</p>
                    )}
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
