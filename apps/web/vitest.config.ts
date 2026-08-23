import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // The same `@/*` -> `src/*` alias `tsconfig.json` gives the app, so a library
  // unit can be imported here exactly as the app imports it.
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    // Pure library units only; the Next.js pages and server actions are not
    // exercised here.
    include: ["src/**/*.test.ts"],
  },
});
