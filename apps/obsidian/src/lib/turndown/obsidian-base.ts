import { regex } from "arkregex";
import type TurndownService from "turndown";

/**
 * Construction options that align our converter with Obsidian's built-in
 * `htmlToMarkdown`, so notes convert into the same Markdown dialect Obsidian
 * emits when it pastes or imports HTML.
 */
export const obsidianTurndownOptions: TurndownService.Options = {
  headingStyle: "atx",
  hr: "---",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
  fence: "```",
  linkStyle: "inlined",
};

export function createObsidianTurndown(
  Turndown: typeof TurndownService,
): TurndownService {
  const td = new Turndown(obsidianTurndownOptions);
  addObsidianRules(td);
  return td;
}

const ATTR_WS = /(?:\n+\s*)+/g;
const PARENS = /([()])/g;
const LEAD_NL = /^\n+/;
const TRAIL_NL = /\n+$/;
const INNER_NL = /\n/gm;
const ENDS_NL = /\n$/;
const PIPES = /\|+/g;
const CELL_NL = /\n\r?/g;
const LEAD_NLCR = /^[\r\n]+/;
const NLCR = /[\r\n]+/g;
const BLANK = /^\s*$/;

const HIGHLIGHT_LANG = regex("highlight-(?:text|source)-(?<lang>[a-z0-9]+)");

const TABLE_ALIGN: Record<string, string> = {
  left: ":--",
  right: "--:",
  center: ":-:",
};

/** Collapse newline runs in `title` / `alt` attributes to a single newline. */
function normalizeAttr(value: string | null): string {
  return value ? value.replace(ATTR_WS, "\n") : "";
}

/** Percent-encode spaces and backslash-escape parentheses in a URL. */
function encodeUrl(value: string): string {
  return value.replaceAll(" ", "%20").replace(PARENS, "\\$1");
}

/** Render the optional ` "title"` suffix of a link/image, escaping quotes. */
function titleSuffix(node: Element): string {
  const title = normalizeAttr(node.getAttribute("title"));
  return title ? ` "${title.replaceAll('"', '\\"')}"` : "";
}

/** Extra columns a cell spans beyond the first, or 0 when `colspan` is unset. */
function extraColspan(cell: Element): number {
  const value = cell.getAttribute("colspan");
  if (!value) return 0;
  const n = Number.parseInt(value, 10);
  return Number.isNaN(n) ? 0 : Math.max(0, n - 1);
}

function colspanPad(cell: Element, separator: string): string {
  return separator.repeat(extraColspan(cell));
}

/**
 * A `<tr>` is the header row when it lives in `<thead>`, or it is the first row
 * of the table/`<tbody>` and every cell is a `<th>`.
 */
function isHeaderRow(row: HTMLTableRowElement | null | undefined): boolean {
  if (!row) return false;
  const parent = row.parentElement;
  if (!parent) return false;
  if (parent.nodeName === "THEAD") return true;
  if (parent.firstChild !== row) return false;
  const prev = parent.previousElementSibling;
  const validParent =
    parent.nodeName === "TABLE" ||
    (parent.nodeName === "TBODY" &&
      (!prev ||
        (prev.nodeName === "THEAD" && BLANK.test(prev.textContent ?? ""))));
  if (!validParent) return false;
  return Array.from(row.childNodes).every((n) => n.nodeName === "TH");
}

export function addObsidianRules(td: TurndownService): void {
  td.remove(["script", "style", "title"]);

  td.addRule("strikethrough", {
    filter: ["del", "s"],
    replacement: (content) => `~~${content}~~`,
  });

  td.addRule("highlight", {
    filter: ["mark"],
    replacement: (content) => `==${content}==`,
  });

  td.addRule("link", {
    filter: (node, options) =>
      options.linkStyle === "inlined" &&
      node.nodeName === "A" &&
      !!node.getAttribute("href"),
    replacement: (content, node) => {
      const el = node as Element;
      const href = encodeUrl(el.getAttribute("href") ?? "");
      return `[${content}](${href}${titleSuffix(el)})`;
    },
  });

  td.addRule("media", {
    filter: ["img"],
    replacement: (_content, node) => {
      const el = node as Element;
      const src = el.getAttribute("src");
      if (!src) return "";
      const alt = normalizeAttr(el.getAttribute("alt"));
      return `![${alt}](${encodeUrl(src)}${titleSuffix(el)})`;
    },
  });

  td.addRule("highlightedCodeBlock", {
    filter: (node) => {
      const first = node.firstChild;
      return (
        node.nodeName === "DIV" &&
        HIGHLIGHT_LANG.test(node.className) &&
        !!first &&
        first.nodeName === "PRE"
      );
    },
    replacement: (_content, node, options) => {
      const el = node as Element;
      const lang = HIGHLIGHT_LANG.exec(el.className)?.groups.lang ?? "";
      const fence = options.fence ?? "```";
      return `\n\n${fence}${lang}\n${el.firstChild?.textContent ?? ""}\n${fence}\n\n`;
    },
  });

  td.addRule("listItem", {
    filter: "li",
    replacement: (content, node, options) => {
      const body = content
        .replace(LEAD_NL, "")
        .replace(TRAIL_NL, "\n")
        .replace(INNER_NL, "\n    ");
      const el = node as Element;
      const parent = el.parentElement;
      let prefix = `${options.bulletListMarker} `;
      if (parent?.nodeName === "OL") {
        const start = parent.getAttribute("start");
        const index = Array.prototype.indexOf.call(parent.children, el);
        prefix = `${start ? Number(start) + index : index + 1}. `;
      }
      const trailing = el.nextSibling && !ENDS_NL.test(body) ? "\n" : "";
      return `${prefix}${body}${trailing}`;
    },
  });

  td.addRule("taskListItems", {
    filter: (node) =>
      node.nodeName === "INPUT" &&
      node.getAttribute("type") === "checkbox" &&
      node.parentElement?.nodeName === "LI",
    replacement: (_content, node) =>
      (node as HTMLInputElement).checked ? "[x] " : "[ ] ",
  });

  td.addRule("tableCell", {
    filter: ["th", "td"],
    replacement: (content, node) => {
      const el = node as Element;
      const parent = el.parentNode;
      const isFirst =
        !!parent && Array.prototype.indexOf.call(parent.childNodes, el) === 0;
      const cell = `${content.trim().replace(PIPES, "\\|").replace(CELL_NL, "<br>")}|`;
      return `${isFirst ? "|" : ""}${cell}${colspanPad(el, "   |")}`;
    },
  });

  td.addRule("tableRow", {
    filter: "tr",
    replacement: (content, node) => {
      const row = node as HTMLTableRowElement;
      let separator = "";
      if (isHeaderRow(row)) {
        Array.from(row.cells).forEach((cell, i) => {
          const align = (cell.getAttribute("align") ?? "").toLowerCase();
          const dash = TABLE_ALIGN[align] ?? "---";
          separator += `${i === 0 ? "|" : ""}${dash}|${colspanPad(cell, `${dash}|`)}`;
        });
      }
      return `\n${content}${separator ? `\n${separator}` : ""}`;
    },
  });

  td.addRule("table", {
    filter: "table",
    replacement: (content, node) => {
      const table = node as HTMLTableElement;
      const firstRow = table.rows[0];
      let body = content;
      if (!isHeaderRow(firstRow)) {
        let cols = 0;
        if (firstRow) {
          for (const cell of firstRow.cells) cols += 1 + extraColspan(cell);
        }
        body =
          `|${"   |".repeat(cols)}\n` +
          `|${"---|".repeat(cols)}\n` +
          `${content.replace(LEAD_NLCR, "")}`;
      }
      return `\n\n${body.replace(NLCR, "\n")}\n\n`;
    },
  });

  td.addRule("tableSection", {
    filter: ["thead", "tbody", "tfoot"],
    replacement: (content) => content,
  });

  // Obsidian disables Markdown escaping entirely, so `[`, `*`, `_`, `\`, `$`
  // pass through verbatim — essential for code, math, and citation markers.
  td.escape = (text) => text;
}
