import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, Users } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSessionProfile } from "@/lib/auth";
import { getCurrentPersonId } from "@/lib/person";
import { createClient } from "@/lib/supabase/server";

import { NewMessageForm, type PersonOption } from "./new-message-form";

/** Long enough for a club roster, short enough not to be a data dump. */
const PEOPLE_LIMIT = 300;

export default async function NewMessagePage() {
  const session = await getSessionProfile();
  if (!session) redirect("/login");

  const personId = await getCurrentPersonId();
  if (!personId) redirect("/messages");

  const supabase = await createClient();

  const [{ data: peopleRows }, { data: roomRows }] = await Promise.all([
    supabase
      .from("people")
      .select("id,first_name,last_name,preferred_name")
      .order("last_name")
      .limit(PEOPLE_LIMIT),
    supabase
      .from("conversation_participants")
      .select("conversation_id,left_at,conversations(id,type,title,team_id)")
      .eq("person_id", personId)
      .is("left_at", null),
  ]);

  const people: PersonOption[] = (peopleRows ?? [])
    .filter((p) => p.id !== personId)
    .map((p) => ({ id: p.id, name: `${p.preferred_name || p.first_name} ${p.last_name}`.trim() }));

  const rooms = (roomRows ?? [])
    .map((r) => r.conversations)
    .filter((c): c is NonNullable<typeof c> => !!c && (c.type === "team" || c.type === "announcement"));

  return (
    <>
      <PageHeader
        title="New message"
        subtitle="Start a direct message or a group, or open one of your team rooms"
        action={
          <Link
            href="/messages"
            className="inline-flex min-h-[44px] items-center gap-1 text-sm text-muted-foreground hover:underline lg:min-h-0"
          >
            <ChevronLeft className="h-4 w-4" /> All messages
          </Link>
        }
      />

      <div className="space-y-6 p-4 max-w-2xl lg:p-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Message someone</CardTitle>
            <p className="text-sm text-muted-foreground">
              A conversation between an adult and a child needs the child&apos;s parent or guardian in
              it. If the club&apos;s rules do not allow the conversation you are trying to start, the
              refusal below will say which rule and why.
            </p>
          </CardHeader>
          <CardContent>
            <NewMessageForm people={people} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="h-4 w-4" /> Your team rooms
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Team rooms manage their own membership — players, staff and the guardians of any
              young players are added automatically.
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {rooms.length === 0 && (
              <p className="text-sm text-muted-foreground">You are not in a team room yet.</p>
            )}
            {rooms.map((room) => (
              <Link
                key={room.id}
                href={`/messages/${room.id}`}
                className="flex min-h-[44px] items-center rounded-lg border p-3 text-sm transition-colors hover:bg-secondary/50"
              >
                {room.title || (room.type === "announcement" ? "Announcements" : "Team room")}
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
