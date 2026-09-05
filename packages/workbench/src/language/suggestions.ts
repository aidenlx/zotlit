// Contract-driven suggestions and hover for Liquid and Eta Templates: field paths
// off the contract IR, filters, tags, partial names, and the annotation shortcut.

import { regex } from "arkregex";

import type { ContractRoot } from "@zotlit/db";
import type { ContractMember, ContractType } from "@zotlit/db/contract/ir";
import { ANNOTATION_HEADER } from "@zotlit/templates/constants";
import type { TemplateLanguage } from "@zotlit/templates/constants";
import {
  LIQUID_BUILTIN_FILTER_NAMES,
  LIQUID_BUILTIN_TAG_NAMES,
  ZOTLIT_FILTER_NAMES,
  ZOTLIT_TAG_NAMES,
} from "@zotlit/templates/liquid";

import {
  contract,
  resolve,
  members,
  describe,
  child,
  sampleValue,
} from "./contract";
import { etaRange } from "./eta-syntax";
import type { EtaRange } from "./eta-syntax";
import { jsonSuggestions, jsonHover } from "./json-e";
import { liquidRanges, STRUCTURAL_TAGS } from "./liquid-ranges";
import type { LiquidRange } from "./liquid-ranges";
import { rankSuggestions } from "./matching";
import { localsAt } from "./scope";
const JSDOC_LINK = regex("\\{@link (?<target>[^}]+)}", "g");
const ANNOTATION_SHORTCUT_DETAIL =
  "Renders the Profile's final Annotation Section with the argument bound to zt. Outside a Profile, uses the named annotation partial. Missing or null data is an error.";

export interface SuggestionConfig {
  /** The root the document renders against before any Annotation Section. */
  root: ContractRoot;
  mode?: "expression";
  /** Source region that owns this render scope, in editor offsets. */
  scope?: { from: number; to: number };
  /** @default "liquid" */
  language?: TemplateLanguage | "json-e";
  /** Partial names the host has registered, offered after `render` / `include(`. */
  partials: readonly string[];
  /** Serialized Template data for the root; supplies `Sample:` hints. */
  sample?: unknown;
  /** Human labels in common-field order, supplied by the host. */
  fields?: readonly { path: string; label: string }[];
}

/** Display category driving an option's icon/grouping in the editor UI. */
export type SuggestionCategory =
  | "field"
  | "loop"
  | "partial"
  | "liquid-filter"
  | "zotlit-filter"
  | "tag"
  | "structural-tag"
  | "annotation-tag"
  | "annotation-helper";

export interface Suggestion {
  label: string;
  insert: string;
  category: SuggestionCategory;
  /** A contract type (`category: "field"`) or the Eta helper's call signature (`category: "annotation-helper"`). Absent for every other category. */
  type?: string;
  detail: string;
  example?: string;
  from?: number;
  to?: number;
  /** UTF-16 offset within the inserted text. */
  cursorOffset?: number;
  path?: string;
  displayLabel?: string;
  /** Accepting this value continues member completion. */
  continuation?: boolean;
}
export interface SuggestionResult {
  from: number;
  to: number;
  /** End of the enclosing tag, before applying the completion edit. */
  tagEnd: number;
  root: ContractRoot;
  trigger: string;
  language: TemplateLanguage | "json-e";
  expression?: boolean;
  range: TemplateRange;
  options: Suggestion[];
}

/** One source edit and the resulting caret, in the source's UTF-16 offsets. */
export interface CompletionEdit {
  from: number;
  to: number;
  insert: string;
  anchor: number;
  continue: boolean;
}

/** Resolve option-specific replacements and preserve the document's line endings. */
export function completionEdit(
  source: string,
  result: SuggestionResult,
  option: Suggestion,
): CompletionEdit {
  const from = option.from ?? result.from;
  let to = option.to ?? result.to;
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  let text = option.insert;
  if (option.continuation) {
    if (!text.endsWith(".")) text += ".";
    if (source[to] === ".") to++;
  }
  if (
    !result.expression &&
    option.category === "field" &&
    !option.continuation &&
    result.range.kind === "output"
  ) {
    const tail = source.slice(to, result.range.to);
    const close = result.language === "eta" ? " %>" : " }}";
    if (/^\s*(?:-?}}|[-_]?%>)?$/.test(tail)) {
      text += result.range.closed ? tail : tail + close;
      to = result.range.to;
    }
  }
  const insert = text.replaceAll(/\r?\n/g, newline);
  const prefix = text.slice(0, option.cursorOffset ?? text.length);
  return {
    from,
    to,
    insert,
    anchor: from + prefix.replaceAll(/\r?\n/g, newline).length,
    continue: option.continuation ?? false,
  };
}

/**
 * The root in scope at `position`: `annotation` once the final Annotation
 * Section header precedes it, otherwise the supplied root.
 */
export function rootAt(
  source: string,
  position: number,
  root: ContractRoot,
): ContractRoot {
  let from = 0;
  while (from <= position) {
    const end = source.indexOf("\n", from);
    if (end < 0 || end >= position) break;
    const line = source.slice(from, end);
    if ((line.endsWith("\r") ? line.slice(0, -1) : line) === ANNOTATION_HEADER)
      return "annotation";
    from = end + 1;
  }
  return root;
}

type TemplateRange = LiquidRange | EtaRange;
type ResultBuilder = (
  trigger: string,
  query: string,
  options: Suggestion[],
) => SuggestionResult;

/**
 * Data-shaped differences between the two Template languages: how a range is
 * found, how a partial-name / array-loop / array-size trigger reads, and the
 * two mutually exclusive extra completion triggers (Eta's `renderAnnotation`
 * helper vs Liquid's filter and tag options).
 */
interface LanguageProfile {
  findRange(source: string, position: number): TemplateRange | null | undefined;
  /** Matches a partial-name trigger (`render "` for Liquid, `include("` for Eta) against `before`. */
  partialPattern: { exec(text: string): { groups: { query: string } } | null };
  /** Array pseudo-members include `first`/`last` for Liquid; Eta offers only the size member. */
  includeArrayFirstLast: boolean;
  arraySizeName: "size" | "length";
  /** Matches an output tag holding just a `zt` path, eligible for the array → for-block snippet. */
  simpleOutputPattern: RegExp;
  /** Matches the tail from the cursor to the tag close, confirming nothing follows the path. */
  outputClosePattern: RegExp;
  loopSnippet: {
    annotation(expression: string): string;
    entry(expression: string, entry: string): string;
  };
  extraTrigger(ctx: {
    range: TemplateRange;
    before: string;
    source: string;
    position: number;
    result: ResultBuilder;
  }): SuggestionResult | null | undefined;
}

function partialOptions(names: readonly string[]): Suggestion[] {
  return names.map((name) => ({
    label: name,
    insert: name,
    category: "partial",
    detail: "A partial the host has registered.",
  }));
}

function filterOptions(): Suggestion[] {
  return [...new Set([...LIQUID_BUILTIN_FILTER_NAMES, ...ZOTLIT_FILTER_NAMES])]
    .sort()
    .map((name) => ({
      label: name,
      insert: name,
      category: ZOTLIT_FILTER_NAMES.includes(name)
        ? "zotlit-filter"
        : "liquid-filter",
      detail: "A registered filter; the Workbench Guide lists the same names.",
    }));
}

function tagOptions({
  source,
  position,
  range,
  before,
}: {
  source: string;
  position: number;
  range: TemplateRange;
  before: string;
}): Suggestion[] {
  return [
    ...new Set([
      ...LIQUID_BUILTIN_TAG_NAMES,
      ...ZOTLIT_TAG_NAMES,
      ...STRUCTURAL_TAGS,
    ]),
  ]
    .sort()
    .map((name): Suggestion => {
      if (name === "render_annotation") {
        const needsArgument = /^\w*\s*(?:-?%})?$/.test(
          source.slice(position, range.to),
        );
        return {
          label: name,
          insert: needsArgument ? "render_annotation annotation" : name,
          category: "annotation-tag",
          detail: ANNOTATION_SHORTCUT_DETAIL,
          example:
            '{% render_annotation annotation %} = {% render "annotation" with annotation as zt %}',
          ...(needsArgument
            ? { cursorOffset: "render_annotation ".length }
            : {}),
        };
      }
      const option: Suggestion = {
        label: name,
        insert: name,
        category: STRUCTURAL_TAGS.includes(name) ? "structural-tag" : "tag",
        detail: STRUCTURAL_TAGS.includes(name)
          ? "A Literature Note Template block boundary."
          : "Liquid tag registry; ZotLit additions included.",
      };
      if (name !== "managed") return option;
      const ending = /^\w*(?:\s*-?%})?/.exec(source.slice(position))![0];
      const lineStart = source.lastIndexOf("\n", range.from - 1) + 1;
      const indent = /^[\t ]*/.exec(source.slice(lineStart, range.from))![0];
      const open = before.startsWith("{%-") ? "{%-" : "{%";
      const close = ending.endsWith("-%}") ? "-%}" : "%}";
      const bodyStart = `${open} ${name} ${close}\n${indent}`;
      return {
        ...option,
        insert: `${bodyStart}\n${indent}{% end${name} %}`,
        from: range.from,
        to: position + ending.length,
        cursorOffset: bodyStart.length,
      };
    });
}

function fieldOptions({
  fields,
  path,
  sample,
  isEta,
}: {
  fields: readonly ContractMember[];
  path: readonly string[];
  sample: unknown;
  isEta: boolean;
}): Suggestion[] {
  return fields.map((field): Suggestion => {
    const value = sampleValue(sample, [...path, field.name]);
    const helper = resolve(field.type);
    return {
      path: ["zt", ...path, field.name].join("."),
      label: field.name,
      insert: field.name,
      category: "field",
      type: describe(field.type),
      continuation: members(field.type).length > 0 || helper.kind === "array",
      detail: [
        field.description
          ?.replaceAll(JSDOC_LINK, "$<target>")
          .replaceAll("`", ""),
        !isEta && helper.kind === "helper" && helper.filter
          ? `Liquid arguments use | ${helper.filter}.`
          : "",
      ]
        .filter(Boolean)
        .join(" "),
      example:
        value !== undefined
          ? `Sample: ${JSON.stringify(value)}`
          : field.examples?.[0]?.code,
    };
  });
}

/** Offers a whole-block replacement only for a field whose output holds just an array path. */
function arrayLoopOptions({
  fields,
  expressionPrefix,
  range,
  before,
  source,
  position,
  root,
  profile,
}: {
  fields: readonly ContractMember[];
  /** The `zt`-rooted path segments (e.g. `["zt"]`) the loop expression is built from. */
  expressionPrefix: readonly string[];
  range: TemplateRange;
  before: string;
  source: string;
  position: number;
  root: ContractRoot;
  profile: LanguageProfile;
}): Suggestion[] {
  const options: Suggestion[] = [];
  for (const field of fields) {
    const array = resolve(field.type);
    if (array.kind !== "array" || range.kind !== "output") continue;
    if (!profile.simpleOutputPattern.test(before)) continue;
    if (
      !range.closed ||
      !profile.outputClosePattern.test(source.slice(position, range.to))
    )
      continue;
    const expression = [...expressionPrefix, field.name].join(".");
    const display = ["text", "title", "fullName", "name"].find((key) =>
      child(array.items, key),
    );
    const entry = display ? `entry.${display}` : "entry";
    const annotations = root === "note" && expression === "zt.annotations";
    options.push({
      label: `${field.name} → for block`,
      insert: annotations
        ? profile.loopSnippet.annotation(expression)
        : profile.loopSnippet.entry(expression, entry),
      category: "loop",
      detail: annotations
        ? "Renders each annotation through the Profile's Annotation Section, with its data bound to zt. Generic templates use the named partial."
        : "Replaces this output with a loop over the array.",
      from: range.from,
      to: range.to,
    });
  }
  return options;
}

function etaExtraTrigger({
  range,
  before,
  source,
  position,
  result,
}: {
  range: TemplateRange;
  before: string;
  source: string;
  position: number;
  result: ResultBuilder;
}): SuggestionResult | null | undefined {
  if ("inLiteral" in range && range.inLiteral) return null;
  const helper = regex("(?:^|[^\\w.])(?<query>[A-Za-z_]\\w*)$").exec(before);
  if (
    !helper?.groups.query ||
    !"renderAnnotation".startsWith(helper.groups.query)
  )
    return undefined;
  const hasArguments = source
    .slice(position)
    .replace(/^\w*/, "")
    .trimStart()
    .startsWith("(");
  return result("Annotation rendering", helper.groups.query, [
    {
      label: "renderAnnotation",
      insert: hasArguments
        ? "renderAnnotation"
        : "renderAnnotation(annotation)",
      category: "annotation-helper",
      type: "renderAnnotation(annotation)",
      detail: ANNOTATION_SHORTCUT_DETAIL,
      example:
        '<%~ renderAnnotation(annotation) %> = <%~ include("annotation", annotation) %>',
      ...(hasArguments ? {} : { cursorOffset: "renderAnnotation(".length }),
    },
  ]);
}

function liquidExtraTrigger({
  range,
  before,
  source,
  position,
  result,
}: {
  range: TemplateRange;
  before: string;
  source: string;
  position: number;
  result: ResultBuilder;
}): SuggestionResult | null | undefined {
  // Other strings are values, not completion triggers. Keep pipes inside quotes inert.
  let quote = "";
  let pipe = -1;
  for (let i = 2; i < before.length; i++) {
    const char = before[i];
    if (quote) {
      if (char === quote) quote = "";
    } else if (char === '"' || char === "'") quote = char;
    else if (char === "|") pipe = i;
  }
  if (quote) return null;
  if (pipe !== -1) {
    const filter = regex("^\\s*(?<query>\\w*)$").exec(before.slice(pipe + 1));
    if (filter) return result("Filters", filter.groups.query, filterOptions());
  }
  const tag = regex("^\\{%-?\\s*(?<query>\\w*)$").exec(before);
  if (tag)
    return result(
      "Tags",
      tag.groups.query,
      tagOptions({ source, position, range, before }),
    );
  return undefined;
}

const liquidProfile: LanguageProfile = {
  findRange: (source, position) =>
    liquidRanges(source).find(
      (r) => position > r.from + 1 && position <= (r.closed ? r.to - 2 : r.to),
    ),
  partialPattern: regex("^\\{%-?\\s*render\\s+[\"'](?<query>[^\"']*)$"),
  includeArrayFirstLast: true,
  arraySizeName: "size",
  simpleOutputPattern: /^\{\{-?\s*zt(?:\.\w*)*$/,
  outputClosePattern: /^\w*\s*-?}}$/,
  loopSnippet: {
    annotation: (expression) =>
      `{% for annotation in ${expression} %}\n{% render_annotation annotation %}\n{% endfor %}`,
    entry: (expression, entry) =>
      `{% for entry in ${expression} %}\n- {{ ${entry} }}\n{% endfor %}`,
  },
  extraTrigger: liquidExtraTrigger,
};
const LIQUID_PROFILE: LanguageProfile = Object.freeze(liquidProfile);

const etaProfile: LanguageProfile = {
  findRange: etaRange,
  partialPattern: regex("(?:^|[^\\w.])include\\(\\s*[\"'](?<query>[^\"']*)$"),
  includeArrayFirstLast: false,
  arraySizeName: "length",
  simpleOutputPattern: /^<%[-_]?[=~]\s*zt(?:\.\w*)*$/,
  outputClosePattern: /^\w*\s*[-_]?%>$/,
  loopSnippet: {
    annotation: (expression) =>
      `<% for (const annotation of ${expression}) { %>\n<%~ renderAnnotation(annotation) %>\n<% } %>`,
    entry: (expression, entry) =>
      `<% for (const entry of ${expression}) { %>\n- <%= ${entry} %>\n<% } %>`,
  },
  extraTrigger: etaExtraTrigger,
};
const ETA_PROFILE: LanguageProfile = Object.freeze(etaProfile);

export function suggestions(
  source: string,
  position: number,
  config: SuggestionConfig,
): SuggestionResult | null {
  if (config.scope || config.mode === "expression") {
    const { scope, mode, ...rest } = config;
    const from = scope?.from ?? 0;
    const to = scope?.to ?? source.length;
    if (position < from || position > to) return null;
    const prefix = mode === "expression" ? "{{ " : "";
    const found = suggestions(
      prefix + source.slice(from, to),
      position - from + prefix.length,
      rest,
    );
    if (!found) return null;
    const offset = from - prefix.length;
    return {
      ...found,
      expression: mode === "expression",
      from: found.from + offset,
      to: found.to + offset,
      tagEnd: found.tagEnd + offset,
      range: {
        ...found.range,
        from: found.range.from + offset,
        to: found.range.to + offset,
      },
      options: found.options.map((option) => ({
        ...option,
        ...(option.from === undefined ? {} : { from: option.from + offset }),
        ...(option.to === undefined ? {} : { to: option.to + offset }),
      })),
    };
  }
  if (config.language === "json-e")
    return jsonSuggestions(source, position, config);
  const isEta = config.language === "eta";
  const profile = isEta ? ETA_PROFILE : LIQUID_PROFILE;
  const range = profile.findRange(source, position);
  if (!range || range.kind === "comment") return null;
  const before = source.slice(range.from, position);
  const root = rootAt(source, position, config.root);
  const result: ResultBuilder = (trigger, query, options) => ({
    from: position - query.length,
    to: position + (/^[\w-]*/.exec(source.slice(position))?.[0].length ?? 0),
    tagEnd: range.to,
    root,
    trigger,
    language: config.language ?? "liquid",
    range,
    options: rankSuggestions(options, query, config),
  });

  const partial = profile.partialPattern.exec(before);
  if (partial)
    return result(
      "Partial names",
      partial.groups.query,
      partialOptions(config.partials),
    );

  const triggered = profile.extraTrigger({
    range,
    before,
    source,
    position,
    result,
  });
  if (triggered !== undefined) return triggered;

  const rootType: ContractType = {
    kind: "ref",
    name: contract.roots[root]!.type,
  };
  const locals = isEta
    ? new Map([["zt", rootType]])
    : localsAt(source, position, rootType);
  const rootOption: Suggestion = {
    label: "zt",
    insert: "zt.",
    continuation: true,
    category: "field",
    type: contract.roots[root]!.type,
    detail: `The ${root} root in this block.`,
  };
  const rootOptions: Suggestion[] = [
    ...fieldOptions({
      fields: members(rootType),
      path: [],
      sample: config.sample,
      isEta,
    }).map((option) => ({ ...option, insert: `zt.${option.insert}` })),
    rootOption,
    ...[...locals]
      .filter(([name]) => name !== "zt")
      .map(
        ([name, type]): Suggestion => ({
          label: name,
          insert: name,
          category: "field",
          type: type ? describe(type) : "unknown",
          continuation:
            type !== undefined &&
            (members(type).length > 0 || resolve(type).kind === "array"),
          detail: "",
        }),
      ),
  ];
  const search = regex("^\\{\\{-?\\s*(?<query>[A-Za-z_]\\w*(?: +\\w*)*)$").exec(
    before,
  );
  if (search) return result("Root", search.groups.query, rootOptions);
  const pathMatch = regex("(?<path>[A-Za-z_]\\w*(?:\\.[\\w]*)*)$").exec(before);
  if (!pathMatch)
    return /\s$|^\{\{-?$/.test(before) ? result("Root", "", rootOptions) : null;
  const parts = pathMatch.groups.path.split(".");
  if (parts.length === 1) return result("Root", parts[0]!, rootOptions);
  const query = parts.pop()!;
  const path = parts.slice(1);
  let type: ContractType | undefined = locals.get(parts[0]!);
  if (!type) return null;
  for (const key of path) {
    type = child(type, key);
    if (!type) return null;
  }
  const resolved = resolve(type);
  const fields: readonly ContractMember[] =
    resolved.kind === "array"
      ? [
          ...(profile.includeArrayFirstLast
            ? [
                {
                  name: "first",
                  optional: false,
                  type: resolved.items,
                  description:
                    "First entry. Use a for block to process all entries.",
                },
                {
                  name: "last",
                  optional: false,
                  type: resolved.items,
                  description: "Last entry.",
                },
              ]
            : []),
          {
            name: profile.arraySizeName,
            optional: false,
            type: { kind: "primitive", type: "number" },
            description: "Number of entries.",
          },
        ]
      : members(type);
  const options = fieldOptions({
    fields,
    path,
    sample: config.sample,
    isEta,
  });
  options.push(
    ...arrayLoopOptions({
      fields,
      expressionPrefix: parts,
      range,
      before,
      source,
      position,
      root,
      profile,
    }),
  );
  return result("Template fields", query, options);
}

/** Resolve the word under the pointer without changing the editor selection. */
export function hoverHint(
  source: string,
  position: number,
  config: SuggestionConfig,
): SuggestionResult | null {
  if (config.language === "json-e") {
    const from = config.scope?.from ?? 0;
    const to = config.scope?.to ?? source.length;
    if (position < from || position > to) return null;
    const result = jsonHover(source.slice(from, to), position - from, config);
    return result
      ? {
          ...result,
          from: result.from + from,
          to: result.to + from,
          tagEnd: result.tagEnd + from,
          range: {
            ...result.range,
            from: result.range.from + from,
            to: result.range.to + from,
          },
        }
      : null;
  }
  const from =
    position - (/[\w-]*$/.exec(source.slice(0, position))?.[0].length ?? 0);
  const to =
    position + (/^[\w-]*/.exec(source.slice(position))?.[0].length ?? 0);
  if (from === to) return null;
  const result = suggestions(source, to, config);
  const option = result?.options.find(
    (entry) => entry.label === source.slice(from, to),
  );
  return result && option ? { ...result, from, to, options: [option] } : null;
}
