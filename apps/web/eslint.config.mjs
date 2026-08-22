import nextPlugin from "@next/eslint-plugin-next";
import reactHooks from "eslint-plugin-react-hooks";
import base from "../../eslint.config.mjs";

export default [
  ...base,
  {
    ignores: ["public/**", "next-env.d.ts"],
  },
  {
    plugins: { "@next/next": nextPlugin, "react-hooks": reactHooks },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
      // Same severities `next lint` applied in the source app, so the existing
      // `eslint-disable-next-line react-hooks/exhaustive-deps` comments resolve.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  {
    // --- Relaxations for the function-room app imported in P0.4 ---
    // Lift-and-shift: these are pre-existing style issues in code that is
    // otherwise unchanged from AoM-Sports-Club-Function-Room. Fixing them would
    // mean editing the imported sources, which P0.4 deliberately avoids.
    // Tighten back to "error" when the app is refactored in Phase 1.
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      // 4 dead locals/args in the imported code (template-editor.tsx,
      // users-client.tsx, payment-pending-banner.tsx, lib/email-templates.ts).
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // bookings-table.tsx uses `cond ? a() : b()` as a statement.
      "@typescript-eslint/no-unused-expressions": [
        "error",
        { allowShortCircuit: true, allowTernary: true },
      ],
    },
  },
];
