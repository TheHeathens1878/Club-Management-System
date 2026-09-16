# design-sync notes — Club Management System

Repo-specific facts a future sync needs. Config lives in `.design-sync/config.json`.

## Shape and inputs
- No Storybook, no library build. The source is the Next.js app `apps/web`; the synced surface is
  `.design-sync/entry.tsx` (relative re-exports of the app's real components). Add a line there AND a
  `componentSrcMap` pin in config to sync a new component — with a custom entry the converter takes
  the component list from the pins, not from a `.d.ts` tree.
- **Invariant: `componentSrcMap` keys, `entry.tsx` exports and `previews/*.tsx` filenames must match
  1:1.** All three are hand-maintained lists of the same set, and nothing checks them against each
  other. A pin with no export syncs an empty component; an export with no pin is simply never seen;
  a preview whose filename does not match a pin is not scanned for Tailwind classes, so the
  component arrives unstyled. Count them before a re-sync (42 today). Two deliberate exceptions on
  the export side: the `*Variants` cva helpers (`buttonVariants`, `badgeVariants`,
  `iconTileVariants`, `toggleChipVariants`, `calloutVariants`), which are not components; and `TH`,
  `TR` and `TD`, which **cannot** be pinned — `lib/dts.mjs`'s `isComponentName` rejects
  `/^[A-Z][A-Z0-9_]+$/`, so a SCREAMING-CASE export reads as an enum and is dropped from the build
  with its preview called stale. They are exported for the app and for the previews, and documented
  inside `Table`'s props body. `THead` and `TBody` are PascalCase and sync as their own entries, as
  the five `Card` parts do.
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
- All 42 components sit in one group ("general"). (SidebarNav left with the three-noun navigation, P7.5.) Regrouping needs a matched doc with a `category`
  frontmatter, and a matched doc replaces the synthesized prompt including its `## Examples` — the
  examples matter more to the design agent than grouping. Revisit only if the converter grows a
  group override.
- `MobileTabBar` renders as a single card at a phone viewport (`cfg.overrides`): the bar is
  `lg:hidden`, so a grid card wider than 1024px shows an empty frame.
- **A portalled overlay photographs fine, and does it by escaping the preview.** `Sheet` portals to
  `document.body` and is `fixed inset-0`, so no frame inside the story can contain it: the
  converter's `.ds-single` wrapper is the containing block for `fixed` DESCENDANTS only, and the
  portal host is a sibling of it. It is given `cardMode: "single"` at `420x560` instead — a phone,
  which is the sheet's phone shape — and the framed page in the preview is simply what its scrim
  dims. The validator already counts roots under `document.body`, so a portalled panel is never read
  as an empty render, and `Sheet` came back clean on the first try; no static stand-in was needed.
  The sheet also makes every other child of `<body>` `inert` while it is open, which includes the
  preview's own mount root — `inert` is an interaction and AT concern only, so the screenshot is
  unaffected. `Popover` is only `absolute`, so it hangs inside its frame exactly as it does in the
  app; it gets `single` at `420x420` only so the two open menus in its two stories do not paint over
  each other in a grid.
- `DataListFrame` is a **column** card (`cfg.overrides`): both its stories are wider than a grid
  cell (a six-column desk table, and a 390px phone frame beside it), and a column card gives each
  story the card's full width instead of cropping it. Its phone story forces the `lg:` classes back
  off with a scoped `!important` block, because the capture viewport is 1200 wide and `lg:` is live
  there — the same trick `previews/FilterRail.tsx` uses in the other direction. At `520` tall the
  phone story is cropped below its fourth row; that is the declared grading viewport, not a fault.
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
