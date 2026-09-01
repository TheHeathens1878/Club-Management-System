import Link from "next/link";
import { redirect } from "next/navigation";
import { Baby, Contact, UsersRound } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSessionProfile, isCommittee } from "@/lib/auth";
import { signPeoplePhotos } from "@/lib/avatars";
import { FamilyTreeView } from "@/components/family-tree-view";
import {
  familyTreePersonIds,
  isFamilyTreeEmpty,
  parseFamilyTree,
  type FamilyNode,
} from "@/lib/family-tree";
import { createClient } from "@/lib/supabase/server";

/**
 * Family linking (Adam, 2026-08-26) — "show you the family group you are
 * connected to in a hierarchical family tree. If an ex-spouse is also
 * registered as a guardian for the children, they shouldn't see any other
 * connected adults or children who aren't their own."
 *
 * A RENDERER, AND NOTHING ELSE. Every entitlement decision is the database's:
 * `my_family_tree()` (20260825420000) returns the caller's own three levels —
 * themselves, the children they are a LIVE guardian of, each of those
 * children's OTHER guardians, and the adults connected to the caller — and
 * this page draws exactly what came back. There is no filtering here, and
 * there is nothing here for a bug in this file to leak: the ex-spouse rule is
 * enforced by the shape of that function, where a co-guardian is a leaf and
 * nothing recurses out of them.
 *
 * PHOTOS. `signPeoplePhotos` is only ever handed rows the CALLER'S OWN
 * `people` read returned (lib/avatars.ts is emphatic about this), so the
 * `people` select below carries the caller's RLS unfiltered: their own row
 * (`people_self_read`), their live-guarded minor children (`people_guardian_read`)
 * and anyone else a policy already lets them see. A co-guardian's row is not
 * among them, so a co-parent shows as initials — which is the correct outcome
 * and not a missing image.
 *
 * NO DATES OF BIRTH. The function does not return one; the child's line shows
 * the age-group hint the family screens use in its place.
 */

export const dynamic = "force-dynamic";

/**
 * Where a row's name goes, or null for plain text.
 *
 * Only routes the caller can actually reach. `/people/[id]` bounces anyone who
 * is not committee straight back to the lobby, so it is offered only to a
 * committee reader; everyone else gets the screen that owns that kind of
 * person. A co-guardian has no screen of their own — the club holds their
 * record, the caller does not — so their name is plain text.
 */
function hrefFor(node: FamilyNode, committee: boolean): string | null {
  if (committee) return `/people/${node.personId}`;
  switch (node.relation) {
    case "self":
      return "/profile";
    case "child":
      return "/family";
    case "connected_adult":
      return "/connected-adults";
    default:
      return null;
  }
}

export default async function FamilyLinkingPage() {
  const session = await getSessionProfile();
  if (!session) redirect("/login");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_family_tree");
  const tree = parseFamilyTree(data ?? null);

  // The photo half. RLS answers this, not the page: whoever comes back gets
  // their picture, whoever does not gets initials.
  const personIds = familyTreePersonIds(tree);
  const { data: photoRows } =
    personIds.length > 0
      ? await supabase.from("people").select("id,photo_path").in("id", personIds)
      : { data: [] as { id: string; photo_path: string | null }[] };
  const photoUrls = await signPeoplePhotos(photoRows ?? []);

  const committee = isCommittee(session.profile?.role);

  return (
    <>
      <PageHeader
        title="Family linking"
        subtitle="The family group the club connects to your account"
      />

      <div className="space-y-6 p-4 lg:p-6">
        {error && (
          <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error.message}
          </p>
        )}

        <Card>
          <CardHeader className="p-4 lg:p-6">
            <CardTitle className="flex items-center gap-2 text-base">
              <UsersRound className="h-4 w-4" /> What this shows
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 p-4 pt-0 text-sm text-muted-foreground lg:p-6 lg:pt-0">
            <p>
              This is your family as the club records it: you, the children the club has you down
              as a guardian for, the other people it has down as guardians of those same children,
              and the adults connected to your account.
            </p>
            {/* The sentence that stops a gap reading as an error. */}
            <p>
              It shows only the people the club connects to <strong>you</strong>. Someone else who
              shares a child with you sees their own version of this page, and it will not be the
              same as yours — so a name you expected and cannot see here is not necessarily a
              mistake. It is read-only: to change who is linked to whom, ask a club administrator.
            </p>
            <p>
              Ages are shown as an age group rather than a date of birth, on purpose.
            </p>
          </CardContent>
        </Card>

        {isFamilyTreeEmpty(tree) ? (
          <Card>
            <CardContent className="space-y-4 py-8 text-center">
              <p className="text-sm text-muted-foreground">
                The club has no one linked to your account yet — no children, and no connected
                adults. That is quite normal for a new account, and nothing is wrong.
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                <Link
                  href="/connected-adults"
                  className={
                    buttonVariants({ variant: "outline", size: "sm" }) + " min-h-[44px] lg:min-h-0"
                  }
                >
                  <Contact className="mr-2 h-4 w-4" /> Connect adults
                </Link>
                <Link
                  href="/family"
                  className={
                    buttonVariants({ variant: "outline", size: "sm" }) + " min-h-[44px] lg:min-h-0"
                  }
                >
                  <Baby className="mr-2 h-4 w-4" /> Connect children
                </Link>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader className="p-4 lg:p-6">
              <CardTitle className="text-base">Your family</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0 lg:p-6 lg:pt-0">
              <FamilyTreeView
                tree={tree}
                photoUrls={photoUrls}
                hrefFor={(node) => hrefFor(node, committee)}
              />
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
