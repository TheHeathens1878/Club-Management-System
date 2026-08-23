/**
 * What a group conversation is *about*.
 *
 * `conversations` carries three mutually-considered ways of saying it, added
 * by 20260824250000_group_scopes.sql on top of the team room's `team_id`:
 *
 *   · `resource_id`  — a venue, pitch or the function room (the club owner's
 *                      first ask: "attached to venues initially");
 *   · `team_id`      — the team, for a group that shadows one;
 *   · `scope_label`  — free text for anything else ("Presentation night",
 *                      "Minibus rota"), display-only.
 *
 * The database allows at most one of `team_id` / `resource_id`
 * (`conversations_one_attachment`); `scope_label` is a caption either way, so
 * the reading order below is deliberate: the structured attachment wins and
 * the free text is the fallback.
 *
 * Pure presentation — no client, no policy decision. Both the admin group list
 * and the members' message list render badges from this one function so a
 * group is described the same way wherever it appears.
 */

export type AttachmentKind = "venue" | "team" | "scope" | "none";

export type GroupAttachmentInput = {
  teamName?: string | null;
  resourceName?: string | null;
  scopeLabel?: string | null;
};

export type GroupAttachment = {
  kind: AttachmentKind;
  /** Always safe to render: an unattached group reads as an em dash. */
  label: string;
};

/** What to show when a group is attached to nothing at all. */
export const NO_ATTACHMENT = "—";

export function groupAttachment(input: GroupAttachmentInput): GroupAttachment {
  const resource = input.resourceName?.trim();
  if (resource) return { kind: "venue", label: resource };

  const team = input.teamName?.trim();
  if (team) return { kind: "team", label: team };

  const scope = input.scopeLabel?.trim();
  if (scope) return { kind: "scope", label: scope };

  return { kind: "none", label: NO_ATTACHMENT };
}

/** The three attachments an administrator can choose between, plus "nothing". */
export const ATTACHMENT_CHOICES = ["none", "resource", "team", "label"] as const;
export type AttachmentChoice = (typeof ATTACHMENT_CHOICES)[number];

export function isAttachmentChoice(value: string): value is AttachmentChoice {
  return (ATTACHMENT_CHOICES as readonly string[]).includes(value);
}

/**
 * The one-attachment check constraint, in a sentence. `conversations_one
 * _attachment` fires as SQLSTATE 23514 and its raw text names the constraint,
 * which tells an administrator nothing they can act on.
 */
export const ONE_ATTACHMENT_REFUSAL =
  "A group can be attached to one thing at a time — a venue or a team, not both. Choose a single attachment and save again.";
