import Link from "next/link";
import { redirect } from "next/navigation";
import { Images } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSessionProfile, isCommittee } from "@/lib/auth";
import { isClubAdmin } from "@/lib/person";
import { createClient } from "@/lib/supabase/server";

import { AlbumForm, type Option } from "./album-form";

export const metadata = { title: "Media" };

/**
 * Albums (PLAN.md P4.5).
 *
 * User-scoped client: `media_albums` is readable through `can_view_album()`,
 * which is a different answer for an administrator, a team parent and a
 * passer-by. The album metadata is all this page shows — the photos
 * themselves are consent-filtered one album at a time.
 */
export default async function MediaPage() {
  const session = await getSessionProfile();
  if (!session) redirect("/login");

  const supabase = await createClient();
  const [{ data: albums, error }, { data: teams }, { data: seasons }] = await Promise.all([
    supabase
      .from("media_albums")
      .select("id,title,description,visibility,created_at,teams(name),seasons(name)")
      .order("created_at", { ascending: false })
      .limit(100),
    supabase.from("teams").select("id,name").eq("active", true).order("name"),
    supabase.from("seasons").select("id,name").order("starts_on", { ascending: false }),
  ]);

  // Who may create one: the database will refuse anyone else anyway (album
  // writes are club_admin or the team's staff), but there is no point showing
  // a form that cannot succeed.
  const canCreate = isCommittee(session.profile?.role) || (await isClubAdmin());

  const teamOptions: Option[] = teams ?? [];
  const seasonOptions: Option[] = seasons ?? [];

  return (
    <>
      <PageHeader title="Media" subtitle="Photo albums, with consent enforced at the query" />

      <div className="p-4 space-y-6 lg:p-6">
        {error && (
          <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error.message}
          </p>
        )}

        {/* Two albums to a row on a phone, as the desktop grid already is. */}
        <div className="grid grid-cols-2 gap-3">
          {(albums ?? []).length === 0 && (
            <Card className="col-span-2">
              <CardContent className="p-6 text-center text-sm text-muted-foreground">
                No albums you can see.
              </CardContent>
            </Card>
          )}
          {(albums ?? []).map((album) => (
            <Link
              key={album.id}
              href={`/media/${album.id}`}
              className="rounded-lg border bg-card p-3 transition-colors hover:bg-secondary/50 sm:p-4"
            >
              {/* The pill sits under the title until there is room beside it. */}
              <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:justify-between sm:gap-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    <Images className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 break-words">{album.title}</span>
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {album.teams?.name ?? "No team"}
                    {album.seasons?.name ? ` · ${album.seasons.name}` : ""}
                  </p>
                </div>
                <Badge variant="outline" className="self-start">{album.visibility}</Badge>
              </div>
              {album.description && (
                <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{album.description}</p>
              )}
            </Link>
          ))}
        </div>

        {canCreate && (
          <Card className="border-dashed">
            <CardHeader className="p-4 lg:p-6">
              <CardTitle className="text-base">New album</CardTitle>
              <p className="text-sm text-muted-foreground">
                An album&apos;s visibility decides which photo consent every young person in it must
                have. Photos of a child without that consent are excluded from the gallery and from
                bulk exports — not hidden by the page, excluded by the query.
              </p>
            </CardHeader>
            <CardContent className="p-4 pt-0 lg:p-6 lg:pt-0">
              <AlbumForm teams={teamOptions} seasons={seasonOptions} />
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
