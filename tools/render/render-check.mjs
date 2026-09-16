#!/usr/bin/env node
/**
 * Photograph a component and measure it.
 *
 *   node tools/render/render-check.mjs FoldCard
 *   node tools/render/render-check.mjs SyncCard --case=waiting --width=390 --keep
 *
 * A fixture (tools/render/fixtures/<Name>.fixture.tsx) names one or more cases;
 * each case is rendered on its own at 1440x900 and at 390x844, screenshotted
 * full page, and then measured for the four things reviews keep catching by
 * eye: something wider than the page, a sideways scrollbar, a tap target under
 * 44px on a phone, and a raw Tailwind palette class that should have been a
 * token. Console errors fail the run too. Exit code is 1 if anything failed,
 * so this can gate a commit by hand.
 *
 * Deliberately NOT in CI: Edge lives at a machine-local path and the tools it
 * drives (esbuild, playwright) are in .ds-sync/, which is gitignored by
 * decision. eslint catches the class strings in source; this catches pixels.
 * See tools/render/README.md.
 */

import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, statSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const web = join(repoRoot, "apps", "web");
const outDir = join(here, "out");

// --- machine-local tools -----------------------------------------------------
// esbuild and playwright are NOT dependencies of this repo: they live in
// .ds-sync/node_modules, which design-sync installs and .gitignore hides. A
// worktree has no .ds-sync, so DS_TOOLS_DIR points at the main checkout's copy.
const toolsDir = process.env.DS_TOOLS_DIR
  ? resolve(process.env.DS_TOOLS_DIR)
  : join(repoRoot, ".ds-sync", "node_modules");
const toolsRequire = createRequire(join(toolsDir, "_render-check.cjs"));

function requireTool(names, hint) {
  const tried = [];
  for (const name of names) {
    try {
      return toolsRequire(name);
    } catch (error) {
      tried.push(`${name}: ${error.code ?? error.message}`);
    }
  }
  fail(
    `Could not load ${hint} from ${toolsDir}.\n  ${tried.join("\n  ")}\n` +
      `  Set DS_TOOLS_DIR to a .ds-sync/node_modules that has it, e.g.\n` +
      `  DS_TOOLS_DIR=C:\\Projects\\Club-Management-System\\.ds-sync\\node_modules`,
  );
}

function fail(message) {
  console.error(`render-check: ${message}`);
  process.exit(2);
}

// --- arguments ---------------------------------------------------------------
const argv = process.argv.slice(2);
const fixtureName = argv.find((a) => !a.startsWith("-"));
const flag = (name) => {
  const hit = argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (hit === undefined) return undefined;
  return hit.includes("=") ? hit.slice(hit.indexOf("=") + 1) : true;
};

if (!fixtureName || flag("help")) {
  const available = existsSync(join(here, "fixtures"))
    ? readdirSync(join(here, "fixtures"))
        .filter((f) => f.endsWith(".fixture.tsx"))
        .map((f) => f.replace(".fixture.tsx", ""))
    : [];
  console.log(
    [
      "Usage: node tools/render/render-check.mjs <FixtureName> [options]",
      "",
      "  --case=<name>            only this case (default: every case in the fixture)",
      "  --width=1440|390         only this viewport (default: both)",
      "  --keep                   keep the bundle and print where it is",
      "  --drag=<from>,<to>       dispatch DragEvents from one selector to another before",
      "                           the screenshot (synthetic; see the README)",
      "",
      available.length ? `Fixtures: ${available.join(", ")}` : "No fixtures yet.",
    ].join("\n"),
  );
  process.exit(fixtureName ? 0 : 1);
}

const fixturePath = join(here, "fixtures", `${fixtureName}.fixture.tsx`);
if (!existsSync(fixturePath)) fail(`no fixture at ${relative(repoRoot, fixturePath)}`);

const onlyCase = typeof flag("case") === "string" ? flag("case") : null;
const onlyWidth = typeof flag("width") === "string" ? Number(flag("width")) : null;
const keep = flag("keep") === true;
const dragSpec = typeof flag("drag") === "string" ? String(flag("drag")).split(",") : null;
if (dragSpec && dragSpec.length !== 2) fail("--drag wants exactly two selectors: --drag=<from>,<to>");

const VIEWPORTS = [
  { width: 1440, height: 900, deviceScaleFactor: 1, hasTouch: false, isMobile: false },
  { width: 390, height: 844, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
].filter((v) => onlyWidth === null || v.width === onlyWidth);
if (VIEWPORTS.length === 0) fail(`--width must be 1440 or 390`);

// --- step (a): the stylesheet -------------------------------------------------
// Rebuild only when a source of truth is newer than the output. Tailwind takes
// a few seconds and most runs in a row change neither globals.css nor the config.
function mtime(path) {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

const cssOut = join(web, ".ds-css", "styles.css");
const cssSources = [join(web, "src", "app", "globals.css"), join(web, "tailwind.config.ts")];
if (mtime(cssOut) <= Math.max(...cssSources.map(mtime))) {
  console.log("css: building (globals.css or tailwind.config.ts is newer than .ds-css/styles.css)");
  execFileSync(process.execPath, [join(repoRoot, ".design-sync", "build-css.mjs")], {
    cwd: repoRoot,
    stdio: "inherit",
  });
} else {
  console.log("css: reusing apps/web/.ds-css/styles.css");
}

// --- step (b): the bundle -----------------------------------------------------
const esbuild = requireTool(["esbuild"], "esbuild");

/** `@/lib/utils` and friends, the way apps/web/tsconfig.json maps them. */
const aliasAtPlugin = {
  name: "alias-@",
  setup(build) {
    build.onResolve({ filter: /^@\// }, (args) => {
      const base = join(web, "src", args.path.slice(2));
      for (const candidate of [
        base,
        `${base}.tsx`,
        `${base}.ts`,
        join(base, "index.tsx"),
        join(base, "index.ts"),
      ]) {
        try {
          if (statSync(candidate).isFile()) return { path: candidate };
        } catch {
          /* try the next spelling */
        }
      }
      return { errors: [{ text: `@/ alias did not resolve: ${args.path}` }] };
    });
  },
};

/**
 * Every `"use server"` module out of the bundle. Matches `../actions`,
 * `./actions.ts`, `@/app/.../actions` and the `./add-fixture-actions` spelling
 * some routes use. Registered before the @/ plugin so it wins.
 */
const actionsShim = join(here, "shims", "actions.ts");
const actionsShimPlugin = {
  name: "shim-actions",
  setup(build) {
    build.onResolve({ filter: /(^|\/)([A-Za-z0-9._-]+-)?actions(\.tsx?)?$/ }, () => ({
      path: actionsShim,
    }));
  },
};

const bundleFile = join(outDir, `.bundle.${fixtureName}.js`);
mkdirSync(outDir, { recursive: true });

const entry = [
  `import * as React from "react";`,
  `import { createRoot } from "react-dom/client";`,
  `import fixture from ${JSON.stringify(fixturePath.split(sep).join("/"))};`,
  `const cases = fixture.cases ?? {};`,
  `window.__ds = {`,
  `  names: Object.keys(cases),`,
  `  render(name) {`,
  `    const host = document.getElementById("root");`,
  `    if (window.__dsRoot) { window.__dsRoot.unmount(); }`,
  `    host.innerHTML = "";`,
  `    window.__dsRoot = createRoot(host);`,
  `    window.__dsRoot.render(React.createElement(cases[name]));`,
  `    return new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));`,
  `  },`,
  `};`,
].join("\n");

let built;
try {
  built = await esbuild.build({
    stdin: { contents: entry, resolveDir: here, sourcefile: "render-entry.js", loader: "js" },
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "chrome120",
    jsx: "automatic",
    jsxDev: false,
    absWorkingDir: repoRoot,
    // .npmrc is node-linker=hoisted, so react, react-dom, lucide-react and the
    // rest sit in the repo-root node_modules rather than under apps/web.
    nodePaths: [join(repoRoot, "node_modules")],
    conditions: ["browser", "import", "default"],
    alias: {
      "next/link": join(repoRoot, ".design-sync", "shims", "next-link.tsx"),
      "next/navigation": join(repoRoot, ".design-sync", "shims", "next-navigation.ts"),
    },
    define: { "process.env.NODE_ENV": '"development"' },
    loader: { ".svg": "dataurl", ".png": "dataurl" },
    plugins: [actionsShimPlugin, aliasAtPlugin],
    outfile: bundleFile,
    logLevel: "silent",
  });
} catch (error) {
  console.error(error.message ?? error);
  for (const e of error.errors ?? []) {
    console.error(`  ${e.location ? `${e.location.file}:${e.location.line} ` : ""}${e.text}`);
  }
  fail(`could not bundle ${relative(repoRoot, fixturePath)}`);
}
for (const w of built.warnings ?? []) console.warn(`bundle warning: ${w.text}`);
console.log(`bundle: ${relative(repoRoot, bundleFile)}`);

const bundleCode = await (await import("node:fs/promises")).readFile(bundleFile, "utf8");

// --- step (c): the browser ----------------------------------------------------
const { chromium } = requireTool(["playwright-core", "playwright"], "playwright");
const edgePath =
  process.env.DS_CHROMIUM_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
if (!existsSync(edgePath)) fail(`no browser at ${edgePath} — set DS_CHROMIUM_PATH`);

const PALETTE =
  /\b(?:bg|text|border|ring|from|to|via)-(?:emerald|amber|sky|rose|slate|indigo|violet|teal|lime|red|green|blue|yellow|gray|zinc|orange|purple|pink|cyan|fuchsia)-\d{2,3}\b/;

const browser = await chromium.launch({
  executablePath: edgePath,
  headless: true,
  // Headless Edge refuses to open a window narrower than about 492px and
  // silently clamps: ask for a wide window and let newContext({ viewport })
  // emulate the phone through CDP instead. See the README.
  args: ["--window-size=1600,1000", "--force-device-scale-factor=1", "--hide-scrollbars=false"],
});

const pageUrl = pathToFileURL(join(here, "page.html")).href;
const rows = [];
const failures = [];
let caseNames = null;

for (const viewport of VIEWPORTS) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.deviceScaleFactor,
    hasTouch: viewport.hasTouch,
    isMobile: viewport.isMobile,
    reducedMotion: "reduce",
  });
  const page = await context.newPage();

  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(String(error)));

  await page.goto(pageUrl);
  await page.addScriptTag({ content: bundleCode });

  const names = await page.evaluate(() => window.__ds.names);
  if (names.length === 0) fail(`${fixtureName}.fixture.tsx exports no cases`);
  caseNames ??= names;
  const wanted = onlyCase ? names.filter((n) => n === onlyCase) : names;
  if (wanted.length === 0) fail(`no case "${onlyCase}" in ${fixtureName} (have: ${names.join(", ")})`);

  for (const name of wanted) {
    consoleErrors.length = 0;
    await page.evaluate((n) => window.__ds.render(n), name);
    await page.evaluate(() => document.fonts.ready.catch(() => {}));
    await page.waitForLoadState("networkidle").catch(() => {});

    if (dragSpec) await synthesiseDrag(page, dragSpec[0], dragSpec[1]);

    const file = join(outDir, `${fixtureName}.${name}.${viewport.width}.png`);
    await page.screenshot({ path: file, fullPage: true });

    const report = await page.evaluate(measureInPage, { palette: PALETTE.source, width: viewport.width });
    const label = `${fixtureName}.${name} @ ${viewport.width}`;

    const problems = [
      ...report.overflow.map((o) => `wider than the page: ${o.selector} right=${o.right} (page ${o.innerWidth})`),
      ...(report.scrollWidth > viewport.width + 1
        ? [`the page scrolls sideways: scrollWidth=${report.scrollWidth} > ${viewport.width}`]
        : []),
      ...report.small.map((s) => `tap target ${s.height}px (needs 44): ${s.selector}`),
      ...report.palette.map((p) => `raw palette class: ${p.selector} — "${p.match}"`),
      ...consoleErrors.map((e) => `console error: ${e}`),
    ];

    console.log("");
    console.log(label);
    console.log(`  ${report.overflow.length === 0 ? "PASS" : "FAIL"}  nothing wider than the page`);
    console.log(`  ${report.scrollWidth <= viewport.width + 1 ? "PASS" : "FAIL"}  no sideways scroll`);
    console.log(
      viewport.width === 390
        ? `  ${report.small.length === 0 ? "PASS" : "FAIL"}  every tap target is 44px tall`
        : `  ----  tap targets (only checked at 390)`,
    );
    console.log(`  ${report.palette.length === 0 ? "PASS" : "FAIL"}  tokens only, no raw palette class`);
    console.log(`  ${consoleErrors.length === 0 ? "PASS" : "FAIL"}  no console errors`);
    for (const p of problems) console.log(`        ${p}`);

    rows.push({ case: name, width: viewport.width, path: relative(repoRoot, file).split(sep).join("/") });
    if (problems.length) failures.push({ label, problems });
  }

  await context.close();
}

await browser.close();
if (!keep) rmSync(bundleFile, { force: true });
else console.log(`\nkept: ${relative(repoRoot, bundleFile)}`);

// --- the table for the PR body ------------------------------------------------
const widths = VIEWPORTS.map((v) => v.width);
const shown = onlyCase ? [onlyCase] : (caseNames ?? []);
console.log("");
console.log(`| ${fixtureName} | ${widths.map((w) => `${w}px`).join(" | ")} |`);
console.log(`| --- | ${widths.map(() => "---").join(" | ")} |`);
for (const name of shown) {
  const cells = widths.map((w) => {
    const hit = rows.find((r) => r.case === name && r.width === w);
    return hit ? `\`${hit.path}\`` : "—";
  });
  console.log(`| ${name} | ${cells.join(" | ")} |`);
}

console.log("");
if (failures.length) {
  console.log(`FAIL — ${failures.length} of ${rows.length} shots have something to fix.`);
  process.exit(1);
}
console.log(`PASS — ${rows.length} shot${rows.length === 1 ? "" : "s"}, nothing to fix.`);

/**
 * Edge cannot synthesise a native HTML5 drag, so a fixture that needs one gets
 * the three DragEvents by hand. It is a sequence, not a drag: no pointer moves,
 * no auto-scroll, and anything keyed off dragenter/dragleave on intermediate
 * elements never fires. Good enough to photograph a drop target mid-drag.
 */
async function synthesiseDrag(page, fromSelector, toSelector) {
  await page.evaluate(
    ({ from, to }) => {
      const source = document.querySelector(from);
      const target = document.querySelector(to);
      if (!source || !target) throw new Error(`--drag: no element for "${!source ? from : to}"`);
      const data = new DataTransfer();
      const fire = (el, type) =>
        el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: data }));
      fire(source, "dragstart");
      fire(target, "dragenter");
      fire(target, "dragover");
      fire(target, "drop");
      fire(source, "dragend");
    },
    { from: fromSelector, to: toSelector },
  );
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
}

/** Runs inside the page. Keep it self-contained: nothing from this file is in scope. */
function measureInPage({ palette, width }) {
  const paletteRe = new RegExp(palette);

  const describe = (el) => {
    const parts = [el.tagName.toLowerCase()];
    if (el.id) parts.push(`#${el.id}`);
    const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/).slice(0, 4) : [];
    if (cls.length) parts.push(`.${cls.join(".")}`);
    const text = (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 32);
    return parts.join("") + (text ? ` "${text}"` : "");
  };

  const all = Array.from(document.querySelectorAll("#root *"));
  const innerWidth = window.innerWidth;

  // An element pinned to the viewport is allowed to sit at the very edge, and
  // so is anything inside it: it is not what makes the page scroll sideways.
  const fixedOrInside = new Set();
  for (const el of all) {
    const position = getComputedStyle(el).position;
    if (position === "fixed" || position === "sticky") {
      fixedOrInside.add(el);
      if (position === "fixed") for (const kid of el.querySelectorAll("*")) fixedOrInside.add(kid);
    }
  }

  const overflow = [];
  for (const el of all) {
    if (fixedOrInside.has(el)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    if (rect.right > innerWidth + 1) {
      overflow.push({ selector: describe(el), right: Math.round(rect.right), innerWidth });
    }
  }

  const small = [];
  if (width === 390) {
    const TAPPABLE = "button, a[href], [role=button], input, select, textarea, summary";
    for (const el of Array.from(document.querySelectorAll(`#root ${TAPPABLE}`))) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.height < 44) small.push({ selector: describe(el), height: Math.round(rect.height * 10) / 10 });
    }
  }

  const paletteHits = [];
  for (const el of Array.from(document.querySelectorAll("#root *, #root"))) {
    const attr = el.getAttribute && el.getAttribute("class");
    if (!attr) continue;
    const hit = attr.match(paletteRe);
    if (hit) paletteHits.push({ selector: describe(el), match: hit[0] });
  }

  return {
    overflow,
    small,
    palette: paletteHits,
    scrollWidth: document.scrollingElement.scrollWidth,
  };
}
