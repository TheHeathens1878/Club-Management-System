import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** The club's own address: where every emailed link is meant to land. */
export const CANONICAL_SITE_URL = "https://portal.aomsportsclub.co.uk";

/**
 * The address links are built on where there is no request to read — an
 * email, a cron. `NEXT_PUBLIC_SITE_URL` names it, except that on production
 * a `*.vercel.app` value is the project's raw address, not the club's: the
 * variable has said that since the project was rebuilt on 2026-08-23, so
 * every confirmation email's "Open your booking portal" landed on a host
 * where the reader had no session and was asked to sign in again (Adam,
 * 2026-09-15). Production ignores such a value and uses the club's address.
 * Previews keep whatever they are given, so a preview's links stay on the
 * preview.
 */
export function siteUrlFrom(configured: string | undefined, vercelEnv: string | undefined): string | null {
  const url = (configured ?? "").trim().replace(/\/+$/, "");
  if (vercelEnv === "production" && (!url || /^https?:\/\/[^/]*\.vercel\.app$/i.test(url))) {
    return CANONICAL_SITE_URL;
  }
  return url || null;
}

export function getSiteUrl(): string {
  const url = siteUrlFrom(process.env.NEXT_PUBLIC_SITE_URL, process.env.VERCEL_ENV);
  if (!url) {
    throw new Error(
      "NEXT_PUBLIC_SITE_URL is not configured. Add it to your Vercel environment variables (e.g. https://portal.aomsportsclub.co.uk)."
    );
  }
  return url;
}

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function formatCurrency(pence: number | null | undefined): string {
  if (pence == null) return "—";
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
  }).format(pence / 100);
}

export function fullName(m: {
  title?: string | null;
  first_name?: string | null;
  surname?: string | null;
  known_as?: string | null;
}): string {
  const first = m.known_as || m.first_name || "";
  return [m.title, first, m.surname].filter(Boolean).join(" ").trim() || "Unknown";
}

export function ageFromDob(dob: string | null | undefined): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age >= 0 && age < 130 ? age : null;
}
