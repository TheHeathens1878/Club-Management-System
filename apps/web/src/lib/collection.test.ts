import { describe, expect, it } from "vitest";

import {
  attemptDisposition,
  checkoutIsPaid,
  collectionReference,
  IN_FLIGHT_WINDOW_MS,
  outstandingPence,
} from "./collection";

describe("outstandingPence", () => {
  it("is the whole amount when nothing has been paid", () => {
    expect(outstandingPence(10000, [])).toBe(10000);
  });

  it("nets payments and refunds off the amount — the partial-payment case", () => {
    // £100 charge, £40 paid: the cron must collect £60, not £100.
    expect(outstandingPence(10000, [{ amount_pence: 4000, refunded_pence: 0 }])).toBe(6000);
    // A refunded payment counts for what was kept.
    expect(
      outstandingPence(10000, [
        { amount_pence: 4000, refunded_pence: 1000 },
        { amount_pence: 2500, refunded_pence: null },
      ]),
    ).toBe(4500);
  });

  it("goes to zero or below when the charge is settled or over-paid", () => {
    expect(outstandingPence(5000, [{ amount_pence: 5000, refunded_pence: 0 }])).toBe(0);
    expect(outstandingPence(5000, [{ amount_pence: 6000, refunded_pence: 0 }])).toBe(-1000);
  });
});

describe("collectionReference", () => {
  it("is unique per charge and attempt, and still parses as charge:<id>", () => {
    const ref = collectionReference("abc-123", 2);
    expect(ref).toBe("charge:abc-123:auto:2");
    expect(ref.split(":")[1]).toBe("abc-123");
    expect(collectionReference("abc-123", 3)).not.toBe(ref);
  });
});

describe("checkoutIsPaid", () => {
  it("reads PAID, or a SUCCESSFUL transaction lagging behind the status", () => {
    expect(checkoutIsPaid({ status: "PAID" })).toBe(true);
    expect(checkoutIsPaid({ status: "PENDING", transactions: [{ status: "SUCCESSFUL" }] })).toBe(true);
    expect(checkoutIsPaid({ status: "PENDING", transactions: [{ status: "FAILED" }] })).toBe(false);
    expect(checkoutIsPaid({ status: "FAILED" })).toBe(false);
    expect(checkoutIsPaid(null)).toBe(false);
  });
});

describe("attemptDisposition", () => {
  const now = Date.parse("2026-09-05T08:00:00Z");
  const fresh = new Date(now - 60_000).toISOString();
  const stale = new Date(now - IN_FLIGHT_WINDOW_MS - 1).toISOString();

  it("a paid checkout is paid however old the attempt — the double-charge case", () => {
    // The run that created this died after SumUp took the money and before
    // the ledger was written. The next run must record it, never charge again.
    expect(attemptDisposition({ checkout: { status: "PAID" }, startedAt: stale, now })).toBe("paid");
    expect(attemptDisposition({ checkout: { status: "PAID" }, startedAt: fresh, now })).toBe("paid");
  });

  it("FAILED and EXPIRED mean the card was not charged", () => {
    expect(attemptDisposition({ checkout: { status: "FAILED" }, startedAt: fresh, now })).toBe("failed");
    expect(attemptDisposition({ checkout: { status: "EXPIRED" }, startedAt: stale, now })).toBe("failed");
  });

  it("a PENDING checkout is in flight while recent, abandoned once old", () => {
    expect(attemptDisposition({ checkout: { status: "PENDING" }, startedAt: fresh, now })).toBe("in_flight");
    expect(attemptDisposition({ checkout: { status: "PENDING" }, startedAt: stale, now })).toBe("abandoned");
  });

  it("no checkout at all is decided by age alone", () => {
    expect(attemptDisposition({ checkout: null, startedAt: fresh, now })).toBe("in_flight");
    expect(attemptDisposition({ checkout: null, startedAt: stale, now })).toBe("abandoned");
  });
});
