/**
 * Base64 → bytes.
 *
 * `expo-image-picker` can hand back the picked image as base64, which is the
 * one form that needs no extra native module to read a file. supabase-js wants
 * bytes, so this converts. Kept pure (no `atob`, no Buffer) so it behaves the
 * same under Hermes and under vitest, and so it can be tested.
 */

const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

const LOOKUP = /* @__PURE__ */ (() => {
  const table = new Uint8Array(128).fill(255);
  for (let index = 0; index < ALPHABET.length; index += 1) {
    table[ALPHABET.charCodeAt(index)] = index;
  }
  // URL-safe aliases, in case a caller hands us base64url.
  table["-".charCodeAt(0)] = 62;
  table["_".charCodeAt(0)] = 63;
  return table;
})();

/** Throws on anything that is not valid base64 rather than uploading rubbish. */
export function base64ToBytes(input: string): Uint8Array {
  const clean = input.replace(/[\s=]/g, "");

  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let byteIndex = 0;
  let accumulator = 0;
  let bits = 0;

  for (let index = 0; index < clean.length; index += 1) {
    const code = clean.charCodeAt(index);
    const value = code < 128 ? LOOKUP[code] : undefined;
    if (value === undefined || value === 255) {
      throw new Error("That image could not be read (invalid base64).");
    }
    accumulator = (accumulator << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[byteIndex] = (accumulator >> bits) & 0xff;
      byteIndex += 1;
    }
  }

  return byteIndex === bytes.length ? bytes : bytes.subarray(0, byteIndex);
}

/** A storage path that cannot collide and carries no personal data. */
export function attachmentPath(
  conversationId: string,
  messageId: string,
  fileName: string,
): string {
  const safe = fileName.replace(/[^A-Za-z0-9._-]/g, "_").slice(-64) || "upload";
  return `${conversationId}/${messageId}/${safe}`;
}

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/webp": "webp",
  "image/gif": "gif",
};

/** Filename for a picked image, derived from its mime type when it has none. */
export function attachmentFileName(
  uri: string | null,
  contentType: string | null,
): string {
  const fromUri = uri?.split(/[?#]/)[0]?.split("/").pop()?.trim();
  if (fromUri && /\.[A-Za-z0-9]{2,5}$/.test(fromUri)) return fromUri;
  const extension = EXTENSIONS[(contentType ?? "").toLowerCase()] ?? "jpg";
  return `image.${extension}`;
}
