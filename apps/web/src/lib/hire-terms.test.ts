import { describe, expect, it } from "vitest";

import {
  bookingDepositPence,
  depositRuleLabel,
  memberInfoText,
  isPaymentPurpose,
  paymentTermsText,
  sumHirePaid,
  sumSecurityPaid,
} from "./hire-terms";

const RULE = { percent: 50, capPence: 10000 };

describe("bookingDepositPence", () => {
  it("is half the room hire, capped at £100", () => {
    expect(bookingDepositPence({ base_hire_pence: 15000, total_pence: 20000 }, RULE)).toBe(7500);
    expect(bookingDepositPence({ base_hire_pence: 30000, total_pence: 35000 }, RULE)).toBe(10000);
    expect(bookingDepositPence({ base_hire_pence: 20000, total_pence: 20000 }, RULE)).toBe(10000);
  });

  it("falls back to the total when the room hire was never split out", () => {
    expect(bookingDepositPence({ base_hire_pence: 0, total_pence: 12000 }, RULE)).toBe(6000);
    expect(bookingDepositPence({ base_hire_pence: null, total_pence: 50000 }, RULE)).toBe(10000);
    expect(bookingDepositPence({ base_hire_pence: null, total_pence: null }, RULE)).toBe(0);
  });

  it("honours the rule it is given", () => {
    expect(bookingDepositPence({ base_hire_pence: 30000 }, { percent: 25, capPence: 0 })).toBe(7500);
    expect(bookingDepositPence({ base_hire_pence: 30001 }, { percent: 50, capPence: 0 })).toBe(15001);
    expect(bookingDepositPence({ base_hire_pence: 30000 }, { percent: 150, capPence: 0 })).toBe(30000);
  });
});

describe("depositRuleLabel", () => {
  it("says the rule in words", () => {
    expect(depositRuleLabel(RULE)).toBe("half the room hire, up to £100.00");
    expect(depositRuleLabel({ percent: 25, capPence: 0 })).toBe("25% of the room hire");
    expect(depositRuleLabel({ percent: 100, capPence: 5000 })).toBe("the room hire in full, up to £50.00");
  });
});

describe("the ledger by purpose", () => {
  const rows = [
    { amount_pence: 10000, refunded_pence: 0, purpose: "deposit" },
    { amount_pence: 25000, refunded_pence: 5000, purpose: "balance" },
    { amount_pence: 20000, refunded_pence: 0, purpose: "security_deposit" },
    { amount_pence: 3000, refunded_pence: null, purpose: null },
  ];

  it("keeps the security deposit out of the hire, and the hire out of the security deposit", () => {
    expect(sumHirePaid(rows)).toBe(33000);
    expect(sumSecurityPaid(rows)).toBe(20000);
  });

  it("knows the three purposes", () => {
    expect(isPaymentPurpose("deposit")).toBe(true);
    expect(isPaymentPurpose("security_deposit")).toBe(true);
    expect(isPaymentPurpose("tip")).toBe(false);
    expect(isPaymentPurpose(null)).toBe(false);
  });
});

describe("paymentTermsText", () => {
  it("states the deposit, then the balance and the security deposit", () => {
    expect(
      paymentTermsText({
        depositPence: 10000,
        depositDueLabel: "20 September 2026",
        depositPaid: false,
        balancePence: 25000,
        balanceDueLabel: "30 October 2026",
        securityDepositPence: 20000,
      }),
    ).toBe(
      "A non-refundable deposit of £100.00 secures the room and is due by 20 September 2026; the booking is confirmed subject to it. " +
        "The balance of £250.00, plus a refundable security deposit of £200.00, returned after the event if all is well are due by 30 October 2026, at least two weeks before your event.",
    );
  });

  it("says only what applies", () => {
    expect(
      paymentTermsText({
        depositPence: 10000,
        depositDueLabel: null,
        depositPaid: true,
        balancePence: 25000,
        balanceDueLabel: "30 October 2026",
        securityDepositPence: 0,
      }),
    ).toBe(
      "Your non-refundable deposit of £100.00 has been received — the room is secured for you. " +
        "The balance of £250.00 is due by 30 October 2026, at least two weeks before your event.",
    );
    expect(
      paymentTermsText({
        depositPence: 0,
        depositDueLabel: null,
        depositPaid: false,
        balancePence: 0,
        balanceDueLabel: null,
        securityDepositPence: 0,
      }),
    ).toBe("");
  });
});

describe("memberInfoText", () => {
  it("is blank for a non-member, so the template paragraph says nothing", () => {
    expect(memberInfoText({ is_member: false })).toBe("");
    expect(memberInfoText({ is_member: null, member_discount_pence: 2500 })).toBe("");
  });
  it("names the membership and the discount applied", () => {
    expect(memberInfoText({ is_member: true, membership_type: "Social", member_number: "00123", member_discount_pence: 2500 })).toBe(
      "This is a member booking (Social, 00123): a member discount of £25.00 has been applied.",
    );
  });
  it("copes with a member who has no type, number or discount", () => {
    expect(memberInfoText({ is_member: true })).toBe("This is a member booking.");
    expect(memberInfoText({ is_member: true, member_number: " 42 ", member_discount_pence: 0 })).toBe("This is a member booking (42).");
  });
});
