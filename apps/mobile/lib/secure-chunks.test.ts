import { describe, expect, it } from "vitest";

import {
  CHUNK_SIZE_BYTES,
  chunkKey,
  decodeManifest,
  encodeManifest,
  needsChunking,
  sanitiseKey,
  splitIntoChunks,
  utf8ByteLength,
} from "./secure-chunks";

describe("sanitiseKey", () => {
  it("leaves a Supabase auth key untouched", () => {
    expect(sanitiseKey("sb-rwpglslbkhsqyxjhnpue-auth-token")).toBe(
      "sb-rwpglslbkhsqyxjhnpue-auth-token",
    );
  });

  it("replaces characters SecureStore rejects", () => {
    expect(sanitiseKey("sb:auth token/1")).toBe("sb_auth_token_1");
  });
});

describe("chunkKey", () => {
  it("namespaces chunks under the sanitised key", () => {
    expect(chunkKey("sb:auth", 2)).toBe("sb_auth.chunk.2");
  });
});

describe("utf8ByteLength", () => {
  it("counts multi-byte code points", () => {
    expect(utf8ByteLength("abc")).toBe(3);
    expect(utf8ByteLength("é")).toBe(2);
    expect(utf8ByteLength("€")).toBe(3);
    expect(utf8ByteLength("🏉")).toBe(4);
  });
});

describe("splitIntoChunks", () => {
  it("returns a single chunk for a short value", () => {
    expect(splitIntoChunks("hello")).toEqual(["hello"]);
  });

  it("returns one empty chunk for an empty value", () => {
    expect(splitIntoChunks("")).toEqual([""]);
  });

  it("round-trips a value larger than the chunk size", () => {
    const value = "x".repeat(CHUNK_SIZE_BYTES * 3 + 17);
    const chunks = splitIntoChunks(value);
    expect(chunks.length).toBe(4);
    expect(chunks.join("")).toBe(value);
  });

  it("keeps every chunk within the byte budget", () => {
    const value = "é".repeat(2000);
    const chunks = splitIntoChunks(value, 100);
    for (const chunk of chunks) {
      expect(utf8ByteLength(chunk)).toBeLessThanOrEqual(100);
    }
    expect(chunks.join("")).toBe(value);
  });

  it("never splits a surrogate pair", () => {
    const value = "🏉".repeat(50);
    const chunks = splitIntoChunks(value, 10);
    for (const chunk of chunks) {
      expect([...chunk].every((cp) => cp === "🏉")).toBe(true);
    }
    expect(chunks.join("")).toBe(value);
  });

  it("rejects a nonsensical budget", () => {
    expect(() => splitIntoChunks("abc", 2)).toThrow(RangeError);
  });
});

describe("needsChunking", () => {
  it("is false for a small session and true for a large one", () => {
    expect(needsChunking("{}")).toBe(false);
    expect(needsChunking("y".repeat(CHUNK_SIZE_BYTES + 1))).toBe(true);
  });
});

describe("manifest", () => {
  it("round-trips a chunk count", () => {
    expect(decodeManifest(encodeManifest(7))).toBe(7);
  });

  it("treats an ordinary value as unchunked", () => {
    expect(decodeManifest('{"access_token":"ey..."}')).toBeNull();
    expect(decodeManifest(null)).toBeNull();
  });

  it("rejects an invalid count", () => {
    expect(() => encodeManifest(0)).toThrow(RangeError);
    expect(decodeManifest("aomclub.chunked.v1:nope")).toBeNull();
  });
});
