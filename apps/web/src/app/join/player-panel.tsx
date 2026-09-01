"use client";

/**
 * One player's registration — the health questions, the emergency contacts,
 * the team choice and whatever else the club's registration builder currently
 * asks. Lifted out of the wizard when joining became four steps
 * (2026-09-01); the panel itself is unchanged.
 */

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Check } from "lucide-react";
import { EmergencyContactsFields, type LeadContact } from "@/components/emergency-contacts-fields";
import { QuestionBlock } from "@/components/registration-question-block";
import { TeamChoiceFields } from "@/components/registration-team-choice";
import type { RegistrationQuestion } from "@/lib/registration-questions";
import { NO_WAITING_LIST_MESSAGE } from "@/lib/waiting-list";

import type { JoinTeamOption } from "./actions";
import type { HouseholdPerson } from "./people-step";

export type PlayerOutcome = "team" | "waiting_list" | "no_team";

export const OUTCOME_LABELS: Record<PlayerOutcome, string> = {
  team: "Team chosen — the club will confirm the registration",
  waiting_list: "Added to the waiting list",
  no_team: "No team yet — the club will be in touch",
};

export function PlayerPanel({
  player,
  lead,
  questions,
  teams,
  openAgeGroups,
  isAdmin,
  outcome,
  error,
  onClearError,
  pending,
  onSubmit,
}: {
  player: HouseholdPerson;
  /** The registrant, offered as "I am the first emergency contact" for a child. */
  lead: LeadContact | null;
  questions: RegistrationQuestion[];
  teams: JoinTeamOption[];
  openAgeGroups: string[];
  isAdmin: boolean;
  outcome?: PlayerOutcome;
  error?: string;
  /** Drop the message as soon as the reader changes what it was about. */
  onClearError: () => void;
  pending: boolean;
  onSubmit: (formData: FormData) => void;
}) {
  if (outcome) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 p-4 text-sm">
          <Check className="h-4 w-4 text-emerald-600" />
          <span className="font-medium">
            {player.firstName} {player.lastName}:
          </span>{" "}
          {OUTCOME_LABELS[outcome]}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Player details — {player.firstName} {player.lastName}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Health questions and an emergency contact are required for everyone who plays.
        </p>
      </CardHeader>
      <CardContent>
        <form
          action={onSubmit}
          className="space-y-4"
          onChange={() => {
            if (error) onClearError();
          }}
        >
          {/* The two bands and the sex rule, applied where the choice is
              made (Adam, 2026-08-26) — and re-applied by
              `registrations_guard()` when the row is written. The "no team
              yet" line is not a team, so it survives the narrowing: no open
              age group means no waiting list to join (Adam, 2026-08-25), but
              the choice still lands as a team-less registration the club
              follows up. */}
          <TeamChoiceFields
            idPrefix={`join-${player.personId}`}
            teamFieldName="team_choice"
            teams={teams}
            dob={player.dob || null}
            recordedSex={player.sex}
            isAdmin={isAdmin}
            firstName={player.firstName}
            extraOption={{
              value: "waiting_list",
              label:
                openAgeGroups.length > 0
                  ? "No team yet — join the waiting list"
                  : "No team yet — the club will be in touch",
            }}
          />
          <p className="text-xs text-muted-foreground">
            {openAgeGroups.length > 0
              ? `Waiting list currently open for: ${openAgeGroups.join(", ")}`
              : NO_WAITING_LIST_MESSAGE}
          </p>

          {/* Emergency contacts are the person's, not the form's (Adam,
              2026-08-25): a fixed block written to the player's record, ahead
              of whatever the builder asks. */}
          <EmergencyContactsFields
            idPrefix={`join-${player.personId}`}
            initial={[]}
            lead={lead}
            personName={player.firstName}
          />

          {questions.map((question) => (
            <QuestionBlock key={question.id} question={question} player={player} />
          ))}

          {questions.length === 0 && (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="terms_accepted" value="yes" required className="mt-1 h-4 w-4" />
              <span>The details are correct and I accept the club&rsquo;s terms.</span>
            </label>
          )}

          {error && (
            <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2">
              <p className="text-sm text-destructive">{error}</p>
              <p className="mt-1 text-xs text-destructive/80">
                {player.firstName} is not saved yet, so the registration cannot be sent. Put it
                right above and press Save player again.
              </p>
            </div>
          )}
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Saving…" : "Save player"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
