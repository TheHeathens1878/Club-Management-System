/**
 * A very small, deliberately tolerant HTML reader.
 *
 * Full-Time's fixture pages are plain server-rendered tables, so a real DOM
 * parser would add a dependency (and a much larger surface to keep working)
 * for no gain. What we need is: find tables, split them into rows and cells,
 * read `<select>` options, and turn markup into visible text. Everything here
 * degrades to "found nothing" rather than throwing — a page that has changed
 * shape must produce warnings upstream, not an exception.
 *
 * None of this is a general-purpose HTML parser and it should not grow into
 * one. If Full-Time ever serves markup this cannot read, that is the signal to
 * re-record the snapshots in `test/fixtures/` and adjust here.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "\u2013",
  mdash: "\u2014",
  lsquo: "\u2018",
  rsquo: "\u2019",
  ldquo: "\u201c",
  rdquo: "\u201d",
  hellip: "\u2026",
  pound: "\u00a3",
  eacute: "\u00e9",
};

/** `&amp;` / `&#39;` / `&#x27;` to the characters they stand for. */
export function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/gi, (whole, body: string) => {
    if (body.startsWith("#")) {
      const isHex = body[1] === "x" || body[1] === "X";
      const code = Number.parseInt(isHex ? body.slice(2) : body.slice(1), isHex ? 16 : 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole;
      try {
        return String.fromCodePoint(code);
      } catch {
        return whole;
      }
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/**
 * The visible text of a fragment: tags removed, entities decoded, runs of
 * whitespace (including the non-breaking spaces Full-Time sprinkles around)
 * collapsed to single spaces.
 */
export function textOf(html: string): string {
  const withoutScripts = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ");
  const withoutTags = withoutScripts.replace(/<[^>]*>/g, " ");
  return decodeEntities(withoutTags)
    .replace(/[\s\u00a0]+/g, " ")
    .trim();
}

/** Escape a literal for embedding in a `RegExp` source string. */
function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * An attribute name must start a name, not merely end one: `\b` alone would
 * read `data-href` when asked for `href`.
 */
const NAME_START = "(?:^|[\\s\"'/<])";

/** The value of one attribute on an opening tag, quoted or bare. */
export function attributeOf(openTag: string, name: string): string | undefined {
  const re = new RegExp(
    NAME_START + escapeForRegExp(name) + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s\"'>]+))",
    "i",
  );
  const m = re.exec(openTag);
  if (!m) return undefined;
  const raw = m[1] ?? m[2] ?? m[3];
  return raw === undefined ? undefined : decodeEntities(raw);
}

/** True when an opening tag carries a boolean attribute such as `selected`. */
export function hasAttribute(openTag: string, name: string): boolean {
  return new RegExp(NAME_START + escapeForRegExp(name) + "\\b", "i").test(openTag);
}

export type HtmlOption = {
  value: string;
  label: string;
  selected: boolean;
};

/**
 * The options of `<select name="...">`. Returns `[]` when the page has no such
 * select, which is the normal case for pages that are not the filter form.
 */
export function selectOptions(html: string, selectName: string): HtmlOption[] {
  const openRe = new RegExp(
    "<select\\b[^>]*" + NAME_START + "name\\s*=\\s*[\"']?" + escapeForRegExp(selectName) + "[\"'\\s>]",
    "i",
  );
  const open = openRe.exec(html);
  if (!open) return [];
  const tagEnd = html.indexOf(">", open.index);
  if (tagEnd === -1) return [];
  const start = tagEnd + 1;
  const end = html.indexOf("</select>", start);
  const body = html.slice(start, end === -1 ? html.length : end);

  const options: HtmlOption[] = [];
  const optionRe = /<option\b([^>]*)>([\s\S]*?)<\/option>/gi;
  let m: RegExpExecArray | null;
  while ((m = optionRe.exec(body)) !== null) {
    const attrs = m[1] ?? "";
    options.push({
      value: attributeOf(`<option ${attrs}>`, "value") ?? "",
      label: textOf(m[2] ?? ""),
      selected: hasAttribute(attrs, "selected"),
    });
  }
  return options;
}

export type HtmlCell = {
  /** `td` or `th`. */
  tag: "td" | "th";
  /** The `class` attribute, lower-cased; `""` when absent. */
  className: string;
  /** Inner markup, so callers can still reach `href`s. */
  html: string;
  /** Visible text. */
  text: string;
};

export type HtmlRow = {
  html: string;
  cells: HtmlCell[];
  /** Visible text of the whole row. */
  text: string;
};

export type HtmlTable = {
  /** The opening `<table>` tag. */
  openTag: string;
  /** Everything between `<table>` and its matching `</table>`. */
  html: string;
  /** Lower-cased `<th>` labels of the first row that has any. */
  headers: string[];
  /** Every `<tr>`, header row included. */
  rows: HtmlRow[];
};

/** Split one row's markup into cells. */
function cellsOf(rowHtml: string): HtmlCell[] {
  const cells: HtmlCell[] = [];
  const cellRe = /<(td|th)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi;
  let m: RegExpExecArray | null;
  while ((m = cellRe.exec(rowHtml)) !== null) {
    const tag = (m[1] ?? "td").toLowerCase() === "th" ? "th" : "td";
    const inner = m[3] ?? "";
    cells.push({
      tag,
      className: (attributeOf(`<${tag} ${m[2] ?? ""}>`, "class") ?? "").toLowerCase(),
      html: inner,
      text: textOf(inner),
    });
  }
  return cells;
}

function rowsOf(tableHtml: string): HtmlRow[] {
  const rows: HtmlRow[] = [];
  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(tableHtml)) !== null) {
    const inner = m[1] ?? "";
    rows.push({ html: inner, cells: cellsOf(inner), text: textOf(inner) });
  }
  return rows;
}

/**
 * Every `<table>` in the document, nesting-aware so an outer table does not
 * stop at an inner one's `</table>`. A nested table's rows are reported as
 * part of its parent and not again on their own.
 */
export function extractTables(html: string): HtmlTable[] {
  const tables: HtmlTable[] = [];
  const openRe = /<table\b[^>]*>/gi;
  let open: RegExpExecArray | null;

  while ((open = openRe.exec(html)) !== null) {
    const bodyStart = open.index + open[0].length;
    const boundaryRe = /<table\b[^>]*>|<\/table\s*>/gi;
    boundaryRe.lastIndex = bodyStart;
    let depth = 1;
    let bodyEnd = html.length;
    let after = html.length;
    let boundary: RegExpExecArray | null;

    while ((boundary = boundaryRe.exec(html)) !== null) {
      if (boundary[0].startsWith("</")) {
        depth -= 1;
        if (depth === 0) {
          bodyEnd = boundary.index;
          after = boundary.index + boundary[0].length;
          break;
        }
      } else {
        depth += 1;
      }
    }

    const body = html.slice(bodyStart, bodyEnd);
    const rows = rowsOf(body);
    const headerRow = rows.find((row) => row.cells.some((cell) => cell.tag === "th"));
    tables.push({
      openTag: open[0],
      html: body,
      headers: (headerRow?.cells ?? []).map((cell) => cell.text.toLowerCase()),
      rows,
    });
    openRe.lastIndex = after;
  }

  return tables;
}

/**
 * Every `href` in a fragment, decoded. Used to find `displayFixture.html?id=`
 * links wherever in the row they happen to sit.
 */
export function hrefsIn(html: string): string[] {
  const hrefs: string[] = [];
  const re = /<a\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const href = attributeOf(m[0], "href");
    if (href !== undefined) hrefs.push(href);
  }
  return hrefs;
}
