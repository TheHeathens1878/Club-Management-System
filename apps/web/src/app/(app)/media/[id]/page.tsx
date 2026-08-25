import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft, Download, EyeOff } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSessionProfile, isCommittee } from "@/lib/auth";
import { signMediaPaths } from "@/lib/media";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import { TagForm, UploadPanel, type TagCandidate } from "./album-client";

/**
 * One album (PLAN.md P4.5 — SAFEGUARDING.md SG-5).
 *
 * The gallery is `media_gallery()` called through the USER's client: it is the
 * consent filter, and nothing on this page reaches around it. Signed URLs are
 * then minted with the service key for exactly the paths that call returned —
 * see lib/media.ts.
 *
 * The one other service-key read is the *untagged* list, and it is narrow on
 * purpose: staff can only reach it after the user client has confirmed they
 * staff this album's team, it never shows an item that has been tagged and
 * filtered out (only ones nobody has confirmed yet), and it exists so that the
 * "fail closed when untagged" rule is visible to the person who has to fix it
 * rather than being a silent disappearance.
 */
export default async function AlbumPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionProfile();
  if (!session) redirect("/login");

  const { id } = await params;
  const supabase = await createClient();

  const { data: album } = await supabase
    .from("media_albums")
    .select("id,title,description,visibility,team_id,teams(name)")
    .eq("id", id)
    .maybeSingle();
  if (!album) notFound();

  const { data: gallery, error: galleryError } = await supabase.rpc("media_gallery", { p_album_id: id });
  const items = gallery ?? [];

  const teamStaff = album.team_id
    ? (await supabase.rpc("is_team_staff", { p_team_id: album.team_id })).data === true
    : false;
  const canManage = isCommittee(session.profile?.role) || teamStaff;

  const signed = await signMediaPaths(items.map((item) => item.storage_path));

  // Untagged items: staff-only, service-key read, justified in the header note.
  let untagged: { id: string; storage_path: string; caption: string | null }[] = [];
  let candidates: TagCandidate[] = [];
  if (canManage) {
    const admin = createAdminClient();
    const { data: pending } = await admin
      .from("media_items")
      .select("id,storage_path,caption")
      .eq("album_id", id)
      .eq("subjects_confirmed", false)
      .is("redacted_at", null)
      .order("created_at", { ascending: false })
      .limit(50);
    untagged = pending ?? [];

    if (album.team_id) {
      const { data: members } = await supabase
        .from("team_memberships")
        .select("person_id,people(first_name,last_name,preferred_name)")
        .eq("team_id", album.team_id)
        .is("left_at", null);
      candidates = (members ?? []).map((member) => ({
        id: member.person_id,
        name: member.people
          ? `${member.people.preferred_name || member.people.first_name} ${member.people.last_name}`.trim()
          : "Club member",
      }));
    }
  }

  const untaggedSigned = await signMediaPaths(untagged.map((item) => item.storage_path));

  return (
    <>
      <PageHeader
        title={album.title}
        subtitle={`${album.visibility} album${album.teams?.name ? ` · ${album.teams.name}` : ""}`}
        action={
          <div className="flex items-center gap-3">
            {canManage && (
              <a href={`/media/${album.id}/export`} className={buttonVariants({ variant: "outline", size: "sm" }) + " gap-2"}>
                <Download className="h-4 w-4" /> Export
              </a>
            )}
            <Link href="/media" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline">
              <ChevronLeft className="h-4 w-4" /> Albums
            </Link>
          </div>
        }
      />

      <div className="p-6 space-y-6">
        {galleryError && (
          <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {galleryError.message}
          </p>
        )}

        {album.description && <p className="text-sm text-muted-foreground">{album.description}</p>}

        <div className="grid gap-3 sm:grid-cols-3">
          {items.length === 0 && (
            <Card className="sm:col-span-3">
              <CardContent className="p-6 text-center text-sm text-muted-foreground">
                Nothing to show in this album. Photos appear once they are tagged and everyone in
                them has consented for this kind of album.
              </CardContent>
            </Card>
          )}
          {items.map((item) => {
            const url = signed.get(item.storage_path);
            return (
              <figure key={item.id} className="overflow-hidden rounded-lg border bg-card">
                {url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={url} alt={item.caption ?? ""} className="h-40 w-full object-cover" />
                ) : (
                  <div className="flex h-40 w-full items-center justify-center bg-muted text-xs text-muted-foreground">
                    Preview unavailable
                  </div>
                )}
                {item.caption && (
                  <figcaption className="px-3 py-2 text-xs text-muted-foreground">{item.caption}</figcaption>
                )}
              </figure>
            );
          })}
        </div>

        {canManage && (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Add photos</CardTitle>
              </CardHeader>
              <CardContent>
                <UploadPanel albumId={album.id} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <EyeOff className="h-4 w-4" /> Needs tagging
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Until someone confirms who is in a photo it is hidden from the gallery and from
                  exports. That is the rule failing closed, not a fault.
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                {untagged.length === 0 && (
                  <p className="text-sm text-muted-foreground">Everything in this album has been tagged.</p>
                )}
                {untagged.map((item) => {
                  const url = untaggedSigned.get(item.storage_path);
                  return (
                    <div key={item.id} className="flex flex-wrap gap-4 rounded-lg border p-3">
                      <div className="w-40 shrink-0">
                        {url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={url} alt={item.caption ?? ""} className="h-28 w-40 rounded object-cover" />
                        ) : (
                          <div className="flex h-28 w-40 items-center justify-center rounded bg-muted text-xs text-muted-foreground">
                            No preview
                          </div>
                        )}
                        <Badge variant="warning" className="mt-2">
                          needs tagging — hidden
                        </Badge>
                      </div>
                      <div className="min-w-[220px] flex-1">
                        <TagForm albumId={album.id} itemId={item.id} candidates={candidates} selected={[]} />
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </>
  );
}
