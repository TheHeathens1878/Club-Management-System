import {
  CalendarDays,
  Hash,
  IdCard,
  KeyRound,
  ShieldCheck,
  Users,
  UsersRound,
  Wallet,
} from "lucide-react";

import { StatRow, StatTile } from "@/components/ui/stat-tile";

/**
 * The band of facts a member record opens with (P8.3).
 *
 * Eight things an administrator came to the page to find out, each said in
 * one figure, each one press to the place it is changed. Before this they
 * were scattered down 866 lines of cards — the age group in a badge at the
 * top, the membership number four cards further on, the roles only visible
 * once you had scrolled past the address — so "is this record usable?" took
 * a read of the whole page.
 *
 * It is a SERVER component on purpose: every figure here is already counted
 * by the page's own reads, nothing on it changes without a navigation, and
 * the tiles are links. `hrefFor` therefore stays a plain function — it never
 * crosses into a client bundle.
 *
 * Nothing is computed here that the caller has not already been told. In
 * particular `idNeeded` is the DATABASE's answer about child-facing roles
 * (SG-6 keeps that in `child_facing_roles`, never in a hard-coded list), and
 * an empty `memberNo` means the reader was not entitled to the billing row
 * rather than that there is no number.
 */

/** The tiles, in the order they are drawn. A key is what `hrefFor` is asked. */
export type PersonFactKey =
  | "age"
  | "login"
  | "membership"
  | "memberNo"
  | "roles"
  | "guardianships"
  | "teams"
  | "identity";

export type PersonFactsData = {
  /** "U12" when the season's bands give one, else null (an adult, or no dob). */
  ageGroup: string | null;
  isMinor: boolean;
  hasDob: boolean;
  /** `profiles.role` when a sign-in is linked to this person. */
  loginRole: string | null;
  /** "Individual" / "Family" — already put into words by the caller. */
  membershipWord: string | null;
  membershipSeason: string | null;
  /** "00042A", the household number with this person's card letter. */
  memberNo: string | null;
  /** "suspended" and the like; null while the account is ordinary. */
  memberNoStatus: string | null;
  roles: number;
  guardians: number;
  children: number;
  /** Every team membership ever held, and the ones with no `left_at`. */
  teams: number;
  liveTeams: number;
  idSeen: boolean;
  /**
   * This person holds a child-facing role and their ID has not been seen —
   * the one fact on the band that is a job rather than a description.
   */
  idNeeded: boolean;
  retired: boolean;
};

export function PersonFacts({
  facts,
  hrefFor,
}: {
  facts: PersonFactsData;
  /** Where each tile goes. The record supplies anchors; the sheet supplies `?sheet=`. */
  hrefFor: (key: PersonFactKey) => string;
}) {
  const ageValue = facts.hasDob ? (facts.ageGroup ?? "Adult") : "Unknown";
  const ageHint = !facts.hasDob
    ? "No date of birth — treated as a child"
    : facts.isMinor
      ? "A minor"
      : "An adult";

  const guardianValue =
    facts.children > 0 || facts.guardians > 0
      ? `${facts.guardians} · ${facts.children}`
      : "None";

  return (
    <StatRow>
      <StatTile
        icon={<CalendarDays className="h-3.5 w-3.5" aria-hidden />}
        label="Age group"
        value={ageValue}
        hint={ageHint}
        tone={facts.hasDob ? "default" : "danger"}
        href={hrefFor("age")}
      />
      <StatTile
        icon={<KeyRound className="h-3.5 w-3.5" aria-hidden />}
        label="Login"
        value={facts.loginRole ? "Linked" : "None"}
        hint={facts.loginRole ? facts.loginRole.replace(/_/g, " ") : "No sign-in on this record"}
        href={hrefFor("login")}
      />
      <StatTile
        icon={<Users className="h-3.5 w-3.5" aria-hidden />}
        label="Membership"
        value={facts.membershipWord ?? "None"}
        hint={facts.membershipSeason ?? "Nothing recorded for this person"}
        href={hrefFor("membership")}
      />
      <StatTile
        icon={<Hash className="h-3.5 w-3.5" aria-hidden />}
        label="Member no."
        value={facts.memberNo ?? "None"}
        hint={facts.memberNoStatus ?? (facts.memberNo ? "The household billed" : "No billing account")}
        tone={facts.memberNoStatus ? "warning" : "default"}
        href={hrefFor("memberNo")}
      />
      <StatTile
        icon={<ShieldCheck className="h-3.5 w-3.5" aria-hidden />}
        label="Roles"
        value={facts.roles}
        hint={facts.roles === 0 ? "None held right now" : "Held right now"}
        href={hrefFor("roles")}
      />
      <StatTile
        icon={<UsersRound className="h-3.5 w-3.5" aria-hidden />}
        label="Guardians · children"
        value={guardianValue}
        hint={facts.guardians === 0 && facts.isMinor ? "Nobody is recorded for them" : "Links on file"}
        tone={facts.isMinor && facts.guardians === 0 ? "warning" : "default"}
        href={hrefFor("guardianships")}
      />
      <StatTile
        icon={<Wallet className="h-3.5 w-3.5" aria-hidden />}
        label="Teams"
        value={facts.teams}
        hint={facts.liveTeams > 0 ? `${facts.liveTeams} live` : "None live"}
        href={hrefFor("teams")}
      />
      <StatTile
        icon={<IdCard className="h-3.5 w-3.5" aria-hidden />}
        label="ID seen"
        value={facts.idSeen ? "Yes" : "No"}
        hint={
          facts.idSeen
            ? "Recorded by the club"
            : facts.idNeeded
              ? "A child-facing role needs it"
              : "Not asked for"
        }
        tone={facts.idSeen ? "success" : facts.idNeeded ? "warning" : "default"}
        href={hrefFor("identity")}
      />
    </StatRow>
  );
}
