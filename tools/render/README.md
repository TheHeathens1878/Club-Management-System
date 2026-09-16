# The render check

A screenshot in every makeover. Point it at a fixture and it mounts one
component at a time in a real browser, photographs it at desk width and phone
width, and measures the four things a code review keeps missing by eye.

Runbook pointer: `docs/runbooks/render-check.md`.

```powershell
$env:PATH = "$env:APPDATA\npm;$env:PATH"
$env:DS_TOOLS_DIR = "C:\Projects\Club-Management-System\.ds-sync\node_modules"
node tools/render/render-check.mjs FoldCard
```

To render a fixture a later PR has just written — the whole line, from a
worktree, copy and paste:

```powershell
$env:DS_TOOLS_DIR = "C:\Projects\Club-Management-System\.ds-sync\node_modules"; $env:DS_CHROMIUM_PATH = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"; node tools/render/render-check.mjs <FixtureName>
```

Options:

| | |
| --- | --- |
| `--case=<name>` | just one case (default: every case in the fixture) |
| `--width=1440` or `--width=390` | just one viewport (default: both) |
| `--keep` | keep the bundle and print where it is, for reading the generated JS |
| `--drag=<fromSelector>,<toSelector>` | fake a drag before the shot — see the limitation below |

Output lands in `tools/render/out/<Name>.<case>.<width>.png`, which is
gitignored: screenshots are evidence for a PR body, not repository content.
The run ends with a Markdown table of relative paths ready to paste.

Exit code is `1` if any assertion failed, `2` if the harness could not run at
all (no fixture, no browser, no tools, a bundle that would not build).

## Writing a fixture

`tools/render/fixtures/<Name>.fixture.tsx` default-exports
`{ cases: Record<string, () => JSX.Element> }` — see `contract.ts`. One case per
state worth photographing; each is a component of no props so it can be mounted
on its own, because a column of five stacked cases hides which one owns an
overflow. A fixture may set `window.__dsPathname` / `window.__dsSearch` at
module scope, and the `next/navigation` shim will report them, so a component
with an active-link state can be shot on the route it belongs to.

Imports work the way they do in the app: `@/…` resolves to `apps/web/src/…`,
`next/link` and `next/navigation` come from `.design-sync/shims/`, and anything
ending `/actions`, `/actions.ts` or `-actions` is swapped for
`tools/render/shims/actions.ts` — a module where every name you ask for is
`async () => ({})`. That is what lets a client component that imports a
`"use server"` module render in a browser at all.

## What it asserts

1. **Nothing is wider than the page.** No element's
   `getBoundingClientRect().right` exceeds `innerWidth + 1`. Elements that are
   `position: fixed` or `sticky` are skipped, and so is everything inside a
   fixed one: a pinned bar sitting at the edge is not what makes a page scroll.
   The contents of a box that scrolls sideways on purpose (`overflow-x` `auto`
   or `scroll`, already overflowing — a `ChipStrip`, a wide table) are skipped
   for the same reason; the box itself is still measured.
2. **No sideways scroll.** `document.scrollingElement.scrollWidth <= innerWidth + 1`.
3. **Every tap target is 44px tall, at 390 only.** `button, a[href],
   [role=button], input, select, textarea, summary` with a non-zero box. The
   failure names the element.
4. **Tokens only.** No rendered `class` attribute may contain
   `(bg|text|border|ring|from|to|via)-(emerald|amber|sky|rose|slate|…)-\d{2,3}`.
5. **No console errors**, including uncaught exceptions during the render.

## Things that will bite

**`DS_TOOLS_DIR`.** esbuild and playwright are not dependencies of this repo —
adding them would put a browser download in everyone's install. They live in
`.ds-sync/node_modules`, which design-sync creates and `.gitignore` hides. The
harness resolves them from `<repo root>/.ds-sync/node_modules` by default; in a
**git worktree that folder does not exist**, so set `DS_TOOLS_DIR` to the main
checkout's copy (the command above). Without it you get a clear error, not a
mysterious one.

**Edge, and the 492px floor.** The browser is whatever `DS_CHROMIUM_PATH`
points at, default
`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`. Headless Edge
will not open an OS window narrower than about 492px and silently clamps to it,
which fakes a "works on a phone" result. **What works:** launch with
`--window-size=1600,1000` and set the CSS viewport per context with
`browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
hasTouch: true, isMobile: true })`. That emulates through CDP rather than
resizing the window, so 390 really is 390 — the phone shots come back
780px wide at scale 2, which is how you can check it took.

**The Tailwind content scan.** `.design-sync/build-css.mjs` names the folders
Tailwind reads. `tools/render/fixtures/*.tsx` is in that list. If a fixture uses
a utility that appears nowhere else in the app and the list is wrong, the class
is simply dropped — no error, the screenshot just comes back unstyled and the
component looks broken. `.design-sync/NOTES.md` records the same trap for
`previews/`. The stylesheet is rebuilt only when `globals.css` or
`tailwind.config.ts` is newer than `apps/web/.ds-css/styles.css`; delete that
file to force it.

**The drag is not a drag.** `--drag=<from>,<to>` dispatches `dragstart`,
`dragenter`, `dragover`, `drop`, `dragend` with a shared `DataTransfer`. Edge
cannot synthesise a native HTML5 drag, so there are no pointer moves, no
auto-scroll, and nothing keyed to `dragenter`/`dragleave` on elements the
pointer would have crossed. It is enough to photograph a drop target that has
accepted, not enough to prove a drag works.

## Not covered

- **Pending and spinner states.** The actions shim resolves immediately, so
  `useFormStatus().pending` and `useActionState`'s pending flag are always
  false. Give the component a prop for the busy state, or shoot it by hand.
- **Hover, focus-visible and any other pointer state.** One shot, at rest.
- **Real data.** A fixture is made-up props. It proves the shape holds, not
  that the query returns what the component expects.
- **Contrast and colour accuracy.** Deliberately out of scope; the tokens-only
  assertion is a proxy, not a measurement.
- **The server/client boundary.** Everything here is bundled for the browser,
  so a component that would 500 in the app because a server page passed it a
  function renders perfectly happily in the harness. That one is eslint's job
  (the `icon` rule) and the reviewer's.
- **Dark mode and `.theme-ink`.** The page is rendered in the default theme.

## Why this is not in CI

Two reasons, both decisions rather than accidents. The browser is at a
machine-local Windows path, and the tools that drive it live in `.ds-sync/`,
which is gitignored — a CI runner has neither. Installing playwright's own
Chromium in CI would be a browser download on every job for a check whose whole
value is that a person looks at the picture.

So the work is split: **eslint catches the class strings** (see the ratchet at
the bottom of `apps/web/eslint.config.mjs`, which does run in CI, at warning
severity), and **this harness catches the pixels** — the overflow, the
too-small thumb target, the thing that only goes wrong at 390. Run it locally
before you open the PR and paste the table into the body.
