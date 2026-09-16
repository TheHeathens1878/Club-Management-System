/**
 * The two folds with something to explain: which pitches are on this ground,
 * and who its coaches' group has in it. Server components — they only draw
 * what the page has already read — kept out of `page.tsx` so the page stays
 * what it should be: the ground, its season, and a list of the folds under
 * it.
 */

import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Callout } from "@/components/ui/callout";
import { nameOf } from "@/lib/person";

import { AddPitchForm } from "./add-pitch-form";
import { AttachPitchForm, DetachPitchForm } from "./pitch-venue-forms";

export type VenuePitch = {
  id: string;
  name: string;
  active: boolean;
  for_matches: boolean;
  for_training: boolean;
};

export function PitchesFold({
  venueId,
  forTraining,
  forMatches,
  here,
  elsewhere,
}: {
  venueId: string;
  forTraining: boolean;
  forMatches: boolean;
  here: VenuePitch[];
  /** Pitches on no venue, or on another one. */
  elsewhere: { id: string; name: string; currentVenue: string | null }[];
}) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Which pitches are here is what decides who is in the coaches group: a team&rsquo;s home pitch,
        a fixture allocated to one, or a training session on one all count as playing here. Moving a
        pitch moves those coaches with it.
      </p>
      {here.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No pitches on this ground yet, so nothing links a team to it and the coaches group is
          empty.
        </p>
      ) : (
        <div className="space-y-2">
          {here.map((pitch) => (
            <div key={pitch.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Link href="/pitches/manage" className="text-sm font-medium underline underline-offset-2 hover:text-primary">
                  {pitch.name}
                </Link>
                {!pitch.active ? <Badge variant="outline">Out of use</Badge> : null}
                <Badge variant="outline">
                  {pitch.for_matches && pitch.for_training
                    ? "Matches & training"
                    : pitch.for_matches
                      ? "Matches"
                      : "Training"}
                </Badge>
              </div>
              <DetachPitchForm venueId={venueId} pitch={pitch} />
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-start gap-3">
        <AddPitchForm venueId={venueId} forTraining={forTraining && !forMatches} />
      </div>
      <AttachPitchForm venueId={venueId} candidates={elsewhere} />
    </div>
  );
}

export function CoachesFold({
  inGroup,
  waiting,
  names,
}: {
  inGroup: { person_id: string }[];
  /** Working here, and out of the group — every one of them for want of a date of birth. */
  waiting: { person_id: string }[];
  names: Map<string, string>;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Worked out from the teams that play here, and kept in step on its own. Nobody is added or
        removed by hand.
      </p>
      {inGroup.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nobody yet. A coach appears here as soon as one of their teams has a home pitch, a fixture
          or a training session on this ground.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {inGroup.map((row) => (
            <Badge key={row.person_id} variant="muted">
              {nameOf(names, row.person_id)}
            </Badge>
          ))}
        </div>
      )}

      {/* The ones the group will not take. Named rather than quietly absent:
          every one of them is a date of birth the club has not got, and that
          is a thing an administrator can actually fix. */}
      {waiting.length > 0 ? (
        <Callout
          tone="warning"
          title={
            waiting.length === 1
              ? "One coach here is not in the group"
              : `${waiting.length} coaches here are not in the group`
          }
        >
          <div className="mt-1.5 flex flex-wrap gap-2">
            {waiting.map((row) => (
              <Link key={row.person_id} href={`/people/${row.person_id}`}>
                <Badge variant="outline" className="hover:bg-secondary">
                  {nameOf(names, row.person_id)}
                </Badge>
              </Link>
            ))}
          </div>
          <p className="mt-2 text-xs">
            A venue&rsquo;s coaches group admits adults only, and the club counts an unknown date of
            birth as a minor. Each of these is waiting on a date of birth — they join the moment the
            club has one, and the app asks them for it at their next sign-in.
          </p>
        </Callout>
      ) : null}
    </div>
  );
}
