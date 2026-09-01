/**
 * Shaping for the Family linking screen (Adam, 2026-08-26: "show you the
 * family group you are connected to in a hierarchical family tree").
 *
 * PURE, AND DELIBERATELY DECIDES NOTHING. Every entitlement question — which
 * children, which co-guardians, which connected adults, and above all which
 * people a second guardian of the same children must NOT see — is answered by
 * `public.my_family_tree()` (20260825420000) under the caller's own JWT. This
 * module reads the jsonb that function returns, defensively, and turns the
 * three-level structure into the flat list of indented rows the page draws.
 * It never filters anybody out and it never adds anybody in: if a name is on
 * this screen, the database put it there.
 *
 * The tree is three levels and no more:
 *
 *   you                                        depth 0
 *    ├── a child you are a live guardian of     depth 1
 *    │    └── that child's other guardians      depth 2   (a leaf)
 *    └── an adult connected to you              depth 1   (a leaf)
 */

import type { Json } from "@club/db";

import { personLabel } from "@/lib/people-display";

/** What a row is, relative to the row it hangs from. */
export type FamilyRelation = "self" | "child" | "co_guardian" | "connected_adult";

export type FamilyPerson = {
  personId: string;
  firstName: string;
  lastName: string;
  preferredName: string | null;
};

export type FamilyChild = FamilyPerson & {
  /** The caller's own guardianship relationship to this child. */
  relationship: string | null;
  /** "U10" and friends — the hint the family screens show INSTEAD of a DOB. */
  ageGroup: string | null;
  /** The other live guardians of this child. Always a leaf: nothing hangs off them. */
  guardians: (FamilyPerson & { relationship: string | null })[];
};

export type FamilyAdult = FamilyPerson & {
  hasLogin: boolean;
  onMyMembership: boolean;
  myLead: boolean;
};

export type FamilyTree = {
  self: FamilyPerson | null;
  children: FamilyChild[];
  adults: FamilyAdult[];
};

/** One rendered row: a person, how deep they sit, and how they connect upwards. */
export type FamilyNode = {
  personId: string;
  name: string;
  relation: FamilyRelation;
  /** 0 = the caller, 1 = a child or a connected adult, 2 = a co-guardian. */
  depth: number;
  /** The words under the name: "Your child", "Also a guardian", "Connected adult". */
  relationshipLabel: string;
  /** Short pills beside the name — an age-group hint, "Lead contact", and so on. */
  badges: string[];
  /** True when nothing at this depth follows it, so the connector line stops here. */
  isLast: boolean;
};

// ---------------------------------------------------------------------------
// Reading the jsonb
// ---------------------------------------------------------------------------
// `my_family_tree()` builds this object itself, so the shape is known — but it
// arrives through PostgREST as `Json`, and a page that assumes rather than
// checks is a page that 500s on the day the function changes. Anything
// unreadable is skipped, not guessed at.

function asRecord(value: Json | null | undefined): Record<string, Json | undefined> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, Json | undefined>;
}

function asString(value: Json | undefined): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function asBool(value: Json | undefined): boolean {
  return value === true;
}

function readPerson(value: Json | undefined): FamilyPerson | null {
  const record = asRecord(value);
  if (!record) return null;
  const personId = asString(record["person_id"]);
  if (!personId) return null;
  return {
    personId,
    firstName: asString(record["first_name"]) ?? "",
    lastName: asString(record["last_name"]) ?? "",
    preferredName: asString(record["preferred_name"]),
  };
}

/** The jsonb `my_family_tree()` returns, as a typed tree. Null if unreadable. */
export function parseFamilyTree(value: Json | null | undefined): FamilyTree {
  const root = asRecord(value);
  if (!root) return { self: null, children: [], adults: [] };

  const children: FamilyChild[] = [];
  const rawChildren = root["children"];
  if (Array.isArray(rawChildren)) {
    for (const entry of rawChildren) {
      const person = readPerson(entry);
      const record = asRecord(entry);
      if (!person || !record) continue;
      const guardians: (FamilyPerson & { relationship: string | null })[] = [];
      const rawGuardians = record["guardians"];
      if (Array.isArray(rawGuardians)) {
        for (const guardianEntry of rawGuardians) {
          const guardian = readPerson(guardianEntry);
          const guardianRecord = asRecord(guardianEntry);
          if (!guardian || !guardianRecord) continue;
          guardians.push({ ...guardian, relationship: asString(guardianRecord["relationship"]) });
        }
      }
      children.push({
        ...person,
        relationship: asString(record["relationship"]),
        ageGroup: asString(record["age_group"]),
        guardians,
      });
    }
  }

  const adults: FamilyAdult[] = [];
  const rawAdults = root["adults"];
  if (Array.isArray(rawAdults)) {
    for (const entry of rawAdults) {
      const person = readPerson(entry);
      const record = asRecord(entry);
      if (!person || !record) continue;
      adults.push({
        ...person,
        hasLogin: asBool(record["has_login"]),
        onMyMembership: asBool(record["on_my_membership"]),
        myLead: asBool(record["my_lead"]),
      });
    }
  }

  return { self: readPerson(root["self"]), children, adults };
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

/** `guardian_relationship` as a person reads it: 'step_parent' -> 'Step parent'. */
export function relationshipLabel(relationship: string | null): string | null {
  if (!relationship) return null;
  const words = relationship.replace(/_/g, " ").trim();
  if (words === "") return null;
  return words.charAt(0).toLocaleUpperCase("en-GB") + words.slice(1);
}

/** The age-group pill, or the honest admission that the club has no date of birth. */
export function ageGroupBadge(ageGroup: string | null): string {
  return ageGroup ?? "Age group unknown";
}

// ---------------------------------------------------------------------------
// Flattening
// ---------------------------------------------------------------------------

/**
 * The tree as rows, in reading order: the caller, then each child with its
 * other guardians directly beneath it, then the connected adults.
 *
 * `isLast` is what lets the page stop a connector line at the final sibling
 * rather than running it past the bottom of the branch. Children and connected
 * adults are siblings — both hang off the caller — so the last depth-1 row is
 * the last connected adult, or the last child where there are none.
 */
export function flattenFamilyTree(tree: FamilyTree): FamilyNode[] {
  const nodes: FamilyNode[] = [];

  if (tree.self) {
    nodes.push({
      personId: tree.self.personId,
      name: nameOfPerson(tree.self),
      relation: "self",
      depth: 0,
      relationshipLabel: "You",
      badges: [],
      isLast: tree.children.length === 0 && tree.adults.length === 0,
    });
  }

  const branchCount = tree.children.length + tree.adults.length;
  let branchIndex = 0;

  for (const child of tree.children) {
    branchIndex += 1;
    nodes.push({
      personId: child.personId,
      name: nameOfPerson(child),
      relation: "child",
      depth: 1,
      relationshipLabel: "Your child",
      badges: [ageGroupBadge(child.ageGroup), relationshipLabel(child.relationship)].filter(
        (badge): badge is string => badge !== null,
      ),
      isLast: branchIndex === branchCount,
    });

    child.guardians.forEach((guardian, index) => {
      nodes.push({
        personId: guardian.personId,
        name: nameOfPerson(guardian),
        relation: "co_guardian",
        depth: 2,
        relationshipLabel: "Also a guardian",
        badges: [relationshipLabel(guardian.relationship)].filter(
          (badge): badge is string => badge !== null,
        ),
        isLast: index === child.guardians.length - 1,
      });
    });
  }

  for (const adult of tree.adults) {
    branchIndex += 1;
    const badges: string[] = [];
    if (adult.myLead) badges.push("Lead contact");
    else if (adult.hasLogin) badges.push("Has their own login");
    else badges.push("No login yet");
    if (adult.onMyMembership) badges.push("On your membership");

    nodes.push({
      personId: adult.personId,
      name: nameOfPerson(adult),
      relation: "connected_adult",
      depth: 1,
      relationshipLabel: "Connected adult",
      badges,
      isLast: branchIndex === branchCount,
    });
  }

  return nodes;
}

/** A person's name as the club shows it, preferring what they asked to be called. */
export function nameOfPerson(person: FamilyPerson): string {
  const label = personLabel({
    first_name: person.firstName,
    last_name: person.lastName,
    preferred_name: person.preferredName,
  });
  return label === "" ? "Someone at the club" : label;
}

/** Nothing but the caller — the "no children, no connected adults" case. */
export function isFamilyTreeEmpty(tree: FamilyTree): boolean {
  return tree.children.length === 0 && tree.adults.length === 0;
}

/** Every person id in the tree, for the page's own `people` photo read. */
export function familyTreePersonIds(tree: FamilyTree): string[] {
  const ids = new Set<string>();
  if (tree.self) ids.add(tree.self.personId);
  for (const child of tree.children) {
    ids.add(child.personId);
    for (const guardian of child.guardians) ids.add(guardian.personId);
  }
  for (const adult of tree.adults) ids.add(adult.personId);
  return Array.from(ids);
}
