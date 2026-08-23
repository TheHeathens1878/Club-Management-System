import { describe, expect, it } from "vitest";

import {
  checkoutBlockedReason,
  describeArrears,
  describeStatus,
  toArrears,
  totalOutstandingPence,
  type ArrearsRow,
} from "./subs";

function arrearsRow(overrides: Partial<ArrearsRow> = {}): ArrearsRow {
  return {
    subscription_id: "sub-1",
    person_id: "child",
    person_name: "Ellie Wareing",
    payer_person_id: "parent",
    plan_id: "plan-1",
    plan_name: "U12 subs 2026/27",
    team_name: "Sale AoM U12",
    status: "pending",
    amount_due_pence: 12000,
    paid_pence: 0,
    outstanding_pence: 12000,
    days_since_start: 41,
    started_at: "2026-07-25T00:00:00Z",
    ...overrides,
  };
}

describe("toArrears", () => {
  it("marks the payer's own pending sub as payable in the app", () => {
    const [row] = toArrears([arrearsRow()], "parent");
    expect(row?.payableByMe).toBe(true);
    expect(row?.canCheckout).toBe(true);
  });

  it("does not offer checkout to someone who is not the payer", () => {
    const [row] = toArrears([arrearsRow()], "someone-else");
    expect(row?.payableByMe).toBe(false);
    expect(row?.canCheckout).toBe(false);
  });

  it("does not offer checkout for a sub Stripe has already taken over", () => {
    // stripe-checkout only accepts a `pending` subscription.
    const [row] = toArrears([arrearsRow({ status: "active" })], "parent");
    expect(row?.canCheckout).toBe(false);
  });

  it("does not offer checkout when nothing is outstanding", () => {
    const [row] = toArrears(
      [arrearsRow({ outstanding_pence: 0, paid_pence: 12000 })],
      "parent",
    );
    expect(row?.canCheckout).toBe(false);
  });

  it("drops a row with no subscription id rather than rendering a blank card", () => {
    expect(toArrears([arrearsRow({ subscription_id: null })], "parent")).toEqual(
      [],
    );
  });

  it("puts the largest debt first", () => {
    const rows = toArrears(
      [
        arrearsRow({ subscription_id: "small", outstanding_pence: 500 }),
        arrearsRow({ subscription_id: "large", outstanding_pence: 12000 }),
      ],
      "parent",
    );
    expect(rows.map((row) => row.subscriptionId)).toEqual(["large", "small"]);
  });

  it("substitutes a neutral name when the view hid one", () => {
    const [row] = toArrears([arrearsRow({ person_name: null })], "parent");
    expect(row?.personName).toBe("A club member");
  });
});

describe("totalOutstandingPence", () => {
  it("adds up what is owed and ignores credits", () => {
    const rows = toArrears(
      [
        arrearsRow({ subscription_id: "a", outstanding_pence: 12000 }),
        arrearsRow({ subscription_id: "b", outstanding_pence: -500 }),
      ],
      "parent",
    );
    expect(totalOutstandingPence(rows)).toBe(12000);
  });
});

describe("describeArrears and describeStatus", () => {
  it("says how much of the total is left", () => {
    const [row] = toArrears(
      [arrearsRow({ paid_pence: 4000, outstanding_pence: 8000 })],
      "parent",
    );
    expect(describeArrears(row!)).toBe("£80.00 of £120.00 outstanding");
  });

  it("says so when there is nothing left to pay", () => {
    const [row] = toArrears([arrearsRow({ outstanding_pence: 0 })], "parent");
    expect(describeArrears(row!)).toBe("Paid in full");
  });

  it("shows how long the debt has run", () => {
    const [row] = toArrears([arrearsRow({ status: "past_due" })], "parent");
    expect(describeStatus(row!)).toBe("Past due · 41 days since start");
  });
});

describe("checkoutBlockedReason", () => {
  it("explains that only the payer can pay", () => {
    const [row] = toArrears([arrearsRow()], "someone-else");
    expect(checkoutBlockedReason(row!)).toContain("registered payer");
  });

  it("explains a status Stripe Checkout will not accept", () => {
    const [row] = toArrears([arrearsRow({ status: "past_due" })], "parent");
    expect(checkoutBlockedReason(row!)).toContain("past due");
  });

  it("says nothing when the button is there, or nothing is owed", () => {
    const [payable] = toArrears([arrearsRow()], "parent");
    expect(checkoutBlockedReason(payable!)).toBeNull();

    const [settled] = toArrears(
      [arrearsRow({ outstanding_pence: 0 })],
      "someone-else",
    );
    expect(checkoutBlockedReason(settled!)).toBeNull();
  });
});
