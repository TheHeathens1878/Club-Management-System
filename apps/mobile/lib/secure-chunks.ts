/**
 * Pure helpers for storing values larger than iOS Keychain / Android
 * EncryptedSharedPreferences comfortably accept.
 *
 * expo-secure-store warns above ~2048 bytes per entry, and a Supabase session
 * (access JWT + refresh token + user metadata) routinely exceeds that. Values
 * over the limit are split across `<key>.chunk.<n>` entries and the primary key
 * holds a manifest instead of the value.
 *
 * No React Native imports live here on purpose — this is the part worth
 * unit-testing (lib/secure-chunks.test.ts).
 */

/** Bytes per chunk. Kept well under the 2048-byte warning threshold. */
export const CHUNK_SIZE_BYTES = 1536;

const MANIFEST_PREFIX = "aomclub.chunked.v1:";

/** SecureStore keys accept alphanumerics, ".", "-" and "_" only. */
export function sanitiseKey(key: string): string {
  return key.replace(/[^A-Za-z0-9._-]/g, "_");
}

/** Key under which chunk `index` of `key` is stored. */
export function chunkKey(key: string, index: number): string {
  return `${sanitiseKey(key)}.chunk.${index}`;
}

/** UTF-8 byte length of a single code point. */
function utf8Length(codePoint: string): number {
  const code = codePoint.codePointAt(0) ?? 0;
  if (code < 0x80) return 1;
  if (code < 0x800) return 2;
  if (code < 0x10000) return 3;
  return 4;
}

/** UTF-8 byte length of a string. */
export function utf8ByteLength(value: string): number {
  let total = 0;
  for (const codePoint of value) total += utf8Length(codePoint);
  return total;
}

/**
 * Split on code-point boundaries (never mid-surrogate-pair) so each chunk is at
 * most `maxBytes` when UTF-8 encoded. Always returns at least one chunk.
 */
export function splitIntoChunks(
  value: string,
  maxBytes: number = CHUNK_SIZE_BYTES,
): string[] {
  if (maxBytes < 4) {
    throw new RangeError("maxBytes must be at least 4 (one UTF-8 code point)");
  }
  const chunks: string[] = [];
  let current = "";
  let currentBytes = 0;

  for (const codePoint of value) {
    const size = utf8Length(codePoint);
    if (currentBytes + size > maxBytes) {
      chunks.push(current);
      current = "";
      currentBytes = 0;
    }
    current += codePoint;
    currentBytes += size;
  }

  if (current.length > 0 || chunks.length === 0) chunks.push(current);
  return chunks;
}

/** True when the value must be chunked rather than stored inline. */
export function needsChunking(
  value: string,
  maxBytes: number = CHUNK_SIZE_BYTES,
): boolean {
  return utf8ByteLength(value) > maxBytes;
}

/** Manifest written to the primary key when a value has been chunked. */
export function encodeManifest(chunkCount: number): string {
  if (!Number.isInteger(chunkCount) || chunkCount < 1) {
    throw new RangeError("chunkCount must be a positive integer");
  }
  return `${MANIFEST_PREFIX}${chunkCount}`;
}

/**
 * Chunk count for a manifest, or `null` when `raw` is an ordinary value stored
 * inline (which is how small sessions and any pre-chunking writes look).
 */
export function decodeManifest(raw: string | null): number | null {
  if (raw === null || !raw.startsWith(MANIFEST_PREFIX)) return null;
  const count = Number(raw.slice(MANIFEST_PREFIX.length));
  return Number.isInteger(count) && count >= 1 ? count : null;
}
