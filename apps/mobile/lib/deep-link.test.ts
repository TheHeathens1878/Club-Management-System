import { describe, expect, it } from "vitest";

import { parseAuthRedirect } from "./deep-link";

describe("parseAuthRedirect", () => {
  it("reads a PKCE code from the query string", () => {
    expect(
      parseAuthRedirect("aomclub://auth/callback?code=abc123"),
    ).toEqual({ kind: "code", code: "abc123" });
  });

  it("reads implicit-flow tokens from the fragment", () => {
    expect(
      parseAuthRedirect(
        "aomclub://auth/callback#access_token=at&refresh_token=rt&token_type=bearer",
      ),
    ).toEqual({ kind: "tokens", accessToken: "at", refreshToken: "rt" });
  });

  it("surfaces an error description", () => {
    expect(
      parseAuthRedirect(
        "aomclub://auth/callback#error=access_denied&error_description=Email+link+is+invalid+or+has+expired",
      ),
    ).toEqual({
      kind: "error",
      message: "Email link is invalid or has expired",
    });
  });

  it("prefers the error over a code", () => {
    const result = parseAuthRedirect(
      "aomclub://auth/callback?code=abc&error_description=nope",
    );
    expect(result?.kind).toBe("error");
  });

  it("ignores links with nothing auth-related in them", () => {
    expect(parseAuthRedirect("aomclub://teams/123")).toBeNull();
    expect(parseAuthRedirect(null)).toBeNull();
    expect(parseAuthRedirect("not a url")).toBeNull();
  });

  it("handles an https universal link the same way", () => {
    expect(
      parseAuthRedirect("https://roombooking.aomsportsclub.co.uk/auth?code=xyz"),
    ).toEqual({ kind: "code", code: "xyz" });
  });

  it("does not let the fragment shadow a query parameter", () => {
    expect(
      parseAuthRedirect("aomclub://auth?code=fromquery#code=fromhash"),
    ).toEqual({ kind: "code", code: "fromquery" });
  });
});
