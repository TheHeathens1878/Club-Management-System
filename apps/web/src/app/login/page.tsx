import { getSettings } from "@/lib/settings";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const s = await getSettings();
  return (
    <LoginForm
      logoUrl={s.logo_url || null}
      logoAlt={s.logo_alt || "Club logo"}
      clubName={s.club_name || "AoM Sports Club"}
      clubTagline={s.club_tagline || "Sign in to the function room system"}
    />
  );
}
