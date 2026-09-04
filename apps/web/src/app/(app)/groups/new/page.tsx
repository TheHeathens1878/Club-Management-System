import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSessionProfile } from "@/lib/auth";
import { getCurrentPersonId, isClubAdmin } from "@/lib/person";

import { loadAttachmentOptions } from "../attachment-options";
import { NewGroupForm } from "./new-group-form";

export const metadata = { title: "New group" };

/**
 * `/groups/new` — set up a group chat.
 *
 * Same guard as `/groups`. The group itself is created under the caller's own
 * client by `createGroup`, so the SG-1 rules apply to an administrator exactly
 * as they apply to anybody else.
 */
export default async function NewGroupPage() {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  if (!(await isClubAdmin())) redirect("/messages");

  const personId = await getCurrentPersonId();
  if (!personId) redirect("/groups");

  const { venues, teams } = await loadAttachmentOptions();

  return (
    <>
      <PageHeader
        title="New group"
        subtitle="A group chat for a venue, a team, or anything else"
        action={
          <Link
            href="/groups"
            className="inline-flex min-h-[44px] items-center gap-1 text-sm text-muted-foreground hover:underline lg:min-h-0"
          >
            <ChevronLeft className="h-4 w-4" /> All groups
          </Link>
        }
      />

      <div className="max-w-2xl p-4 lg:p-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Set up a group</CardTitle>
            <p className="text-sm text-muted-foreground">
              Groups work like any other conversation in the club: only the people in one can read
              it, and the club&apos;s safeguarding rules are checked as each person is added. A
              conversation between an adult and a child needs the child&apos;s parent or guardian in
              it.
            </p>
          </CardHeader>
          <CardContent>
            <NewGroupForm venues={venues} teams={teams} myPersonId={personId} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
