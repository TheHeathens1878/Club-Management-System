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

export default async function RegisterPage() {
  const s = await getSettings();
  return (
    <RegisterForm
      logoUrl={s.logo_url || null}
      logoAlt={s.logo_alt || "Club logo"}
      clubName={s.club_name || "AoM Sports Club"}
    />
  );
}
