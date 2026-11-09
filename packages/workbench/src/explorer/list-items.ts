// How a list's items read in a note: the one source for the list preview, the list shape and the list snippets.

import type { DisplayNode } from "./display-tree";
import { inertPlaceholderReason } from "./inert-placeholder";
import { coerceToString } from "./string-coercion";

/** What separates the items of a list joined in one line. */
export const JOIN_SEPARATOR = ", ";

/** A list, or a property of a list's items: a field that holds many values. */
export function isList(node: DisplayNode): boolean {
  return (
    node.kind === "list-property" ||
    (node.kind === "value" && node.valueType === "array")
  );
}

/** True for an object literal or a null-prototype record, as opposed to a class instance such as a Temporal date. */
export function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * True for an item a template prints as itself: a primitive, a record with
 * its own `toString` (creators, tags, collections), or a class instance such
 * as a date. A plain record without one prints `[object Object]`.
 */
function itemReadsAsText(item: unknown): boolean {
  if (item === null || item === undefined) return false;
  if (typeof item !== "object") return true;
  if (Array.isArray(item)) return false;
  return Object.hasOwn(item, "toString") || !isPlainObject(item);
}

/** Evaluate a helper with no arguments; `null` on throw, or a null/undefined result. */
export function evaluateHelper(
  fn: (...args: unknown[]) => unknown,
): string | null {
  try {
    const result = fn();
    return result == null ? null : coerceToString(result);
  } catch {
    return null;
  }
}

/**
 * One value as the text a note shows: a helper's zero-argument result, a
 * record's own `toString`; empty for nothing, an inert helper, or a record
 * with no text of its own.
 */
export function valueText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "function") {
    if (inertPlaceholderReason(value) !== undefined) return "";
    return evaluateHelper(value as (...args: unknown[]) => unknown) ?? "";
  }
  if (typeof value !== "object") return coerceToString(value);
  if (!itemReadsAsText(value)) return "";
  const text = coerceToString(value);
  return text === "[object Object]" ? "" : text;
}

/**
 * Whether an item has a value for a property: anything but what Liquid
 * reads as `blank`, that is `null`, `undefined`, `false`, or text that is
 * empty or only spaces. A list snippet passes over an item without one, so
 * the note shows no empty entry for it.
 */
export function hasValue(value: unknown): boolean {
  if (value === null || value === undefined || value === false) return false;
  return typeof value !== "string" || value.trim() !== "";
}

/**
 * The texts a list shows in its preview and its result: every item's text
 * but an item without a value, or with no text of its own.
 */
export function shownTexts(values: readonly (string | null)[]): string[] {
  return values.filter((text): text is string => text !== null && text !== "");
}

/** One property a list's records have, with its value for every item. */
export interface ListProperty {
  readonly name: string;
  /**
   * Each item's value as text, in item order: `null` for an item without a
   * value, which the list's snippets pass over.
   */
  readonly values: readonly (string | null)[];
}

/** How a list reads in a note, which its row, its details and its snippets all show. */
export interface ListReading {
  /** Every item reads as text, so the list joins into one meaningful line. An empty list counts, as its item shape is unknown. */
  readonly readsAsText: boolean;
  /**
   * The property one line of the list shows for each item: `undefined` when
   * the items read as text, so a line shows the item itself.
   */
  readonly lineProperty: string | undefined;
  /**
   * Each item's line as text, in item order. An item without a value for the
   * line property is left out, as the loop passes over it; so is an item
   * that reads as no text.
   */
  readonly lines: readonly string[];
  /** Every property the list's records have, in the display tree's order. */
  readonly properties: readonly ListProperty[];
}

/** How `list` reads in a note. */
export function readList(list: readonly unknown[]): ListReading {
  const readsAsText = list.every(itemReadsAsText);
  const records = list.filter(
    (item): item is object =>
      item !== null &&
      typeof item === "object" &&
      !Array.isArray(item) &&
      isPlainObject(item),
  );
  const names = [
    ...new Set(records.flatMap((record) => Object.keys(record))),
  ].sort((a, b) => a.localeCompare(b));
  const lineProperty = readsAsText ? undefined : lineOf(names, records);
  const valuesOf = (name: string) =>
    list.map((item) => {
      const value = ownValue(item, name);
      return hasValue(value) ? valueText(value) : null;
    });
  return {
    readsAsText,
    lineProperty,
    lines: shownTexts(
      lineProperty === undefined ? list.map(valueText) : valuesOf(lineProperty),
    ),
    properties: names.map((name) => ({ name, values: valuesOf(name) })),
  };
}

/**
 * The first property, in `names` order, that some record has a value for
 * and that reads as text for every record that has one; then the first
 * that reads as text for some record; then the first property.
 */
function lineOf(
  names: readonly string[],
  records: readonly object[],
): string | undefined {
  const values = (name: string) =>
    records
      .map((record) => ownValue(record, name))
      .filter((value) => value !== undefined && value !== null && value !== "");
  const text = (value: unknown) =>
    typeof value !== "function" && itemReadsAsText(value);
  return (
    names.find((name) => {
      const present = values(name);
      return present.length > 0 && present.every(text);
    }) ??
    names.find((name) => values(name).some(text)) ??
    names[0]
  );
}

/** An item's own value for `name`; an unread getter counts as no value, as the tree leaves it unread. */
function ownValue(item: unknown, name: string): unknown {
  if (item === null || typeof item !== "object") return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(item, name);
  return descriptor && !descriptor.get ? descriptor.value : undefined;
}
