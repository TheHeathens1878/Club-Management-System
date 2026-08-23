import { defineConfig } from "vitest/config";

// Pure-logic tests only. Screens and native modules are exercised by a dev
// build on device (P6.1 acceptance), not by a React Native test runner, so the
// include list is deliberately limited to plain .ts modules.
export default defineConfig({
  test: {
    include: ["lib/**/*.test.ts"],
    environment: "node",
  },
});
