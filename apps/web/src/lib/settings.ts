import { cache } from "react";

import { createAdminClient } from "@/lib/supabase/admin";

export type SiteSettings = {
  club_name: string;
  club_tagline: string;
  club_description: string;
  login_subtitle: string;
  login_no_email: string;
  contact_email: string;
  logo_url: string;
  logo_alt: string;
  color_theme: string;
  logo_height: string;
  logo_max_width: string;
  logo_object_fit: string;
  home_benefit_1_title: string;
  home_benefit_1_desc: string;
  home_benefit_2_title: string;
  home_benefit_2_desc: string;
  home_benefit_3_title: string;
  home_benefit_3_desc: string;
  deposit_default_pence: string;
  deposit_window_days: string;
  balance_reminder_days: string;
  auto_cancel_unpaid: string;            // "true" | "false"
  notify_booking_request: string;        // JSON array of user ids
  notify_cancellation: string;           // JSON array of user ids
  notify_auto_cancellation: string;      // JSON array of user ids
};

const DEFAULTS: SiteSettings = {
  club_name: "AoM Sports Club",
  club_tagline: "Teams, fixtures, messages, payments — and function room hire",
  club_description:
    "Members, parents, coaches and committee sign in for club life. Our function room is available for private hire — parties, meetings and celebrations.",
  login_subtitle: "Sign in to manage room bookings",
  login_no_email: "Contact the club to get access.",
  contact_email: "bookings@aomsportsclub.co.uk",
  logo_url: "",
  logo_alt: "Club logo",
  color_theme: "blue",
  logo_height: "80",
  logo_max_width: "300",
  logo_object_fit: "contain",
  home_benefit_1_title: "A welcoming community",
  home_benefit_1_desc: "Established in Sale, we bring together current and former service personnel and their families in a warm and friendly environment.",
  home_benefit_2_title: "Events & social calendar",
  home_benefit_2_desc: "From quiz nights and charity events to celebration dinners, there's always something happening at the club.",
  home_benefit_3_title: "How to join",
  home_benefit_3_desc: "Membership is by proposal from an existing member. Apply online and we'll guide you through the process step by step.",
  deposit_default_pence: "10000",
  deposit_window_days: "7",
  balance_reminder_days: "14",
  auto_cancel_unpaid: "true",
  notify_booking_request: "[]",
  notify_cancellation: "[]",
  notify_auto_cancellation: "[]",
};

/**
 * `cache()`d for the same reason as `getSessionProfile`: the root layout asks
 * on every request, and the pages that theme an email or read a deposit
 * default ask again in the same render. One request, one read — the table is
 * a handful of rows and changes only when an administrator saves Settings, so
 * the per-request answer is always fresh enough.
 */
export const getSettings = cache(async function getSettings(): Promise<SiteSettings> {
  try {
    const admin = createAdminClient();
    const { data } = await admin.from("site_settings").select("key,value");
    if (!data) return DEFAULTS;
    const map = Object.fromEntries(data.map((r) => [r.key, r.value]));
    return { ...DEFAULTS, ...map } as SiteSettings;
  } catch {
    return DEFAULTS;
  }
});

export const THEMES = {
  // The club's own palette — crest orange on warm ink and paper, from the
  // linked Claude Design project. This is the default and what globals.css
  // ships; picking it emits no override at all.
  crest:  { label: "Crest (club default)", primary: "12 75% 44%",  accent: "12 76% 51%",  hex: "#C23D1C" },
  blue:   { label: "Blue",                 primary: "221 83% 41%", accent: "199 89% 48%", hex: "#1249bf" },
  green:  { label: "Green",                primary: "142 71% 45%", accent: "158 64% 52%", hex: "#21c45d" },
  purple: { label: "Purple",               primary: "262 83% 58%", accent: "280 87% 65%", hex: "#7c3bed" },
  navy:   { label: "Navy",                 primary: "220 70% 28%", accent: "199 89% 48%", hex: "#153779" },
  red:    { label: "Crimson",              primary: "0 72% 51%",   accent: "24 89% 48%",  hex: "#dc2828" },
} as const;

export async function getEmailBrandColor(): Promise<string> {
  const settings = await getSettings();
  return THEMES[settings.color_theme as ThemeKey]?.hex ?? THEMES.crest.hex;
}

export type ThemeKey = keyof typeof THEMES;

export function themeVars(theme: string): string {
  const t = THEMES[theme as ThemeKey] ?? THEMES.crest;
  return `--primary:${t.primary};--ring:${t.primary};--accent:${t.accent};`;
}

// Resolve the staff users selected for a notification setting (JSON array of
// user ids) to their email addresses. If none are selected, falls back to all
// super users + committee so notifications are never silently lost.
export async function getRecipientEmails(settingKey: string): Promise<string[]> {
  const admin = createAdminClient();
  const { data: setting } = await admin
    .from("site_settings")
    .select("value")
    .eq("key", settingKey)
    .maybeSingle();

  let userIds: string[] = [];
  if (setting?.value) {
    try { userIds = JSON.parse(setting.value); } catch { /* ignore */ }
  }

  if (userIds.length === 0) {
    const { data: profiles } = await admin
      .from("profiles")
      .select("id")
      .in("role", ["super_user", "committee"]);
    userIds = (profiles ?? []).map((p) => p.id as string);
  }

  if (userIds.length === 0) return [];

  const wanted = new Set(userIds);
  const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
  return (list?.users ?? [])
    .filter((u) => wanted.has(u.id) && !!u.email)
    .map((u) => u.email as string);
}
