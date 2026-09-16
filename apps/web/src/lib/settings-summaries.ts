/**
 * The seven Settings folds, each said in one closed line (P8.10).
 *
 * A `FoldCard` only earns its place if the closed row answers the question
 * that made somebody open it. "Payments" is not an answer; "Deposit: half the
 * total, up to £100 · security £100 · reminders 14/7/0 days" is, and a super
 * user who came to check the cap never has to open the fold at all.
 *
 * Every figure here is the CLUB'S setting, read from `site_settings` by the
 * page and handed in. Where a setting has never been given a value the line
 * says so — "Not set" for a thing that genuinely has none, "Using defaults"
 * for a thing that is quietly working off the built-in answer — rather than
 * printing a zero and letting a reader think the club chose it.
 *
 * Pure: `SiteSettings` is imported as a TYPE ONLY, so nothing drags
 * `lib/settings.ts` (and its admin client) into a client bundle.
 */

import type { SiteSettings } from "@/lib/settings";
import { formatCurrency } from "@/lib/utils";

/**
 * The theme names `THEMES` in `lib/settings.ts` gives, kept here as labels so
 * this module stays importable from a client component. An unknown key falls
 * back to the key itself rather than pretending to know it.
 */
const THEME_LABELS: Record<string, string> = {
  crest: "Crest",
  blue: "Blue",
  green: "Green",
  purple: "Purple",
  navy: "Navy",
  red: "Crimson",
};

/**
 * The balance chase runs two weeks out, one week out and on the due day
 * (`api/cron/payment-reminders`, Adam 2026-09-15). The bands are the cron's,
 * not a setting, so the line states them rather than inventing a figure.
 */
const BALANCE_CHASE_DAYS = "14/7/0";

export type SettingsCounts = {
  /** Every account in `auth.users`. */
  accounts: number;
  committee: number;
  superUsers: number;
  /** Active rows on the public booking page. */
  faqs: number;
  /** Distinct staff picked on any of the three notify settings. */
  notifyRecipients: number;
  /** Rows in `email_templates` — the ones a super user has customised. */
  customTemplates: number;
  /** Everything in `TEMPLATE_DEFINITIONS`. */
  totalTemplates: number;
};

export type SettingsSummaries = {
  general: string;
  branding: string;
  payments: string;
  notifications: string;
  users: string;
  faqs: string;
  emailTemplates: string;
};

/** "1 account" / "14 accounts" — the club is small enough for the singular to show up. */
function count(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** A settings value that was never filled in reads as absent, not as "". */
function valueOf(raw: string | null | undefined): string | null {
  const text = (raw ?? "").trim();
  return text === "" ? null : text;
}

function pence(raw: string | null | undefined): number {
  const n = Number(valueOf(raw) ?? "");
  return Number.isFinite(n) ? n : 0;
}

/** "half the total, up to £100" — the deposit rule as the fold says it. */
function depositLine(settings: SiteSettings): string | null {
  const percent = Number(valueOf(settings.deposit_percent) ?? "");
  const cap = pence(settings.deposit_default_pence);
  if (!Number.isFinite(percent) || percent <= 0) return null;
  const share =
    percent === 50
      ? "half the total"
      : percent === 100
        ? "the total in full"
        : `${percent}% of the total`;
  return cap > 0 ? `Deposit: ${share}, up to ${formatCurrency(cap)}` : `Deposit: ${share}`;
}

/**
 * One closed-fold line per section, in the order `/settings` shows them.
 */
export function settingsSummaries(
  settings: SiteSettings,
  counts: SettingsCounts,
): SettingsSummaries {
  // General — who the club is and where its booking email lands.
  const clubName = valueOf(settings.club_name);
  const contactEmail = valueOf(settings.contact_email);
  const general =
    clubName && contactEmail
      ? `${clubName} · ${contactEmail}`
      : (clubName ?? contactEmail ?? "Not set");

  // Branding — the logo and the colour, the two things a reader can check
  // without opening anything.
  const logo = valueOf(settings.logo_url);
  const themeKey = valueOf(settings.color_theme);
  const themeLabel = themeKey ? (THEME_LABELS[themeKey] ?? themeKey) : null;
  const branding = logo
    ? themeLabel
      ? `Logo set · ${themeLabel} colours`
      : "Logo set"
    : themeLabel
      ? `No logo · ${themeLabel} colours`
      : "Using defaults";

  // Payments — the deposit rule, the security deposit and when the balance
  // is chased. The three figures the desk is asked about most.
  const deposit = depositLine(settings);
  const security = pence(settings.security_deposit_default_pence);
  const paymentParts = [
    deposit,
    security > 0 ? `security ${formatCurrency(security)}` : null,
    `reminders ${BALANCE_CHASE_DAYS} days`,
  ].filter((part): part is string => part !== null);
  const payments = deposit === null ? "Not set" : paymentParts.join(" · ");

  // Email notifications — who is copied in. Nobody picked is not nobody
  // emailed: `getRecipientEmails()` falls back to super users and committee,
  // and the line says so rather than reading as a hole.
  const notifications =
    counts.notifyRecipients > 0
      ? `${count(counts.notifyRecipients, "member of staff", "staff")} copied in`
      : "Nobody picked — super users and committee are copied in";

  // Users — accounts, and the two roles worth knowing the count of.
  const users =
    counts.accounts === 0
      ? "No accounts"
      : [
          count(counts.accounts, "account"),
          `${counts.committee} committee`,
          count(counts.superUsers, "super user"),
        ].join(" · ");

  // FAQs — what the public booking page is showing.
  const faqs =
    counts.faqs === 0
      ? "None yet"
      : `${count(counts.faqs, "question")} on the public page`;

  // Email templates — how much of the club's own wording is in use.
  const emailTemplates =
    counts.customTemplates === 0
      ? "Using defaults"
      : `${counts.customTemplates} of ${counts.totalTemplates} customised`;

  return { general, branding, payments, notifications, users, faqs, emailTemplates };
}
