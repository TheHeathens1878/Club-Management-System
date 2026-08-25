import { describe, expect, it } from "vitest";

import {
  CENTRAL_DIRECTORY_SIGNATURE,
  END_OF_CENTRAL_DIRECTORY_SIGNATURE,
  LOCAL_FILE_HEADER_SIGNATURE,
  buildZip,
  crc32,
  zipSafeName,
} from "./zip";

const encoder = new TextEncoder();

/** The archive a squad export actually produces: two stored files. */
function twoFileArchive() {
  const first = { name: "Siân O'Brien.jpg", data: encoder.encode("first photo bytes") };
  const second = { name: "missing.txt", data: encoder.encode("Alex Ross\r\n") };
  const zip = buildZip([first, second], new Date(2026, 7, 25, 10, 30, 20));
  return { first, second, zip, view: new DataView(zip.buffer, zip.byteOffset, zip.byteLength) };
}

describe("crc32", () => {
  // The published check value for CRC-32/ISO-HDLC.
  it("gives 0xcbf43926 for the standard check string", () => {
    expect(crc32(encoder.encode("123456789"))).toBe(0xcbf43926);
  });

  it("gives 0 for no bytes at all", () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  it("is a known value for a short ASCII string", () => {
    expect(crc32(encoder.encode("hello world"))).toBe(0x0d4a1185);
  });
});

describe("buildZip", () => {
  it("opens with a local file header and closes with an end record", () => {
    const { zip, view } = twoFileArchive();
    expect(view.getUint32(0, true)).toBe(LOCAL_FILE_HEADER_SIGNATURE);
    expect(view.getUint32(zip.length - 22, true)).toBe(END_OF_CENTRAL_DIRECTORY_SIGNATURE);
  });

  it("counts both entries in the end record", () => {
    const { zip, view } = twoFileArchive();
    const end = zip.length - 22;
    expect(view.getUint16(end + 8, true)).toBe(2); // entries on this disk
    expect(view.getUint16(end + 10, true)).toBe(2); // entries in total
  });

  it("points the end record at a central directory of the right size", () => {
    const { zip, first, second, view } = twoFileArchive();
    const end = zip.length - 22;
    const centralSize = view.getUint32(end + 12, true);
    const centralOffset = view.getUint32(end + 16, true);

    expect(centralOffset + centralSize).toBe(end);
    const firstName = encoder.encode(first.name).length;
    const secondName = encoder.encode(second.name).length;
    expect(centralSize).toBe(46 * 2 + firstName + secondName);
    expect(view.getUint32(centralOffset, true)).toBe(CENTRAL_DIRECTORY_SIGNATURE);
  });

  it("records each entry's real local header offset", () => {
    const { zip, first, second, view } = twoFileArchive();
    const end = zip.length - 22;
    const centralOffset = view.getUint32(end + 16, true);
    const firstName = encoder.encode(first.name).length;
    const secondName = encoder.encode(second.name).length;

    const firstLocal = view.getUint32(centralOffset + 42, true);
    const secondCentral = centralOffset + 46 + firstName;
    const secondLocal = view.getUint32(secondCentral + 42, true);

    expect(firstLocal).toBe(0);
    expect(secondLocal).toBe(30 + firstName + first.data.length);
    expect(view.getUint32(secondCentral, true)).toBe(CENTRAL_DIRECTORY_SIGNATURE);
    expect(view.getUint32(secondLocal, true)).toBe(LOCAL_FILE_HEADER_SIGNATURE);
    // And the second local header is followed by its own name and bytes.
    expect(view.getUint16(secondLocal + 26, true)).toBe(secondName);
    expect(view.getUint32(secondLocal + 18, true)).toBe(second.data.length);
  });

  it("stores the bytes uncompressed, with matching sizes and CRCs", () => {
    const { zip, first, second, view } = twoFileArchive();
    const firstName = encoder.encode(first.name).length;

    expect(view.getUint16(4 + 4, true)).toBe(0); // method: stored
    expect(view.getUint32(14, true)).toBe(crc32(first.data));
    expect(view.getUint32(18, true)).toBe(first.data.length); // compressed
    expect(view.getUint32(22, true)).toBe(first.data.length); // uncompressed

    const body = zip.slice(30 + firstName, 30 + firstName + first.data.length);
    expect(new TextDecoder().decode(body)).toBe("first photo bytes");

    // The central record repeats the CRC the local header gave.
    const end = zip.length - 22;
    const centralOffset = view.getUint32(end + 16, true);
    expect(view.getUint32(centralOffset + 16, true)).toBe(crc32(first.data));
    expect(view.getUint32(centralOffset + 46 + firstName + 16, true)).toBe(crc32(second.data));
  });

  it("flags the names as UTF-8 and writes them as UTF-8", () => {
    const { zip, first, view } = twoFileArchive();
    expect(view.getUint16(6, true) & 0x0800).toBe(0x0800);
    const nameBytes = encoder.encode(first.name);
    expect(view.getUint16(26, true)).toBe(nameBytes.length);
    expect(nameBytes.length).toBeGreaterThan(first.name.length); // the â is two bytes
    expect(new TextDecoder().decode(zip.slice(30, 30 + nameBytes.length))).toBe(first.name);
  });

  it("writes an empty but valid archive for no entries", () => {
    const zip = buildZip([]);
    expect(zip.length).toBe(22);
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    expect(view.getUint32(0, true)).toBe(END_OF_CENTRAL_DIRECTORY_SIGNATURE);
    expect(view.getUint16(8, true)).toBe(0);
    expect(view.getUint32(12, true)).toBe(0);
  });
});

describe("zipSafeName", () => {
  it("leaves an ordinary player name alone", () => {
    expect(zipSafeName("Siân O'Brien")).toBe("Siân O'Brien");
  });

  it("removes separators so nothing can escape the archive", () => {
    expect(zipSafeName("../../etc/passwd")).toBe(".. .. etc passwd");
    expect(zipSafeName("C:\\Windows\\system32")).toBe("C Windows system32");
  });

  it("drops control characters and trailing dots", () => {
    expect(zipSafeName("Alex\u0000 Ross.")).toBe("Alex Ross");
  });

  it("never returns an empty name", () => {
    expect(zipSafeName("   ")).toBe("unnamed");
    expect(zipSafeName("///")).toBe("unnamed");
  });
});
