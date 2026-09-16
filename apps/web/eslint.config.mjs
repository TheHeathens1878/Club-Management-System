import nextPlugin from "@next/eslint-plugin-next";
import reactHooks from "eslint-plugin-react-hooks";
import base from "../../eslint.config.mjs";

// --- The design ratchet (P8.0b) ----------------------------------------------
// Five class strings and one type the makeover is replacing with names. They
// are WARNINGS on purpose: there are hundreds today, and a rule that fails the
// build on day one just gets switched off. Each screen PR burns its own down;
// when a rule's count reaches zero, flip that one entry to a separate "error"
// block so it can never come back. The counts at the time this landed are in
// the PR body — that is the baseline.
//
// The companion check is `node tools/render/render-check.mjs <Fixture>`, which
// looks at pixels in a browser. eslint reads source, so it sees a class that is
// never rendered; the harness sees a rendered class whose source is a variable.
// Neither replaces the other.
const PALETTE =
  "\\b(?:bg|text|border|ring|from|to|via)-(?:emerald|amber|sky|rose|slate|indigo|violet|teal|lime|red|green|blue|yellow|gray|zinc|orange|purple|pink|cyan|fuchsia)-\\d{2,3}\\b";

/** A `className="…"`, a `className={"…"}` and every quasi of a `className={`…`}`. */
const inClassName = (pattern) =>
  [
    `JSXAttribute[name.name="className"] Literal[value=/${pattern}/]`,
    `JSXAttribute[name.name="className"] TemplateElement[value.raw=/${pattern}/]`,
  ].join(", ");

const classNameRatchet = [
  {
    selector: inClassName(PALETTE),
    message:
      "Raw Tailwind palette class in a className. Use the status tokens instead — success/warning/info (with -foreground and -tint), or the existing primary/muted/destructive.",
  },
  {
    selector: inClassName("\\btext-\\[\\d"),
    message:
      "Pixel font size in a className. Use the named scale: text-2xs/xs/list/sm/row/panel/lg/xl.",
  },
  {
    selector: inClassName("\\bmin-h-\\[44px\\] lg:min-h-0\\b"),
    message:
      "Hand-rolled thumb target. Use the `touch` class, or Button size=\"touch\".",
  },
  {
    selector: inClassName("\\bshadow-\\["),
    message:
      "Bespoke shadow. Use the three elevations: shadow-sm resting, shadow-lg floating, shadow-2xl owns the screen.",
  },
  {
    selector: inClassName("\\brounded-\\["),
    message:
      "Bespoke radius. Use the ladder: rounded-full pills, rounded-xl surfaces, rounded-lg insets, rounded-md controls.",
  },
];

/**
 * An `icon` prop typed as a component is the shape that produced two
 * production 500s: a server page cannot pass a function to a client component,
 * so the icon has to arrive already rendered.
 */
const iconRatchet = [
  {
    selector: [
      'TSPropertySignature[key.name="icon"] > TSTypeAnnotation > TSTypeReference[typeName.name="LucideIcon"]',
      'TSPropertySignature[key.name="icon"] > TSTypeAnnotation > TSTypeReference[typeName.name="ComponentType"]',
      'TSPropertySignature[key.name="icon"] > TSTypeAnnotation > TSTypeReference[typeName.right.name="ComponentType"]',
    ].join(", "),
    message:
      "icons cross the server/client boundary rendered — type it React.ReactNode",
  },
];

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
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: { "no-restricted-syntax": ["warn", ...classNameRatchet] },
  },
  {
    // Flat config replaces a rule's options wholesale rather than merging them,
    // so the shared components repeat the class ratchet to keep it.
    files: ["src/components/**/*.{ts,tsx}"],
    rules: { "no-restricted-syntax": ["warn", ...classNameRatchet, ...iconRatchet] },
  },
];
