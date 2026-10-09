// The Item Query scenario: a small, deterministic set of Items for the
// adversarial cases of the Item Query spec. Each row says which behavior it
// supports.
// Rows reference Zotero's own lookup tables by name, so the pristine database
// decides every item type, field, and creator type ID.
import type { DatabaseSync } from "node:sqlite";

import { formatIndexedKey } from "@/lib/zt-key";

/** The two Libraries of the scenario. `libraryID` is local to the copy. */
export const SCENARIO_LIBRARIES = {
  personal: { libraryID: 1, groupID: null, name: null },
  group: { libraryID: 2, groupID: 4815, name: "Methods Reading Group" },
} as const;

export type ScenarioLibraryName = keyof typeof SCENARIO_LIBRARIES;

type Stamp = string;

interface ScenarioCreator {
  firstName?: string;
  lastName: string;
  /** `1`: one-field (institutional) name in `lastName`. */
  fieldMode?: 0 | 1;
  creatorType: "author" | "editor";
}

interface ScenarioTag {
  name: string;
  /** `0` manual, `1` automatic. */
  type: 0 | 1;
}

interface ScenarioItemSpec {
  library: ScenarioLibraryName;
  key: string;
  itemType: string;
  dateAdded: Stamp;
  dateModified: Stamp;
  /** Built-in fields by their stored name. An integer is stored as an SQLite INTEGER. */
  fields?: Record<string, string | number>;
  /** Custom fields (`fieldsCombined.custom = 1`) by exact source name. */
  custom?: Partial<Record<ScenarioCustomField, string>>;
  creators?: readonly ScenarioCreator[];
  tags?: readonly ScenarioTag[];
  /** Names of {@link COLLECTIONS} entries. */
  collections?: readonly string[];
  trashed?: boolean;
  /** Name of an earlier {@link ITEMS} entry. */
  parent?: string;
  attachment?: { linkMode: number; contentType: string; path: string };
  annotation?: {
    type: number;
    text: string;
    color: string;
    comment?: string;
    pageLabel?: string;
    sortIndex?: string;
    position?: string;
  };
  note?: { note: string; title: string };
}

/** Exact source names of the custom fields the scenario defines. */
const SCENARIO_CUSTOM_FIELDS = [
  // Punctuation: reachable only as custom["review.status"].
  "review.status",
  // Identifier-safe and outside the built-in names: has a bare form.
  "mood",
  // Collides with a built-in field name.
  "title",
  // Collides with a base field that type-specific fields alias.
  "publicationTitle",
] as const;

type ScenarioCustomField = (typeof SCENARIO_CUSTOM_FIELDS)[number];

interface ScenarioCollectionSpec {
  library: ScenarioLibraryName;
  key: string;
  name: string;
  /** Name of an earlier {@link COLLECTIONS} entry. */
  parent?: string;
  trashed?: boolean;
}

const COLLECTIONS = {
  thesis: { library: "personal", key: "CL2THSIS", name: "Thesis" },
  thesisMethods: {
    library: "personal",
    key: "CL2THMTH",
    name: "Methods",
    parent: "thesis",
  },
  teaching: { library: "personal", key: "CL2TCHNG", name: "Teaching" },
  // Same leaf name as Thesis/Methods under another parent.
  teachingMethods: {
    library: "personal",
    key: "CL2TCMTH",
    name: "Methods",
    parent: "teaching",
  },
  archive: {
    library: "personal",
    key: "CL2ARCHV",
    name: "Archive",
    trashed: true,
  },
  // A live Collection below a trashed ancestor.
  archiveOld: {
    library: "personal",
    key: "CL2ARLD2",
    name: "Old",
    parent: "archive",
  },
  // Same name and key shape in the other Library.
  groupMethods: { library: "group", key: "CL2GRMTH", name: "Methods" },
} as const satisfies Record<string, ScenarioCollectionSpec>;

const SAME_DAY_ADDED = "2021-01-01 00:00:00";
const SAME_MODIFIED = "2024-03-01 12:00:00";

const BASE_ITEMS = {
  // Full date, both creator modes, Tags that differ only in case, a number-
  // stored field value, three custom fields, two Collections (one below a
  // trashed ancestor), and every child row kind.
  fullDateArticle: {
    library: "personal",
    key: "ART2FULL",
    itemType: "journalArticle",
    dateAdded: "2020-03-16 09:30:00",
    dateModified: "2024-06-01 10:00:00",
    fields: {
      title: "Exact Matching in Literature Review",
      date: "2020-03-15 2020-03-15",
      publicationTitle: "Journal of Testing",
      volume: 12,
      DOI: "10.1234/exact",
    },
    custom: {
      "review.status": "done",
      mood: "calm",
      title: "Custom Title Value",
    },
    creators: [
      { firstName: "Ada", lastName: "Lovelace", creatorType: "author" },
      {
        lastName: "World Health Organization",
        fieldMode: 1,
        creatorType: "author",
      },
    ],
    tags: [
      { name: "to-read", type: 0 },
      { name: "To-Read", type: 1 },
      { name: "methods", type: 0 },
    ],
    collections: ["thesisMethods", "archiveOld"],
  },
  // Year-month date; the same person as author and as editor; a trashed
  // Collection membership; an empty custom value; added 06:00Z on 2020-01-07.
  yearMonthBook: {
    library: "personal",
    key: "BK2MNTH2",
    itemType: "book",
    dateAdded: "2020-01-07 06:00:00",
    dateModified: "2023-12-01 08:00:00",
    fields: {
      title: "Methods for Everyone",
      date: "2019-11-00 November 2019",
      publisher: "Academic Press",
      place: "Boston",
    },
    custom: { "review.status": "" },
    creators: [
      { firstName: "Grace", lastName: "Hopper", creatorType: "author" },
      { firstName: "Grace", lastName: "Hopper", creatorType: "editor" },
    ],
    tags: [{ name: "to-read", type: 0 }],
    collections: ["teachingMethods", "archive"],
  },
  // Year-only date; `bookTitle` aliases the `publicationTitle` base field;
  // filed in a parent Collection and its child; accessed on the calendar day
  // 2020-01-07.
  yearOnlyChapter: {
    library: "personal",
    key: "CHP2YEAR",
    itemType: "bookSection",
    dateAdded: "2019-05-01 12:00:00",
    dateModified: "2024-01-01 09:00:00",
    fields: {
      title: "A Chapter on Sampling",
      date: "2018-00-00 2018",
      bookTitle: "Handbook of Methods",
      publisher: "Sage",
      accessDate: "2020-01-07",
    },
    creators: [
      { firstName: "Alan", lastName: "Turing", creatorType: "author" },
      { firstName: "Grace", lastName: "Hopper", creatorType: "editor" },
    ],
    collections: ["thesis", "thesisMethods"],
  },
  // Text date with no year; `proceedingsTitle` aliases `publicationTitle`;
  // added 04:00Z on 2020-01-07.
  textDateConference: {
    library: "personal",
    key: "CNF2TEXT",
    itemType: "conferencePaper",
    dateAdded: "2020-01-07 04:00:00",
    dateModified: "2023-11-01 07:00:00",
    fields: {
      title: "Forthcoming Results",
      date: "0000-00-00 forthcoming",
      proceedingsTitle: "Proceedings of Testing",
    },
    creators: [
      { firstName: "Ada", lastName: "Lovelace", creatorType: "author" },
    ],
  },
  // No date, no creators, no Tags, no Collections; `institution` aliases
  // `publisher`; accessed at 04:00Z on 2020-01-07.
  missingDateReport: {
    library: "personal",
    key: "RPT2NDTE",
    itemType: "report",
    dateAdded: "2022-02-02 02:02:02",
    dateModified: "2024-02-01 06:00:00",
    fields: {
      title: "Lab Report",
      institution: "Lab Institute",
      accessDate: "2020-01-07 04:00:00",
    },
  },
  // Alias conflict: the base field and its type-specific variant are both
  // stored, and a custom field carries the base field's name.
  aliasConflictChapter: {
    library: "personal",
    key: "ALS2CNFL",
    itemType: "bookSection",
    dateAdded: "2021-07-01 10:00:00",
    dateModified: "2024-04-01 11:00:00",
    fields: {
      title: "Alias Conflict",
      date: "2021-06-30 2021-06-30",
      bookTitle: "Type-Specific Host",
      publicationTitle: "Base Field Host",
    },
    custom: { publicationTitle: "Custom Host" },
    tags: [{ name: "methods", type: 0 }],
  },
  // Unicode and SQL wildcard hazards; a leap-day date; an access date that
  // does not parse.
  unicodeArticle: {
    library: "personal",
    key: "UNI2CDE2",
    itemType: "journalArticle",
    dateAdded: "2024-02-29 23:30:00",
    dateModified: "2024-05-01 10:00:00",
    fields: {
      title: "Éclair İstanbul K 50%_off \\ é 🧪",
      date: "2024-02-29 2024-02-29",
      publicationTitle: "Revue d'Études",
      accessDate: "yesterday",
    },
    creators: [{ firstName: "Zoë", lastName: "Ünal", creatorType: "author" }],
    tags: [
      { name: "Éclair", type: 0 },
      { name: "eclair", type: 0 },
      { name: "100%_raw\\path", type: 0 },
    ],
  },
  // Tie-heavy group: equal title, date, venue, and timestamps. Only the key
  // separates the first two; the third has no title and no volume. `volume` is
  // stored as an integer on one and as text on the other.
  tieFirst: {
    library: "personal",
    key: "TIE2AAAA",
    itemType: "journalArticle",
    dateAdded: SAME_DAY_ADDED,
    dateModified: SAME_MODIFIED,
    fields: {
      title: "Same Title",
      date: "2021-00-00 2021",
      publicationTitle: "Tie Journal",
      volume: 12,
    },
    creators: [{ firstName: "Sam", lastName: "Same", creatorType: "author" }],
    tags: [{ name: "tie", type: 0 }],
  },
  tieSecond: {
    library: "personal",
    key: "TIE2BBBB",
    itemType: "journalArticle",
    dateAdded: SAME_DAY_ADDED,
    dateModified: SAME_MODIFIED,
    fields: {
      title: "Same Title",
      date: "2021-00-00 2021",
      publicationTitle: "Tie Journal",
      volume: "12",
    },
    creators: [{ firstName: "Sam", lastName: "Same", creatorType: "author" }],
    tags: [{ name: "tie", type: 0 }],
  },
  tieUntitled: {
    library: "personal",
    key: "TIE2CCCC",
    itemType: "journalArticle",
    dateAdded: SAME_DAY_ADDED,
    dateModified: SAME_MODIFIED,
    fields: {
      date: "2021-00-00 2021",
      publicationTitle: "Tie Journal",
    },
    tags: [{ name: "tie", type: 0 }],
  },
  // A trashed top-level Item that still carries a Tag and a Collection.
  trashedArticle: {
    library: "personal",
    key: "TRS2SHED",
    itemType: "journalArticle",
    dateAdded: "2020-03-17 09:00:00",
    dateModified: "2024-07-01 10:00:00",
    fields: {
      title: "Trashed Article",
      date: "2020-03-15 2020-03-15",
    },
    tags: [{ name: "to-read", type: 0 }],
    collections: ["thesisMethods"],
    trashed: true,
  },
  // Child rows of fullDateArticle: a live and a trashed Attachment, an
  // Annotation on the live Attachment, and a Child Note.
  liveAttachment: {
    library: "personal",
    key: "PDF2LIVE",
    itemType: "attachment",
    dateAdded: "2020-03-16 09:31:00",
    dateModified: "2020-03-16 09:31:00",
    fields: { title: "Full Text PDF" },
    parent: "fullDateArticle",
    attachment: {
      linkMode: 0,
      contentType: "application/pdf",
      path: "storage:exact.pdf",
    },
  },
  trashedAttachment: {
    library: "personal",
    key: "PDF2TRSH",
    itemType: "attachment",
    dateAdded: "2020-03-16 09:32:00",
    dateModified: "2020-03-16 09:32:00",
    fields: { title: "Old PDF" },
    parent: "fullDateArticle",
    attachment: {
      linkMode: 0,
      contentType: "application/pdf",
      path: "storage:old.pdf",
    },
    trashed: true,
  },
  highlightAnnotation: {
    library: "personal",
    key: "ANN2HGHT",
    itemType: "annotation",
    dateAdded: "2020-03-16 09:40:00",
    dateModified: "2020-03-16 09:40:00",
    parent: "liveAttachment",
    annotation: { type: 1, text: "an exact match", color: "#ffd400" },
  },
  childNote: {
    library: "personal",
    key: "NTE2CHLD",
    itemType: "note",
    dateAdded: "2020-03-16 09:50:00",
    dateModified: "2020-03-16 09:50:00",
    parent: "fullDateArticle",
    note: {
      note: '<div data-schema-version="9"><p>Child note</p></div>',
      title: "Child note",
    },
  },
  // Group Library: the same bare key as fullDateArticle, a shared Tag, a
  // Collection with a leaf name used in the personal Library, and a trashed
  // Item.
  groupArticle: {
    library: "group",
    key: "ART2FULL",
    itemType: "journalArticle",
    dateAdded: "2020-04-01 09:00:00",
    dateModified: "2024-06-02 10:00:00",
    fields: {
      title: "Group Copy of Exact Matching",
      date: "2020-03-15 2020-03-15",
      publicationTitle: "Journal of Testing",
    },
    creators: [
      { firstName: "Ada", lastName: "Lovelace", creatorType: "author" },
    ],
    tags: [{ name: "to-read", type: 0 }],
  },
  groupBook: {
    library: "group",
    key: "GRP2BK22",
    itemType: "book",
    dateAdded: "2022-03-01 09:00:00",
    dateModified: "2024-05-02 10:00:00",
    fields: {
      title: "Group Methods Book",
      date: "2022-00-00 2022",
      publisher: "Group Press",
    },
    tags: [{ name: "group-only", type: 0 }],
    collections: ["groupMethods"],
  },
  groupTrashed: {
    library: "group",
    key: "GRP2TRSH",
    itemType: "journalArticle",
    dateAdded: "2022-03-02 09:00:00",
    dateModified: "2024-08-01 10:00:00",
    fields: { title: "Group Trashed" },
    tags: [{ name: "group-only", type: 0 }],
    trashed: true,
  },
} as const satisfies Record<string, ScenarioItemSpec>;

const ANNOTATION_ITEMS = {
  linkedAttachment: {
    library: "personal",
    key: "PDF2LINK",
    itemType: "attachment",
    dateAdded: SAME_DAY_ADDED,
    dateModified: SAME_MODIFIED,
    parent: "fullDateArticle",
    fields: { title: "linkedAttachment" },
    attachment: {
      linkMode: 2,
      contentType: "application/pdf",
      path: "attachments:linked.pdf",
    },
  },
  trashedItemAttachment: {
    library: "personal",
    key: "PDF2DEAD",
    itemType: "attachment",
    dateAdded: SAME_DAY_ADDED,
    dateModified: SAME_MODIFIED,
    parent: "trashedArticle",
    fields: { title: "trashedItemAttachment" },
    attachment: {
      linkMode: 0,
      contentType: "application/pdf",
      path: "storage:paper.pdf",
    },
  },
  groupAttachment: {
    library: "group",
    key: "PDF2GRUP",
    itemType: "attachment",
    dateAdded: SAME_DAY_ADDED,
    dateModified: SAME_MODIFIED,
    parent: "groupArticle",
    fields: { title: "groupAttachment" },
    attachment: {
      linkMode: 0,
      contentType: "application/pdf",
      path: "storage:paper.pdf",
    },
  },
  standaloneAttachment: {
    library: "personal",
    key: "PDF2SOLO",
    itemType: "attachment",
    dateAdded: SAME_DAY_ADDED,
    dateModified: SAME_MODIFIED,
    fields: { title: "standaloneAttachment" },
    attachment: {
      linkMode: 0,
      contentType: "application/pdf",
      path: "storage:paper.pdf",
    },
  },
  underlineAnnotation: {
    library: "personal",
    key: "ANN2UNDR",
    itemType: "annotation",
    dateAdded: SAME_DAY_ADDED,
    dateModified: SAME_MODIFIED,
    parent: "liveAttachment",
    tags: [{ name: "method", type: 0 }],
    annotation: {
      type: 5,
      text: "A <i>formatted</i> excerpt",
      comment: "<b>Comment</b>",
      color: "#ffd400",
      pageLabel: "iv",
      sortIndex: "00000|000005|00000",
    },
  },
  noteAnnotation: {
    library: "personal",
    key: "ANN2NOTE",
    itemType: "annotation",
    dateAdded: SAME_DAY_ADDED,
    dateModified: SAME_MODIFIED,
    parent: "liveAttachment",
    tags: [{ name: "method", type: 0 }],
    annotation: {
      type: 2,
      text: "A <i>formatted</i> excerpt",
      comment: "<b>Comment</b>",
      color: "#ffd400",
      pageLabel: "iv",
      sortIndex: "00000|000002|00000",
    },
  },
  imageAnnotation: {
    library: "personal",
    key: "ANN2IMAG",
    itemType: "annotation",
    dateAdded: SAME_DAY_ADDED,
    dateModified: SAME_MODIFIED,
    parent: "liveAttachment",
    tags: [{ name: "method", type: 0 }],
    annotation: {
      type: 3,
      text: "A <i>formatted</i> excerpt",
      comment: "<b>Comment</b>",
      color: "#ffd400",
      pageLabel: "iv",
      sortIndex: "00000|000003|00000",
    },
  },
  inkAnnotation: {
    library: "personal",
    key: "ANN2INK2",
    itemType: "annotation",
    dateAdded: SAME_DAY_ADDED,
    dateModified: SAME_MODIFIED,
    parent: "liveAttachment",
    tags: [{ name: "method", type: 0 }],
    annotation: {
      type: 4,
      text: "A <i>formatted</i> excerpt",
      comment: "<b>Comment</b>",
      color: "#ffd400",
      pageLabel: "iv",
      sortIndex: "00000|000004|00000",
    },
  },
  textAnnotation: {
    library: "personal",
    key: "ANN2TEXT",
    itemType: "annotation",
    dateAdded: SAME_DAY_ADDED,
    dateModified: SAME_MODIFIED,
    parent: "liveAttachment",
    tags: [{ name: "method", type: 0 }],
    annotation: {
      type: 6,
      text: "A <i>formatted</i> excerpt",
      comment: "<b>Comment</b>",
      color: "#ffd400",
      pageLabel: "iv",
      sortIndex: "00000|000006|00000",
    },
  },
  linkedHighlight: {
    library: "personal",
    key: "ANN2LINK",
    itemType: "annotation",
    dateAdded: SAME_DAY_ADDED,
    dateModified: SAME_MODIFIED,
    parent: "linkedAttachment",
    tags: [{ name: "method", type: 0 }],
    annotation: {
      type: 1,
      text: "A <i>formatted</i> excerpt",
      comment: "<b>Comment</b>",
      color: "#ffd400",
      pageLabel: "iv",
      sortIndex: "00000|000001|00000",
    },
  },
  linkedImage: {
    library: "personal",
    key: "ANL2IMAG",
    itemType: "annotation",
    dateAdded: SAME_DAY_ADDED,
    dateModified: SAME_MODIFIED,
    parent: "linkedAttachment",
    annotation: {
      type: 3,
      text: "Linked excerpt",
      color: "#123456",
      sortIndex: "00000|000003|00000",
    },
  },
  linkedInk: {
    library: "personal",
    key: "ANL2INK2",
    itemType: "annotation",
    dateAdded: SAME_DAY_ADDED,
    dateModified: SAME_MODIFIED,
    parent: "linkedAttachment",
    annotation: {
      type: 4,
      text: "Linked excerpt",
      color: "#123456",
      sortIndex: "00000|000004|00000",
    },
  },
  linkedUnderline: {
    library: "personal",
    key: "ANL2UNDR",
    itemType: "annotation",
    dateAdded: SAME_DAY_ADDED,
    dateModified: SAME_MODIFIED,
    parent: "linkedAttachment",
    annotation: {
      type: 5,
      text: "Linked excerpt",
      color: "#123456",
      sortIndex: "00000|000005|00000",
    },
  },
  linkedText: {
    library: "personal",
    key: "ANL2TEXT",
    itemType: "annotation",
    dateAdded: SAME_DAY_ADDED,
    dateModified: SAME_MODIFIED,
    parent: "linkedAttachment",
    annotation: {
      type: 6,
      text: "Linked excerpt",
      color: "#123456",
      sortIndex: "00000|000006|00000",
    },
  },
  trashedAnnotation: {
    library: "personal",
    key: "ANN2TRSH",
    itemType: "annotation",
    dateAdded: SAME_DAY_ADDED,
    dateModified: SAME_MODIFIED,
    parent: "liveAttachment",
    trashed: true,
    tags: [{ name: "method", type: 0 }],
    annotation: {
      type: 1,
      text: "A <i>formatted</i> excerpt",
      comment: "<b>Comment</b>",
      color: "#ffd400",
      pageLabel: "iv",
      sortIndex: "00000|000001|00000",
    },
  },
  trashedAttachmentAnnotation: {
    library: "personal",
    key: "ANN2DEAD",
    itemType: "annotation",
    dateAdded: SAME_DAY_ADDED,
    dateModified: SAME_MODIFIED,
    parent: "trashedAttachment",
    tags: [{ name: "method", type: 0 }],
    annotation: {
      type: 1,
      text: "A <i>formatted</i> excerpt",
      comment: "<b>Comment</b>",
      color: "#ffd400",
      pageLabel: "iv",
      sortIndex: "00000|000001|00000",
    },
  },
  trashedItemAnnotation: {
    library: "personal",
    key: "ANN2GONE",
    itemType: "annotation",
    dateAdded: SAME_DAY_ADDED,
    dateModified: SAME_MODIFIED,
    parent: "trashedItemAttachment",
    tags: [{ name: "method", type: 0 }],
    annotation: {
      type: 1,
      text: "A <i>formatted</i> excerpt",
      comment: "<b>Comment</b>",
      color: "#ffd400",
      pageLabel: "iv",
      sortIndex: "00000|000001|00000",
    },
  },
  standaloneAnnotation: {
    library: "personal",
    key: "ANN2SOLO",
    itemType: "annotation",
    dateAdded: SAME_DAY_ADDED,
    dateModified: SAME_MODIFIED,
    parent: "standaloneAttachment",
    tags: [{ name: "method", type: 0 }],
    annotation: {
      type: 1,
      text: "A <i>formatted</i> excerpt",
      comment: "<b>Comment</b>",
      color: "#ffd400",
      pageLabel: "iv",
      sortIndex: "00000|000001|00000",
    },
  },
  groupAnnotation: {
    library: "group",
    key: "ANN2GRUP",
    itemType: "annotation",
    dateAdded: SAME_DAY_ADDED,
    dateModified: SAME_MODIFIED,
    parent: "groupAttachment",
    tags: [{ name: "method", type: 0 }],
    annotation: {
      type: 1,
      text: "A <i>formatted</i> excerpt",
      comment: "<b>Comment</b>",
      color: "#ffd400",
      pageLabel: "iv",
      sortIndex: "00000|000001|00000",
    },
  },
  malformedAnnotation: {
    library: "personal",
    key: "ANN2BAD2",
    itemType: "annotation",
    dateAdded: SAME_DAY_ADDED,
    dateModified: SAME_MODIFIED,
    parent: "linkedAttachment",
    tags: [{ name: "method", type: 0 }],
    annotation: {
      type: 2,
      text: "A <i>formatted</i> excerpt",
      comment: "<b>Comment</b>",
      color: "#ffd400",
      pageLabel: "iv",
      sortIndex: "00000|000002|00000",
      position: "invalid JSON",
    },
  },
} as const satisfies Record<string, ScenarioItemSpec>;

const ITEMS = { ...BASE_ITEMS, ...ANNOTATION_ITEMS };

export type ScenarioItemName = keyof typeof ITEMS;

export interface ScenarioItem {
  /** Zotero's 8-character Key, unique within its Library only. */
  key: string;
  /** The cross-Library identity Item Query reports. */
  indexedKey: string;
  library: ScenarioLibraryName;
}

/** Every scenario row by symbolic name, addressed by Indexed Key. */
export const SCENARIO_ITEMS = Object.fromEntries(
  Object.entries<ScenarioItemSpec>(ITEMS).map(([name, spec]) => [
    name,
    {
      key: spec.key,
      indexedKey: formatIndexedKey(
        spec.key,
        SCENARIO_LIBRARIES[spec.library].groupID,
      ),
      library: spec.library,
    },
  ]),
) as Record<ScenarioItemName, ScenarioItem>;

/**
 * Zotero's offset between a `customFields` row ID and its `fieldsCombined` ID.
 *
 * @see https://github.com/zotero/zotero/blob/10.0.0/chrome/content/zotero/xpcom/data/cachedTypes.js#L345
 */
const CUSTOM_ID_OFFSET = 10_000;

/** Insert the scenario into a pristine Zotero database, in one transaction. */
export function seedScenario(sqlite: DatabaseSync, annotations = false): void {
  sqlite.exec("begin");
  try {
    insertScenario(sqlite, annotations);
    sqlite.exec("commit");
  } catch (error) {
    sqlite.exec("rollback");
    throw error;
  }
}

/**
 * The `id` column of the row that `sql` selects for `name` in one of Zotero's
 * lookup tables.
 *
 * @throws {Error} when the pristine database has no such row.
 */
export function lookupID(
  sqlite: DatabaseSync,
  sql: string,
  name: string,
): number {
  const row = sqlite.prepare(sql).get(name) as { id: number } | undefined;
  if (!row) {
    throw new Error(
      `the pristine database carries no "${name}" in its global schema.`,
    );
  }
  return row.id;
}

function insertScenario(sqlite: DatabaseSync, annotations: boolean): void {
  const idOf = (sql: string, name: string): number =>
    lookupID(sqlite, sql, name);
  const itemTypeID = (name: string) =>
    idOf(
      "select itemTypeID as id from itemTypesCombined where typeName = ?",
      name,
    );
  const fieldID = (name: string) =>
    idOf(
      "select fieldID as id from fieldsCombined where fieldName = ? and custom = 0",
      name,
    );
  const creatorTypeID = (name: string) =>
    idOf(
      "select creatorTypeID as id from creatorTypes where creatorType = ?",
      name,
    );

  const { group } = SCENARIO_LIBRARIES;
  sqlite
    .prepare(
      "insert into libraries (libraryID, type, editable, filesEditable) values (?, 'group', 1, 1)",
    )
    .run(group.libraryID);
  sqlite
    .prepare(
      "insert into groups (groupID, libraryID, name, description, version) values (?, ?, ?, '', 0)",
    )
    .run(group.groupID, group.libraryID, group.name);

  const customFieldIDs = new Map<string, number>();
  for (const name of SCENARIO_CUSTOM_FIELDS) {
    const { lastInsertRowid } = sqlite
      .prepare("insert into customFields (fieldName, label) values (?, ?)")
      .run(name, name);
    const id = Number(lastInsertRowid) + CUSTOM_ID_OFFSET;
    sqlite
      .prepare(
        "insert into fieldsCombined (fieldID, fieldName, label, fieldFormatID, custom) values (?, ?, ?, null, 1)",
      )
      .run(id, name, name);
    customFieldIDs.set(name, id);
  }

  const collectionIDs = new Map<string, number>();
  for (const [name, spec] of Object.entries<ScenarioCollectionSpec>(
    COLLECTIONS,
  )) {
    const parentID = spec.parent ? collectionIDs.get(spec.parent) : null;
    const { lastInsertRowid } = sqlite
      .prepare(
        "insert into collections (collectionName, parentCollectionID, clientDateModified, libraryID, key) values (?, ?, ?, ?, ?)",
      )
      .run(
        spec.name,
        parentID ?? null,
        SAME_MODIFIED,
        SCENARIO_LIBRARIES[spec.library].libraryID,
        spec.key,
      );
    const id = Number(lastInsertRowid);
    collectionIDs.set(name, id);
    if (spec.trashed) {
      sqlite
        .prepare(
          "insert into deletedCollections (collectionID, dateDeleted) values (?, ?)",
        )
        .run(id, SAME_MODIFIED);
    }
  }

  const internValue = (value: string | number): number => {
    // node:sqlite binds a JS number as REAL; a bigint binds as INTEGER.
    const bound = typeof value === "number" ? BigInt(value) : value;
    const found = sqlite
      .prepare("select valueID from itemDataValues where value is ?")
      .get(bound) as { valueID: number } | undefined;
    if (found) return found.valueID;
    return Number(
      sqlite.prepare("insert into itemDataValues (value) values (?)").run(bound)
        .lastInsertRowid,
    );
  };
  const internTag = (name: string): number => {
    const found = sqlite
      .prepare("select tagID from tags where name = ?")
      .get(name) as { tagID: number } | undefined;
    if (found) return found.tagID;
    return Number(
      sqlite.prepare("insert into tags (name) values (?)").run(name)
        .lastInsertRowid,
    );
  };
  const internCreator = (creator: ScenarioCreator): number => {
    const firstName = creator.firstName ?? "";
    const fieldMode = creator.fieldMode ?? 0;
    const found = sqlite
      .prepare(
        "select creatorID from creators where firstName = ? and lastName = ? and fieldMode = ?",
      )
      .get(firstName, creator.lastName, fieldMode) as
      | { creatorID: number }
      | undefined;
    if (found) return found.creatorID;
    return Number(
      sqlite
        .prepare(
          "insert into creators (firstName, lastName, fieldMode) values (?, ?, ?)",
        )
        .run(firstName, creator.lastName, fieldMode).lastInsertRowid,
    );
  };

  const itemIDs = new Map<string, number>();
  for (const [name, spec] of Object.entries<ScenarioItemSpec>(
    annotations ? ITEMS : BASE_ITEMS,
  )) {
    const library = SCENARIO_LIBRARIES[spec.library];
    const itemID = Number(
      sqlite
        .prepare(
          "insert into items (itemTypeID, dateAdded, dateModified, clientDateModified, libraryID, key) values (?, ?, ?, ?, ?, ?)",
        )
        .run(
          itemTypeID(spec.itemType),
          spec.dateAdded,
          spec.dateModified,
          spec.dateModified,
          library.libraryID,
          spec.key,
        ).lastInsertRowid,
    );
    itemIDs.set(name, itemID);

    if (library.groupID !== null) {
      sqlite
        .prepare(
          "insert into groupItems (itemID, createdByUserID, lastModifiedByUserID) values (?, null, null)",
        )
        .run(itemID);
    }

    const setValue = (id: number, value: string | number) =>
      sqlite
        .prepare(
          "insert into itemData (itemID, fieldID, valueID) values (?, ?, ?)",
        )
        .run(itemID, id, internValue(value));
    for (const [field, value] of Object.entries(spec.fields ?? {})) {
      setValue(fieldID(field), value);
    }
    for (const [field, value] of Object.entries(spec.custom ?? {})) {
      setValue(customFieldIDs.get(field)!, value);
    }

    for (const [orderIndex, creator] of (spec.creators ?? []).entries()) {
      sqlite
        .prepare(
          "insert into itemCreators (itemID, creatorID, creatorTypeID, orderIndex) values (?, ?, ?, ?)",
        )
        .run(
          itemID,
          internCreator(creator),
          creatorTypeID(creator.creatorType),
          orderIndex,
        );
    }
    for (const tag of spec.tags ?? []) {
      sqlite
        .prepare("insert into itemTags (itemID, tagID, type) values (?, ?, ?)")
        .run(itemID, internTag(tag.name), tag.type);
    }
    for (const [orderIndex, collection] of (spec.collections ?? []).entries()) {
      sqlite
        .prepare(
          "insert into collectionItems (collectionID, itemID, orderIndex) values (?, ?, ?)",
        )
        .run(collectionIDs.get(collection)!, itemID, orderIndex);
    }

    const parentID = spec.parent ? itemIDs.get(spec.parent)! : null;
    if (spec.attachment) {
      sqlite
        .prepare(
          "insert into itemAttachments (itemID, parentItemID, linkMode, contentType, path) values (?, ?, ?, ?, ?)",
        )
        .run(
          itemID,
          parentID,
          spec.attachment.linkMode,
          spec.attachment.contentType,
          spec.attachment.path,
        );
    }
    if (spec.annotation) {
      sqlite
        .prepare(
          "insert into itemAnnotations (itemID, parentItemID, type, text, color, sortIndex, position, comment, pageLabel, isExternal) values (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)",
        )
        .run(
          itemID,
          parentID,
          spec.annotation.type,
          spec.annotation.text,
          spec.annotation.color,
          spec.annotation.sortIndex ?? "00000|000000|00000",
          spec.annotation.position ?? '{"pageIndex":0,"rects":[[0,0,1,1]]}',
          spec.annotation.comment ?? null,
          spec.annotation.pageLabel ?? null,
        );
    }
    if (spec.note) {
      sqlite
        .prepare(
          "insert into itemNotes (itemID, parentItemID, note, title) values (?, ?, ?, ?)",
        )
        .run(itemID, parentID, spec.note.note, spec.note.title);
    }
    if (spec.trashed) {
      sqlite
        .prepare("insert into deletedItems (itemID, dateDeleted) values (?, ?)")
        .run(itemID, spec.dateModified);
    }
  }
}
