import { redirect } from "next/navigation";
import { MessageSquare } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { getSessionProfile } from "@/lib/auth";
import { getCurrentPersonId } from "@/lib/person";

export const metadata = { title: "Messages" };

/**
 * /messages — the right pane when nothing is open yet. The conversation rail
 * beside it comes from the layout; on a phone the rail IS this page, so the
 * placeholder only draws on large screens.
 */
export default async function MessagesPage() {
  const session = await getSessionProfile();
  if (!session) redirect("/login");

  const personId = await getCurrentPersonId();
  if (!personId) {
    return (
      <>
        <PageHeader title="Messages" subtitle="Club conversations" />
        <div className="max-w-2xl p-4 lg:p-6">
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">
              Your sign-in is not linked to a member record yet, so there are no conversations to
              show. An administrator can link it on your member profile.
            </CardContent>
          </Card>
        </div>
      </>
    );
  }

  return (
    <div className="hidden min-h-full items-center justify-center p-6 lg:flex">
      <div className="text-center text-muted-foreground">
        <MessageSquare className="mx-auto h-8 w-8 opacity-40" aria-hidden />
        <p className="mt-3 text-sm">Pick a conversation to read it here.</p>
      </div>
    </div>
  );
}
