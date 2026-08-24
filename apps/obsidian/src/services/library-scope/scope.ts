/**
 * Library Scope — which Zotero Libraries ZotLit discovers Items from.
 *
 * The persisted value is either All Libraries or a non-empty set of Selected
 * Libraries. Selected Libraries holds **stable selectors** — the personal
 * selector for My Library, a Zotero `groupID` for a group — never a local
 * `libraryID` and never a Library name, because Zotero reassigns local
 * `libraryID`s and renames groups freely.
 *
 * This module is the pure core: plain data in, plain data out, no service, no
 * database, no i18n. {@link resolveLibraryScope} maps a saved scope onto the
 * Libraries of one database snapshot; {@link sameResolution} answers whether
 * two resolutions are equivalent, which is how the service suppresses
 * redundant change events.
 *
 * ## Validity
 *
 * A valid Selected Libraries value is non-empty, free of duplicates, and in
 * canonical order: My Library first, then groups by ascending `groupID`.
 * {@link libraryScopeSchema} rejects anything else instead of normalizing it,
 * so a broken saved value stays broken (and stays persisted) until the user
 * repairs it. A broken value reaches this module as `null`, which resolves to
 * {@link MY_LIBRARY_SCOPE} with `invalid: true`.
 */
import * as v from "valibot";

import type { Library } from "@zotlit/db";

const groupID = v.pipe(v.number(), v.safeInteger(), v.minValue(1));

/** A stable reference to one Library, independent of its local `libraryID`. */
export const librarySelectorSchema = v.variant("type", [
  v.object({ type: v.literal("personal") }),
  v.object({ type: v.literal("group"), groupID }),
]);

export type LibrarySelector = v.InferOutput<typeof librarySelectorSchema>;

const selectedLibraries = v.pipe(
  v.array(librarySelectorSchema),
  v.minLength(1, "Selected libraries must name at least one library"),
  v.check(
    isCanonicalOrder,
    "Selected libraries must be unique and in canonical order",
  ),
  v.readonly(),
);

export const libraryScopeSchema = v.variant("mode", [
  v.object({ mode: v.literal("all") }),
  v.object({ mode: v.literal("selected"), libraries: selectedLibraries }),
]);

export type LibraryScope = v.InferOutput<typeof libraryScopeSchema>;

/** Fresh installations discover every local Library. */
export const DEFAULT_LIBRARY_SCOPE: LibraryScope = Object.freeze({
  mode: "all",
});

/**
 * Selected Libraries at its minimum — My Library alone. Two roles: the runtime
 * stand-in while a broken saved value waits to be repaired, and where a switch
 * from All Libraries to Selected Libraries starts.
 */
export const MY_LIBRARY_SCOPE: LibraryScope = Object.freeze({
  mode: "selected",
  libraries: Object.freeze([Object.freeze({ type: "personal" as const })]),
});

/** One Library of the active database that the saved scope resolved onto. */
export interface AvailableLibrary {
  selector: LibrarySelector;
  /** Local id of this Library in the active database — never persisted. */
  libraryID: number;
  /** Zotero's group name, or `null` for My Library and unnamed groups. */
  name: string | null;
}

export interface ResolvedLibraryScope {
  mode: LibraryScope["mode"];
  /**
   * The saved value failed validation. `mode`, `available`, and `unavailable`
   * describe {@link MY_LIBRARY_SCOPE}, not what is on disk.
   */
  invalid: boolean;
  /** Libraries in scope that this database holds, in canonical order. */
  available: readonly AvailableLibrary[];
  /** Selected selectors this database has no Library for, in canonical order. */
  unavailable: readonly LibrarySelector[];
}

/**
 * Cache identity of a set of available Libraries — the selectors paired with
 * the local ids an index would be built against. Library names are left out, so
 * a rename refreshes labels without discarding a built index.
 */
export function availableKey(libraries: readonly AvailableLibrary[]): string {
  return libraries
    .map((library) => `${selectorKey(library.selector)}@${library.libraryID}`)
    .join(",");
}

/** Stable identity of a selector, for set membership and equality. */
export function selectorKey(selector: LibrarySelector): string {
  return selector.type === "personal"
    ? "personal"
    : `group:${selector.groupID}`;
}

/** Canonical order: My Library first, then groups by ascending group id. */
export function compareSelectors(
  a: LibrarySelector,
  b: LibrarySelector,
): number {
  if (a.type !== b.type) return a.type === "personal" ? -1 : 1;
  if (a.type === "personal" || b.type === "personal") return 0;
  return a.groupID - b.groupID;
}

/** Strictly ascending canonical order, which also rules out duplicates. */
function isCanonicalOrder(selectors: LibrarySelector[]): boolean {
  return selectors.every(
    (selector, index) =>
      index === 0 || compareSelectors(selectors[index - 1]!, selector) < 0,
  );
}

/** The selector naming `library`, whatever local `libraryID` it currently has. */
export function selectorOf(library: Library): LibrarySelector | null {
  if (library.type === "user") return { type: "personal" };
  return library.groupID === null
    ? null
    : { type: "group", groupID: library.groupID };
}

/**
 * Map a saved scope onto the Libraries of one database snapshot.
 *
 * @param libraries every Library the active database holds.
 * @param scope the validated saved scope, or `null` when the saved value is
 * broken — which resolves {@link MY_LIBRARY_SCOPE} and reports
 * `invalid: true`.
 */
export function resolveLibraryScope(
  libraries: readonly Library[],
  scope: LibraryScope | null,
): ResolvedLibraryScope {
  const invalid = scope === null;
  const effective = scope ?? MY_LIBRARY_SCOPE;

  if (effective.mode === "all") {
    const available = libraries
      .flatMap((library) => {
        const selector = selectorOf(library);
        return selector
          ? [{ selector, libraryID: library.libraryID, name: library.name }]
          : [];
      })
      .sort((a, b) => compareSelectors(a.selector, b.selector));
    return { mode: "all", invalid, available, unavailable: [] };
  }

  const available: AvailableLibrary[] = [];
  const unavailable: LibrarySelector[] = [];
  for (const selector of effective.libraries) {
    const library = libraries.find((candidate) =>
      matchesSelector(candidate, selector),
    );
    if (library) {
      available.push({
        selector,
        libraryID: library.libraryID,
        name: library.name,
      });
    } else {
      unavailable.push(selector);
    }
  }
  return { mode: "selected", invalid, available, unavailable };
}

function matchesSelector(library: Library, selector: LibrarySelector): boolean {
  return selector.type === "personal"
    ? library.type === "user"
    : library.type === "group" && library.groupID === selector.groupID;
}

/**
 * Whether two resolutions mean the same thing to every consumer. Names take
 * part, so a group rename reaches mounted Library labels; local `libraryID`s
 * take part, so a returning group with a new local id rebuilds what it must.
 */
export function sameResolution(
  a: ResolvedLibraryScope | null,
  b: ResolvedLibraryScope | null,
): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.mode === b.mode &&
    a.invalid === b.invalid &&
    sameArray(
      a.available,
      b.available,
      (x, y) =>
        x.libraryID === y.libraryID &&
        x.name === y.name &&
        selectorKey(x.selector) === selectorKey(y.selector),
    ) &&
    sameArray(
      a.unavailable,
      b.unavailable,
      (x, y) => selectorKey(x) === selectorKey(y),
    )
  );
}

function sameArray<T>(
  a: readonly T[],
  b: readonly T[],
  equal: (x: T, y: T) => boolean,
): boolean {
  return a.length === b.length && a.every((item, i) => equal(item, b[i]!));
}
