import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** Read a recorded (or synthetic) page from `test/fixtures/`. */
export function fixture(name: string): string {
  return readFileSync(join(here, "fixtures", name), "utf8");
}
