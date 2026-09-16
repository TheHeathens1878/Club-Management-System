# Render check — one page

A component, in a real browser, at 1440 and at 390, photographed and measured.
Run it before opening a PR that changes how a screen looks, and paste the table
it prints into the PR body.

```powershell
$env:DS_TOOLS_DIR = "C:\Projects\Club-Management-System\.ds-sync\node_modules"; $env:DS_CHROMIUM_PATH = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"; node tools/render/render-check.mjs <FixtureName>
```

Three things catch people out and all three are explained in full in
**`tools/render/README.md`**, which is the real document:

- **`DS_TOOLS_DIR`** — esbuild and playwright are machine-local, in
  `.ds-sync/node_modules`. A git worktree has no such folder, so point the
  variable at the main checkout.
- **Headless Edge will not open a window under ~492px.** The harness already
  works around it by emulating the viewport; do not "fix" it by resizing the
  window.
- **The Tailwind content scan** in `.design-sync/build-css.mjs` must include
  `tools/render/fixtures/*.tsx`, or a fixture-only utility is dropped and the
  screenshot comes back unstyled.

Not in CI, by decision: eslint catches the class strings, this catches the
pixels. Not covered: pending/spinner states, hover, real data, contrast, the
server/client boundary, dark mode.
