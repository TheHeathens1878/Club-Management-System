/**
 * A minimal STORE-only zip writer.
 *
 * The app has no zip dependency and this is not a reason to add one: the only
 * archive it builds is a handful of squad photos, already-compressed JPEG/PNG/
 * WebP bytes that deflate would not shrink. STORE (method 0) copies them
 * through unchanged, which every unzip on every platform reads.
 *
 * The format is APPNOTE 6.3.x, the 1989-vintage core of it: a local file header
 * plus bytes for each entry, then a central directory repeating those headers
 * with the offset each one starts at, then an end-of-central-directory record
 * pointing at the directory. No data descriptors (sizes and CRCs are known
 * before anything is written), no zip64 (see the guards below), no extra
 * fields.
 *
 * Names are UTF-8 with general-purpose flag bit 11 set, which is what tells a
 * reader not to fall back to CP437 — the difference between "Siân Ó Brien.jpg"
 * and mojibake on a Windows desktop.
 */

/** "PK\3\4" — the head of every entry. */
export const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
/** "PK\1\2" — the head of every central directory record. */
export const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
/** "PK\5\6" — the single record that closes the archive. */
export const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;

/** Bit 11 of the general-purpose flags: the name (and comment) is UTF-8. */
const FLAG_UTF8_NAMES = 0x0800;
/** Version 2.0: enough for STORE and for folders, and universally understood. */
const VERSION = 20;
/** Method 0 — stored, not deflated. */
const METHOD_STORE = 0;

const LOCAL_HEADER_BYTES = 30;
const CENTRAL_HEADER_BYTES = 46;
const END_RECORD_BYTES = 22;

/** Where zip64 would have to take over, and where this writer refuses instead. */
const MAX_ENTRIES = 0xffff;
const MAX_BYTES = 0xffffffff;

export type ZipEntry = {
  /** The name inside the archive. Forward slashes separate folders. */
  name: string;
  data: Uint8Array;
};

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 (IEEE 802.3, reflected), the checksum every zip entry carries. */
export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    crc = CRC_TABLE[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * MS-DOS packed date and time — two 16-bit fields, two-second resolution, and
 * no year before 1980. A clock that somehow reads earlier is clamped rather
 * than allowed to write a negative year field.
 */
function dosStamp(at: Date): { time: number; date: number } {
  const year = Math.max(1980, at.getFullYear());
  return {
    time: (at.getHours() << 11) | (at.getMinutes() << 5) | (at.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((at.getMonth() + 1) << 5) | at.getDate(),
  };
}

/**
 * A name that is safe to unpack: no directory separators, no drive letters, no
 * traversal, no control characters, and none of the characters Windows refuses
 * outright. An archive is untrusted input to whoever opens it, and the entry
 * names here are built from member names — so they are cleaned here, once.
 */
export function zipSafeName(name: string): string {
  const cleaned = name
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[/\\:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    // A trailing dot or space is silently dropped by Windows; drop it here so
    // the name in the archive is the name on disk.
    .replace(/[. ]+$/, "");
  return cleaned === "" ? "unnamed" : cleaned.slice(0, 120);
}

/**
 * Build the archive. Everything is held in memory, which is the right trade at
 * this size (a squad of thirty 5MB photos is the ceiling the bucket enforces)
 * and the reason for the guards.
 */
export function buildZip(entries: ZipEntry[], modified: Date = new Date()): Uint8Array {
  if (entries.length > MAX_ENTRIES) {
    throw new Error(`A zip without zip64 holds at most ${MAX_ENTRIES} entries.`);
  }

  const encoder = new TextEncoder();
  const prepared = entries.map((entry) => {
    const nameBytes = encoder.encode(entry.name);
    return { nameBytes, data: entry.data, crc: crc32(entry.data) };
  });

  const localBytes = prepared.reduce(
    (sum, e) => sum + LOCAL_HEADER_BYTES + e.nameBytes.length + e.data.length,
    0,
  );
  const centralBytes = prepared.reduce(
    (sum, e) => sum + CENTRAL_HEADER_BYTES + e.nameBytes.length,
    0,
  );
  const total = localBytes + centralBytes + END_RECORD_BYTES;
  if (total > MAX_BYTES) {
    throw new Error("A zip without zip64 holds at most 4GB.");
  }

  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  const { time, date } = dosStamp(modified);
  const offsets: number[] = [];
  let at = 0;

  const u16 = (value: number) => {
    view.setUint16(at, value, true);
    at += 2;
  };
  const u32 = (value: number) => {
    view.setUint32(at, value, true);
    at += 4;
  };
  const bytes = (value: Uint8Array) => {
    out.set(value, at);
    at += value.length;
  };

  for (const entry of prepared) {
    offsets.push(at);
    u32(LOCAL_FILE_HEADER_SIGNATURE);
    u16(VERSION);
    u16(FLAG_UTF8_NAMES);
    u16(METHOD_STORE);
    u16(time);
    u16(date);
    u32(entry.crc);
    u32(entry.data.length); // compressed size — the same, stored
    u32(entry.data.length); // uncompressed size
    u16(entry.nameBytes.length);
    u16(0); // no extra field
    bytes(entry.nameBytes);
    bytes(entry.data);
  }

  const centralStart = at;
  for (let i = 0; i < prepared.length; i += 1) {
    const entry = prepared[i]!;
    u32(CENTRAL_DIRECTORY_SIGNATURE);
    u16(VERSION); // version made by
    u16(VERSION); // version needed to extract
    u16(FLAG_UTF8_NAMES);
    u16(METHOD_STORE);
    u16(time);
    u16(date);
    u32(entry.crc);
    u32(entry.data.length);
    u32(entry.data.length);
    u16(entry.nameBytes.length);
    u16(0); // extra field length
    u16(0); // comment length
    u16(0); // disk number start
    u16(0); // internal attributes
    u32(0); // external attributes
    u32(offsets[i]!); // where this entry's local header begins
    bytes(entry.nameBytes);
  }

  // Measured before the closing record is written, or it would count itself.
  const centralSize = at - centralStart;

  u32(END_OF_CENTRAL_DIRECTORY_SIGNATURE);
  u16(0); // this disk
  u16(0); // the disk the central directory starts on
  u16(prepared.length); // entries on this disk
  u16(prepared.length); // entries in total
  u32(centralSize);
  u32(centralStart); // central directory offset
  u16(0); // no archive comment

  return out;
}
