// A view's vault conditions, planned before ZotLit Query runs: the plugin
// evaluates them against the value each Literature Note holds and against
// no value, and gives ZotLit Query one condition on the Indexed Key in their
// place. Where the conditions fail for no value, that condition keeps the
// Items whose note passes, `[..].contains(indexedKey)`, which ZotLit Query
// reads as candidates from the database. Where they hold for no value, it
// leaves out the Items whose note fails, `![..].contains(indexedKey)`, which
// ZotLit Query tests on each Item it reads. Either way ZotLit Query applies
// `limit` to the rows the view shows.
//
// @see apps/obsidian/docs/adr/0070-vault-properties-are-answered-outside-zotlit-query.md
import { planItemFilter } from "@zotlit/item-query";

import * as m from "@/lib/i18n/generated/messages";
import type { FilterLocation } from "@/views/query-view/query-file";
import type { ReaderDiagnosticSource } from "@/views/query-view/reader-diagnostic";
import type { VaultValue } from "@/views/query-view/table-notes";

import type { VaultCondition, VaultRead } from "./filter-split";

/** The Literature Notes a vault filter reads. */
export interface VaultFilterNotes {
  /** The Indexed Keys of the Items that have a Literature Note. */
  itemKeys(): Iterable<string>;
  /** The vault property `name` of an Item, by its Indexed Key. */
  read(itemKey: string, name: string): VaultValue;
}

/**
 * The plan of a view's vault conditions: the condition ZotLit Query reads in
 * their place, `null` where it needs none; or the condition that keeps the
 * view from running, with what is wrong with it.
 */
export type VaultFilter =
  | { readonly condition: string | null }
  | {
      readonly fault: {
        readonly at: FilterLocation;
        readonly diagnostic: ReaderDiagnosticSource;
      };
    };

/** What a view's vault conditions are planned from. */
export interface VaultFilterInput {
  /** The vault conditions that must each hold for a row. */
  readonly conditions: readonly VaultCondition[];
  /**
   * The conditions that read a vault property elsewhere in the filters, such
   * as inside an `or` group, which the plugin cannot take out of ZotLit
   * Query's filter.
   */
  readonly stranded: readonly FilterLocation[];
  readonly notes: VaultFilterNotes;
  /**
   * What reads the Indexed Key of a row's Item: `indexedKey`, the default,
   * or `item.indexedKey` for a row of an Annotation or an Attachment.
   */
  readonly keyPath?: string;
}

/** Plan a view's vault conditions against every Literature Note. */
export function planVaultFilter({
  conditions,
  stranded,
  notes,
  keyPath = "indexedKey",
}: VaultFilterInput): VaultFilter {
  const [nested] = stranded;
  if (nested)
    return fault(nested, {
      code: "vault-filter-nested",
      message: m.query_view_vault_filter_nested(),
      hint: m.query_view_vault_filter_nested_hint(),
    });
  if (conditions.length === 0) return { condition: null };
  const planned: {
    text: string;
    reads: readonly VaultRead[];
    at: FilterLocation;
  }[] = [];
  for (const { text, section, path, reads } of conditions) {
    if (reads === null)
      return fault(
        { section, path },
        {
          code: "vault-filter-mixed",
          message: m.query_view_vault_filter_mixed(),
          hint: m.query_view_vault_filter_mixed_hint(),
        },
      );
    planned.push({ text, reads, at: { section, path } });
  }
  // Each text is planned once, however many notes hold the same values.
  const tests = new Map<string, boolean>();
  const holds = (value: (name: string) => unknown) => {
    for (const { text, reads, at } of planned) {
      const filled = substitute(text, reads, value);
      let matched = tests.get(filled);
      if (matched === undefined) {
        const filter = planItemFilter(filled);
        if ("code" in filter)
          return {
            at,
            diagnostic: {
              code: filter.code,
              message: filter.message,
              hint: filter.hint,
            },
          };
        // The text reads no field of the Item, only the values put in it.
        matched = filter.matches({} as never);
        tests.set(filled, matched);
      }
      if (!matched) return false;
    }
    return true;
  };
  const withoutNote = holds(() => null);
  if (typeof withoutNote !== "boolean") return { fault: withoutNote };
  const listed: string[] = [];
  for (const key of notes.itemKeys()) {
    const passes = holds((name) => {
      const read = notes.read(key, name);
      return read.note ? read.value : null;
    });
    if (typeof passes !== "boolean") return { fault: passes };
    // Without a note an Item passes as no value does; the list names the
    // notes that answer otherwise.
    if (passes !== withoutNote) listed.push(key);
  }
  listed.sort();
  if (withoutNote && listed.length === 0) return { condition: null };
  const list = `[${listed.map((key) => JSON.stringify(key)).join(", ")}].contains(${keyPath})`;
  return { condition: withoutNote ? `!${list}` : list };
}

function fault(
  { section, path }: FilterLocation,
  diagnostic: ReaderDiagnosticSource,
): VaultFilter {
  return { fault: { at: { section, path }, diagnostic } };
}

/** `text` with each vault property it reads replaced by its value. */
function substitute(
  text: string,
  reads: readonly VaultRead[],
  value: (name: string) => unknown,
): string {
  let out = "";
  let last = 0;
  for (const read of [...reads].sort((a, b) => a.from - b.from)) {
    out += text.slice(last, read.from) + literal(value(read.name));
    last = read.to;
  }
  return out + text.slice(last);
}

/**
 * The Filter Expression literal of a frontmatter value. A value with no
 * literal, such as a nested map, reads as no value.
 */
function literal(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number")
    return Number.isFinite(value) ? `(${value})` : "null";
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[${value.map(literal).join(", ")}]`;
  return "null";
}
