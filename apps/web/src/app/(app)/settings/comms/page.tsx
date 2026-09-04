import { redirect } from "next/navigation";

import { DeviceNotifications } from "@/components/notification-prompt";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSessionProfile, isCommittee } from "@/lib/auth";
import { getCurrentPersonId } from "@/lib/person";
import { createClient } from "@/lib/supabase/server";

import { COMMS_CHANNELS } from "@/lib/comms";

import {
  PreferencesForm,
  SuppressionsPanel,
  type PreferenceSet,
  type SuppressionRow,
} from "./comms-forms";

export const metadata = { title: "Communication preferences" };

/**
 * Communication preferences (PLAN.md P4.4).
 *
 * User-scoped client: `can_act_for()` in the preferences policy is what lets a
 * guardian set a child's preferences and stops anyone setting a stranger's.
 */
export default async function CommsSettingsPage() {
  const session = await getSessionProfile();
  if (!session) redirect("/login");

  const personId = await getCurrentPersonId();
  const committee = isCommittee(session.profile?.role);
  const supabase = await createClient();

  let preferenceSets: PreferenceSet[] = [];

  if (personId) {
    const { data: children } = await supabase
      .from("guardianships")
      .select("child_person_id,people!guardianships_child_person_id_fkey(first_name,last_name,preferred_name)")
      .eq("guardian_person_id", personId)
      .is("ended_at", null);

    const ids = [personId, ...(children ?? []).map((c) => c.child_person_id)];
    const { data: prefRows } = await supabase
      .from("comms_preferences")
      .select("person_id,channel,enabled")
      .in("person_id", ids);

    const byPerson = new Map<string, Record<string, boolean>>();
    for (const id of ids) {
      // The database's own default: everything on except SMS, which is opt-in.
      byPerson.set(id, Object.fromEntries(COMMS_CHANNELS.map((c) => [c, c !== "sms"])));
    }
    for (const row of prefRows ?? []) {
      const set = byPerson.get(row.person_id);
      if (set) set[row.channel] = row.enabled;
    }

    preferenceSets = [
      { personId, name: "You", channels: byPerson.get(personId) ?? {} },
      ...(children ?? []).map((child) => {
        const person = child.people;
        return {
          personId: child.child_person_id,
          name: person
            ? `${person.preferred_name || person.first_name} ${person.last_name}`.trim()
            : "Your child",
          channels: byPerson.get(child.child_person_id) ?? {},
        };
      }),
    ];
  }

  const { data: suppressionRows } = committee
    ? await supabase
        .from("comms_suppressions")
        .select("id,channel,address,reason,created_at")
        .order("created_at", { ascending: false })
        .limit(200)
    : { data: null };

  const suppressions: SuppressionRow[] = suppressionRows ?? [];

  return (
    <>
      <PageHeader
        title="Communication preferences"
        subtitle="How the club contacts you, and who it must not contact"
        back={committee ? { href: "/settings", label: "Settings" } : undefined}
      />

      <div className="p-4 space-y-4 max-w-3xl lg:p-6 lg:space-y-6">
        <Card>
          <CardHeader className="p-4 lg:p-6">
            <CardTitle className="text-base">Your channels</CardTitle>
            <p className="text-sm text-muted-foreground">
              Every message the club sends goes through one place, and that place checks these
              settings before anything leaves. As a parent or guardian you also set your children&apos;s.
            </p>
          </CardHeader>
          <CardContent className="space-y-4 p-4 pt-0 lg:p-6 lg:pt-0">
            {!personId && (
              <p className="text-sm text-muted-foreground">
                Your sign-in is not linked to a member record yet, so there are no preferences to set.
              </p>
            )}
            {preferenceSets.map((set) => (
              <PreferencesForm key={set.personId} preferences={set} />
            ))}
          </CardContent>
        </Card>

        {/* The device half of "Push notification" above. The checkbox is the
            member's standing preference and travels with them; this is whether
            THIS browser holds a live subscription. Both have to be on, and the
            component says so — a member whose preference is on and whose phone
            has never been asked is the commonest "I get nothing" report. */}
        {personId && <DeviceNotifications personId={personId} />}

        {committee && (
          <Card>
            <CardHeader className="p-4 lg:p-6">
              <CardTitle className="text-base">Suppression list</CardTitle>
              <p className="text-sm text-muted-foreground">
                A hard block, above preferences: nothing is sent to a suppressed address, not even
                transactional mail. Use it for bounces and complaints.
              </p>
            </CardHeader>
            <CardContent className="p-4 pt-0 lg:p-6 lg:pt-0">
              <SuppressionsPanel suppressions={suppressions} />
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
