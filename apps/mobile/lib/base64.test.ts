import { describe, expect, it } from "vitest";

import { attachmentFileName, attachmentPath, base64ToBytes } from "./base64";

function encode(bytes: number[]): string {
  return Buffer.from(Uint8Array.from(bytes)).toString("base64");
}

describe("base64ToBytes", () => {
  it("round-trips bytes through base64", () => {
    const original = [0, 1, 127, 128, 255, 42, 200];
    expect([...base64ToBytes(encode(original))]).toEqual(original);
  });

  it("handles every padding length", () => {
    for (const length of [1, 2, 3, 4, 5]) {
      const original = Array.from({ length }, (_, index) => index * 17);
      expect([...base64ToBytes(encode(original))]).toEqual(original);
    }
  });

  it("matches a real JPEG header", () => {
    // The first bytes expo-image-picker hands back for a JPEG.
    expect([...base64ToBytes("/9j/4AAQ")]).toEqual([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10,
    ]);
  });

  it("ignores whitespace and padding", () => {
    expect([...base64ToBytes("AAEC\n  ==")]).toEqual([0, 1, 2]);
  });

  it("accepts base64url as well", () => {
    expect([...base64ToBytes("-_8")]).toEqual([251, 255]);
  });

  it("throws rather than uploading rubbish", () => {
    expect(() => base64ToBytes("not base64!!")).toThrow(/invalid base64/i);
  });

  it("returns nothing for an empty string", () => {
    expect(base64ToBytes("")).toHaveLength(0);
  });
});

describe("attachmentPath", () => {
  it("nests the object under its conversation and message", () => {
    expect(attachmentPath("conv", "msg", "photo.jpg")).toBe(
      "conv/msg/photo.jpg",
    );
  });

  it("strips anything that could escape the prefix", () => {
    const path = attachmentPath("conv", "msg", "../../secret.png");
    expect(path).toBe("conv/msg/.._.._secret.png");
    expect(path.startsWith("conv/msg/")).toBe(true);
  });

  it("never produces an empty file name", () => {
    expect(attachmentPath("conv", "msg", "")).toBe("conv/msg/upload");
  });
});

describe("attachmentFileName", () => {
  it("keeps a name the picker already gave us", () => {
    expect(attachmentFileName("file:///tmp/IMG_0001.HEIC", "image/heic")).toBe(
      "IMG_0001.HEIC",
    );
  });

  it("ignores a query string on the uri", () => {
    expect(attachmentFileName("file:///tmp/a.png?x=1", "image/png")).toBe(
      "a.png",
    );
  });

  it("derives an extension from the mime type when there is none", () => {
    expect(attachmentFileName("file:///tmp/asset", "image/png")).toBe(
      "image.png",
    );
    expect(attachmentFileName(null, "image/webp")).toBe("image.webp");
  });

  it("falls back to jpg for an unknown type", () => {
    expect(attachmentFileName(null, null)).toBe("image.jpg");
  });
});
