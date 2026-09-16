import { redirect } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { getSessionProfile } from "@/lib/auth";
import { getSettings } from "@/lib/settings";

/**
 * The hirer's own chrome (P8.9). Two bands, the same two the signed-in app
 * has: the club's brand and the way out on top, then the page's title.
 *
 * Until now the layout drew only the brand strip and `/portal` opened with a
 * floating `<h1>` of its own, so the one screen an outsider sees was the one
 * screen with no header band. The title moved up here because it is the same
 * on every page under `/portal` — the page beneath is then free to open with
 * the booking itself.
 */
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const session = await getSessionProfile();
  if (!session) redirect("/login");

  const settings = await getSettings();

  return (
    <div className="min-h-screen bg-muted/20">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            {settings.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={settings.logo_url}
                alt={settings.logo_alt || "Club logo"}
                style={{ height: 36, maxWidth: 160, objectFit: "contain" }}
              />
            ) : (
              <span className="truncate text-sm font-semibold">{settings.club_name}</span>
            )}
          </div>
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="touch -mr-2 inline-flex items-center rounded-md px-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      <div className="mx-auto max-w-3xl">
        <PageHeader
          title="Your bookings"
          subtitle={`${settings.club_name} · your deposit, your balance and any security deposit, all payable here.`}
        />
      </div>

      <main className="mx-auto max-w-3xl px-4 py-6 lg:py-8">{children}</main>
    </div>
  );
}
