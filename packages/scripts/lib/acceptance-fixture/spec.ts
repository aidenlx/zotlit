// Deterministic description of the disposable multi-Library acceptance fixture.

import { USER_LIBRARY_ID } from "@zotlit/db";

/** Stable selector for My Library, alongside the numeric group selectors. */
export const PERSONAL_SELECTOR = "my-library";

/** A stable Library selector: My Library, or a Zotero group by its group ID. */
export type LibrarySelector = typeof PERSONAL_SELECTOR | number;

export interface FixtureLibrary {
  libraryID: number;
  type: "user" | "group";
  /** `null` for My Library; the stable Zotero group ID for a group Library. */
  groupID: number | null;
  /** `null` for My Library, which Zotero names in the UI rather than the database. */
  name: string | null;
  /** `0` marks read-only group membership. */
  editable: 0 | 1;
}

/**
 * Local `libraryID` order deliberately disagrees with group ID order, so a
 * canonical-order check proves that stable selector order does not follow
 * database row order.
 */
export const LIBRARIES: readonly FixtureLibrary[] = [
  {
    libraryID: USER_LIBRARY_ID,
    type: "user",
    groupID: null,
    name: null,
    editable: 1,
  },
  {
    libraryID: 2,
    type: "group",
    groupID: 4200309,
    name: "Shared Reading",
    editable: 1,
  },
  {
    libraryID: 3,
    type: "group",
    groupID: 118,
    name: "Lab Archive",
    editable: 1,
  },
  {
    libraryID: 4,
    type: "group",
    groupID: 990117,
    name: "Consortium Reading Room",
    editable: 0,
  },
];

/**
 * Group IDs the fixture never creates. A saved scope that names one exercises
 * the unavailable-selector paths without any database edit.
 */
export const UNAVAILABLE_GROUP_IDS: readonly number[] = [606001, 606002];

export interface FixtureCollection {
  collectionID: number;
  libraryID: number;
  /**
   * Bare Zotero collection key — unique per Library, not globally, and in
   * Zotero's object-key format, so `isItemKey` accepts it.
   */
  key: string;
  name: string;
}

/** `SHAREDCL` repeats in three Libraries, so a collection target must name one. */
export const COLLECTIONS: readonly FixtureCollection[] = [
  { collectionID: 1, libraryID: 1, key: "SHAREDCL", name: "Shared key" },
  { collectionID: 2, libraryID: 2, key: "SHAREDCL", name: "Shared key" },
  { collectionID: 3, libraryID: 3, key: "SHAREDCL", name: "Shared key" },
  { collectionID: 4, libraryID: 1, key: "PERSNAL2", name: "Personal only" },
];

export interface FixtureItem {
  itemID: number;
  libraryID: number;
  /**
   * Bare Zotero item key — unique per Library, not globally, and in Zotero's
   * object-key format, so `isItemKey` accepts it.
   */
  key: string;
  itemType: "journalArticle" | "bookSection";
  /** `null` leaves the item without a native Zotero Citation Key. */
  citationKey: string | null;
  title: string;
  /** Container title, stored under the type-specific field of {@link itemType}. */
  containerTitle: string;
  /** Publication year, as Zotero stores the raw `date` string. */
  date: string;
  creator: { firstName: string; lastName: string };
  /** `YYYY-MM-DD HH:MM:SS` in UTC, the shape Zotero writes. */
  dateModified: string;
  collectionIDs: readonly number[];
}

/**
 * The item set every discovery, Citation Key, and batch tracer reads.
 *
 * Modification times descend with item id apart from two deliberate ties:
 * items 7 and 9 tie across Libraries (canonical Library order decides), and
 * items 11 and 12 tie inside My Library (ascending item id decides).
 */
export const ITEMS: readonly FixtureItem[] = [
  {
    itemID: 1,
    libraryID: 1,
    key: "AAAAAAAA",
    itemType: "journalArticle",
    citationKey: "personalAlpha2024",
    title: "Alpha of the personal library",
    containerTitle: "Journal of Personal Records",
    date: "2024",
    creator: { firstName: "Ada", lastName: "Personal" },
    dateModified: "2025-03-10 12:00:00",
    collectionIDs: [1, 4],
  },
  {
    itemID: 2,
    libraryID: 1,
    key: "BBBB2222",
    itemType: "journalArticle",
    citationKey: "duplicateWithin2020",
    title: "Within-library duplicate, first item",
    containerTitle: "Journal of Personal Records",
    date: "2020",
    creator: { firstName: "Bo", lastName: "Duplicate" },
    dateModified: "2025-03-09 12:00:00",
    collectionIDs: [1],
  },
  {
    itemID: 3,
    libraryID: 1,
    key: "CCCC3333",
    itemType: "journalArticle",
    citationKey: "duplicateWithin2020",
    title: "Within-library duplicate, second item",
    containerTitle: "Journal of Personal Records",
    date: "2020",
    creator: { firstName: "Cai", lastName: "Duplicate" },
    dateModified: "2025-03-08 12:00:00",
    collectionIDs: [],
  },
  {
    itemID: 4,
    libraryID: 1,
    key: "DDDD4444",
    itemType: "journalArticle",
    citationKey: "duplicateAcross2019",
    title: "Cross-library duplicate, personal side",
    containerTitle: "Journal of Personal Records",
    date: "2019",
    creator: { firstName: "Dee", lastName: "Across" },
    dateModified: "2025-03-07 12:00:00",
    collectionIDs: [4],
  },
  {
    itemID: 5,
    libraryID: 1,
    key: "EEEE5555",
    itemType: "bookSection",
    citationKey: null,
    title: "Personal item without a citation key",
    containerTitle: "Collected Personal Essays",
    date: "2018",
    creator: { firstName: "Eli", lastName: "Unkeyed" },
    dateModified: "2025-03-06 12:00:00",
    collectionIDs: [],
  },
  {
    itemID: 6,
    libraryID: 2,
    key: "AAAAAAAA",
    itemType: "journalArticle",
    citationKey: "sharedReadingAlpha2023",
    title: "Alpha of the shared reading group",
    containerTitle: "Journal of Shared Reading",
    date: "2023",
    creator: { firstName: "Fay", lastName: "Shared" },
    dateModified: "2025-03-05 12:00:00",
    collectionIDs: [2],
  },
  {
    itemID: 7,
    libraryID: 2,
    key: "FFFF6666",
    itemType: "journalArticle",
    citationKey: "sharedReadingBeta2022",
    title: "Beta of the shared reading group",
    containerTitle: "Journal of Shared Reading",
    date: "2022",
    creator: { firstName: "Gil", lastName: "Shared" },
    dateModified: "2025-03-04 12:00:00",
    collectionIDs: [2],
  },
  {
    itemID: 8,
    libraryID: 3,
    key: "GGGG7777",
    itemType: "journalArticle",
    citationKey: "duplicateAcross2019",
    title: "Cross-library duplicate, lab side",
    containerTitle: "Lab Archive Proceedings",
    date: "2019",
    creator: { firstName: "Hal", lastName: "Across" },
    dateModified: "2025-03-03 12:00:00",
    collectionIDs: [3],
  },
  {
    itemID: 9,
    libraryID: 3,
    key: "HHHH8888",
    itemType: "journalArticle",
    citationKey: "labArchiveAlpha2021",
    title: "Alpha of the lab archive",
    containerTitle: "Lab Archive Proceedings",
    date: "2021",
    creator: { firstName: "Ivy", lastName: "Archive" },
    dateModified: "2025-03-04 12:00:00",
    collectionIDs: [3],
  },
  {
    itemID: 10,
    libraryID: 4,
    key: "IIII9999",
    itemType: "journalArticle",
    citationKey: "consortiumAlpha2020",
    title: "Alpha of the read-only consortium",
    containerTitle: "Consortium Reading Room Notes",
    date: "2020",
    creator: { firstName: "Jo", lastName: "Consortium" },
    dateModified: "2025-03-02 12:00:00",
    collectionIDs: [],
  },
  {
    itemID: 11,
    libraryID: 1,
    key: "JJJJJJJJ",
    itemType: "journalArticle",
    citationKey: "personalTieFirst2017",
    title: "Personal tie, lower item id",
    containerTitle: "Journal of Personal Records",
    date: "2017",
    creator: { firstName: "Kim", lastName: "Tie" },
    dateModified: "2025-03-01 12:00:00",
    collectionIDs: [],
  },
  {
    itemID: 12,
    libraryID: 1,
    key: "KKKKKKKK",
    itemType: "journalArticle",
    citationKey: "personalTieSecond2017",
    title: "Personal tie, higher item id",
    containerTitle: "Journal of Personal Records",
    date: "2017",
    creator: { firstName: "Lin", lastName: "Tie" },
    dateModified: "2025-03-01 12:00:00",
    collectionIDs: [],
  },
];

export interface FixtureNote {
  itemID: number;
  libraryID: number;
  /**
   * Bare Zotero item key — unique per Library, not globally, and in Zotero's
   * object-key format, so `isItemKey` accepts it.
   */
  key: string;
  /** `null` for a standalone note; otherwise the parent item it hangs off. */
  parentItemID: number | null;
  title: string;
  /** Note body, in the HTML shape Zotero stores. */
  note: string;
  /** `YYYY-MM-DD HH:MM:SS` in UTC, the shape Zotero writes. */
  dateModified: string;
  /**
   * Collections the note is filed in. A child note carries none: Zotero files
   * it with its parent item rather than in a collection of its own.
   */
  collectionIDs: readonly number[];
}

/**
 * The note set every note-import tracer reads. Every Library holds at least one
 * note, so a scoped import finds work wherever the scope reaches, and `NNNNAAAA`
 * repeats in My Library and Shared Reading, so an exact note target has to name
 * its Library.
 */
export const NOTES: readonly FixtureNote[] = [
  {
    itemID: 13,
    libraryID: 1,
    key: "NNNNAAAA",
    parentItemID: 1,
    title: "Reading notes on the personal alpha",
    note: '<div data-schema-version="9"><h1>Reading notes on the personal alpha</h1><p>A child note of an item filed in two collections.</p></div>',
    dateModified: "2025-02-28 12:00:00",
    collectionIDs: [],
  },
  {
    itemID: 14,
    libraryID: 1,
    key: "NNNNBBBB",
    parentItemID: 5,
    title: "Reading notes on the unkeyed personal item",
    note: '<div data-schema-version="9"><h1>Reading notes on the unkeyed personal item</h1><p>A child note of an item that no collection holds.</p></div>',
    dateModified: "2025-02-27 12:00:00",
    collectionIDs: [],
  },
  {
    itemID: 15,
    libraryID: 1,
    key: "NNNNCCCC",
    parentItemID: null,
    title: "Standalone personal note",
    note: '<div data-schema-version="9"><h1>Standalone personal note</h1><p>Filed in a collection on its own, with no parent item.</p></div>',
    dateModified: "2025-02-26 12:00:00",
    collectionIDs: [4],
  },
  {
    itemID: 16,
    libraryID: 2,
    key: "NNNNAAAA",
    parentItemID: 6,
    title: "Reading notes on the shared alpha",
    note: '<div data-schema-version="9"><h1>Reading notes on the shared alpha</h1><p>Repeats the bare note key of the My Library child note.</p></div>',
    dateModified: "2025-02-25 12:00:00",
    collectionIDs: [],
  },
  {
    itemID: 17,
    libraryID: 3,
    key: "NNNNDDDD",
    parentItemID: 9,
    title: "Reading notes on the lab archive alpha",
    note: '<div data-schema-version="9"><h1>Reading notes on the lab archive alpha</h1><p>A child note in a group Library.</p></div>',
    dateModified: "2025-02-24 12:00:00",
    collectionIDs: [],
  },
  {
    itemID: 18,
    libraryID: 4,
    key: "NNNNEEEE",
    parentItemID: 10,
    title: "Reading notes on the consortium alpha",
    note: '<div data-schema-version="9"><h1>Reading notes on the consortium alpha</h1><p>A child note in a read-only group Library.</p></div>',
    dateModified: "2025-02-23 12:00:00",
    collectionIDs: [],
  },
];

/**
 * Persisted Library Scope, in the shape the specification fixes: All Libraries,
 * or a non-empty set of stable selectors in canonical order (My Library first,
 * then groups by ascending group ID).
 */
export type PersistedLibraryScope =
  | { readonly mode: "all" }
  | {
      readonly mode: "selected";
      readonly libraries: readonly LibrarySelector[];
    };

/**
 * Settings key the scope is written under. The Library Scope setting itself
 * lands in a later ticket; this constant and {@link PersistedLibraryScope} are
 * the single seam to update when it does.
 */
export const LIBRARY_SCOPE_SETTING_KEY = "zotero.library-scope";

export interface FixtureScopeCase {
  id: string;
  /** One line for the maintainer choosing a case. */
  summary: string;
  scope: PersistedLibraryScope;
}

export const SCOPE_CASES: readonly FixtureScopeCase[] = [
  {
    id: "all",
    summary: "All Libraries — every fixture Library joins discovery.",
    scope: { mode: "all" },
  },
  {
    id: "available",
    summary: "Selected Libraries, every selector available.",
    scope: {
      mode: "selected",
      libraries: [PERSONAL_SELECTOR, 118, 990117, 4200309],
    },
  },
  {
    id: "partial",
    summary: "Selected Libraries, one selector unavailable.",
    scope: {
      mode: "selected",
      libraries: [PERSONAL_SELECTOR, 118, 606001],
    },
  },
  {
    id: "unavailable",
    summary: "Selected Libraries, no selector available.",
    scope: { mode: "selected", libraries: [606001, 606002] },
  },
];

export const DEFAULT_SCOPE_CASE = "all";

export function findScopeCase(id: string): FixtureScopeCase {
  const found = SCOPE_CASES.find((scopeCase) => scopeCase.id === id);
  if (!found) {
    throw new Error(
      `unknown scope case "${id}". Known: ${SCOPE_CASES.map((c) => c.id).join(", ")}`,
    );
  }
  return found;
}
