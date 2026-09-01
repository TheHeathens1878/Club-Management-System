/**
 * Which sections of a match page a reader is offered — the rule on its own,
 * away from the bar that draws it, so it can be tested and so there is one
 * place to read it.
 *
 * Adam, 2026-09-01: "when clicking into an event (match), parents should just
 * see details, who has accepted, declined and no response. They should not be
 * able to see line up before the game (would be useful afterwards)."
 *
 * A team sheet before kick-off is the manager's working document: who is
 * starting, who is not, and who has been moved. Handing that to the families
 * on Friday night turns a coaching decision into a negotiation, and the child
 * who reads it first is not the one the coach meant to tell. Afterwards it is
 * simply the record of the game they watched, and it is theirs.
 *
 * So the withholding is of the SELECTION, and it is over the moment the game
 * starts. Nothing here hides a result, a stat, or an answer to an invitation:
 * Details — which carries the squad's replies in three lists — is offered
 * throughout.
 */

export const EVENT_TABS = ["details", "lineup", "stats", "score"] as const;

export type EventTabKey = (typeof EVENT_TABS)[number];

/**
 * @param memberView the hat being worn is Parent, Player or Me — the views a
 *   person wears to look at a team as somebody in it. A coach or an
 *   administrator wearing one gets what it gets; the hat decides, not the
 *   person (the team page's tabs follow the same rule).
 * @param kickedOff the match has started, so the line-up is history.
 */
export function eventTabsFor({
  memberView,
  kickedOff,
}: {
  memberView: boolean;
  kickedOff: boolean;
}): readonly EventTabKey[] {
  return memberView && !kickedOff ? (["details"] as const) : EVENT_TABS;
}

/**
 * `?tab=` from the URL, or Details for anything unrecognised — and for
 * anything this reader is not being offered, so that typing a tab's name into
 * the address bar reaches exactly what its link would have.
 */
export function eventTabFrom(
  value: string | string[] | undefined,
  offered: readonly EventTabKey[] = EVENT_TABS,
): EventTabKey {
  const key = Array.isArray(value) ? value[0] : value;
  return (offered as readonly string[]).includes(key ?? "") ? (key as EventTabKey) : "details";
}
