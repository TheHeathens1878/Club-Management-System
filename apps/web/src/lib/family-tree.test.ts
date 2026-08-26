import { describe, expect, it } from "vitest";

import {
  ageGroupBadge,
  familyTreePersonIds,
  flattenFamilyTree,
  isFamilyTreeEmpty,
  parseFamilyTree,
  relationshipLabel,
} from "./family-tree";

/**
 * Shaping only. The ex-spouse rule is a DATABASE rule and its tests live in
 * `supabase/tests/family_linking.test.sql`; what is checked here is that the
 * renderer neither invents a row nor drops one, and that the indentation and
 * connector flags come out of the shape the function returned.
 */

/** Adam's scenario, as `my_family_tree()` returns it for parent A. */
const treeA = {
  self: { person_id: "a", first_name: "Ada", last_name: "Quinn", preferred_name: null },
  children: [
    {
      person_id: "x",
      first_name: "Xan",
      last_name: "Quinn",
      preferred_name: null,
      relationship: "parent",
      age_group: "U10",
      guardians: [
        {
          person_id: "b",
          first_name: "Ben",
          last_name: "Quinn",
          preferred_name: null,
          relationship: "parent",
        },
      ],
    },
    {
      person_id: "y",
      first_name: "Yves",
      last_name: "Quinn",
      preferred_name: "Yvie",
      relationship: "parent",
      age_group: "U08",
      guardians: [
        {
          person_id: "b",
          first_name: "Ben",
          last_name: "Quinn",
          preferred_name: null,
          relationship: "parent",
        },
      ],
    },
  ],
  adults: [
    {
      person_id: "p",
      first_name: "Pat",
      last_name: "Reed",
      preferred_name: null,
      has_login: false,
      on_my_membership: true,
      my_lead: false,
    },
  ],
};

describe("parseFamilyTree", () => {
  it("reads the three levels the function returns", () => {
    const tree = parseFamilyTree(treeA);
    expect(tree.self?.personId).toBe("a");
    expect(tree.children.map((child) => child.personId)).toEqual(["x", "y"]);
    expect(tree.children[0]?.guardians.map((g) => g.personId)).toEqual(["b"]);
    expect(tree.adults.map((adult) => adult.personId)).toEqual(["p"]);
    expect(tree.adults[0]?.onMyMembership).toBe(true);
  });

  it("survives null, a scalar and a missing branch without throwing", () => {
    expect(parseFamilyTree(null)).toEqual({ self: null, children: [], adults: [] });
    expect(parseFamilyTree("nope")).toEqual({ self: null, children: [], adults: [] });
    expect(parseFamilyTree({ self: null })).toEqual({ self: null, children: [], adults: [] });
  });

  it("skips an entry with no person id rather than rendering a blank row", () => {
    const tree = parseFamilyTree({
      self: null,
      children: [{ first_name: "Ghost", guardians: [{ first_name: "Ghost" }] }],
      adults: [{ person_id: "p", first_name: "Pat", last_name: "Reed" }],
    });
    expect(tree.children).toHaveLength(0);
    expect(tree.adults).toHaveLength(1);
  });
});

describe("flattenFamilyTree", () => {
  it("puts each child's other guardians directly beneath that child", () => {
    const nodes = flattenFamilyTree(parseFamilyTree(treeA));
    expect(nodes.map((node) => [node.personId, node.depth, node.relation])).toEqual([
      ["a", 0, "self"],
      ["x", 1, "child"],
      ["b", 2, "co_guardian"],
      ["y", 1, "child"],
      ["b", 2, "co_guardian"],
      ["p", 1, "connected_adult"],
    ]);
  });

  it("labels each row by its relationship to the row above it", () => {
    const nodes = flattenFamilyTree(parseFamilyTree(treeA));
    expect(nodes.map((node) => node.relationshipLabel)).toEqual([
      "You",
      "Your child",
      "Also a guardian",
      "Your child",
      "Also a guardian",
      "Connected adult",
    ]);
  });

  it("prefers the name a child asked to be called", () => {
    const nodes = flattenFamilyTree(parseFamilyTree(treeA));
    expect(nodes.find((node) => node.personId === "y")?.name).toBe("Yvie Quinn");
    expect(nodes.find((node) => node.personId === "x")?.name).toBe("Xan Quinn");
  });

  it("shows the age-group hint and never a date of birth", () => {
    const nodes = flattenFamilyTree(parseFamilyTree(treeA));
    expect(nodes.find((node) => node.personId === "x")?.badges).toEqual(["U10", "Parent"]);
    expect(JSON.stringify(nodes)).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it("ends the connector at the last sibling of each depth", () => {
    const nodes = flattenFamilyTree(parseFamilyTree(treeA));
    // Children and connected adults are siblings of one another: the last
    // depth-1 row is the connected adult, not the last child.
    expect(nodes.filter((node) => node.isLast).map((node) => node.personId)).toEqual([
      "b",
      "b",
      "p",
    ]);
  });

  it("marks the caller as the last row when they stand alone", () => {
    const nodes = flattenFamilyTree(
      parseFamilyTree({
        self: { person_id: "a", first_name: "Ada", last_name: "Quinn" },
        children: [],
        adults: [],
      }),
    );
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.isLast).toBe(true);
  });

  it("flags a lead contact ahead of a login", () => {
    const nodes = flattenFamilyTree(
      parseFamilyTree({
        self: { person_id: "a", first_name: "Ada", last_name: "Quinn" },
        children: [],
        adults: [
          {
            person_id: "l",
            first_name: "Lee",
            last_name: "Quinn",
            has_login: true,
            on_my_membership: false,
            my_lead: true,
          },
        ],
      }),
    );
    expect(nodes[1]?.badges).toEqual(["Lead contact"]);
  });
});

describe("helpers", () => {
  it("humanises a guardian relationship", () => {
    expect(relationshipLabel("step_parent")).toBe("Step parent");
    expect(relationshipLabel("parent")).toBe("Parent");
    expect(relationshipLabel(null)).toBeNull();
    expect(relationshipLabel("")).toBeNull();
  });

  it("says so when the club has no date of birth to hint from", () => {
    expect(ageGroupBadge("U12")).toBe("U12");
    expect(ageGroupBadge(null)).toBe("Age group unknown");
  });

  it("knows an empty family from a populated one", () => {
    expect(isFamilyTreeEmpty(parseFamilyTree(treeA))).toBe(false);
    expect(
      isFamilyTreeEmpty(parseFamilyTree({ self: { person_id: "a", first_name: "A", last_name: "Q" } })),
    ).toBe(true);
  });

  it("collects every person id once, for the photo read", () => {
    expect(familyTreePersonIds(parseFamilyTree(treeA)).sort()).toEqual(["a", "b", "p", "x", "y"]);
  });
});
