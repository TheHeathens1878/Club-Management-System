import { describe, expect, it } from "vitest";
import { CANONICAL_SITE_URL, siteUrlFrom } from "./utils";

describe("siteUrlFrom", () => {
  it("on production, a raw *.vercel.app address gives way to the club's own", () => {
    expect(siteUrlFrom("https://club-management-web-theheathens1878s-projects.vercel.app", "production")).toBe(CANONICAL_SITE_URL);
    expect(siteUrlFrom("https://club-management-web.vercel.app/", "production")).toBe(CANONICAL_SITE_URL);
  });
  it("on production, nothing configured also gives the club's own", () => {
    expect(siteUrlFrom(undefined, "production")).toBe(CANONICAL_SITE_URL);
    expect(siteUrlFrom("", "production")).toBe(CANONICAL_SITE_URL);
  });
  it("on production, a club address is kept as configured", () => {
    expect(siteUrlFrom("https://roombooking.aomsportsclub.co.uk", "production")).toBe("https://roombooking.aomsportsclub.co.uk");
  });
  it("a preview keeps its own vercel.app address", () => {
    expect(siteUrlFrom("https://club-management-abc123.vercel.app", "preview")).toBe("https://club-management-abc123.vercel.app");
  });
  it("outside Vercel, the configured value is used and a trailing slash dropped", () => {
    expect(siteUrlFrom("http://localhost:3000/", undefined)).toBe("http://localhost:3000");
    expect(siteUrlFrom(undefined, undefined)).toBeNull();
  });
});
