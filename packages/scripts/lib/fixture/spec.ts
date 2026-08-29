// Deterministic description of the Fixture.

import { USER_LIBRARY_ID } from "@zotlit/db";

/** Names My Library in the printed Library table, beside the group IDs. */
export const PERSONAL_SELECTOR = "my-library";

/** A stable Library selector: My Library, or a Zotero group by its group ID. */
export type LibrarySelector =
  | { readonly type: "personal" }
  | { readonly type: "group"; readonly groupID: number };

/** My Library, which every valid Selected Libraries case starts from. */
export const MY_LIBRARY: LibrarySelector = { type: "personal" };

/** One group Library by its stable Zotero group ID. */
export function group(groupID: number): LibrarySelector {
  return { type: "group", groupID };
}

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
 * Group IDs the Fixture never creates. A saved scope that names one exercises
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

/**
 * What `CURRENT_TIMESTAMP` reads as while a build runs. Zotero's schema
 * defaults ten columns to the clock, and a column the Spec does not stamp
 * falls back to one of them, so the build pins the clock instead of letting
 * the time of the build reach the database.
 */
export const BUILD_TIMESTAMP = "2026-08-19 08:00:00";

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
  /** Fixture Vault filename stem when a prose page needs a stable target. */
  literatureNoteName?: string;
  title: string;
  /** Container title, stored under the type-specific field of {@link itemType}. */
  containerTitle: string;
  /** Publication year, as Zotero stores the raw `date` string. */
  date: string;
  creators: readonly FixtureCreator[];
  tags?: readonly { name: string; type: 0 | 1 }[];
  /** Related Item keys in the same Library, stored reciprocally by the Spec. */
  relatedKeys?: readonly string[];
  /** `YYYY-MM-DD HH:MM:SS` in UTC, the shape Zotero writes. */
  dateModified: string;
  collectionIDs: readonly number[];
}

export interface FixtureCreator {
  firstName: string | null;
  lastName: string;
  creatorType: "author" | "contributor" | "editor";
  /** `1` stores a single-field institutional name in {@link lastName}. */
  fieldMode: 0 | 1;
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
    creators: [
      {
        firstName: "Ada",
        lastName: "Personal",
        creatorType: "author",
        fieldMode: 0,
      },
      {
        firstName: "Erin",
        lastName: "Editor",
        creatorType: "editor",
        fieldMode: 0,
      },
      {
        firstName: null,
        lastName: "ZotLit Research Collective",
        creatorType: "contributor",
        fieldMode: 1,
      },
    ],
    tags: [
      { name: "fixture-core", type: 0 },
      { name: "read-later", type: 1 },
    ],
    relatedKeys: ["EEEE5555"],
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
    creators: [author("Bo", "Duplicate")],
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
    creators: [author("Cai", "Duplicate")],
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
    creators: [author("Dee", "Across")],
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
    creators: [author("Eli", "Unkeyed")],
    relatedKeys: ["AAAAAAAA"],
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
    creators: [author("Fay", "Shared")],
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
    creators: [author("Gil", "Shared")],
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
    creators: [author("Hal", "Across")],
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
    creators: [author("Ivy", "Archive")],
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
    creators: [author("Jo", "Consortium")],
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
    creators: [author("Kim", "Tie")],
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
    creators: [author("Lin", "Tie")],
    dateModified: "2025-03-01 12:00:00",
    collectionIDs: [],
  },
  {
    itemID: 20,
    libraryID: 1,
    key: "SAKIMA22",
    itemType: "bookSection",
    citationKey: "nafulaSakimasSong",
    title: "Sakima’s song",
    containerTitle: "African Storybook",
    date: "2015",
    creators: [author("Ursula", "Nafula")],
    dateModified: "2025-02-21 12:00:00",
    collectionIDs: [1],
  },
  {
    itemID: 28,
    libraryID: 1,
    key: "IANNP5A2",
    itemType: "journalArticle",
    citationKey: "ioannidisWhyMost2005",
    title: "Why Most Published Research Findings Are False",
    containerTitle: "PLoS Medicine",
    date: "2005",
    creators: [author("John P. A.", "Ioannidis")],
    dateModified: "2025-02-13 12:00:00",
    collectionIDs: [1],
  },
  {
    itemID: 40,
    libraryID: 1,
    key: "HENSHR22",
    itemType: "journalArticle",
    citationKey: "Hensher2011",
    literatureNoteName: "Hensher2011",
    title:
      "Interrogation of Responses to Stated Choice Experiments: Is there sense in what respondents tell us?",
    containerTitle: "Journal of Choice Modelling",
    date: "2011",
    creators: [author("David A.", "Hensher")],
    dateModified: "2025-02-11 12:00:00",
    collectionIDs: [1],
  },
  {
    itemID: 41,
    libraryID: 1,
    key: "WALLGR27",
    itemType: "journalArticle",
    citationKey: "wallgren-petterssonDistalMyopathyCaused2007",
    literatureNoteName: "wallgren-petterssonDistalMyopathyCaused2007",
    title:
      "Distal myopathy caused by homozygous missense mutations in the nebulin gene",
    containerTitle: "Brain",
    date: "2007",
    creators: [author("Carina", "Wallgren-Pettersson")],
    dateModified: "2025-02-10 12:00:00",
    collectionIDs: [1],
  },
  {
    itemID: 42,
    libraryID: 1,
    key: "WANGMT22",
    itemType: "journalArticle",
    citationKey: "wangMutationalClinicalSpectrum2020a",
    literatureNoteName: "wangMutationalClinicalSpectrum2020a",
    title:
      "Mutational and clinical spectrum in a cohort of Chinese patients with hereditary nemaline myopathy",
    containerTitle: "Clinical Genetics",
    date: "2020",
    creators: [author("Zheng", "Wang")],
    dateModified: "2025-02-09 12:00:00",
    collectionIDs: [1],
  },
  {
    itemID: 43,
    libraryID: 1,
    key: "WTTTNB26",
    itemType: "journalArticle",
    citationKey: "wittNebulinRegulatesThin2006",
    literatureNoteName: "wittNebulinRegulatesThin2006",
    title:
      "Nebulin regulates thin filament length, contractility, and Z-disk structure in vivo",
    containerTitle: "The EMBO Journal",
    date: "2006",
    creators: [author("Christopher C.", "Witt")],
    dateModified: "2025-02-08 12:00:00",
    collectionIDs: [1],
  },
  {
    itemID: 44,
    libraryID: 1,
    key: "XUNPKEY9",
    itemType: "journalArticle",
    citationKey: null,
    literatureNoteName: "xuNoCitationKeyProperty2019",
    title: "A Literature Note whose Zotero item carries no native citation key",
    containerTitle: "Fixture Journal",
    date: "2019",
    creators: [author("Xiu", "Xu")],
    dateModified: "2025-02-07 12:00:00",
    collectionIDs: [1],
  },
  {
    itemID: 45,
    libraryID: 1,
    key: "YXNCLN22",
    itemType: "journalArticle",
    citationKey: "yinClinicopathologicalFeaturesMutational2021",
    literatureNoteName: "yinClinicopathologicalFeaturesMutational2021",
    title:
      "Clinico-pathological features and mutational spectrum of 16 nemaline myopathy patients from a Chinese neuromuscular center",
    containerTitle: "Neuromuscular Disorders",
    date: "2021",
    creators: [author("Huan", "Yin")],
    dateModified: "2025-02-06 12:00:00",
    collectionIDs: [1],
  },
  {
    itemID: 46,
    libraryID: 1,
    key: "RUGIER24",
    itemType: "journalArticle",
    citationKey: "rougierTenSimpleRules2014",
    literatureNoteName: "rougierTenSimpleRules2014",
    title: "Ten Simple Rules for Better Figures",
    containerTitle: "PLOS Computational Biology",
    date: "2014",
    creators: [
      author("Nicolas P.", "Rougier"),
      author("Michael", "Droettboom"),
      author("Philip E.", "Bourne"),
    ],
    dateModified: "2025-02-05 12:00:00",
    collectionIDs: [1],
  },
];

function author(firstName: string, lastName: string): FixtureCreator {
  return { firstName, lastName, creatorType: "author", fieldMode: 0 };
}

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
  /** Complete HTML derived from Zotero-created Note output. */
  note: string;
  /** Markdown body for a generated Imported Note; `null` for other Notes. */
  importedNoteBody: string | null;
  /** `YYYY-MM-DD HH:MM:SS` in UTC, the shape Zotero writes. */
  dateModified: string;
  trashed?: boolean;
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
    note: '<div class="zotero-note znv1"><div data-schema-version="9"><h1>Reading notes on the personal alpha</h1>\n<p>A child note of an item filed in two collections.</p>\n</div></div>',
    importedNoteBody:
      "# Reading notes on the personal alpha\n\nA child note of an item filed in two collections.\n",
    dateModified: "2025-02-28 12:00:00",
    collectionIDs: [],
  },
  {
    itemID: 14,
    libraryID: 1,
    key: "NNNNBBBB",
    parentItemID: 5,
    title: "Reading notes on the unkeyed personal item",
    note: '<div class="zotero-note znv1"><div data-schema-version="9"><h1>Reading notes on the unkeyed personal item</h1>\n<p>A child note of an item that no collection holds.</p>\n</div></div>',
    importedNoteBody:
      "# Reading notes on the unkeyed personal item\n\nA child note of an item that no collection holds.\n",
    dateModified: "2025-02-27 12:00:00",
    collectionIDs: [],
  },
  {
    itemID: 15,
    libraryID: 1,
    key: "NNNNCCCC",
    parentItemID: null,
    title: "Standalone personal note",
    note: '<div class="zotero-note znv1"><div data-schema-version="9"><h1>Standalone personal note</h1>\n<p>Filed in a collection on its own, with no parent item.</p>\n</div></div>',
    importedNoteBody: null,
    dateModified: "2025-02-26 12:00:00",
    collectionIDs: [4],
  },
  {
    itemID: 16,
    libraryID: 2,
    key: "NNNNAAAA",
    parentItemID: 6,
    title: "Reading notes on the shared alpha",
    note: '<div class="zotero-note znv1"><div data-schema-version="9"><h1>Reading notes on the shared alpha</h1>\n<p>Repeats the bare note key of the My Library child note.</p>\n</div></div>',
    importedNoteBody:
      "# Reading notes on the shared alpha\n\nRepeats the bare note key of the My Library child note.\n",
    dateModified: "2025-02-25 12:00:00",
    collectionIDs: [],
  },
  {
    itemID: 17,
    libraryID: 3,
    key: "NNNNDDDD",
    parentItemID: 9,
    title: "Reading notes on the lab archive alpha",
    note: '<div class="zotero-note znv1"><div data-schema-version="9"><h1>Reading notes on the lab archive alpha</h1>\n<p>A child note in a group Library.</p>\n</div></div>',
    importedNoteBody:
      "# Reading notes on the lab archive alpha\n\nA child note in a group Library.\n",
    dateModified: "2025-02-24 12:00:00",
    collectionIDs: [],
  },
  {
    itemID: 18,
    libraryID: 4,
    key: "NNNNEEEE",
    parentItemID: 10,
    title: "Reading notes on the consortium alpha",
    note: '<div class="zotero-note znv1"><div data-schema-version="9"><h1>Reading notes on the consortium alpha</h1>\n<p>A child note in a read-only group Library.</p>\n</div></div>',
    importedNoteBody:
      "# Reading notes on the consortium alpha\n\nA child note in a read-only group Library.\n",
    dateModified: "2025-02-23 12:00:00",
    collectionIDs: [],
  },
  {
    itemID: 19,
    libraryID: 1,
    key: "TRASHED2",
    parentItemID: null,
    title: "A deliberately trashed Note",
    note: '<div class="zotero-note znv1"><div data-schema-version="9"><h1>A deliberately trashed Note</h1>\n<p>Present in the Fixture database and hidden from ordinary Note queries.</p>\n</div></div>',
    importedNoteBody: null,
    dateModified: "2025-02-22 12:00:00",
    trashed: true,
    collectionIDs: [],
  },
];

export type FixtureAnnotationAsset =
  | "rougier-2014/annotations/4PE492KU.png"
  | "rougier-2014/annotations/FDRFQ7C2.png"
  | "rougier-2014/annotations/TYY6Z6ZF.png";

export type FixtureAsset =
  | FixtureAnnotationAsset
  | "ioannidis-2005/ioannidis-2005.pdf"
  | "rougier-2014/rougier-2014.pdf"
  | "sakimas-song/sakimas-song.html"
  | "sakimas-song/sakimas-song.pdf";

interface FixtureAttachmentBase {
  itemID: number;
  libraryID: number;
  /** Bare Zotero key for the Attachment row. */
  key: string;
  parentItemID: number;
  contentType: "application/pdf" | "text/html";
  title: string;
  /** Committed source to copy; `null` makes a URL row or deliberate miss. */
  sourceAsset: FixtureAsset | null;
  /** `YYYY-MM-DD HH:MM:SS` in UTC, the shape Zotero writes. */
  dateModified: string;
}

export type FixtureAttachment = FixtureAttachmentBase &
  (
    | {
        linkMode: "imported_file";
        path: string;
        url: null;
      }
    | {
        linkMode: "linked_file";
        path: string;
        url: null;
        /** Root that holds the generated file and backs its absolute database path. */
        fileRoot: "linked-files" | "vault";
      }
    | {
        linkMode: "imported_url";
        path: string;
        url: string;
      }
    | {
        linkMode: "linked_url";
        path: null;
        url: string;
        sourceAsset: null;
      }
  );

/**
 * File-backed rows cover every storage and linked-file branch. `LINKURL2`
 * exercises the URL-only branch, while `MISSNG22` resolves to the one path the
 * generator deliberately leaves absent.
 */
export const ATTACHMENTS: readonly FixtureAttachment[] = [
  {
    itemID: 21,
    libraryID: 1,
    key: "PDFSTR22",
    parentItemID: 20,
    linkMode: "imported_file",
    contentType: "application/pdf",
    title: "Sakima's Song PDF",
    path: "sakimas-song.pdf",
    url: null,
    sourceAsset: "sakimas-song/sakimas-song.pdf",
    dateModified: "2025-02-20 12:00:00",
  },
  {
    itemID: 22,
    libraryID: 1,
    key: "HTMLSNAP",
    parentItemID: 20,
    linkMode: "imported_url",
    contentType: "text/html",
    title: "Sakima's Song Snapshot",
    path: "sakimas-song.html",
    url: "https://www.storybookscanada.ca/stories/en/0315/",
    sourceAsset: "sakimas-song/sakimas-song.html",
    dateModified: "2025-02-19 12:00:00",
  },
  {
    itemID: 23,
    libraryID: 1,
    key: "PDFLINKD",
    parentItemID: 20,
    linkMode: "linked_file",
    fileRoot: "linked-files",
    contentType: "application/pdf",
    title: "Sakima's Song Linked PDF",
    path: "sakimas-song.pdf",
    url: null,
    sourceAsset: "sakimas-song/sakimas-song.pdf",
    dateModified: "2025-02-18 12:00:00",
  },
  {
    itemID: 24,
    libraryID: 1,
    key: "LINKURL2",
    parentItemID: 20,
    linkMode: "linked_url",
    contentType: "text/html",
    title: "Sakima's Song Web Page",
    path: null,
    url: "https://www.storybookscanada.ca/stories/en/0315/",
    sourceAsset: null,
    dateModified: "2025-02-17 12:00:00",
  },
  {
    itemID: 25,
    libraryID: 1,
    key: "MISSNG22",
    parentItemID: 20,
    linkMode: "imported_file",
    contentType: "application/pdf",
    title: "Deliberately Missing PDF",
    path: "deliberately-missing.pdf",
    url: null,
    sourceAsset: null,
    dateModified: "2025-02-16 12:00:00",
  },
  {
    itemID: 29,
    libraryID: 1,
    key: "IANPDF25",
    parentItemID: 28,
    linkMode: "imported_file",
    contentType: "application/pdf",
    title: "Ioannidis 2005 PDF",
    path: "ioannidis-2005.pdf",
    url: null,
    sourceAsset: "ioannidis-2005/ioannidis-2005.pdf",
    dateModified: "2025-02-12 12:00:00",
  },
  {
    itemID: 47,
    libraryID: 1,
    key: "RGRPDF24",
    parentItemID: 46,
    linkMode: "linked_file",
    fileRoot: "vault",
    contentType: "application/pdf",
    title: "Rougier et al. 2014 PDF",
    path: "attachments/rougier-2014.pdf",
    url: null,
    sourceAsset: "rougier-2014/rougier-2014.pdf",
    dateModified: "2025-02-04 12:00:00",
  },
];

interface FixtureAnnotationBase {
  itemID: number;
  libraryID: number;
  /** Bare Zotero key for the Annotation row. */
  key: string;
  parentItemID: number;
  text: string | null;
  comment: string | null;
  color: string;
  pageLabel: string;
  sortIndex: string;
  /** `YYYY-MM-DD HH:MM:SS` in UTC, the shape Zotero writes. */
  dateAdded: string;
  /** `YYYY-MM-DD HH:MM:SS` in UTC, the shape Zotero writes. */
  dateModified: string;
}

type FixturePdfRect = readonly [number, number, number, number];
type FixturePdfRectsPosition = {
  pageIndex: number;
  rects: readonly FixturePdfRect[];
};
type FixturePdfTextPosition = FixturePdfRectsPosition & {
  fontSize: number;
  rotation: number;
};
type FixturePdfInkPosition = {
  pageIndex: number;
  width: number;
  paths: readonly (readonly number[])[];
};

export type FixtureAnnotation = FixtureAnnotationBase &
  (
    | {
        type: 1 | 2 | 5;
        position: FixturePdfRectsPosition;
        cacheImageAsset: null;
      }
    | {
        type: 3;
        position: FixturePdfRectsPosition;
        /** Generated Zotero annotation-cache PNG. */
        cacheImageAsset: FixtureAnnotationAsset;
      }
    | {
        type: 4;
        position: FixturePdfInkPosition;
        /** Generated Zotero annotation-cache PNG. */
        cacheImageAsset: FixtureAnnotationAsset;
      }
    | {
        type: 6;
        position: FixturePdfTextPosition;
        cacheImageAsset: null;
      }
  );

/** Real anchors captured from pages in the committed PDFs. */
export const ANNOTATIONS: readonly FixtureAnnotation[] = [
  {
    itemID: 26,
    libraryID: 1,
    key: "HIGHLGHT",
    parentItemID: 21,
    type: 1,
    text: "Sakima lived with his parents and his four year old sister.",
    comment: null,
    color: "#ffd400",
    pageLabel: "2",
    sortIndex: "00001|000000|00389",
    position: {
      pageIndex: 1,
      rects: [
        [389, 531, 710, 553],
        [389, 505, 688, 527],
      ],
    },
    cacheImageAsset: null,
    dateAdded: "2025-02-15 12:00:00",
    dateModified: "2025-02-15 12:00:00",
  },
  {
    itemID: 27,
    libraryID: 1,
    key: "NTMARK22",
    parentItemID: 21,
    type: 2,
    text: null,
    comment: "The opening establishes Sakima’s family and home.",
    color: "#ffd400",
    pageLabel: "2",
    sortIndex: "00001|000001|00730",
    position: { pageIndex: 1, rects: [[730, 537, 748, 555]] },
    cacheImageAsset: null,
    dateAdded: "2025-02-14 12:00:00",
    dateModified: "2025-02-14 12:00:00",
  },
  {
    itemID: 48,
    libraryID: 1,
    key: "PUPR5FG5",
    parentItemID: 47,
    type: 1,
    text: "Identify Your Message",
    comment: null,
    color: "#2ea8e5",
    pageLabel: "1",
    sortIndex: "00000|002041|00170",
    position: {
      pageIndex: 0,
      rects: [[265.833, 611.202, 374.503, 620.019]],
    },
    cacheImageAsset: null,
    dateAdded: "2026-08-23 16:17:50",
    dateModified: "2026-08-23 16:17:50",
  },
  {
    itemID: 49,
    libraryID: 1,
    key: "FDRFQ7C2",
    parentItemID: 47,
    type: 3,
    text: null,
    comment: null,
    color: "#ffd400",
    pageLabel: "2",
    sortIndex: "00001|001860|00047",
    position: {
      pageIndex: 1,
      rects: [[48.75, 395.509, 570, 743.723]],
    },
    cacheImageAsset: "rougier-2014/annotations/FDRFQ7C2.png",
    dateAdded: "2026-08-23 16:18:01",
    dateModified: "2026-08-23 16:18:01",
  },
  {
    itemID: 50,
    libraryID: 1,
    key: "K3JRFLFQ",
    parentItemID: 47,
    type: 5,
    text: "Scientific visualization is classically defined as the process of graphically displaying scientific data.",
    comment: null,
    color: "#ff6666",
    pageLabel: "1",
    sortIndex: "00000|000434|00180",
    position: {
      pageIndex: 0,
      rects: [
        [67.011, 612.638, 211.485, 620.77],
        [58.054, 601.98, 211.489, 610.112],
        [58.054, 591.321, 153.781, 599.454],
      ],
    },
    cacheImageAsset: null,
    dateAdded: "2026-08-23 16:18:11",
    dateModified: "2026-08-23 16:18:11",
  },
  {
    itemID: 51,
    libraryID: 1,
    key: "HRK7BG32",
    parentItemID: 47,
    type: 6,
    text: null,
    comment: "Making figures is hard :(",
    color: "#a28ae5",
    pageLabel: "1",
    sortIndex: "00000|000191|00088",
    position: {
      pageIndex: 0,
      fontSize: 14,
      rotation: 0,
      rects: [[398.804, 685.107, 560.804, 702.107]],
    },
    cacheImageAsset: null,
    dateAdded: "2026-08-23 16:18:18",
    dateModified: "2026-08-23 16:19:07",
  },
  {
    itemID: 52,
    libraryID: 1,
    key: "C94NJNYG",
    parentItemID: 47,
    type: 2,
    text: null,
    comment: "some text comment",
    color: "#ffd400",
    pageLabel: "1",
    sortIndex: "00000|003354|00170",
    position: {
      pageIndex: 0,
      rects: [[566.901, 598.393, 588.901, 620.393]],
    },
    cacheImageAsset: null,
    dateAdded: "2026-08-23 16:19:19",
    dateModified: "2026-08-23 16:19:30",
  },
  {
    itemID: 55,
    libraryID: 1,
    key: "TYY6Z6ZF",
    parentItemID: 47,
    type: 4,
    text: null,
    comment: null,
    color: "#5fb236",
    pageLabel: "1",
    sortIndex: "00000|000040|00100",
    position: {
      pageIndex: 0,
      width: 2,
      paths: [
        [
          66.964, 674.348, 66.629, 673.26, 66.629, 672.214, 66.964, 671.209,
          67.299, 670.205, 67.906, 669.389, 68.617, 668.614, 69.099, 667.61,
          69.308, 666.564, 69.915, 665.664, 70.333, 664.701, 71.003, 663.948,
          72.028, 664.011, 72.531, 664.931, 73.284, 665.936, 74.289, 666.94,
          75.126, 667.798, 75.963, 668.74, 76.821, 669.765, 77.762, 670.874,
          78.767, 672.004, 79.771, 672.967, 80.755, 673.825, 81.655, 674.767,
          82.513, 675.771, 83.454, 676.776, 84.438, 677.78, 85.338, 678.785,
          86.175, 679.768, 87.012, 680.668, 87.807, 681.484, 88.686, 682.551,
          89.314, 683.43, 90.109, 684.309, 90.862, 684.979, 91.49, 685.816,
          92.201, 686.653, 92.85, 687.511, 93.541, 688.327, 94.21, 689.206,
          94.964, 689.959,
        ],
      ],
    },
    cacheImageAsset: "rougier-2014/annotations/TYY6Z6ZF.png",
    dateAdded: "2026-08-23 16:20:09",
    dateModified: "2026-08-23 16:20:21",
  },
  {
    itemID: 56,
    libraryID: 1,
    key: "4PE492KU",
    parentItemID: 47,
    type: 4,
    text: null,
    comment: null,
    color: "#f19837",
    pageLabel: "1",
    sortIndex: "00000|000067|00104",
    position: {
      pageIndex: 0,
      width: 2,
      paths: [
        [
          203.571, 673.009, 204.45, 672.256, 205.266, 671.628, 205.915, 670.791,
          206.124, 669.786, 206.71, 668.865, 207.464, 668.112, 208.28, 667.296,
          208.803, 666.438, 209.598, 665.768, 210.247, 664.994, 210.917,
          664.241, 211.691, 665.057, 212.57, 665.936, 213.574, 666.689, 214.432,
          667.233, 215.374, 667.945, 216.42, 668.782, 217.634, 669.619, 218.973,
          670.519, 220.313, 671.67, 221.694, 672.988, 223.242, 674.223, 224.079,
          674.809, 225.565, 675.918, 226.8, 676.943, 227.846, 677.822, 228.725,
          678.533, 229.625, 679.266, 230.608, 680.082, 231.613, 680.919,
          232.617, 681.756, 233.559, 682.593, 234.417, 683.43, 235.191, 684.079,
          236.175, 684.644, 236.97, 685.314, 237.744, 686.088, 238.518, 686.737,
        ],
      ],
    },
    cacheImageAsset: "rougier-2014/annotations/4PE492KU.png",
    dateAdded: "2026-08-23 16:20:12",
    dateModified: "2026-08-23 16:20:18",
  },
];

/** One CSL style a user installed in Zotero, as the Fixture carries it. */
export interface FixtureStyle {
  /** File under `assets/styles/`, and the name Zotero installs it under. */
  file: string;
  /** `<info><id>` — the identity the Citation and References Style setting stores. */
  id: string;
  /** `<info><title>` — the label the Citation and References Style picker lists. */
  title: string;
}

/**
 * The styles a user installed on top of Zotero's bundled set, which every build
 * lays down beside it. The one here is a numeric style carrying its own
 * `zh-CN` default locale, so the picker offers a selection the bundled styles
 * have no equivalent of, and a Citation Locale case that reads in one glance.
 *
 * Each file travels under its own CC BY-SA 3.0 licence, as its `<rights>`
 * element states.
 */
export const INSTALLED_STYLES: readonly FixtureStyle[] = [
  {
    file: "chinese-gb7714-1987-numeric.csl",
    id: "http://www.zotero.org/styles/chinese-gb7714-1987-numeric",
    title: "China National Standard GB/T 7714-1987 (numeric, 中文)",
  },
];

/**
 * The Fixture's second Literature Note Profile. Together with the built-in
 * default Profile and its built-in document, it provides two document-backed
 * layouts and two target folders for real-vault checks.
 */
export const LITERATURE_NOTE_PROFILES = [
  {
    id: "V1StGXR8Z5jd",
    label: "Books",
    document: "books.md",
    bindings: {
      "note.literature-folder": "books",
      "citation.references-style": INSTALLED_STYLES[0]!.id,
    },
  },
] as const;

/** Literature Note Template documents placed in the Fixture template folder. */
export const LITERATURE_NOTE_DOCUMENTS = [
  {
    filename: "books.md",
    source: `---
id: zotlit-fixture-books
name: Fixture books
version: 1.0.0
author: ZotLit
description: A visibly distinct book layout for the End-to-end Run
contract: 2
filename: 'books-{{ zt.citationKey | default: zt.key }}{% suffix %}'
frontmatter:
  - key: fixture-title
    expr: zt.title
    merge: replace
  - key: fixture-kind
    value:
      $if: 'zt.itemType == "journalArticle"'
      then: reference/article
      else: reference/other
    merge: replace
  - key: fixture-obsolete
    value:
      $if: 'zt.itemType == "bookSection"'
      then: retained
    merge: replace
---
# Book profile: {{ zt.title }}

{% managed %}
## Book details

Citation key: {{ zt.citationKey }}
{% endmanaged %}

{% annotation %}
{% bq %}
[!quote] Fixture page {{ zt.pageLabel }}

{{ zt.text }}
{% endbq %}
{% endannotation %}
`,
  },
] as const;

const STRESS_ITEM_KEY_ALPHABET = "23456789ABCDEFGHIJKLMNPQRSTUVWXYZ";
const STRESS_BUILD_SEED = 0x5eed_0000;

/** Synthetic Item count used by `pnpm fixture stress`. */
export const DEFAULT_STRESS_ITEM_COUNT = 25_000;
export const STRESS_ITEM_COUNT_CONSTRAINT = "a non-negative safe integer";

function stressItemKey(index: number): string {
  let value = index;
  let suffix = "";
  for (let place = 0; place < 7; place++) {
    suffix =
      STRESS_ITEM_KEY_ALPHABET[value % STRESS_ITEM_KEY_ALPHABET.length]! +
      suffix;
    value = Math.floor(value / STRESS_ITEM_KEY_ALPHABET.length);
  }
  return `S${suffix}`;
}

/** Additive synthetic corpus for an on-demand Stress Build. */
export function createStressItems(count: number): readonly FixtureItem[] {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error(
      `stress item count must be ${STRESS_ITEM_COUNT_CONSTRAINT}, got ${count}`,
    );
  }

  const firstItemID =
    Math.max(
      ...ITEMS.map(({ itemID }) => itemID),
      ...NOTES.map(({ itemID }) => itemID),
      ...ATTACHMENTS.map(({ itemID }) => itemID),
      ...ANNOTATIONS.map(({ itemID }) => itemID),
    ) + 1;

  return Array.from({ length: count }, (_, index) => {
    const seededIndex = STRESS_BUILD_SEED + index;
    const ordinal = index + 1;
    const library = LIBRARIES[seededIndex % LIBRARIES.length]!;
    const collection = COLLECTIONS.find(
      ({ libraryID }) => libraryID === library.libraryID,
    );
    return {
      itemID: firstItemID + index,
      libraryID: library.libraryID,
      key: stressItemKey(seededIndex),
      itemType: "journalArticle",
      citationKey: `stress${String(ordinal).padStart(7, "0")}`,
      title: `Synthetic stress item ${ordinal}`,
      containerTitle: "Stress Build Journal",
      date: String(2000 + (seededIndex % 25)),
      creators: [author("Stress", `Author ${ordinal}`)],
      tags: [
        { name: "stress-build", type: 0 },
        { name: `stress-bucket-${seededIndex % 16}`, type: 1 },
      ],
      dateModified: "2025-01-01 00:00:00",
      collectionIDs: collection ? [collection.collectionID] : [],
    };
  });
}

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
 * Settings key the scope is written under. This constant and
 * {@link PersistedLibraryScope} are the single seam to update when the Library
 * Scope setting changes shape.
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
    summary: "All Libraries — every Fixture Library joins discovery.",
    scope: { mode: "all" },
  },
  {
    id: "available",
    summary: "Selected Libraries, every selector available.",
    scope: {
      mode: "selected",
      libraries: [MY_LIBRARY, group(118), group(990117), group(4200309)],
    },
  },
  {
    id: "partial",
    summary: "Selected Libraries, one selector unavailable.",
    scope: {
      mode: "selected",
      libraries: [MY_LIBRARY, group(118), group(606001)],
    },
  },
  {
    id: "unavailable",
    summary: "Selected Libraries, no selector available.",
    scope: {
      mode: "selected",
      libraries: [group(606001), group(606002)],
    },
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

/**
 * Persisted shape of one Managed Frontmatter field, as ZotLit v2.1 saved it
 * under `note.frontmatter-fields`.
 */
export interface FixtureFrontmatterField {
  readonly key: string;
  readonly expr: string;
  readonly merge: "replace";
  readonly language: "liquid";
}

/** One legacy Literature Note Template slot file the Upgrader vault ejects. */
export interface FixtureLegacyTemplate {
  /** Slot name; the file is `zotlit-<name>.liquid.md` in the template folder. */
  readonly name: "filename" | "note" | "content" | "annotation";
  /** Text present in the shipped default source; the build fails otherwise. */
  readonly find: string;
  /** Visible edit that stands in for a user's customization. */
  readonly replace: string;
}

export interface FixtureVaultCase {
  id: "configured" | "fresh" | "upgrader";
  /** One line for the maintainer choosing a case. */
  summary: string;
}

/**
 * A Vault Case is a named, saved Fixture Vault state. The Scope Case selects
 * the saved Library Scope; the Vault Case selects everything else the vault
 * holds: settings file, notes, Profiles, and template files.
 */
export const VAULT_CASES: readonly FixtureVaultCase[] = [
  {
    id: "configured",
    summary:
      "Current settings, the Books Profile, Literature Notes, and Imported Notes. This is the default.",
  },
  {
    id: "fresh",
    summary:
      "Vault with no notes, ZotLit installed, and no settings file: the new-user path.",
  },
  {
    id: "upgrader",
    summary:
      "A ZotLit v2.1 vault: version-9 settings, ejected legacy slot files with visible edits, an edited Managed Frontmatter list.",
  },
];

export const DEFAULT_VAULT_CASE = "configured";

export function findVaultCase(id: string): FixtureVaultCase {
  const found = VAULT_CASES.find((vaultCase) => vaultCase.id === id);
  if (!found) {
    throw new Error(
      `unknown vault case "${id}". Known: ${VAULT_CASES.map((c) => c.id).join(", ")}`,
    );
  }
  return found;
}

/** Settings version ZotLit v2.1.0 wrote, before Profiles absorbed the note bindings. */
export const UPGRADER_SETTINGS_VERSION = 9;

/** Plugin version the Upgrader vault records as its last launch. */
export const UPGRADER_PLUGIN_VERSION = "2.1.0";

/**
 * The v2.1 `note.frontmatter-fields` list: the four shipped defaults, plus one
 * visible addition so the list reads as user-edited.
 */
export const UPGRADER_FRONTMATTER_FIELDS: readonly FixtureFrontmatterField[] = [
  { key: "title", expr: "zt.title", merge: "replace", language: "liquid" },
  {
    key: "related",
    expr: "zt.relatedItems | note_links",
    merge: "replace",
    language: "liquid",
  },
  {
    key: "collections",
    expr: "zt.collections | collection_paths",
    merge: "replace",
    language: "liquid",
  },
  {
    key: "citekey",
    expr: "zt.citationKey",
    merge: "replace",
    language: "liquid",
  },
  { key: "year", expr: "zt.date.year", merge: "replace", language: "liquid" },
];

/**
 * Legacy slot files the Upgrader vault ejects into its template folder. Each
 * starts from the shipped Liquid default and carries one visible edit, so a
 * converted document is recognizably the user's own and the trashed files are
 * easy to tell from the defaults.
 */
export const UPGRADER_LEGACY_TEMPLATES: readonly FixtureLegacyTemplate[] = [
  {
    name: "filename",
    find: "{{ zt.citationKey",
    replace: "lit-{{ zt.citationKey",
  },
  {
    name: "note",
    find: "# {{ zt.title }}",
    replace: "# {{ zt.title }} (v2.1 template)",
  },
  { name: "content", find: "## Notes", replace: "## Zotero notes" },
  {
    name: "annotation",
    find: "[!note] Page",
    replace: "[!quote] Page",
  },
];
