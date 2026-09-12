# design-sync notes — Club Management System

Repo-specific facts a future sync needs. Config lives in `.design-sync/config.json`.

## Shape and inputs
- No Storybook, no library build. The source is the Next.js app `apps/web`; the synced surface is
  `.design-sync/entry.tsx` (relative re-exports of the app's real components). Add a line there AND a
  `componentSrcMap` pin in config to sync a new component — with a custom entry the converter takes
  the component list from the pins, not from a `.d.ts` tree.
- pnpm uses `node-linker=hoisted` (`.npmrc`), so `--node-modules ./node_modules` at the REPO ROOT is
  where react, lucide-react and cva resolve. `apps/web/node_modules` holds only workspace links.
- `PKG_DIR` resolves to the repo root (the entry walks up to the root package.json), so every
  config path (`srcDir`, `cssEntry`, `tsconfig`) is repo-root-relative.
- Prop types: the extractor only reads a `types` entry declared in package.json, which this app has
  no reason to have, so every component has a hand-written body in `cfg.dtsPropsFor`. Keep them in
  step with the component sources when props change.
- Stylesheet: `node .design-sync/build-css.mjs` (the `buildCmd`) compiles the app's Tailwind
  (`globals.css` through the app's `tailwind.config.ts`) to `apps/web/.ds-css/styles.css`, with the
  Google Fonts import and `--font-sans` / `--font-display` declared up front (next/font does that in
  the app). The content scan covers `apps/web/src` AND `.design-sync/previews`, so a utility used
  only in a preview still compiles. Anything not in that scan does not exist in the bundle.
- `next/link` and `next/navigation` are shimmed (`.design-sync/shims/`) through
  `.design-sync/tsconfig.json` paths. Route-aware previews set `window.__dsPathname` at module top.
- Render check: no Playwright browser cache on this machine; the installed Edge is used via
  `DS_CHROMIUM_PATH="C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"`.
  Playwright itself is installed in `.ds-sync/` (`npm i playwright`).
- The Bash tool used to drive this sync mangles heredocs whose content contains an apostrophe;
  write prose files with the Write tool.

## Build and verify (what a re-sync runs)
```
node .design-sync/build-css.mjs
node .ds-sync/resync.mjs --config .design-sync/config.json --node-modules ./node_modules \
  --entry ./.design-sync/entry.tsx --out ./ds-bundle --remote .design-sync/.cache/remote-sync.json
```
with `DS_CHROMIUM_PATH` set as above.

## Decisions
- All 22 components sit in one group ("general"). (SidebarNav left with the three-noun navigation, P7.5.) Regrouping needs a matched doc with a `category`
  frontmatter, and a matched doc replaces the synthesized prompt including its `## Examples` — the
  examples matter more to the design agent than grouping. Revisit only if the converter grows a
  group override.
- `MobileTabBar` renders as a single card at a phone viewport (`cfg.overrides`): the bar is
  `lg:hidden`, so a grid card wider than 1024px shows an empty frame.
- `SubmitButton` previews show the idle state only; the pending spinner needs a live form action.
- Data-bound components (registration blocks, role switcher, notice bell, command palette, person
  picker, notification prompt, family tree, header tools, mobile header, address/DOB/emergency
  contact fields) are deliberately out of scope: they need Supabase or a signed-in role.

## Known render warns
- `[FONT_REMOTE] "Source Sans 3", "Oswald"` — expected; the fonts load from Google Fonts at runtime.

## Re-sync risks
- `dtsPropsFor` is hand-maintained: a prop added to a component in `apps/web` does not reach the
  design agent until the body in config is updated.
- The shims mimic only what the scoped components use (`Link`, `usePathname`, `useSearchParams`,
  `useRouter`); a new component using more of next/navigation needs the shim extended.
- Fonts are fetched from Google at render time; offline previews show fallbacks.
- Toolchain assumed: node 24, pnpm 10.34, tailwindcss 3.4 CLI from the root `node_modules/.bin`,
  Edge 152 for the render check.
