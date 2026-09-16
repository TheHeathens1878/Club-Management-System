import { describe, expect, it } from "vitest";

import { personNextAction, type PersonRecordInput } from "@/lib/person-record-state";

// An adult born long enough ago that the test does not age out, and a child
// who will still be one for a decade.
const ADULT_DOB = "1984-04-01";
const CHILD_DOB = "2016-04-01";

const COMPLETE: PersonRecordInput = {
  person: { dob: ADULT_DOB, id_verified: true, updated_at: "2026-10-04T13:20:00Z" },
  pendingImports: 0,
  emergencyContacts: 1,
  childFacingRoles: [],
  identityDocuments: 0,
};

type RecordPatch = Omit<Partial<PersonRecordInput>, "person"> & {
  person?: Partial<PersonRecordInput["person"]>;
};

function record(patch: RecordPatch = {}): PersonRecordInput {
  return { ...COMPLETE, ...patch, person: { ...COMPLETE.person, ...(patch.person ?? {}) } };
}

describe("what a member record needs next", () => {
  it("names the imports waiting on a date of birth", () => {
    const action = personNextAction(record({ person: { dob: null }, pendingImports: 3 }));
    expect(action.key).toBe("apply-imports");
    expect(action.label).toBe("Save a date of birth — 3 imports waiting");
    expect(action.mode).toBe("details");
  });

  it("counts one import in the singular", () => {
    const action = personNextAction(record({ person: { dob: null }, pendingImports: 1 }));
    expect(action.label).toBe("Save a date of birth — 1 import waiting");
  });

  it("asks for a date of birth when nothing is queued", () => {
    const action = personNextAction(record({ person: { dob: null } }));
    expect(action.key).toBe("add-dob");
    expect(action.label).toBe("Add a date of birth");
    expect(action.tone).toBe("error");
  });

  it("asks for an emergency contact for a child", () => {
    const action = personNextAction(record({ person: { dob: CHILD_DOB }, emergencyContacts: 0 }));
    expect(action.key).toBe("add-emergency-contact");
    expect(action.label).toBe("Add an emergency contact");
    expect(action.mode).toBe("contacts");
  });

  it("does not ask an adult for an emergency contact", () => {
    const action = personNextAction(record({ emergencyContacts: 0 }));
    expect(action.key).toBe("record-complete");
  });

  it("asks to record ID for an adult in a child-facing role", () => {
    const action = personNextAction(
      record({ person: { id_verified: false }, childFacingRoles: ["coach"] }),
    );
    expect(action.key).toBe("record-id-seen");
    expect(action.label).toBe("Record ID seen");
    expect(action.mode).toBe("identity");
    expect(action.why).toContain("coach");
  });

  it("says when a document is already waiting to be checked", () => {
    const action = personNextAction(
      record({
        person: { id_verified: false },
        childFacingRoles: ["assistant_coach"],
        identityDocuments: 1,
      }),
    );
    expect(action.why).toContain("assistant coach");
    expect(action.why).toContain("waiting to be checked");
  });

  it("asks nothing of an adult who holds no child-facing role", () => {
    const action = personNextAction(record({ person: { id_verified: false } }));
    expect(action.key).toBe("record-complete");
  });

  it("goes quiet on a complete record and says when it last changed", () => {
    const action = personNextAction(record());
    expect(action.key).toBe("record-complete");
    expect(action.label).toBe("Edit details");
    expect(action.why).toBe("Record complete · last changed 4 Oct");
    expect(action.tone).toBe("done");
  });

  it("survives a record with no last-changed stamp", () => {
    const action = personNextAction(record({ person: { updated_at: "" } }));
    expect(action.why).toBe("Record complete");
  });
});

describe("the order the branches run in", () => {
  it("puts the imports above everything, even a missing contact", () => {
    const action = personNextAction(
      record({ person: { dob: null }, pendingImports: 2, emergencyContacts: 0 }),
    );
    expect(action.key).toBe("apply-imports");
  });

  it("puts a missing date of birth above a missing contact", () => {
    // With no date of birth the record is a minor by default (SG-0), so this
    // one would ALSO match the emergency-contact branch. The birthday wins.
    const action = personNextAction(record({ person: { dob: null }, emergencyContacts: 0 }));
    expect(action.key).toBe("add-dob");
  });

  it("puts a missing contact above an unrecorded ID", () => {
    const action = personNextAction(
      record({
        person: { dob: CHILD_DOB, id_verified: false },
        emergencyContacts: 0,
        childFacingRoles: ["coach"],
      }),
    );
    expect(action.key).toBe("add-emergency-contact");
  });

  it("never asks a child for a child-facing ID", () => {
    const action = personNextAction(
      record({
        person: { dob: CHILD_DOB, id_verified: false },
        emergencyContacts: 2,
        childFacingRoles: ["player"],
      }),
    );
    expect(action.key).toBe("record-complete");
  });
});
