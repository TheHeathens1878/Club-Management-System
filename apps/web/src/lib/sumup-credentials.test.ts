import { describe, expect, it } from "vitest";
import { SumUpAuthError, alarmDue, isSumUpAuthStatus } from "./sumup";

describe("isSumUpAuthStatus", () => {
  it("treats 401 and 403 as the credential being refused", () => {
    expect(isSumUpAuthStatus(401)).toBe(true);
    expect(isSumUpAuthStatus(403)).toBe(true);
  });
  it("leaves every other failure as an ordinary request failure", () => {
    for (const status of [400, 404, 409, 422, 429, 500, 502, 503]) {
      expect(isSumUpAuthStatus(status)).toBe(false);
    }
  });
});

describe("SumUpAuthError", () => {
  it("carries the status and SumUp's own words", () => {
    const e = new SumUpAuthError(401, '{"detail":"Unauthorized."}');
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("SumUpAuthError");
    expect(e.status).toBe(401);
    expect(e.detail).toContain("Unauthorized");
    expect(e.message).toContain("401");
  });
});

describe("alarmDue", () => {
  const now = new Date("2026-09-15T09:00:00Z");
  it("is due when nothing has ever been sent", () => {
    expect(alarmDue(null, now)).toBe(true);
    expect(alarmDue(undefined, now)).toBe(true);
  });
  it("is not due within 24 hours of the last alarm", () => {
    expect(alarmDue("2026-09-14T10:00:00Z", now)).toBe(false);
    expect(alarmDue("2026-09-15T08:59:00Z", now)).toBe(false);
  });
  it("is due again once 24 hours have passed", () => {
    expect(alarmDue("2026-09-14T09:00:00Z", now)).toBe(true);
    expect(alarmDue("2026-09-13T09:00:00Z", now)).toBe(true);
  });
  it("is due when the last stamp cannot be read", () => {
    expect(alarmDue("not a date", now)).toBe(true);
  });
});
