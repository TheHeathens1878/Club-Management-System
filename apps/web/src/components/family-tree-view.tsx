import type { ReactNode } from "react";
import Link from "next/link";

import { Avatar } from "@/components/avatar";
import { Badge } from "@/components/ui/badge";
import { flattenFamilyTree, type FamilyNode, type FamilyTree } from "@/lib/family-tree";

/**
 * The family tree, drawn.
 *
 * Extracted from /family-linking so the same tree can appear on a member's
 * record for an administrator (Adam, 2026-08-26: "there should be another tab
 * saying Membership and payments. The family tree should appear in here").
 * Two drawings of the same thing would drift; one cannot.
 *
 * A RENDERER, AND NOTHING ELSE. Every entitlement decision belongs to whichever
 * database function produced the tree — `my_family_tree()` for the member's own
 * page, `family_tree_for()` for an administrator looking at somebody else. This
 * component filters nothing and fetches nothing, so there is nothing here for a
 * bug in this file to leak.
 *
 * NO DATES OF BIRTH: neither function returns one, and a child's line carries
 * the age-group hint the family screens use in its place.
 */

/** Where a row's name goes, or null for plain text. */
export type FamilyHrefFor = (node: FamilyNode) => string | null;

/**
 * The connector lines, as plain CSS borders — no library, and nothing that
 * needs JavaScript to draw.
 *
 * One 1rem rail per level of depth. The rail nearest the name is the elbow: a
 * vertical stroke down to the middle of the row and a horizontal stub out to
 * the avatar. On the last sibling the vertical stops at the elbow instead of
 * running on past the bottom of the branch. Rails further left are the
 * ancestor's line, drawn only while that ancestor still has siblings below.
 */
function Rails({
  depth,
  isLast,
  ancestorContinues,
}: {
  depth: number;
  isLast: boolean;
  ancestorContinues: boolean;
}) {
  if (depth === 0) return null;
  const rails: ReactNode[] = [];
  for (let level = 0; level < depth; level += 1) {
    const isElbow = level === depth - 1;
    if (isElbow) {
      rails.push(
        <span key={level} aria-hidden="true" className="relative w-4 flex-none self-stretch">
          {/* 1.625rem is the centre of the avatar beside it: 0.25rem of row
              padding, 0.25rem of avatar offset, then half of an h-9 circle. */}
          <span
            className={`absolute left-0 top-0 w-px bg-border ${isLast ? "h-[1.625rem]" : "h-full"}`}
          />
          <span className="absolute left-0 top-[1.625rem] h-px w-3 bg-border" />
        </span>,
      );
    } else {
      rails.push(
        <span key={level} aria-hidden="true" className="relative w-4 flex-none self-stretch">
          {ancestorContinues && <span className="absolute left-0 top-0 h-full w-px bg-border" />}
        </span>,
      );
    }
  }
  return <>{rails}</>;
}

function TreeRow({
  node,
  ancestorContinues,
  photoUrl,
  href,
}: {
  node: FamilyNode;
  ancestorContinues: boolean;
  photoUrl: string | null;
  href: string | null;
}) {
  const name = href ? (
    <Link
      href={href}
      className="inline-flex min-h-[44px] items-center font-medium underline-offset-4 hover:underline lg:min-h-0"
    >
      {node.name}
    </Link>
  ) : (
    <span className="inline-flex min-h-[44px] items-center font-medium lg:min-h-0">
      {node.name}
    </span>
  );

  return (
    <li className="flex items-stretch">
      <Rails depth={node.depth} isLast={node.isLast} ancestorContinues={ancestorContinues} />
      <div className="flex min-w-0 flex-1 items-start gap-3 py-1">
        <Avatar name={node.name} photoUrl={photoUrl} size="md" className="mt-1" />
        <div className="min-w-0 flex-1">
          {/* break-words, because a long double-barrelled name must wrap on a
              phone rather than push the tree sideways. */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 break-words">
            {name}
            {node.badges.map((badge) => (
              <Badge key={badge} variant={node.relation === "child" ? "outline" : "muted"}>
                {badge}
              </Badge>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{node.relationshipLabel}</p>
        </div>
      </div>
    </li>
  );
}

export function FamilyTreeView({
  tree,
  photoUrls,
  hrefFor,
}: {
  tree: FamilyTree;
  /** person_id → signed photo URL. Whoever is absent shows initials. */
  photoUrls: Map<string, string>;
  hrefFor: FamilyHrefFor;
}) {
  const nodes = flattenFamilyTree(tree);

  // The one piece of render-time state the flat list cannot carry: whether a
  // co-guardian's parent branch still has siblings below it, which decides
  // whether the rail to its left keeps going. Computed in one pass so the JSX
  // below stays a straight map.
  const ancestorContinues = new Map<number, boolean>();
  let branchIsLast = false;
  nodes.forEach((node, index) => {
    if (node.depth <= 1) branchIsLast = node.isLast;
    ancestorContinues.set(index, node.depth === 2 && !branchIsLast);
  });

  return (
    <ul className="space-y-0">
      {nodes.map((node, index) => (
        <TreeRow
          key={`${node.personId}-${index}`}
          node={node}
          ancestorContinues={ancestorContinues.get(index) ?? false}
          photoUrl={photoUrls.get(node.personId) ?? null}
          href={hrefFor(node)}
        />
      ))}
    </ul>
  );
}
