// Targeted YAML edits into the Profile manifest, so a form control changes one
// node instead of re-serializing the manifest and losing the author's bytes.

import type { ChangeSpec } from "@codemirror/state";
import { isMap, isNode, isScalar, isSeq, parseDocument, stringify } from "yaml";
import type { Document, Node, Pair, YAMLMap } from "yaml";

import { literatureNoteTemplateManifestRange } from "@zotlit/templates/facade";

/**
 * The value kinds a form control writes into the manifest. A multi-line YAML
 * value would land with its continuation lines at column 0, so patching one
 * node in place stays with the scalars the form owns.
 */
export type ManifestScalar = string | number | boolean | null;

/**
 * Source offsets one region covers; `to` is exclusive. A manifest node's own
 * range and the slice a pane edits it through are the same span, so both sides
 * read it under this one name.
 */
export interface WorkbenchSliceRange {
  readonly from: number;
  readonly to: number;
}

/** The field a Managed Frontmatter entry writes its expression in. */
export type ManagedEntryLanguage = "expr" | "value" | "js";

/** One authored Managed Frontmatter entry, as the source holds it. */
export interface ManagedEntrySource {
  /** 1-based list position, the number every entry diagnostic names. */
  readonly position: number;
  /** The static entry's property name; absent on a Spread Entry. */
  readonly key?: string;
  readonly language: ManagedEntryLanguage;
  readonly merge: string;
  /** The whole authored entry in whole lines, so it can move or go. */
  readonly block: WorkbenchSliceRange;
  /** The expression's own text — the region a slice editor owns. */
  readonly expression: WorkbenchSliceRange;
}

/** A structural change to the Managed Frontmatter list. */
export type ManagedEntryAction =
  | {
      readonly action: "add";
      readonly kind: "property" | "spread";
      /** Position to insert after; the foot of the list when absent. */
      readonly after?: number;
    }
  | { readonly action: "remove"; readonly position: number }
  | { readonly action: "move"; readonly position: number; readonly by: -1 | 1 }
  | {
      readonly action: "language";
      readonly position: number;
      readonly language: "expr" | "value";
      /** Start a value entry with literal text instead of the example rule. */
      readonly text?: string;
    }
  | {
      readonly action: "set";
      readonly position: number;
      readonly field: "key" | "merge";
      readonly value: string;
    };

/**
 * What a fresh entry starts with. A language change writes the same text, which
 * is what keeps it a new expression rather than a silent translation of the old
 * one — the author's own text stays one undo away.
 */
const NEW_EXPRESSION = "zt.title";
const NEW_RULE = '{"$eval":"zt.title"}';
const NEW_SPREAD =
  '{"kind":{"$eval":"zt.itemType"},"tags":{"$eval":"zt.tags"}}';

/**
 * The document change that replaces the manifest node at `path` with `value`.
 * A replaced string keeps the scalar style it had, so an author's quoting
 * survives a form edit.
 * @returns null when the draft has no closed manifest or the path names no node.
 */
export function manifestValueEdit(
  source: string,
  path: readonly (string | number)[],
  value: ManifestScalar,
): ChangeSpec | null {
  const found = manifestNode(source, path);
  if (!found) return null;

  const { node, from, to } = found;
  return { from, to, insert: scalarText(value, node) };
}

/**
 * The document change that writes one top-level manifest key, or removes the
 * key with its own line when `value` is undefined — the two halves of Override
 * and Use default. A key the manifest never wrote is added at its foot.
 * @returns null when the manifest does not parse, when the key holds a value no
 * form can patch — anything but a scalar — and when a removal is asked of a key
 * the manifest never wrote, which is the state the caller wanted.
 */
export function manifestKeyEdit(
  source: string,
  key: string,
  value: ManifestScalar | undefined,
): ChangeSpec | null {
  const manifest = manifestYaml(source);
  if (!manifest || manifest.doc.errors.length > 0) return null;

  const pair = mapPair(manifest.doc.contents, key);
  if (!pair) {
    return value === undefined
      ? null
      : {
          from: manifest.end,
          to: manifest.end,
          insert: `${key}: ${scalarText(value, null)}\n`,
        };
  }
  // A block mapping or a sequence under this key spans lines the removal below
  // would leave behind, so a key that holds one keeps the value it has.
  if (
    !isScalar(pair.key) ||
    !pair.key.range ||
    !isScalar(pair.value) ||
    !pair.value.range
  ) {
    return null;
  }
  const [from, to] = pair.value.range;
  if (value !== undefined) {
    return {
      from: manifest.offset + from,
      to: manifest.offset + to,
      insert: scalarText(value, pair.value),
    };
  }
  // The key goes with the line it was written on, so the manifest keeps the
  // shape it had rather than gaining a blank line where the binding was.
  return {
    from: lineStart(source, manifest.offset + pair.key.range[0]),
    to: blockEnd(source, manifest.offset + to),
  };
}

/**
 * The text a manifest scalar holds, inside its quotes when it has them — the
 * region a slice editor owns, so the note-name template is edited as template
 * source rather than as YAML.
 * @returns null when the value is written in a form one line cannot hold: a
 * block scalar, a folded plain scalar, or a quoted one carrying an escape.
 */
export function manifestScalarSlice(
  source: string,
  path: readonly (string | number)[],
): WorkbenchSliceRange | null {
  const found = manifestNode(source, path);
  if (!found || !isScalar(found.node)) return null;

  const { node, from, to } = found;
  const quoted = node.type === "QUOTE_SINGLE" || node.type === "QUOTE_DOUBLE";
  if (node.type !== "PLAIN" && !quoted) return null;
  const slice = quoted ? { from: from + 1, to: to - 1 } : { from, to };
  const text = source.slice(slice.from, slice.to);
  // A quoted scalar whose raw text differs from its value carries an escape or
  // a doubled quote, which an editor over the raw text would corrupt.
  return text.includes("\n") || (quoted && text !== node.value) ? null : slice;
}

/**
 * Document offsets of the manifest node at `path`, so a problem can point at
 * the text that caused it.
 * @returns null when the draft has no closed manifest or the path names no node.
 */
export function manifestNodeRange(
  source: string,
  path: readonly (string | number)[],
): WorkbenchSliceRange | null {
  const found = manifestNode(source, path);
  return found && { from: found.from, to: found.to };
}

/** What the manifest's `frontmatter` list offers a form right now. */
export type ManagedFrontmatterList =
  /** The authored entries, in list order: the list is one a form can patch. */
  | { readonly status: "rows"; readonly entries: readonly ManagedEntrySource[] }
  /**
   * The manifest parses and its list does not: a flow list, or an entry that is
   * not a block mapping. Advanced owns that list.
   */
  | { readonly status: "source-only" }
  /** The manifest text does not parse, so the source names no entry at all. */
  | { readonly status: "unparsed" };

/** Every Managed Frontmatter entry the manifest authors, in list order. */
export function managedFrontmatterEntries(
  source: string,
): ManagedFrontmatterList {
  const read = readList(source);
  return read.status === "rows"
    ? { status: "rows", entries: read.list.entries.map(({ entry }) => entry) }
    : read;
}

/**
 * The document change one Properties action makes. Every action rewrites whole
 * lines of the entry it names and leaves every other byte — comments, key
 * order, quoting — where the author put it.
 * @returns null when the action names no entry, or the list is not patchable.
 */
export function managedEntryEdit(
  source: string,
  action: ManagedEntryAction,
): ChangeSpec | null {
  const read = readList(source);
  if (read.status !== "rows") return null;
  const { list } = read;
  switch (action.action) {
    case "add":
      return addEntry(list, action);
    case "remove":
      return removeEntry(list, action.position);
    case "move":
      return moveEntry(source, list, action);
    case "language":
      return changeLanguage(list, action);
    case "set":
      return setField(list, action);
  }
}

/** One entry, with the mapping node the structural actions patch through. */
interface ManagedEntryNode {
  readonly entry: ManagedEntrySource;
  readonly node: YAMLMap;
  /** Column the entry's own keys sit at, where a missing one is written. */
  readonly column: number;
}

/** The `frontmatter` list as the source holds it, ready to patch. */
interface ManagedList {
  readonly manifest: ManifestYaml;
  readonly entries: readonly ManagedEntryNode[];
  /** Column the `-` markers sit at. */
  readonly indent: number;
  /** Offset just past `frontmatter:`, or null when the manifest omits the key. */
  readonly keyEnd: number | null;
  /** The list value's own range, or null when the manifest omits the key. */
  readonly value: WorkbenchSliceRange | null;
}

/** The list ready to patch, or the reason a form cannot have it. */
type ReadList =
  | { readonly status: "rows"; readonly list: ManagedList }
  | Exclude<ManagedFrontmatterList, { status: "rows" }>;

interface ManifestYaml {
  readonly doc: Document;
  /** Where the manifest starts in the document, added to every node offset. */
  readonly offset: number;
  /** The closing `---` line, where a missing manifest key is written. */
  readonly end: number;
}

function manifestYaml(source: string): ManifestYaml | null {
  let range;
  try {
    range = literatureNoteTemplateManifestRange(source);
  } catch {
    return null;
  }
  return {
    doc: parseDocument(source.slice(range.from, range.to), {
      keepSourceTokens: true,
    }),
    offset: range.from,
    end: range.to,
  };
}

function manifestNode(
  source: string,
  path: readonly (string | number)[],
): { node: Node; from: number; to: number } | null {
  const manifest = manifestYaml(source);
  if (!manifest) return null;

  const node = manifest.doc.getIn(path, true);
  if (!isNode(node) || !node.range) return null;

  const [start, end] = node.range;
  return { node, from: manifest.offset + start, to: manifest.offset + end };
}

function readList(source: string): ReadList {
  const manifest = manifestYaml(source);
  if (!manifest || manifest.doc.errors.length > 0) {
    return { status: "unparsed" };
  }

  const rows = (list: ManagedList): ReadList => ({ status: "rows", list });
  const pair = mapPair(manifest.doc.contents, "frontmatter");
  if (!pair) {
    return rows({
      manifest,
      entries: [],
      indent: 2,
      keyEnd: null,
      value: null,
    });
  }
  const keyEnd =
    isScalar(pair.key) && pair.key.range
      ? manifest.offset + pair.key.range[1] + 1
      : null;
  const node = pair.value;
  if (!isNode(node) || !node.range || keyEnd === null) {
    return { status: "source-only" };
  }
  const value = {
    from: manifest.offset + node.range[0],
    to: manifest.offset + node.range[1],
  };
  const empty = { manifest, entries: [], keyEnd, value };
  // An unwritten list is still a list a first entry can be added to; anything
  // other than a block sequence of block mappings belongs to Advanced.
  if (isScalar(node) && node.value === null)
    return rows({ ...empty, indent: 2 });
  if (!isSeq(node)) return { status: "source-only" };
  if (node.items.length === 0) return rows({ ...empty, indent: 2 });
  const token = node.srcToken;
  if (token?.type !== "block-seq") return { status: "source-only" };

  const entries: ManagedEntryNode[] = [];
  for (const [index, item] of node.items.entries()) {
    const marker = token.items[index]?.start.find(
      (part) => part.type === "seq-item-ind",
    );
    if (!marker) return { status: "source-only" };
    const entry = readEntry(source, manifest, {
      item,
      index,
      marker: manifest.offset + marker.offset,
    });
    if (!entry) return { status: "source-only" };
    entries.push(entry);
  }
  return rows({ manifest, entries, indent: token.indent, keyEnd, value });
}

function readEntry(
  source: string,
  manifest: ManifestYaml,
  { item, index, marker }: { item: unknown; index: number; marker: number },
): ManagedEntryNode | null {
  if (!isMap(item) || item.srcToken?.type !== "block-map" || !item.range) {
    return null;
  }
  const language = (["expr", "value", "js"] as const).find((name) =>
    item.has(name),
  );
  const field = language && mapPair(item, language);
  if (!field || !isNode(field.value) || !field.value.range) return null;

  const key = item.get("key");
  const merge = item.get("merge");
  const start = manifest.offset + item.range[0];
  const expression = manifest.offset + field.value.range[0];
  return {
    node: item,
    column: start - lineStart(source, start),
    entry: {
      position: index + 1,
      ...(typeof key === "string" ? { key } : {}),
      language,
      merge: typeof merge === "string" ? merge : "replace",
      // The `-` marker introduces the entry, and an entry may write its first
      // key on the line under it, so the block starts at the marker's own line.
      block: {
        from: lineStart(source, marker),
        to: blockEnd(source, manifest.offset + item.range[1]),
      },
      expression: {
        from: expression,
        to: contentEnd(
          source,
          expression,
          manifest.offset + field.value.range[1],
        ),
      },
    },
  };
}

function addEntry(
  list: ManagedList,
  { kind, after }: { kind: "property" | "spread"; after?: number },
): ChangeSpec | null {
  const indent = " ".repeat(list.indent);
  const text =
    kind === "spread"
      ? `${indent}- value: ${NEW_SPREAD}\n`
      : `${indent}- key: ${freshKey(list)}\n${indent}  expr: ${NEW_EXPRESSION}\n`;

  if (list.entries.length > 0) {
    const at =
      after === undefined
        ? list.entries.at(-1)!.entry.block.to
        : entryAt(list, after)?.entry.block.to;
    return at === undefined ? null : { from: at, to: at, insert: text };
  }
  // The first entry writes the list itself: over an empty or unwritten value
  // when the key is there, and over the manifest's foot when it is not.
  if (list.keyEnd === null || !list.value) {
    return {
      from: list.manifest.end,
      to: list.manifest.end,
      insert: `frontmatter:\n${text}`,
    };
  }
  return {
    from: list.keyEnd,
    to: list.value.to,
    insert: `\n${text.slice(0, -1)}`,
  };
}

function removeEntry(list: ManagedList, position: number): ChangeSpec | null {
  const target = entryAt(list, position);
  if (!target) return null;
  const { block } = target.entry;
  if (list.entries.length > 1) return { from: block.from, to: block.to };
  // A `frontmatter:` with nothing under it reads as null, which the manifest
  // schema refuses, so the last removal writes an empty list beside the key and
  // takes the entry's own lines alone, leaving the rest of the key's line and
  // every comment the list carries. An entry only exists under a written key,
  // so the key end is there.
  return [
    { from: list.keyEnd!, to: list.keyEnd!, insert: " []" },
    { from: block.from, to: block.to },
  ];
}

function moveEntry(
  source: string,
  list: ManagedList,
  { position, by }: { position: number; by: -1 | 1 },
): ChangeSpec | null {
  const moved = entryAt(list, position);
  const other = entryAt(list, position + by);
  if (!moved || !other) return null;
  const [first, second] =
    by === 1 ? [moved.entry, other.entry] : [other.entry, moved.entry];
  return {
    from: first.block.from,
    to: second.block.to,
    insert:
      source.slice(second.block.from, second.block.to) +
      // Whatever the author wrote between the two entries — a comment, a blank
      // line — stays between them.
      source.slice(first.block.to, second.block.from) +
      source.slice(first.block.from, first.block.to),
  };
}

function changeLanguage(
  list: ManagedList,
  {
    position,
    language,
    text,
  }: { position: number; language: "expr" | "value"; text?: string },
): ChangeSpec | null {
  const target = entryAt(list, position);
  if (!target) return null;
  // A keyless entry spreads a mapping over the note, which only a rule writes.
  if (
    (language === "expr" || text !== undefined) &&
    target.entry.key === undefined
  )
    return null;

  const field = mapPair(target.node, target.entry.language);
  if (!field || !isScalar(field.key) || !field.key.range) return null;
  if (
    target.entry.language === language &&
    text === undefined &&
    !(
      language === "value" &&
      isScalar(field.value) &&
      typeof field.value.value === "string"
    )
  )
    return null;
  return {
    from: list.manifest.offset + field.key.range[0],
    to: target.entry.expression.to,
    insert:
      language === "expr"
        ? `expr: ${NEW_EXPRESSION}`
        : `value: ${text === undefined ? NEW_RULE : JSON.stringify(text)}`,
  };
}

function setField(
  list: ManagedList,
  {
    position,
    field,
    value,
  }: { position: number; field: "key" | "merge"; value: string },
): ChangeSpec | null {
  const target = entryAt(list, position);
  if (!target) return null;

  const pair = mapPair(target.node, field);
  if (pair && isNode(pair.value) && pair.value.range) {
    return {
      from: list.manifest.offset + pair.value.range[0],
      to: list.manifest.offset + pair.value.range[1],
      insert: scalarText(value, pair.value),
    };
  }
  // An entry that never wrote the key gains it as its own line, at the column
  // its siblings sit at.
  const { block } = target.entry;
  return {
    from: block.to,
    to: block.to,
    insert: `${" ".repeat(target.column)}${field}: ${scalarText(value, null)}\n`,
  };
}

function entryAt(list: ManagedList, position: number): ManagedEntryNode | null {
  return list.entries[position - 1] ?? null;
}

/** The next `property`, `property2`, … the list has no entry for. */
function freshKey(list: ManagedList): string {
  const taken = new Set(list.entries.map(({ entry }) => entry.key));
  let key = "property";
  for (let index = 2; taken.has(key); index++) key = `property${index}`;
  return key;
}

/** A scalar written the way the node it replaces was written. */
function scalarText(value: ManifestScalar, node: Node | null): string {
  return stringify(value, {
    lineWidth: 0,
    ...(typeof value === "string" && node && isScalar(node) && node.type
      ? { defaultStringType: node.type }
      : {}),
  }).trimEnd();
}

function mapPair(node: unknown, name: string): Pair | null {
  if (!isMap(node)) return null;
  return (
    node.items.find((item) => isScalar(item.key) && item.key.value === name) ??
    null
  );
}

function lineStart(source: string, at: number): number {
  return source.lastIndexOf("\n", at - 1) + 1;
}

/**
 * The end of the region's last content line. A block mapping's own end and a
 * block scalar's sit on the line under the value, so a slice bounded there
 * would carry the line break that starts the entry's next key.
 */
function contentEnd(source: string, from: number, to: number): number {
  return from + source.slice(from, to).trimEnd().length;
}

/**
 * The start of the line after `at`. A block mapping's own end already sits
 * there, so this only has to travel when a trailing comment holds the rest of
 * the entry's last line.
 */
function blockEnd(source: string, at: number): number {
  const next = source.indexOf("\n", Math.max(at - 1, 0));
  return next === -1 ? source.length : next + 1;
}
