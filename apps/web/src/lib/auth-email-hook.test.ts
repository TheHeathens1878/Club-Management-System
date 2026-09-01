import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  AUTH_EMAIL_ACTION_TYPES,
  authEmailContent,
  buildAuthLink,
  nextPathFrom,
  otpTypeFor,
  parseAuthEmailPayload,
  parseHookSecret,
  readHookHeaders,
  resolveDelivery,
  safeRelativePath,
  verifyHookSignature,
  type AuthEmailActionType,
} from "./auth-email-hook";

const SITE = "https://portal.aomsportsclub.co.uk";
const SECRET_BYTES = Buffer.from("a-shared-secret-for-the-club-hook");
const SECRET = `v1,whsec_${SECRET_BYTES.toString("base64")}`;

const NOW_MS = Date.UTC(2026, 7, 25, 12, 0, 0);
const NOW_SECONDS = Math.floor(NOW_MS / 1000);

function sign(id: string, timestamp: number, body: string, key = SECRET_BYTES): string {
  return createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64");
}

// ---------------------------------------------------------------------------

describe("parseHookSecret", () => {
  it("accepts the dashboard's v1,whsec_ form", () => {
    expect(parseHookSecret(SECRET)?.equals(SECRET_BYTES)).toBe(true);
  });
  it("accepts the bare whsec_ and raw base64 forms", () => {
    expect(parseHookSecret(`whsec_${SECRET_BYTES.toString("base64")}`)?.equals(SECRET_BYTES)).toBe(true);
    expect(parseHookSecret(SECRET_BYTES.toString("base64"))?.equals(SECRET_BYTES)).toBe(true);
  });
  it("refuses nothing, and anything that is not base64", () => {
    expect(parseHookSecret(undefined)).toBeNull();
    expect(parseHookSecret("")).toBeNull();
    expect(parseHookSecret("v1,whsec_not base64!")).toBeNull();
  });

  // A real Supabase hook secret is 32 bytes. The dashboard shows base64 of
  // them; the Management API returns the same bytes as 64 hex characters.
  // Both spellings must land on the same key.
  const REAL_BYTES = Buffer.from(
    "8121189d3ea07efb49aac9c78d3b080b51b83c9bd4d100488aec09c1bbc50663",
    "hex",
  );

  it("accepts the hex form the Management API returns", () => {
    const hex = REAL_BYTES.toString("hex");
    expect(parseHookSecret(hex)?.equals(REAL_BYTES)).toBe(true);
    expect(parseHookSecret(hex.toUpperCase())?.equals(REAL_BYTES)).toBe(true);
    expect(parseHookSecret(`v1,whsec_${hex}`)?.equals(REAL_BYTES)).toBe(true);
  });

  it("agrees with the base64 spelling of the same secret", () => {
    expect(parseHookSecret(REAL_BYTES.toString("hex"))).toEqual(
      parseHookSecret(`v1,whsec_${REAL_BYTES.toString("base64")}`),
    );
  });

  it("does not mistake hex for base64, which is the silent-wrong-key trap", () => {
    // Hex digits are all in the base64 alphabet, so decoding hex AS base64
    // does not throw — it quietly returns 48 bytes of the wrong key, and
    // every signature then fails with nothing to say why.
    const hex = REAL_BYTES.toString("hex");
    expect(parseHookSecret(hex)?.length).toBe(32);
    expect(Buffer.from(hex, "base64").length).toBe(48);
  });

  it("still reads a base64 secret that is not 32 bytes long", () => {
    expect(parseHookSecret(SECRET)?.equals(SECRET_BYTES)).toBe(true);
  });
});

describe("verifyHookSignature", () => {
  const body = JSON.stringify({ user: { email: "jo@example.com" } });
  const id = "msg_2abc";

  it("accepts a good signature", () => {
    const result = verifyHookSignature({
      secret: SECRET,
      id,
      timestamp: String(NOW_SECONDS),
      signature: `v1,${sign(id, NOW_SECONDS, body)}`,
      body,
      now: NOW_MS,
    });
    expect(result.ok).toBe(true);
  });

  it("accepts a header carrying several signatures, one of which matches", () => {
    const other = sign(id, NOW_SECONDS, body, Buffer.from("an-older-rotated-secret"));
    const good = sign(id, NOW_SECONDS, body);
    const result = verifyHookSignature({
      secret: SECRET,
      id,
      timestamp: String(NOW_SECONDS),
      signature: `v1,${other} v1,${good}`,
      body,
      now: NOW_MS,
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a signature made with a different secret", () => {
    const result = verifyHookSignature({
      secret: SECRET,
      id,
      timestamp: String(NOW_SECONDS),
      signature: `v1,${sign(id, NOW_SECONDS, body, Buffer.from("the-wrong-secret"))}`,
      body,
      now: NOW_MS,
    });
    expect(result).toEqual({ ok: false, reason: "signature_mismatch" });
  });

  it("rejects a signature over a different body, id or version", () => {
    const signature = `v1,${sign(id, NOW_SECONDS, body)}`;
    expect(
      verifyHookSignature({ secret: SECRET, id, timestamp: String(NOW_SECONDS), signature, body: `${body} `, now: NOW_MS }).ok,
    ).toBe(false);
    expect(
      verifyHookSignature({ secret: SECRET, id: "msg_other", timestamp: String(NOW_SECONDS), signature, body, now: NOW_MS }).ok,
    ).toBe(false);
    expect(
      verifyHookSignature({
        secret: SECRET,
        id,
        timestamp: String(NOW_SECONDS),
        signature: `v2,${sign(id, NOW_SECONDS, body)}`,
        body,
        now: NOW_MS,
      }),
    ).toEqual({ ok: false, reason: "signature_mismatch" });
  });

  it("rejects a timestamp more than five minutes old, or in the future", () => {
    const old = NOW_SECONDS - 301;
    expect(
      verifyHookSignature({
        secret: SECRET,
        id,
        timestamp: String(old),
        signature: `v1,${sign(id, old, body)}`,
        body,
        now: NOW_MS,
      }),
    ).toEqual({ ok: false, reason: "timestamp_too_old" });

    const ahead = NOW_SECONDS + 301;
    expect(
      verifyHookSignature({
        secret: SECRET,
        id,
        timestamp: String(ahead),
        signature: `v1,${sign(id, ahead, body)}`,
        body,
        now: NOW_MS,
      }),
    ).toEqual({ ok: false, reason: "timestamp_in_future" });
  });

  it("accepts a timestamp just inside the window", () => {
    const recent = NOW_SECONDS - 299;
    expect(
      verifyHookSignature({
        secret: SECRET,
        id,
        timestamp: String(recent),
        signature: `v1,${sign(id, recent, body)}`,
        body,
        now: NOW_MS,
      }).ok,
    ).toBe(true);
  });

  it("rejects missing headers, a non-numeric timestamp and a missing secret", () => {
    const signature = `v1,${sign(id, NOW_SECONDS, body)}`;
    expect(
      verifyHookSignature({ secret: SECRET, id: null, timestamp: String(NOW_SECONDS), signature, body, now: NOW_MS }),
    ).toEqual({ ok: false, reason: "missing_headers" });
    expect(
      verifyHookSignature({ secret: SECRET, id, timestamp: "not-a-number", signature, body, now: NOW_MS }),
    ).toEqual({ ok: false, reason: "bad_timestamp" });
    expect(
      verifyHookSignature({ secret: "", id, timestamp: String(NOW_SECONDS), signature, body, now: NOW_MS }),
    ).toEqual({ ok: false, reason: "secret_missing_or_malformed" });
  });
});

describe("readHookHeaders", () => {
  it("reads the webhook-* headers, falling back to svix-*", () => {
    const webhook = new Headers({
      "webhook-id": "a",
      "webhook-timestamp": "1",
      "webhook-signature": "v1,x",
    });
    expect(readHookHeaders(webhook)).toEqual({ id: "a", timestamp: "1", signature: "v1,x" });

    const svix = new Headers({ "svix-id": "b", "svix-timestamp": "2", "svix-signature": "v1,y" });
    expect(readHookHeaders(svix)).toEqual({ id: "b", timestamp: "2", signature: "v1,y" });

    expect(readHookHeaders(new Headers())).toEqual({ id: null, timestamp: null, signature: null });
  });
});

// ---------------------------------------------------------------------------

function payloadFor(action: AuthEmailActionType, extra: Record<string, unknown> = {}) {
  return {
    user: { email: "jo@example.com", new_email: "jo.new@example.com" },
    email_data: {
      token: "123456",
      token_hash: "hash-current",
      token_new: "654321",
      token_hash_new: "hash-new",
      redirect_to: `${SITE}/auth/callback`,
      email_action_type: action,
      site_url: SITE,
      ...extra,
    },
  };
}

describe("parseAuthEmailPayload", () => {
  it("reads a well-formed payload", () => {
    const parsed = parseAuthEmailPayload(payloadFor("signup"));
    expect(parsed?.user.email).toBe("jo@example.com");
    expect(parsed?.emailData.action).toBe("signup");
    expect(parsed?.emailData.tokenHash).toBe("hash-current");
  });
  it("refuses anything that is not a known action type", () => {
    expect(parseAuthEmailPayload(payloadFor("nonsense" as unknown as AuthEmailActionType))).toBeNull();
    expect(parseAuthEmailPayload({})).toBeNull();
    expect(parseAuthEmailPayload(null)).toBeNull();
    expect(parseAuthEmailPayload("signup")).toBeNull();
  });
});

describe("resolveDelivery", () => {
  it("sends everything but an email change to the address on the account", () => {
    const delivery = resolveDelivery(parseAuthEmailPayload(payloadFor("recovery"))!);
    expect(delivery).toMatchObject({
      to: "jo@example.com",
      otpType: "recovery",
      tokenHash: "hash-current",
      token: "123456",
    });
  });
  it("sends the new-address half of an email change to the new address", () => {
    const delivery = resolveDelivery(parseAuthEmailPayload(payloadFor("email_change_new"))!);
    expect(delivery).toMatchObject({
      to: "jo.new@example.com",
      otpType: "email_change",
      tokenHash: "hash-new",
    });
  });
  it("sends the current-address half to the address on the account", () => {
    const delivery = resolveDelivery(parseAuthEmailPayload(payloadFor("email_change_current"))!);
    expect(delivery).toMatchObject({ to: "jo@example.com", tokenHash: "hash-current" });
  });
  it("has no recipient when the payload has no address", () => {
    const raw = payloadFor("signup");
    raw.user = { email: "", new_email: "" };
    expect(resolveDelivery(parseAuthEmailPayload(raw)!)).toBeNull();
  });
});

describe("otpTypeFor", () => {
  it("maps every action type Auth can send", () => {
    expect(otpTypeFor("signup")).toBe("signup");
    expect(otpTypeFor("invite")).toBe("invite");
    expect(otpTypeFor("magiclink")).toBe("magiclink");
    expect(otpTypeFor("recovery")).toBe("recovery");
    expect(otpTypeFor("email_change")).toBe("email_change");
    expect(otpTypeFor("email_change_current")).toBe("email_change");
    expect(otpTypeFor("email_change_new")).toBe("email_change");
    expect(otpTypeFor("reauthentication")).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe("safeRelativePath", () => {
  it("keeps a path on this site", () => {
    expect(safeRelativePath("/lobby")).toBe("/lobby");
    expect(safeRelativePath("/teams/u12?tab=squad")).toBe("/teams/u12?tab=squad");
  });
  it("refuses anything that could leave the site, and the callback itself", () => {
    expect(safeRelativePath("//evil.example.com")).toBeNull();
    expect(safeRelativePath("https://evil.example.com/x")).toBeNull();
    expect(safeRelativePath("/\\evil.example.com")).toBeNull();
    expect(safeRelativePath("/auth/callback")).toBeNull();
    expect(safeRelativePath(null)).toBeNull();
    expect(safeRelativePath("")).toBeNull();
  });
});

describe("nextPathFrom", () => {
  it("yields nothing for the bare callback the app asks for today", () => {
    expect(nextPathFrom(`${SITE}/auth/callback`, SITE)).toBeNull();
  });
  it("unwraps a destination the callback URL carries", () => {
    expect(nextPathFrom(`${SITE}/auth/callback?next=%2Fwelcome`, SITE)).toBe("/welcome");
  });
  it("keeps a same-site destination", () => {
    expect(nextPathFrom(`${SITE}/join?step=2`, SITE)).toBe("/join?step=2");
  });
  it("drops anything on another origin", () => {
    expect(nextPathFrom("https://evil.example.com/steal", SITE)).toBeNull();
    expect(nextPathFrom("//evil.example.com/steal", SITE)).toBeNull();
    expect(nextPathFrom(null, SITE)).toBeNull();
  });
});

describe("buildAuthLink", () => {
  const linkFor = (action: AuthEmailActionType, redirectTo?: string) => {
    const delivery = resolveDelivery(parseAuthEmailPayload(payloadFor(action))!)!;
    return buildAuthLink({ siteUrl: SITE, delivery, redirectTo: redirectTo ?? `${SITE}/auth/callback` });
  };

  it("builds one link per action type", () => {
    expect(linkFor("signup")).toBe(`${SITE}/auth/callback?token_hash=hash-current&type=signup`);
    expect(linkFor("invite")).toBe(`${SITE}/auth/callback?token_hash=hash-current&type=invite`);
    expect(linkFor("magiclink")).toBe(`${SITE}/auth/callback?token_hash=hash-current&type=magiclink`);
    expect(linkFor("recovery")).toBe(`${SITE}/auth/callback?token_hash=hash-current&type=recovery`);
    expect(linkFor("email_change")).toBe(`${SITE}/auth/callback?token_hash=hash-new&type=email_change`);
    expect(linkFor("email_change_new")).toBe(`${SITE}/auth/callback?token_hash=hash-new&type=email_change`);
    expect(linkFor("email_change_current")).toBe(
      `${SITE}/auth/callback?token_hash=hash-current&type=email_change`,
    );
    expect(linkFor("reauthentication")).toBeNull();
  });

  it("appends a destination when the link asked for one", () => {
    expect(linkFor("magiclink", `${SITE}/portal`)).toBe(
      `${SITE}/auth/callback?token_hash=hash-current&type=magiclink&next=%2Fportal`,
    );
  });

  it("escapes the token hash and tolerates a trailing slash on the site URL", () => {
    const delivery = resolveDelivery(
      parseAuthEmailPayload(payloadFor("recovery", { token_hash: "a b/c" }))!,
    )!;
    expect(buildAuthLink({ siteUrl: `${SITE}/`, delivery })).toBe(
      `${SITE}/auth/callback?token_hash=a%20b%2Fc&type=recovery`,
    );
  });

  it("has no link when Auth sent no token", () => {
    const delivery = resolveDelivery(
      parseAuthEmailPayload(payloadFor("signup", { token_hash: "" }))!,
    )!;
    expect(buildAuthLink({ siteUrl: SITE, delivery })).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe("authEmailContent", () => {
  const content = (action: AuthEmailActionType) =>
    authEmailContent({
      action,
      clubName: "AoM Sports Club",
      brandColor: "#C23D1C",
      linkUrl: action === "reauthentication" ? null : `${SITE}/auth/callback?token_hash=h&type=x`,
      token: "123456",
    });

  it("writes a subject, a button and a plain URL for every link email", () => {
    for (const action of AUTH_EMAIL_ACTION_TYPES) {
      const { subject, html, text } = content(action);
      expect(subject).toContain("AoM Sports Club");
      expect(html).toContain("AoM Sports Club");
      if (action === "reauthentication") continue;
      // Once as a button, once as a URL a person can copy.
      expect(html).toContain(`href="${SITE}/auth/callback?token_hash=h&type=x"`);
      expect(html.split(`${SITE}/auth/callback?token_hash=h&type=x`).length - 1).toBe(2);
      expect(text).toContain(`${SITE}/auth/callback?token_hash=h&type=x`);
    }
  });

  it("tells everyone what to do if they did not ask for it", () => {
    for (const action of AUTH_EMAIL_ACTION_TYPES) {
      const { html, text } = content(action);
      expect(html).toContain("If you did not ask for this");
      expect(text).toContain("If you did not ask for this");
    }
  });

  it("shows the code only where a person could be asked for one", () => {
    for (const action of AUTH_EMAIL_ACTION_TYPES) {
      const shows = action === "magiclink" || action === "recovery" || action === "reauthentication";
      expect(content(action).text.includes("123456")).toBe(shows);
    }
  });

  it("warns the current address that a change it did not ask for is an intrusion", () => {
    expect(content("email_change_current").text).toContain("contact the club");
  });

  it("leaves out the code when Auth sent none", () => {
    const { text } = authEmailContent({
      action: "magiclink",
      clubName: "AoM Sports Club",
      brandColor: "#C23D1C",
      linkUrl: `${SITE}/auth/callback?token_hash=h&type=magiclink`,
      token: null,
    });
    expect(text).not.toContain("123456");
    expect(text).not.toContain("asked for a code");
  });
});
