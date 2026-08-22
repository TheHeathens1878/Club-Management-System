import { redirect } from "next/navigation";
import { getSessionProfile } from "@/lib/auth";
import { getSettings } from "@/lib/settings";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const session = await getSessionProfile();
  if (!session) redirect("/login");

  const settings = await getSettings();

  return (
    <div className="min-h-screen bg-muted/20">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            {settings.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={settings.logo_url}
                alt={settings.logo_alt || "Club logo"}
                style={{ height: 36, maxWidth: 160, objectFit: "contain" }}
              />
            ) : (
              <span className="text-sm font-semibold">{settings.club_name}</span>
            )}
          </div>
          <form action="/auth/signout" method="post">
            <button type="submit" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8">{children}</main>
    </div>
  );
}
