import { describe, expect, it } from "vitest";

import { isClubHost, originFromHeaders } from "./request-origin";

describe("isClubHost", () => {
  it("accepts the club's hosts and Vercel's", () => {
    expect(isClubHost("portal.aomsportsclub.co.uk")).toBe(true);
    expect(isClubHost("roombooking.aomsportsclub.co.uk")).toBe(true);
    expect(isClubHost("club-management-web-theheathens1878s-projects.vercel.app")).toBe(true);
    expect(isClubHost("localhost:3000")).toBe(true);
  });

  it("refuses anything else, including look-alikes", () => {
    expect(isClubHost("aomsportsclub.co.uk.evil.example")).toBe(false);
    expect(isClubHost("evil.example")).toBe(false);
    expect(isClubHost("")).toBe(false);
  });
});

describe("originFromHeaders", () => {
  it("follows the forwarded host when it is the club's", () => {
    const h = new Headers({ "x-forwarded-host": "portal.aomsportsclub.co.uk", "x-forwarded-proto": "https" });
    expect(originFromHeaders(h)).toBe("https://portal.aomsportsclub.co.uk");
  });

  it("falls back to the canonical address for a foreign host", () => {
    const h = new Headers({ host: "attacker.example" });
    expect(originFromHeaders(h)).toBe(process.env.NEXT_PUBLIC_SITE_URL ?? "");
  });
});
