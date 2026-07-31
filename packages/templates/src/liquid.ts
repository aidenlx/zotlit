// Liquid engine core: fixed engine config plus the ZotLit tag/filter vocabulary.

import {
  evalToken,
  filters,
  Liquid,
  Tag,
  tags,
  type Context,
  type Emitter,
  type FS,
  type TagToken,
  type Template,
  type TopLevelToken,
  type ValueToken,
} from "liquidjs";

import { Temporal } from "@zotlit/shared/temporal";

import { formatBlockquote } from "./blockquote";
import { coerceOutput } from "./coerce";
import { filenameSuffix } from "./filename-suffix";
import { normalizeObsidianTag } from "./obsidian-tag";

/**
 * Minimal structural view of a Zotero multipart date, duck-typed so this
 * package doesn't depend on `@zotlit/db`.
 *
 * @see `packages/db/src/lib/zt-date.ts` `ItemDate` for the full shape
 */
interface ItemDateLike {
  kind: "date" | "yearMonth" | "year" | "text";
  year: number | null;
  month: number | null;
  day: number | null;
  toString(): string;
}

export const LIQUID_BUILTIN_FILTER_NAMES: readonly string[] = Object.freeze(
  Object.keys(filters).sort(),
);

export const LIQUID_BUILTIN_TAG_NAMES: readonly string[] = Object.freeze(
  Object.keys(tags).sort(),
);

export const ZOTLIT_FILTER_NAMES: readonly string[] = Object.freeze([
  "embed",
  "file_link",
  "note_link",
  "img_link",
  "note_links",
  "collection_paths",
  "arr_prefix",
  "arr_suffix",
  "arr_replace",
  "obsidian_tag",
]);

const ITEM_DATE_KINDS: ReadonlySet<unknown> = new Set([
  "date",
  "yearMonth",
  "year",
  "text",
] satisfies ItemDateLike["kind"][]);

function isItemDateLike(value: unknown): value is ItemDateLike {
  return (
    typeof value === "object" &&
    value !== null &&
    ITEM_DATE_KINDS.has((value as { kind?: unknown }).kind)
  );
}

/**
 * Registers a link-override filter for a camelCase link-helper method (e.g.
 * `fileLink`) under a snake_case filter name (e.g. `file_link`). The method
 * may be absent — a real "no link" data state, not a defensive check — in
 * which case the filter returns `null` so `embed`/{@link coerceOutput}
 * collapse it to `""`.
 */
function registerLinkFilter(
  engine: Liquid,
  filterName: string,
  methodName: string,
): void {
  engine.registerFilter(
    filterName,
    (obj: unknown, alias?: string, subpath?: string) => {
      const helper = (obj as Record<string, unknown> | null | undefined)?.[
        methodName
      ];
      return typeof helper === "function"
        ? (helper as (alias?: string, subpath?: string) => unknown).call(
            obj,
            alias,
            subpath,
          )
        : null;
    },
  );
}

/**
 * Reads the text to normalize from one `obsidian_tag` input. A Zotero tag
 * arrives as `{ name }`, so reading it here lets a template pipe `zt.tags`
 * straight in without `map: "name"` first. An object with no string `name`
 * yields `""`, which the filter then drops — `[object Object]` is never a tag
 * the author meant.
 */
function tagName(item: unknown): string {
  if (typeof item === "string") return item;
  if (typeof item === "number") return String(item);
  const name = (item as { name?: unknown } | null | undefined)?.name;
  return typeof name === "string" ? name : "";
}

/**
 * Resolves one related item to its note link, falling back to
 * `zt-error:<indexedKey>` when `noteLink()` is absent or returns `null` —
 * reproduces the old JS frontmatter default's per-item error fallback.
 */
function noteLinkOrError(item: unknown): unknown {
  const record = item as Record<string, unknown> | null | undefined;
  const noteLink = record?.noteLink;
  const link =
    typeof noteLink === "function"
      ? (noteLink as () => unknown).call(record)
      : null;
  return link ?? `zt-error:${String(record?.indexedKey)}`;
}

/** `{% bq %}…{% endbq %}` block tag wrapping {@link formatBlockquote}. */
class BqTag extends Tag {
  readonly #tpls: Template[] = [];

  constructor(
    tagToken: TagToken,
    remainTokens: TopLevelToken[],
    liquid: Liquid,
  ) {
    super(tagToken, remainTokens, liquid);
    liquid.parser
      .parseStream(remainTokens)
      .on("template", (tpl: Template) => this.#tpls.push(tpl))
      .on("tag:endbq", function (this: { stop(): void }) {
        this.stop();
      })
      .on("end", () => {
        throw new Error(`tag ${tagToken.getText()} not closed`);
      })
      .start();
  }

  *render(ctx: Context, emitter: Emitter): Generator<unknown, void, unknown> {
    const html = (yield this.liquid.renderer.renderTemplates(
      this.#tpls,
      ctx,
    )) as string;
    emitter.write(formatBlockquote(html));
  }
}

/** Inline `{% suffix length, prepend, append %}` tag wrapping {@link filenameSuffix}; all args optional. */
class SuffixTag extends Tag {
  readonly #args: ValueToken[] = [];

  constructor(
    tagToken: TagToken,
    remainTokens: TopLevelToken[],
    liquid: Liquid,
  ) {
    super(tagToken, remainTokens, liquid);
    while (!this.tokenizer.end()) {
      const value = this.tokenizer.readValue();
      if (value) this.#args.push(value);
      this.tokenizer.readTo(",");
    }
  }

  *render(ctx: Context, emitter: Emitter): Generator<unknown, void, unknown> {
    const [lengthTok, prependTok, appendTok] = this.#args;
    const length = lengthTok
      ? ((yield evalToken(lengthTok, ctx)) as number | undefined)
      : undefined;
    const prepend = prependTok
      ? ((yield evalToken(prependTok, ctx)) as string | undefined)
      : undefined;
    const append = appendTok
      ? ((yield evalToken(appendTok, ctx)) as string | undefined)
      : undefined;
    emitter.write(filenameSuffix(length, prepend, append));
  }
}

export interface CreateLiquidEngineOptions {
  /**
   * Overrides the file-system module backing `{% render %}`/`{% include %}`
   * partial resolution.
   *
   * @see `TemplateFacade` in `./facade`, which passes an in-memory `fs` so
   *   named partials resolve against its own registry instead of disk.
   */
  fs?: FS;
}

/**
 * Builds a Liquid engine with fixed, non-configurable options and the
 * ZotLit tag/filter vocabulary. Rendering is synchronous —
 * `engine.parseAndRenderSync(template, data)`.
 *
 * Coercion via `outputEscape` applies only to `{{ }}` outputs: `{% echo %}`
 * inside a `{% liquid %}` block bypasses it entirely. Whitespace trimming is
 * off by default (`greedy: false`); a trailing `-%}` eats inline blanks plus
 * exactly one following newline (a blank line after it survives), while a
 * leading `{%-` eats only same-line indentation and never a bare newline.
 * `strictFilters: true` turns an unknown filter into a render error instead
 * of a silent pass-through.
 */
export function createLiquidEngine({
  fs,
}: CreateLiquidEngineOptions = {}): Liquid {
  const engine = new Liquid({
    // `fs` key must be absent, not present-with-`undefined`: liquidjs's
    // options normalize() treats an explicit `fs: undefined` as a provided
    // fs module and crashes reading `.dirname` off it.
    ...(fs ? { fs } : {}),
    greedy: false,
    relativeReference: false,
    outputEscape: coerceOutput,
    strictFilters: true,
  });

  engine.registerTag("bq", BqTag);

  engine.registerFilter("embed", (link: unknown): string =>
    typeof link === "string" && link !== "" ? `!${link}` : "",
  );

  registerLinkFilter(engine, "file_link", "fileLink");
  registerLinkFilter(engine, "note_link", "noteLink");
  registerLinkFilter(engine, "img_link", "imgLink");

  engine.registerFilter("note_links", (items: unknown): unknown[] =>
    Array.isArray(items) ? items.map(noteLinkOrError) : [],
  );
  engine.registerFilter(
    "collection_paths",
    (collections: unknown, sep = "/"): unknown[] =>
      Array.isArray(collections)
        ? collections.map((c: unknown) =>
            (c as { path: string[] }).path.join(sep),
          )
        : [],
  );

  engine.registerFilter("arr_prefix", (items: unknown, str?: string) => {
    if (!Array.isArray(items))
      throw new TypeError("arr_prefix requires an array");
    return items.map((item) => `${str ?? ""}${String(item)}`);
  });

  engine.registerFilter("arr_suffix", (items: unknown, str?: string) => {
    if (!Array.isArray(items))
      throw new TypeError("arr_suffix requires an array");
    return items.map((item) => `${String(item)}${str ?? ""}`);
  });

  engine.registerFilter(
    "arr_replace",
    (items: unknown, search?: string, replacement?: string) => {
      if (!Array.isArray(items))
        throw new TypeError("arr_replace requires an array");
      // An empty search would insert the replacement between every character.
      if (!search) throw new TypeError("arr_replace requires a search string");
      return items.map((item) =>
        String(item).replaceAll(search, replacement ?? ""),
      );
    },
  );

  engine.registerFilter("obsidian_tag", (value: unknown, prefix?: string) => {
    const prefixed = (item: unknown): string => {
      const body = normalizeObsidianTag(tagName(item));
      return body === "" ? "" : `${prefix ?? ""}${body}`;
    };
    return Array.isArray(value)
      ? value.map(prefixed).filter((tag) => tag !== "")
      : prefixed(value);
  });

  engine.registerTag("suffix", SuffixTag);

  const builtinDate = filters.date as (
    this: unknown,
    v: unknown,
    ...args: unknown[]
  ) => unknown;
  engine.registerFilter(
    "date",
    function (this: unknown, v: unknown, ...args: unknown[]) {
      // ItemDate "text" carries no parseable date — strftime is meaningless, so
      // render its raw user text and skip the builtin entirely.
      if (isItemDateLike(v) && v.kind === "text") return String(v);
      return builtinDate.call(this, normalizeDateInput(v), ...args);
    },
  );

  return engine;
}

/**
 * Normalizes Temporal / ItemDate-shaped values into a local-time JS `Date`
 * before delegating to the builtin `date` filter, which throws on Temporal
 * objects and would otherwise parse a stringified `PlainDate` as UTC via
 * `new Date(string)`.
 */
function normalizeDateInput(v: unknown): unknown {
  if (v instanceof Temporal.Instant) {
    return new Date(v.epochMilliseconds);
  }
  if (v instanceof Temporal.PlainDate) {
    return new Date(v.year, v.month - 1, v.day);
  }
  if (v instanceof Temporal.PlainYearMonth) {
    return new Date(v.year, v.month - 1, 1);
  }
  if (isItemDateLike(v)) {
    switch (v.kind) {
      case "date":
        return new Date(v.year!, v.month! - 1, v.day!);
      case "yearMonth":
        return new Date(v.year!, v.month! - 1, 1);
      case "year":
        return new Date(v.year!, 0, 1);
    }
  }
  return v;
}
