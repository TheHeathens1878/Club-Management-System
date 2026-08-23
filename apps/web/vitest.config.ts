import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Pure library units only; the Next.js pages and server actions are not
    // exercised here.
    include: ["src/**/*.test.ts"],
  },
});
