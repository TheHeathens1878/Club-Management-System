import { describe, expect, it } from "vitest";

import {
  conversationIdFromDeepLink,
  conversationIdFromPushData,
  messagesDeepLink,
  messagesRoute,
  normalisePlatform,
  routeForPushData,
} from "./push";

const ID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

describe("conversationIdFromPushData", () => {
  it("reads the payload push-fanout sends", () => {
    expect(
      conversationIdFromPushData({
        entity: "conversations",
        entity_id: ID,
        template: "message",
      }),
    ).toBe(ID);
  });

  it("accepts the camelCase spelling too", () => {
    expect(
      conversationIdFromPushData({ entity: "conversations", entityId: ID }),
    ).toBe(ID);
  });

  it("ignores a notification about something else", () => {
    expect(
      conversationIdFromPushData({ entity: "subscriptions", entity_id: ID }),
    ).toBeNull();
  });

  it("refuses an id that is not a uuid", () => {
    expect(
      conversationIdFromPushData({ entity: "conversations", entity_id: "../../" }),
    ).toBeNull();
  });

  it("survives a missing or malformed payload", () => {
    expect(conversationIdFromPushData(undefined)).toBeNull();
    expect(conversationIdFromPushData(null)).toBeNull();
    expect(conversationIdFromPushData("nonsense")).toBeNull();
    expect(conversationIdFromPushData({})).toBeNull();
  });
});

describe("routeForPushData", () => {
  it("routes a message notification to its thread", () => {
    expect(routeForPushData({ entity: "conversations", entity_id: ID })).toBe(
      `/messages/${ID}`,
    );
  });

  it("stays put for anything else", () => {
    expect(routeForPushData({ entity: "subscriptions", entity_id: ID })).toBeNull();
  });
});

describe("deep links", () => {
  it("builds the club's scheme", () => {
    expect(messagesDeepLink(ID)).toBe(`aomclub://messages/${ID}`);
    expect(messagesRoute(ID)).toBe(`/messages/${ID}`);
  });

  it("parses a conversation id back out of one", () => {
    expect(conversationIdFromDeepLink(`aomclub://messages/${ID}`)).toBe(ID);
    expect(
      conversationIdFromDeepLink(`https://aomsportsclub.co.uk/messages/${ID}`),
    ).toBe(ID);
  });

  it("returns null for a link that names no conversation", () => {
    expect(conversationIdFromDeepLink("aomclub://fixtures")).toBeNull();
    expect(conversationIdFromDeepLink(null)).toBeNull();
  });
});

describe("normalisePlatform", () => {
  it("maps the platforms we send from", () => {
    expect(normalisePlatform("ios")).toBe("ios");
    expect(normalisePlatform("Android")).toBe("android");
    // Not "web": that value is reserved for a browser's Web Push
    // subscription, and the database rejects an Expo token wearing it.
    expect(normalisePlatform("macos")).toBe("unknown");
  });
});
