import { getSettings } from "@/lib/settings";

import { RegisterForm } from "./register-form";

/**
 * Public self-registration (gap 4) — the Neon app's /register, rebuilt.
 *
 * The middleware allow-lists this exact path, the same way /waiting-list is
 * allow-listed. Everything it does runs on the anon client.
 */

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Create an account",
  description: "Create an account for the club app.",
};

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ as?: string }>;
}) {
  const [s, params] = await Promise.all([getSettings(), searchParams]);
  // ?as=referee — the sign-in page's third door (Adam, 2026-09-01: "they should
  // be able to register as a referee too"). It is the same account and the same
  // form; what it adds is a request to hold the referee hat, which a club
  // administrator decides on in /approvals. Anything else in the parameter is
  // ignored rather than trusted, and the page is the ordinary one.
  return (
    <RegisterForm
      logoUrl={s.logo_url || null}
      logoAlt={s.logo_alt || "Club logo"}
      clubName={s.club_name || "AoM Sports Club"}
      asReferee={params.as === "referee"}
    />
  );
}
