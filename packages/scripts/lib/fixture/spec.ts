// Deterministic description of the Fixture.

import { join } from "node:path";

import { CONTRACT_VERSION, USER_LIBRARY_ID } from "@zotlit/db";

/** Directory the committed source assets named below are read from. */
export const ASSET_DIR = join(import.meta.dirname, "assets");

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
  /** Parent in the same Library; absent for a top-level collection. */
  parentCollectionID?: number;
}

/**
 * What `CURRENT_TIMESTAMP` reads as while a build runs. Zotero's schema
 * defaults ten columns to the clock, and a column the Spec does not stamp
 * falls back to one of them, so the build pins the clock instead of letting
 * the time of the build reach the database.
 */
export const BUILD_TIMESTAMP = "2026-08-19 08:00:00";

/**
 * `SHAREDCL` repeats in three Libraries, so a collection target must name one.
 * `PERSCHLD` nests under `PERSNAL2`, so a descendant walk and a direct
 * membership check give different answers for the one Item filed there.
 */
export const COLLECTIONS: readonly FixtureCollection[] = [
  { collectionID: 1, libraryID: 1, key: "SHAREDCL", name: "Shared key" },
  { collectionID: 2, libraryID: 2, key: "SHAREDCL", name: "Shared key" },
  { collectionID: 3, libraryID: 3, key: "SHAREDCL", name: "Shared key" },
  { collectionID: 4, libraryID: 1, key: "PERSNAL2", name: "Personal only" },
  {
    collectionID: 5,
    libraryID: 1,
    key: "PERSCHLD",
    name: "Personal child",
    parentCollectionID: 4,
  },
];

/**
 * The Zotero Item types the Spec builds. Venue coverage drives the set: a
 * native container field, an aliased one, an aliased publisher-role field, a
 * native publisher field, and a type with neither role.
 */
export const FIXTURE_ITEM_TYPES = [
  "journalArticle",
  "bookSection",
  "conferencePaper",
  "preprint",
  "book",
  "thesis",
  "letter",
] as const;

/** The Zotero fields an Item's {@link FixtureItem.fields} can carry. */
export const FIXTURE_ITEM_FIELDS = [
  "volume",
  "issue",
  "pages",
  "place",
] as const;

export type FixtureItemField = (typeof FIXTURE_ITEM_FIELDS)[number];

export interface FixtureItem {
  itemID: number;
  libraryID: number;
  /**
   * Bare Zotero item key — unique per Library, not globally, and in Zotero's
   * object-key format, so `isItemKey` accepts it.
   */
  key: string;
  itemType: (typeof FIXTURE_ITEM_TYPES)[number];
  /** `null` leaves the item without a native Zotero Citation Key. */
  citationKey: string | null;
  /** Fixture Vault filename stem when a prose page needs a stable target. */
  literatureNoteName?: string;
  /**
   * Citation Keys the seeded Literature Note cites in its body, so a
   * Literature Note carries citation edges of its own and a local graph can
   * walk from one literature node to a second.
   */
  literatureNoteCitations?: readonly string[];
  /**
   * Literature Note Profile the seeded note belongs to, written as a Profile
   * stamp. An absent value seeds the note under the default Profile, unstamped.
   */
  literatureNoteProfile?: string;
  /**
   * Seed this Item's Literature Note with a managed region holding the
   * per-Annotation output ZotLit wrote before Mark Landing (#1156): a plain
   * page label, with no link and no Annotation Anchor. Update Note rewrites
   * that region, so the note stands for work a reader has already done.
   */
  literatureNoteStaleAnnotations?: boolean;
  title: string;
  /**
   * The Item's **Venue**. The builder resolves which per-type field receives
   * it — the container-role field where {@link itemType} has one, its
   * publisher-role field otherwise. Omit it for a type that records neither.
   */
  venue?: string;
  /**
   * A publisher-role value on a type that also records a container role, so
   * the container-first Venue chain has something to win against.
   */
  publisher?: string;
  /**
   * Locator and imprint fields under their canonical Zotero names. The build
   * fails when {@link itemType} has no such field.
   */
  fields?: Readonly<Partial<Record<FixtureItemField, string>>>;
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

/** Id of the Fixture's second Literature Note Profile, {@link LITERATURE_NOTE_PROFILES}. */
const BOOKS_PROFILE_ID = "V1StGXR8Z5jd";

/**
 * The papers the Demo Vault Case reads: real articles with their real
 * metadata, each on an Attachment of its own over a committed PDF, so
 * screenshots and walkthroughs never touch a test Item.
 */
export const DEMO_ITEMS: readonly FixtureItem[] = [
  {
    itemID: 900,
    libraryID: 1,
    key: "DMRGRART",
    itemType: "journalArticle",
    citationKey: "rougier2014",
    literatureNoteName: "rougier2014",
    title: "Ten Simple Rules for Better Figures",
    venue: "PLOS Computational Biology",
    date: "2014",
    creators: [
      author("Nicolas P.", "Rougier"),
      author("Michael", "Droettboom"),
      author("Philip E.", "Bourne"),
    ],
    dateModified: "2024-11-20 09:00:00",
    collectionIDs: [],
  },
  {
    itemID: 902,
    libraryID: 1,
    key: "DMIANART",
    itemType: "journalArticle",
    citationKey: "ioannidis2005",
    literatureNoteName: "ioannidis2005",
    title: "Why Most Published Research Findings Are False",
    venue: "PLoS Medicine",
    date: "2005",
    creators: [author("John P. A.", "Ioannidis")],
    dateModified: "2024-11-19 09:00:00",
    collectionIDs: [],
  },
];

/** Vault folder that holds the demo papers' linked PDFs. */
export const DEMO_PAPERS_DIR = "Papers";

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
    venue: "Journal of Personal Records",
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
    literatureNoteName: "books-duplicateWithin2020",
    literatureNoteProfile: BOOKS_PROFILE_ID,
    title: "Within-library duplicate, first item",
    venue: "Journal of Personal Records",
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
    venue: "Journal of Personal Records",
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
    venue: "Journal of Personal Records",
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
    venue: "Collected Personal Essays",
    publisher: "Essay House",
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
    venue: "Journal of Shared Reading",
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
    venue: "Journal of Shared Reading",
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
    venue: "Lab Archive Proceedings",
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
    venue: "Lab Archive Proceedings",
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
    venue: "Consortium Reading Room Notes",
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
    venue: "Journal of Personal Records",
    date: "2017",
    creators: [author("Kim", "Tie")],
    dateModified: "2025-03-01 12:00:00",
    collectionIDs: [5],
  },
  {
    itemID: 12,
    libraryID: 1,
    key: "KKKKKKKK",
    itemType: "journalArticle",
    citationKey: "personalTieSecond2017",
    title: "Personal tie, higher item id",
    venue: "Journal of Personal Records",
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
    venue: "African Storybook",
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
    venue: "PLoS Medicine",
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
    venue: "Journal of Choice Modelling",
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
    venue: "Brain",
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
    venue: "Clinical Genetics",
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
    venue: "The EMBO Journal",
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
    venue: "Fixture Journal",
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
    venue: "Neuromuscular Disorders",
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
    literatureNoteCitations: ["ioannidisWhyMost2005"],
    title: "Ten Simple Rules for Better Figures",
    venue: "PLOS Computational Biology",
    date: "2014",
    creators: [
      author("Nicolas P.", "Rougier"),
      author("Michael", "Droettboom"),
      author("Philip E.", "Bourne"),
    ],
    dateModified: "2025-02-05 12:00:00",
    collectionIDs: [1],
    literatureNoteStaleAnnotations: true,
  },
  {
    itemID: 57,
    libraryID: 1,
    key: "PREPRNT2",
    itemType: "preprint",
    citationKey: "yePreprintRepository2022",
    title: "A preprint whose Venue is its repository",
    venue: "arXiv",
    date: "2022",
    creators: [author("Lin", "Ye")],
    dateModified: "2025-02-04 12:00:00",
    collectionIDs: [1],
  },
  {
    itemID: 58,
    libraryID: 1,
    key: "BKPUBLR4",
    itemType: "book",
    citationKey: "weiBookPublisher2017",
    title: "A book whose Venue is its publisher",
    venue: "Fixture University Press",
    date: "2017",
    creators: [author("Xin", "Wei")],
    dateModified: "2025-02-03 12:00:00",
    collectionIDs: [1],
  },
  {
    itemID: 59,
    libraryID: 1,
    key: "LETTERS5",
    itemType: "letter",
    citationKey: "chenLetterNoVenue2015",
    title: "A letter that records no Venue at all",
    date: "2015",
    creators: [author("Mei", "Chen")],
    dateModified: "2025-02-02 12:00:00",
    collectionIDs: [1],
  },
  {
    itemID: 60,
    libraryID: 1,
    key: "CNPF226A",
    itemType: "conferencePaper",
    citationKey: "riveraResearchInterfaces2026",
    title: "Designing reproducible research interfaces",
    venue: "Proceedings of the Open Research Conference",
    date: "2026",
    creators: [author("Mara", "Rivera"), author("Tao", "Chen")],
    dateModified: "2025-01-03 12:00:00",
    collectionIDs: [1],
  },
  {
    itemID: 61,
    libraryID: 1,
    key: "NW2CPDTC",
    itemType: "book",
    citationKey: "Kahneman2011",
    title: "Thinking, fast and slow",
    venue: "Penguin Books",
    date: "2011-00-00 2011",
    creators: [author("D", "Kahneman")],
    dateModified: "2025-05-22 03:30:30",
    collectionIDs: [],
  },
  {
    itemID: 62,
    libraryID: 1,
    key: "I49R3FTL",
    itemType: "thesis",
    citationKey: "Batista2010",
    title:
      "Bicycle Sharing in Developing Countries: A proposal towards sustainable transportation in Brazilian media cities",
    venue: "",
    date: "2010-00-00 2010",
    creators: [author("Edgard Antunes Dias", "Batista")],
    dateModified: "2025-05-22 03:30:30",
    collectionIDs: [],
  },
  // ── Publisher by item type (discussion #1197) ─────────────────────
  // One `publisher` property formatted per item type: a journal article with
  // every locator and one with only a volume, a book with a place, a chapter
  // in an edited collection, and a thesis whose university is its publisher.
  {
    itemID: 86,
    libraryID: 1,
    key: "PUBJRNL2",
    itemType: "journalArticle",
    citationKey: "orlovaArchivalReading2021",
    title: "Archival reading practices in regional libraries",
    venue: "Journal of Library History",
    fields: { volume: "12", issue: "3", pages: "45-67" },
    date: "2021-03-00 March 2021",
    creators: [author("Anna", "Orlova")],
    dateModified: "2024-11-05 12:00:00",
    collectionIDs: [],
  },
  {
    itemID: 87,
    libraryID: 1,
    key: "PUBJRNL3",
    itemType: "journalArticle",
    citationKey: "marshMarginaliaEvidence2019",
    title: "Marginalia as evidence of reading",
    venue: "Book History Review",
    fields: { volume: "8" },
    date: "2019",
    creators: [author("Peter", "Marsh")],
    dateModified: "2024-11-04 12:00:00",
    collectionIDs: [],
  },
  {
    itemID: 88,
    libraryID: 1,
    key: "PUBBKPL4",
    itemType: "book",
    citationKey: "sokolovReadingCultures2018",
    title: "Reading cultures of the nineteenth century",
    venue: "Fixture Academic Press",
    fields: { place: "Moscow" },
    date: "2018",
    creators: [author("Ivan", "Sokolov")],
    dateModified: "2024-11-03 12:00:00",
    collectionIDs: [],
  },
  {
    itemID: 89,
    libraryID: 1,
    key: "PUBSECT5",
    itemType: "bookSection",
    citationKey: "grantFootnotesReaders2016",
    title: "Footnotes and their readers",
    venue: "Essays on scholarly apparatus",
    publisher: "Leiden Fixture Publishers",
    fields: { place: "Leiden", pages: "101-118" },
    date: "2016",
    creators: [
      author("Helen", "Grant"),
      {
        firstName: "Jan",
        lastName: "de Vries",
        creatorType: "editor",
        fieldMode: 0,
      },
    ],
    dateModified: "2024-11-02 12:00:00",
    collectionIDs: [],
  },
  {
    itemID: 90,
    libraryID: 1,
    key: "PUBTHSS6",
    itemType: "thesis",
    citationKey: "petrovaCorrespondenceNetworks2020",
    title: "Scholarly correspondence networks in the long nineteenth century",
    venue: "Fixture State University",
    fields: { place: "Saint Petersburg" },
    date: "2020",
    creators: [author("Maria", "Petrova")],
    dateModified: "2024-11-01 12:00:00",
    collectionIDs: [],
  },
  // ── Graph showcase: information-science citation web ──────────────
  {
    itemID: 70,
    libraryID: 1,
    key: "BUSH45AA",
    itemType: "journalArticle",
    citationKey: "bushAsWeMayThink1945",
    literatureNoteName: "bushAsWeMayThink1945",
    title: "As We May Think",
    venue: "The Atlantic Monthly",
    date: "1945",
    creators: [author("Vannevar", "Bush")],
    dateModified: "2024-12-31 12:00:00",
    collectionIDs: [1],
  },
  {
    itemID: 71,
    libraryID: 1,
    key: "NELSN65A",
    itemType: "conferencePaper",
    citationKey: "nelsonComplexInformation1965",
    literatureNoteName: "nelsonComplexInformation1965",
    literatureNoteCitations: ["bushAsWeMayThink1945"],
    title:
      "Complex information processing: a file structure for the complex, the changing and the indeterminate",
    venue: "Proceedings of the 1965 20th National Conference",
    date: "1965",
    creators: [author("Theodor Holm", "Nelson")],
    dateModified: "2024-12-30 12:00:00",
    collectionIDs: [1],
  },
  {
    itemID: 72,
    libraryID: 1,
    key: "GRFLD55A",
    itemType: "journalArticle",
    citationKey: "garfieldCitationIndexes1955",
    literatureNoteName: "garfieldCitationIndexes1955",
    title:
      "Citation Indexes for Science: A New Dimension in Documentation through Association of Ideas",
    venue: "Science",
    date: "1955",
    creators: [author("Eugene", "Garfield")],
    dateModified: "2024-12-29 12:00:00",
    collectionIDs: [1],
  },
  {
    itemID: 73,
    libraryID: 1,
    key: "SMALL73A",
    itemType: "journalArticle",
    citationKey: "smallCoCitationScientific1973",
    literatureNoteName: "smallCoCitationScientific1973",
    literatureNoteCitations: ["garfieldCitationIndexes1955"],
    title:
      "Co-citation in the Scientific Literature: A New Measure of the Relationship between Two Documents",
    venue: "Journal of the American Society for Information Science",
    date: "1973",
    creators: [author("Henry", "Small")],
    dateModified: "2024-12-28 12:00:00",
    collectionIDs: [1],
  },
  {
    itemID: 74,
    libraryID: 1,
    key: "LHMNN82A",
    itemType: "bookSection",
    citationKey: "luhmannCommunicatingSlipBoxes1981",
    literatureNoteName: "luhmannCommunicatingSlipBoxes1981",
    title: "Communicating with Slip Boxes: An Empirical Account",
    venue: "Öffentliche Meinung und sozialer Wandel",
    date: "1981",
    creators: [author("Niklas", "Luhmann")],
    dateModified: "2024-12-27 12:00:00",
    collectionIDs: [1],
  },
  {
    itemID: 75,
    libraryID: 1,
    key: "AHRNS27A",
    itemType: "book",
    citationKey: "ahrensHowTakeSmartNotes2017",
    literatureNoteName: "ahrensHowTakeSmartNotes2017",
    literatureNoteCitations: ["luhmannCommunicatingSlipBoxes1981"],
    title:
      "How to Take Smart Notes: One Simple Technique to Boost Writing, Learning and Thinking",
    venue: "Sönke Ahrens",
    date: "2017",
    creators: [author("Sönke", "Ahrens")],
    dateModified: "2024-12-26 12:00:00",
    collectionIDs: [1],
  },
  {
    itemID: 76,
    libraryID: 1,
    key: "BRNRS52A",
    itemType: "journalArticle",
    citationKey: "bernersLeeSemanticWeb2001",
    literatureNoteName: "bernersLeeSemanticWeb2001",
    literatureNoteCitations: [
      "bushAsWeMayThink1945",
      "nelsonComplexInformation1965",
    ],
    title: "The Semantic Web",
    venue: "Scientific American",
    date: "2001",
    creators: [
      author("Tim", "Berners-Lee"),
      author("James", "Hendler"),
      author("Ora", "Lassila"),
    ],
    dateModified: "2024-12-25 12:00:00",
    collectionIDs: [1],
  },
  {
    itemID: 77,
    libraryID: 1,
    key: "FRTEE22A",
    itemType: "book",
    citationKey: "forteBuildingSecondBrain2022",
    literatureNoteName: "forteBuildingSecondBrain2022",
    literatureNoteCitations: [
      "ahrensHowTakeSmartNotes2017",
      "bushAsWeMayThink1945",
    ],
    title:
      "Building a Second Brain: A Proven Method to Organize Your Digital Life and Unlock Your Creative Potential",
    venue: "Atria Books",
    date: "2022",
    creators: [author("Tiago", "Forte")],
    dateModified: "2024-12-24 12:00:00",
    collectionIDs: [1],
  },
  {
    itemID: 78,
    libraryID: 1,
    key: "MATSC29A",
    itemType: "preprint",
    citationKey: "matuschakTransformativeTools2019",
    literatureNoteName: "matuschakTransformativeTools2019",
    literatureNoteCitations: [
      "bushAsWeMayThink1945",
      "nelsonComplexInformation1965",
      "ahrensHowTakeSmartNotes2017",
    ],
    title: "How can we develop transformative tools for thought?",
    venue: "numinous.productions",
    date: "2019",
    creators: [author("Andy", "Matuschak"), author("Michael", "Nielsen")],
    dateModified: "2024-12-23 12:00:00",
    collectionIDs: [1],
  },
  {
    itemID: 79,
    libraryID: 2,
    key: "ENGBT62A",
    itemType: "journalArticle",
    citationKey: "engelbartAugmentingHuman1962",
    title: "Augmenting Human Intellect: A Conceptual Framework",
    venue: "SRI Summary Report",
    date: "1962",
    creators: [author("Douglas C.", "Engelbart")],
    dateModified: "2024-12-22 12:00:00",
    collectionIDs: [2],
  },
  ...DEMO_ITEMS,
];

/** How a seeded Citation Key resolves against the Items the build writes. */
export type SeededCitationKeyResolution = "unique" | "ambiguous" | "missing";

/**
 * The Citation Keys the seeded vault cites for its graph cases, with the
 * resolution each case rests on: one Item behind a Literature Note, several
 * behind an ambiguous key, none behind an unresolved key.
 * {@link assertSeededCitationKeys} holds the build to this map, so an Item
 * edit that retires a case stops the build instead of leaving a seeded page
 * that no longer shows what it names. Declare a key here as you seed a page
 * that cites it.
 */
export const SEEDED_CITATION_KEYS: Readonly<
  Record<string, SeededCitationKeyResolution>
> = {
  Hensher2011: "unique",
  ahrensHowTakeSmartNotes2017: "unique",
  bernersLeeSemanticWeb2001: "unique",
  bushAsWeMayThink1945: "unique",
  consortiumAlpha2020: "unique",
  duplicateAcross2019: "ambiguous",
  engelbartAugmentingHuman1962: "unique",
  forteBuildingSecondBrain2022: "unique",
  garfieldCitationIndexes1955: "unique",
  ioannidisWhyMost2005: "unique",
  labArchiveAlpha2021: "unique",
  luhmannCommunicatingSlipBoxes1981: "unique",
  matuschakTransformativeTools2019: "unique",
  nelsonComplexInformation1965: "unique",
  nonexistentCitekeyForSmokeTest2099: "missing",
  rougierTenSimpleRules2014: "unique",
  sharedReadingAlpha2023: "unique",
  smallCoCitationScientific1973: "unique",
  "wallgren-petterssonDistalMyopathyCaused2007": "unique",
  wangMutationalClinicalSpectrum2020a: "unique",
  wittNebulinRegulatesThin2006: "unique",
  xuNoCitationKeyProperty2019: "missing",
  yinClinicopathologicalFeaturesMutational2021: "unique",
};

function citationKeyResolution(
  items: readonly FixtureItem[],
  key: string,
): SeededCitationKeyResolution {
  const held = items.filter((item) => item.citationKey === key).length;
  if (held === 0) return "missing";
  return held === 1 ? "unique" : "ambiguous";
}

/** One message per seeded Citation Key that left its declared resolution. */
export function seededCitationKeyDrift(
  items: readonly FixtureItem[],
): readonly string[] {
  return Object.entries(SEEDED_CITATION_KEYS).flatMap(([key, declared]) => {
    const resolution = citationKeyResolution(items, key);
    return resolution === declared
      ? []
      : [
          `seeded Citation Key "${key}" resolves as ${resolution}, the Spec declares ${declared}`,
        ];
  });
}

/** Stops a build whose Items no longer carry the seeded citation cases. */
export function assertSeededCitationKeys(items: readonly FixtureItem[]): void {
  const drift = seededCitationKeyDrift(items);
  if (drift.length > 0) {
    throw new Error(drift.join("; "));
  }
}

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
    note: '<div class="zotero-note znv1"><div data-schema-version="9"><h1>Reading notes on the personal alpha</h1>\n<p><img data-attachment-key="SNAP2345" data-annotation="%7B%22attachmentURI%22%3A%22http%3A%2F%2Fzotero.org%2Fusers%2Flocal%2FLOCAL%2Fitems%2FRGRPDF24%22%2C%22annotationKey%22%3A%22FDRFQ7C2%22%7D"></p>\n<p><img data-attachment-key="SNAP3456" data-annotation="%7B%22attachmentURI%22%3A%22http%3A%2F%2Fzotero.org%2Fusers%2Flocal%2FLOCAL%2Fitems%2FRGRPDF24%22%2C%22annotationKey%22%3A%22TYY6Z6ZF%22%7D"></p>\n<p>Saved snapshot <img data-attachment-key="FRZN2345"></p>\n<p>A child note of an item filed in two collections.</p>\n</div></div>',
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
  | "excerpt-rendering/corrupt.pdf"
  | "excerpt-rendering/encrypted.pdf"
  | "excerpt-rendering/excerpt-rendering.pdf"
  | "external-annotation/external-annotation.pdf"
  | "ioannidis-2005/ioannidis-2005.pdf"
  | "pdf-parity/pdf-parity-layout.pdf"
  | "pdf-parity/pdf-parity-scanned.pdf"
  | "rougier-2014/rougier-2014.pdf"
  | "sakimas-song/sakimas-song.html"
  | "sakimas-song/sakimas-song.pdf";

/** One line-grouping branch of Zotero's PDF text-structuring algorithm. */
export type FixtureParityBranch =
  | "rotation"
  | "ligature"
  | "multi-column"
  | "no-text-layer";

/**
 * One PDF built for the Sort Index / Page Label parity test, asset-only: no
 * Zotero item, attachment, annotation, or collection backs it. The parity
 * test reads it straight from the asset directory, so it stays out of the
 * Fixture database and every count assertion that reads from there.
 */
export interface FixtureParityPdf {
  /** Committed asset path, under `assets/`. */
  readonly asset: FixtureAsset;
  /** Line-grouping branches this PDF is built to exercise. */
  readonly branches: readonly FixtureParityBranch[];
  /** SHA-256 of the committed bytes; `pdf-parity/NOTICE.md` records the same value. */
  readonly sha256: string;
}

/**
 * The two hand-generated parity PDFs (`pdf-parity/generate.ts`): one page
 * that drives Zotero's line-grouping algorithm through its rotation,
 * ligature, and multi-column branches, and one scanned page with no text
 * layer, whose only content is an image.
 */
export const PARITY_PDFS: readonly FixtureParityPdf[] = [
  {
    asset: "pdf-parity/pdf-parity-layout.pdf",
    branches: ["rotation", "ligature", "multi-column"],
    sha256: "3839ce157abd250ab19d57d18855e72a45eaf9a70bdd207981600ca48b67a4db",
  },
  {
    asset: "pdf-parity/pdf-parity-scanned.pdf",
    branches: ["no-text-layer"],
    sha256: "dac746f7dee4aaf961bb8a3764611d088264cbb25ea55314914940d1ffcbbf04",
  },
];

/** Stable vault directory for the excerpt-rendering acceptance inputs. */
export const EXCERPT_RENDERING_VAULT_DIR = "attachments/excerpt-acceptance";

export interface FixtureExcerptPdf {
  readonly asset: FixtureAsset;
  readonly outcome: "renderable" | "corrupt" | "password-required";
  readonly sha256: string;
}

/**
 * Small, generated PDFs for renderer acceptance. They are copied into the
 * Fixture Vault, but stay out of Zotero's database and Item count assertions.
 */
export const EXCERPT_RENDERING_PDFS: readonly FixtureExcerptPdf[] = [
  {
    asset: "excerpt-rendering/excerpt-rendering.pdf",
    outcome: "renderable",
    sha256: "cd292fc28f13fc469df6694c64a2e4a60d5ef2e02ce2c4beb4a43065285b415a",
  },
  {
    asset: "excerpt-rendering/corrupt.pdf",
    outcome: "corrupt",
    sha256: "48c92d5c280dfbd46680f7ec622426f4e8d90d2e1f5f7531c585a6f7ea09be67",
  },
  {
    asset: "excerpt-rendering/encrypted.pdf",
    outcome: "password-required",
    sha256: "875fe363708b463a04568096d2681870f17a22cdd5813f7ed2b7ac779ec66374",
  },
];

export interface FixtureExcerptCase {
  readonly id: string;
  readonly type: "image" | "ink";
  readonly pageIndex: number;
  readonly rect?: readonly [number, number, number, number];
  readonly width?: number;
  readonly paths?: readonly (readonly number[])[];
  readonly measureMemory?: boolean;
  /** Independent decoded-PNG oracles; sample coordinates are output pixels. */
  readonly expected: {
    readonly width: number;
    readonly height: number;
    readonly samples: readonly (readonly [
      number,
      number,
      number,
      number,
      number,
      number,
    ])[];
  };
}

/** Independent geometry cases consumed by desktop acceptance tests. */
export const EXCERPT_RENDERING_CASES: readonly FixtureExcerptCase[] = [
  {
    id: "crop-user-unit",
    type: "image",
    pageIndex: 0,
    rect: [70, 90, 190, 200],
    expected: {
      width: 960,
      height: 880,
      samples: [[480, 440, 255, 0, 0, 255]],
    },
  },
  {
    id: "rotate-90",
    type: "image",
    pageIndex: 1,
    rect: [250, 250, 440, 400],
    expected: {
      width: 600,
      height: 760,
      samples: [[300, 380, 0, 115, 230, 255]],
    },
  },
  {
    id: "rotate-180",
    type: "image",
    pageIndex: 2,
    rect: [70, 90, 190, 200],
    expected: {
      width: 480,
      height: 440,
      samples: [[240, 220, 255, 0, 0, 255]],
    },
  },
  {
    id: "rotate-270",
    type: "image",
    pageIndex: 3,
    rect: [250, 250, 440, 400],
    expected: {
      width: 600,
      height: 760,
      samples: [[300, 380, 0, 115, 230, 255]],
    },
  },
  {
    id: "cjk-native-form-optional-content",
    type: "image",
    pageIndex: 4,
    rect: [50, 350, 400, 740],
    expected: {
      width: 1400,
      height: 1560,
      samples: [
        [200, 192, 0, 0, 0, 255],
        [520, 192, 0, 0, 0, 255],
        [160, 800, 255, 128, 0, 255],
        [600, 800, 204, 0, 204, 255],
        [200, 1240, 26, 178, 76, 255],
      ],
    },
  },
  {
    id: "small-point-ink",
    type: "ink",
    pageIndex: 0,
    width: 1,
    paths: [[220, 180]],
    expected: {
      width: 480,
      height: 480,
      samples: [[240, 240, 255, 0, 0, 255]],
    },
  },
  {
    id: "large-multi-path-ink",
    type: "ink",
    pageIndex: 4,
    width: 18,
    paths: [
      [60, 80, 540, 700],
      [60, 700, 540, 80],
    ],
    expected: {
      width: 2072,
      height: 2632,
      samples: [[1036, 1316, 255, 0, 0, 255]],
    },
  },
  {
    id: "maximum-pixels",
    type: "image",
    pageIndex: 0,
    rect: [24, 36, 588, 756],
    measureMemory: true,
    expected: {
      width: 3625,
      height: 4627,
      samples: [[1774, 2930, 0, 115, 230, 255]],
    },
  },
  {
    id: "maximum-dimension",
    type: "image",
    pageIndex: 5,
    rect: [0, 0, 3000, 100],
    measureMemory: true,
    expected: {
      width: 8192,
      height: 273,
      samples: [[4096, 136, 38, 64, 191, 255]],
    },
  },
];

interface FixtureAttachmentBase {
  itemID: number;
  libraryID: number;
  /** Bare Zotero key for the Attachment row. */
  key: string;
  parentItemID: number;
  contentType: "application/pdf" | "image/png" | "text/html";
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
 * The demo papers' PDFs, linked from {@link DEMO_PAPERS_DIR} under the names
 * Zotero's default file renaming gives them.
 */
export const DEMO_ATTACHMENTS: readonly FixtureAttachment[] = [
  {
    itemID: 901,
    libraryID: 1,
    key: "DMRGRPDF",
    parentItemID: 900,
    linkMode: "linked_file",
    fileRoot: "vault",
    contentType: "application/pdf",
    title: "Full Text PDF",
    path: `${DEMO_PAPERS_DIR}/Rougier et al. - 2014 - Ten Simple Rules for Better Figures.pdf`,
    url: null,
    sourceAsset: "rougier-2014/rougier-2014.pdf",
    dateModified: "2024-11-20 09:00:00",
  },
  {
    itemID: 903,
    libraryID: 1,
    key: "DMIANPDF",
    parentItemID: 902,
    linkMode: "linked_file",
    fileRoot: "vault",
    contentType: "application/pdf",
    title: "Full Text PDF",
    path: `${DEMO_PAPERS_DIR}/Ioannidis - 2005 - Why Most Published Research Findings Are False.pdf`,
    url: null,
    sourceAsset: "ioannidis-2005/ioannidis-2005.pdf",
    dateModified: "2024-11-19 09:00:00",
  },
];

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
  {
    itemID: 63,
    libraryID: 1,
    key: "CNPDF26A",
    parentItemID: 60,
    linkMode: "imported_file",
    contentType: "application/pdf",
    title: "Research interfaces conference paper",
    path: "research-interfaces.pdf",
    url: null,
    sourceAsset: "rougier-2014/rougier-2014.pdf",
    dateModified: "2025-01-03 11:00:00",
  },
  {
    itemID: 80,
    libraryID: 1,
    key: "CNPVLT26",
    parentItemID: 60,
    linkMode: "linked_file",
    fileRoot: "vault",
    contentType: "application/pdf",
    title: "Research interfaces conference paper (linked copy)",
    path: "attachments/research-interfaces.pdf",
    url: null,
    sourceAsset: "rougier-2014/rougier-2014.pdf",
    dateModified: "2025-01-03 11:30:00",
  },
  {
    itemID: 82,
    libraryID: 1,
    key: "SNAP2345",
    parentItemID: 13,
    linkMode: "imported_file",
    contentType: "image/png",
    title: "Live image excerpt snapshot",
    path: "snapshot.png",
    url: null,
    sourceAsset: "rougier-2014/annotations/FDRFQ7C2.png",
    dateModified: "2025-02-28 12:00:00",
  },
  {
    itemID: 83,
    libraryID: 1,
    key: "SNAP3456",
    parentItemID: 13,
    linkMode: "imported_file",
    contentType: "image/png",
    title: "Live ink excerpt snapshot",
    path: "snapshot.png",
    url: null,
    sourceAsset: "rougier-2014/annotations/TYY6Z6ZF.png",
    dateModified: "2025-02-28 12:00:00",
  },
  {
    itemID: 84,
    libraryID: 1,
    key: "FRZN2345",
    parentItemID: 13,
    linkMode: "imported_file",
    contentType: "image/png",
    title: "Frozen excerpt snapshot",
    path: "snapshot.png",
    url: null,
    sourceAsset: "rougier-2014/annotations/4PE492KU.png",
    dateModified: "2025-02-28 12:00:00",
  },
  {
    // Its PDF embeds one highlight another PDF reader saved, and the Fixture
    // seeds no Annotation here. A Paired Zotero that opens the PDF imports
    // that highlight as an External Annotation, which Zotero keeps read-only.
    itemID: 85,
    libraryID: 1,
    key: "EXTPDF25",
    parentItemID: 57,
    linkMode: "linked_file",
    fileRoot: "vault",
    contentType: "application/pdf",
    title: "External annotation PDF",
    path: "attachments/external-annotation.pdf",
    url: null,
    sourceAsset: "external-annotation/external-annotation.pdf",
    dateModified: "2025-01-02 12:00:00",
  },
  ...DEMO_ATTACHMENTS,
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
  /** Manual (`0`) or automatic (`1`) Zotero tags on the Annotation. */
  tags?: readonly { name: string; type: 0 | 1 }[];
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

/**
 * A reader's Annotations on the demo papers, captured from a Zotero 10 reader
 * session: Zotero drew each one, so its position, text, Sort Index, and page
 * label are Zotero's own.
 */
export const DEMO_ANNOTATIONS: readonly FixtureAnnotation[] = [
  {
    itemID: 904,
    libraryID: 1,
    key: "F9AKNNK2",
    parentItemID: 901,
    type: 1,
    text: "Scientific visualization is classically defined as the process of graphically displaying scientific data.",
    comment:
      "The textbook definition. The authors argue that it is too narrow.",
    color: "#ffd400",
    tags: [{ name: "definition", type: 0 }],
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
    dateAdded: "2026-09-26 16:49:36",
    dateModified: "2026-09-26 16:54:17",
  },
  {
    itemID: 905,
    libraryID: 1,
    key: "NEIKLK9T",
    parentItemID: 901,
    type: 1,
    text: "A more accurate definition for scientific visualization would be a graphical interface between people and data.",
    comment: "Use this framing in the chapter intro.",
    color: "#5fb236",
    tags: [{ name: "framing", type: 0 }],
    pageLabel: "1",
    sortIndex: "00000|000765|00287",
    position: {
      pageIndex: 0,
      rects: [
        [180.792, 506.055, 211.469, 514.188],
        [58.054, 495.397, 211.481, 503.53],
        [58.054, 484.739, 211.471, 492.871],
        [58.054, 474.081, 158.205, 482.213],
      ],
    },
    cacheImageAsset: null,
    dateAdded: "2026-09-26 16:53:32",
    dateModified: "2026-09-26 16:54:17",
  },
  {
    itemID: 906,
    libraryID: 1,
    key: "B9SXMZEU",
    parentItemID: 901,
    type: 1,
    text: "Rule 1: Know Your Audience",
    comment: null,
    color: "#a28ae5",
    pageLabel: "1",
    sortIndex: "00000|001057|00398",
    position: { pageIndex: 0, rects: [[58.054, 383.41, 196.512, 392.226]] },
    cacheImageAsset: null,
    dateAdded: "2026-09-26 16:54:20",
    dateModified: "2026-09-26 16:54:20",
  },
  {
    itemID: 907,
    libraryID: 1,
    key: "YPM6GIAT",
    parentItemID: 901,
    type: 5,
    text: "problems arise when how a visual is perceived differs significantly from the intent of the conveyer.",
    comment: null,
    color: "#ff6666",
    tags: [{ name: "pitfall", type: 0 }],
    pageLabel: "1",
    sortIndex: "00000|001103|00416",
    position: {
      pageIndex: 0,
      rects: [
        [176.711, 366.477, 211.525, 374.61],
        [58.054, 355.819, 211.489, 363.951],
        [58.054, 345.161, 211.459, 353.293],
        [58.054, 334.503, 109.093, 342.635],
      ],
    },
    cacheImageAsset: null,
    dateAdded: "2026-09-26 16:54:25",
    dateModified: "2026-09-26 16:54:25",
  },
  {
    itemID: 908,
    libraryID: 1,
    key: "ADY8P65X",
    parentItemID: 901,
    type: 1,
    text: "If your figure is able to convey a striking message at first glance, chances are increased that your article will draw more attention from the community.",
    comment: "Check every figure in ch. 3 against this.",
    color: "#ffd400",
    tags: [{ name: "figure-design", type: 0 }],
    pageLabel: "1",
    sortIndex: "00000|002700|00389",
    position: {
      pageIndex: 0,
      rects: [
        [297.353, 414.04, 382.849, 422.172],
        [229.436, 403.438, 382.844, 411.57],
        [229.436, 392.836, 382.856, 400.969],
        [229.436, 382.234, 382.847, 390.367],
      ],
    },
    cacheImageAsset: null,
    dateAdded: "2026-09-26 16:54:29",
    dateModified: "2026-09-26 16:54:29",
  },
  {
    itemID: 909,
    libraryID: 1,
    key: "S8WTHP4F",
    parentItemID: 901,
    type: 1,
    text: "you should abandon the practice of extracting a figure from your article to be put, as is, in your oral presentation.",
    comment: "Guilty. Redraw the slides for the conference talk.",
    color: "#f19837",
    tags: [{ name: "talk", type: 0 }],
    pageLabel: "1",
    sortIndex: "00000|004039|00391",
    position: {
      pageIndex: 0,
      rects: [
        [400.763, 391.588, 554.215, 399.72],
        [400.763, 381.1, 554.177, 389.233],
        [400.763, 370.555, 543.451, 378.687],
      ],
    },
    cacheImageAsset: null,
    dateAdded: "2026-09-26 16:54:33",
    dateModified: "2026-09-26 16:54:33",
  },
  {
    itemID: 910,
    libraryID: 1,
    key: "AGSYQ9ZZ",
    parentItemID: 901,
    type: 2,
    text: null,
    comment: "Every caption must stand on its own. Ask Sam to read them cold.",
    color: "#ffd400",
    pageLabel: "1",
    sortIndex: "00000|004134|00427",
    position: { pageIndex: 0, rects: [[539.795, 341.215, 561.795, 363.215]] },
    cacheImageAsset: null,
    dateAdded: "2026-09-26 16:54:41",
    dateModified: "2026-09-26 16:54:41",
  },
  {
    itemID: 911,
    libraryID: 1,
    key: "TF3ZGRBV",
    parentItemID: 901,
    type: 5,
    text: "you cannot explain everything within the figure itself—a figure should be accompanied by a caption.",
    comment: null,
    color: "#2ea8e5",
    tags: [{ name: "figure-design", type: 0 }],
    pageLabel: "1",
    sortIndex: "00000|004245|00484",
    position: {
      pageIndex: 0,
      rects: [
        [485.118, 297.822, 554.194, 305.954],
        [400.762, 287.334, 554.179, 295.467],
        [400.762, 276.789, 536.536, 284.921],
      ],
    },
    cacheImageAsset: null,
    dateAdded: "2026-09-26 16:54:37",
    dateModified: "2026-09-26 16:54:37",
  },
  {
    itemID: 912,
    libraryID: 1,
    key: "2G7A4A3L",
    parentItemID: 901,
    type: 3,
    text: null,
    comment: "Figure 1: the same data, drawn for three audiences.",
    color: "#ffd400",
    tags: [{ name: "figure", type: 0 }],
    pageLabel: "2",
    sortIndex: "00001|001860|00047",
    position: { pageIndex: 1, rects: [[48.75, 395.509, 570, 743.723]] },
    // Zotero cached this capture byte-for-byte as FDRFQ7C2's: same page, same rectangle.
    cacheImageAsset: "rougier-2014/annotations/FDRFQ7C2.png",
    dateAdded: "2026-09-26 16:55:19",
    dateModified: "2026-09-26 16:55:20",
  },
  {
    itemID: 913,
    libraryID: 1,
    key: "N5HVBIDP",
    parentItemID: 903,
    type: 1,
    text: "the convenient, yet ill-founded strategy of claiming conclusive research findings solely on the basis of a single study assessed by formal statistical significance,",
    comment: null,
    color: "#ff6666",
    tags: [{ name: "p-values", type: 0 }],
    pageLabel: "696",
    sortIndex: "00000|000872|00265",
    position: {
      pageIndex: 0,
      rects: [
        [297.48, 530.696, 358.5, 539.192],
        [219, 519.696, 354.36, 528.192],
        [219, 508.696, 366.059, 517.192],
        [219, 497.697, 362.28, 506.193],
        [219, 486.697, 333.838, 495.193],
      ],
    },
    cacheImageAsset: null,
    dateAdded: "2026-09-26 16:57:22",
    dateModified: "2026-09-26 16:57:22",
  },
  {
    itemID: 914,
    libraryID: 1,
    key: "475YANAK",
    parentItemID: 903,
    type: 5,
    text: "the probability that a research finding is indeed true depends on the prior probability of it being true (before doing the study), the statistical power of the study, and the level of statistical significance",
    comment: "Three levers: prior, power, alpha.",
    color: "#5fb236",
    pageLabel: "696",
    sortIndex: "00000|001671|00608",
    position: {
      pageIndex: 0,
      rects: [
        [348.106, 221.421, 360.886, 229.917],
        [219.001, 210.421, 352.559, 218.917],
        [219.001, 199.421, 358.861, 207.917],
        [219.001, 188.421, 354.361, 196.917],
        [219.001, 177.422, 365.341, 185.918],
        [219.001, 166.422, 367.681, 174.918],
        [219.001, 155.423, 265.261, 163.919],
      ],
    },
    cacheImageAsset: null,
    dateAdded: "2026-09-26 16:57:26",
    dateModified: "2026-09-26 16:57:26",
  },
  {
    itemID: 915,
    libraryID: 1,
    key: "F4E7J5W5",
    parentItemID: 903,
    type: 1,
    text: "a research finding is less likely to be true when the studies conducted in a field are smaller; when effect sizes are smaller;",
    comment: "Both apply to the pilot cohort (n = 24). Say so in 3.2.",
    color: "#ffd400",
    tags: [{ name: "limitations", type: 0 }],
    pageLabel: "696",
    sortIndex: "00000|004269|00258",
    position: {
      pageIndex: 0,
      rects: [
        [132.603, 516.971, 199.428, 524.819],
        [45, 505.972, 192.275, 513.82],
        [45, 494.972, 186.221, 502.82],
        [45, 483.973, 130.303, 491.821],
      ],
    },
    cacheImageAsset: null,
    dateAdded: "2026-09-26 16:57:17",
    dateModified: "2026-09-26 16:57:18",
  },
];

/** Reviewed anchors for the committed Fixture documents. */
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
    tags: [{ name: "visualization", type: 0 }],
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
    tags: [{ name: "figure", type: 0 }],
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
    tags: [
      { name: "visualization", type: 0 },
      { name: "methodology", type: 0 },
    ],
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
    tags: [{ name: "figure", type: 0 }],
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
    tags: [{ name: "methodology", type: 0 }],
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
    itemID: 53,
    libraryID: 1,
    key: "Q8ZR4TDH",
    parentItemID: 47,
    type: 1,
    text: "There are so many different ways to represent the same data: scatter plots, linear plots, bar plots, and pie charts, to name just a few.",
    comment: null,
    color: "#e56eee",
    pageLabel: "1",
    sortIndex: "00000|000566|00223",
    position: {
      pageIndex: 0,
      rects: [
        [58.054, 570.005, 211.468, 578.137],
        [58.054, 559.347, 211.474, 567.479],
        [58.054, 548.688, 211.47, 556.821],
        [58.054, 538.03, 121.296, 546.163],
      ],
    },
    cacheImageAsset: null,
    dateAdded: "2026-08-23 16:19:52",
    dateModified: "2026-08-23 16:19:52",
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
  {
    itemID: 64,
    libraryID: 1,
    key: "CNPAN26A",
    parentItemID: 63,
    type: 1,
    text: "A reproducible interface makes its inputs and outputs inspectable.",
    comment: "Reviewed Fixture text; it contains no personal library data.",
    color: "#ffd400",
    pageLabel: "1",
    sortIndex: "00000|000001|00000",
    position: { pageIndex: 0, rects: [[58, 590, 375, 610]] },
    cacheImageAsset: null,
    dateAdded: "2025-01-03 11:30:00",
    dateModified: "2025-01-03 11:30:00",
  },
  {
    itemID: 81,
    libraryID: 1,
    key: "CNPVL26A",
    parentItemID: 80,
    type: 1,
    text: "A reproducible interface makes its inputs and outputs inspectable.",
    comment: null,
    color: "#ffd400",
    pageLabel: "1",
    sortIndex: "00000|000001|00000",
    position: { pageIndex: 0, rects: [[58, 590, 375, 610]] },
    cacheImageAsset: null,
    dateAdded: "2025-01-03 11:30:00",
    dateModified: "2025-01-03 11:30:00",
  },
  ...DEMO_ANNOTATIONS,
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
    id: BOOKS_PROFILE_ID,
    label: "Books",
    document: "zotlit-profile.books.md",
    bindings: {
      "note.literature-folder": "books",
      "citation.references-style": INSTALLED_STYLES[0]!.id,
    },
  },
] as const;

/**
 * The Fixture's Shared Partial. The Books Profile note body calls it, the
 * Profile import example bundles a different edition under this name, and
 * removing the file is what makes a Literature Note create refuse.
 */
export const FIXTURE_PARTIAL_NAME = "book-details";

/**
 * The Configured vault's `zotlit-citation.md`: the shipped Citation Template
 * default with one visible edit, so an inserted alternate citation reads as
 * the reader's own rather than the built-in text.
 */
export const CITATION_DOCUMENT_EDIT: FixtureTemplateEdit = {
  find: '{{ zt.citations | pandoc_cite: "prefer-author-in-text" }}',
  replace: 'cf. {{ zt.citations | pandoc_cite: "prefer-author-in-text" }}',
};

/** One Shared Partial the Fixture Vault holds, as its `zotlit-partial.<name>.md` file carries it. */
export interface FixtureSharedPartial {
  /** The partial's vault-global name, which a render call names. */
  readonly name: string;
  readonly language: "liquid" | "eta";
  /** The template source below the document's manifest. */
  readonly source: string;
}

/** Shared Partial documents placed in the Fixture template folder. */
export const SHARED_PARTIAL_DOCUMENTS: readonly FixtureSharedPartial[] = [
  {
    name: FIXTURE_PARTIAL_NAME,
    language: "liquid",
    source: `> [!info] Book details
> Type: {{ zt.itemType }}
> Citation key: {{ zt.citationKey | default: zt.key }}
`,
  },
];

/** Literature Note Template documents placed in the Fixture template folder. */
export const LITERATURE_NOTE_DOCUMENTS = [
  {
    filename: "zotlit-profile.books.md",
    source: `---
id: ${BOOKS_PROFILE_ID}
name: Books
folder: books
citationStyle: ${INSTALLED_STYLES[0]!.id}
version: 1.0.0
author: ZotLit
description: A visibly distinct book layout for the End-to-end Run
contract: ${CONTRACT_VERSION}
filename: 'books-{{ zt.citationKey | default: zt.key }}{% suffix %}'
match: 'itemType == "book"'
frontmatter:
  - key: fixture-title
    expr: zt.title
    merge: replace
  - key: fixture-kind
    value: {"$if":"zt.itemType == 'journalArticle'","then":"reference/article","else":"reference/other"}
    merge: replace
  - key: fixture-obsolete
    value: {"$if":"zt.itemType == 'bookSection'","then":"retained"}
    merge: replace
  - value: {"fixture-spread-title":{"$eval":"zt.title"},"fixture-spread-kind":{"$eval":"zt.itemType"}}
---
# Book profile: {{ zt.title }}

{% managed %}
## Book details

Citation key: {{ zt.citationKey }}

{% render "${FIXTURE_PARTIAL_NAME}" with zt as zt %}
{% endmanaged %}

--- zotlit:annotation ---
{% bq %}
[!quote] Fixture page {{ zt.pageLabel }}

{{ zt.text }}
{% endbq %}
`,
  },
] as const;

/** Id of the Demo Vault Case's Literature Note Profile, {@link DEMO_PROFILE_DOCUMENT}. */
const DEMO_PROFILE_ID = "Rd9QmT4kLw2P";

/**
 * The Demo Vault Case's one Literature Note Profile document. It has no
 * match, so the shipped default Profile still writes every new note. Its
 * properties show JSON-e rules next to an expression: `year` evaluates one
 * field, and one keyless rule chooses which properties a note gets: a book
 * gets `publisher`, any other item gets `journal`. A property with a key
 * writes only that key, so only a keyless rule can choose between names.
 */
export const DEMO_PROFILE_DOCUMENT = {
  filename: "zotlit-profile.reading.md",
  source: `---
id: ${DEMO_PROFILE_ID}
name: Reading notes
version: 1.0.0
author: ZotLit
description: Adds the year, and the publisher of a book or the journal of an article
contract: ${CONTRACT_VERSION}
filename: '{{ zt.citationKey | default: zt.key }}{% suffix %}'
frontmatter:
  - key: title
    expr: zt.title
    merge: replace
  - key: year
    value: {"$eval":"zt.date.year"}
    merge: replace
  - value: {"$if":"zt.itemType == 'book'","then":{"publisher":{"$eval":"zt.publisher"}},"else":{"journal":{"$eval":"zt.publicationTitle"}}}
---
# {{ zt.title }}

[Zotero]({{ zt.backlink }})

{% managed %}
{% if zt.annotations.size > 0 %}
## Annotations

{% for annotation in zt.annotations %}
{% render_annotation annotation %}
{% endfor %}
{% endif %}
{% endmanaged %}

--- zotlit:annotation ---
{% bq %}
[!note] Page {{ zt.pageLabel }}

{{ zt.text }}
{% endbq %}
`,
} as const;

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
      venue: "Stress Build Journal",
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

/** Fixture Spec Items in My Library, the floor of a one-Library Stress Build. */
export const STRESS_LIBRARY_MIN_ITEM_COUNT = ITEMS.filter(
  ({ libraryID }) => libraryID === USER_LIBRARY_ID,
).length;
export const STRESS_LIBRARY_ITEM_COUNT_CONSTRAINT = `a safe integer of at least ${STRESS_LIBRARY_MIN_ITEM_COUNT}`;
/** My Library sizes the Item Query performance tiers measure. */
export const STRESS_LIBRARY_TIERS = [10_000, 50_000, 100_000] as const;

/**
 * Query targets of a one-Library Stress Build. Every synthetic Item draws each
 * value from its index `i` in the corpus: rare values recur every 1,000 Items,
 * common values every 10, and dominant values cover more than a quarter of the
 * Library, so a selective and a non-selective query each have a target.
 */
export const STRESS_LIBRARY_VALUES = {
  tags: {
    /** `i % 1000 == 0`: 0.1% of the corpus. */
    rare: "stress-rare",
    /** `i % 10 == 5`: 10%. */
    common: "stress-common",
    /** `i % 5 < 3`: 60%. */
    dominant: "stress-dominant",
  },
  collections: {
    /** Top-level; files no Item directly, so its subtree is the other three. */
    root: { key: "STRESSRT", name: "Stress Build" },
    /** Under `root`; `i % 10 == 6`: 10%. */
    common: { key: "STRESSCM", name: "Common" },
    /** Under `common`; `i % 1000 == 1`: 0.1%. */
    rare: { key: "STRESSRR", name: "Rare" },
    /** Under `root`; `i % 5 >= 2`: 60%. */
    dominant: { key: "STRESSDM", name: "Dominant" },
  },
  itemTypes: {
    /** `i % 1000 == 2`, with Venue "Stress Build University". */
    rare: "thesis",
    /** `i % 10 == 7`, with Venue "Stress Build Press". */
    common: "book",
    /** Every other Item: about 90%. */
    dominant: "journalArticle",
  },
  /** `publicationTitle` of the journal articles. */
  venues: {
    /** `i % 1000 == 3`. */
    rare: "Stress Rare Journal",
    /** `i % 10 == 8`. */
    common: "Stress Common Journal",
    /** Every other journal article. */
    dominant: "Stress Dominant Journal",
  },
  /** Title of the Item at `i == floor(count / 2)`; every other title is unique too. */
  uniqueTitle: "Stress Build unique title",
} as const;

/** Data a one-Library Stress Build adds to the Fixture Spec. */
export interface StressLibraryCorpus {
  items: readonly FixtureItem[];
  collections: readonly FixtureCollection[];
}

const STRESS_LIBRARY_MODIFIED_EPOCH = Date.UTC(2020, 0, 1);

/**
 * Synthetic corpus that fills My Library to exactly `itemCount` Items, with
 * the distributions of {@link STRESS_LIBRARY_VALUES}.
 */
export function createStressLibraryCorpus(
  itemCount: number,
): StressLibraryCorpus {
  if (
    !Number.isSafeInteger(itemCount) ||
    itemCount < STRESS_LIBRARY_MIN_ITEM_COUNT
  ) {
    throw new Error(
      `stress Library item count must be ${STRESS_LIBRARY_ITEM_COUNT_CONSTRAINT}, got ${itemCount}`,
    );
  }
  const count = itemCount - STRESS_LIBRARY_MIN_ITEM_COUNT;
  const { tags, itemTypes, venues } = STRESS_LIBRARY_VALUES;

  const firstCollectionID =
    Math.max(...COLLECTIONS.map(({ collectionID }) => collectionID)) + 1;
  const [root, common, rare, dominant] = (
    ["root", "common", "rare", "dominant"] as const
  ).map((role, offset) => ({
    collectionID: firstCollectionID + offset,
    libraryID: USER_LIBRARY_ID,
    ...STRESS_LIBRARY_VALUES.collections[role],
  })) as [
    FixtureCollection,
    FixtureCollection,
    FixtureCollection,
    FixtureCollection,
  ];
  const collections: FixtureCollection[] = [
    root,
    { ...common, parentCollectionID: root.collectionID },
    { ...rare, parentCollectionID: common.collectionID },
    { ...dominant, parentCollectionID: root.collectionID },
  ];

  const firstItemID =
    Math.max(
      ...ITEMS.map(({ itemID }) => itemID),
      ...NOTES.map(({ itemID }) => itemID),
      ...ATTACHMENTS.map(({ itemID }) => itemID),
      ...ANNOTATIONS.map(({ itemID }) => itemID),
    ) + 1;
  const uniqueTitleIndex = Math.floor(count / 2);

  const items = Array.from({ length: count }, (_, i): FixtureItem => {
    const ordinal = i + 1;
    const itemType =
      i % 1000 === 2
        ? itemTypes.rare
        : i % 10 === 7
          ? itemTypes.common
          : itemTypes.dominant;
    const venue =
      itemType === "thesis"
        ? "Stress Build University"
        : itemType === "book"
          ? "Stress Build Press"
          : i % 1000 === 3
            ? venues.rare
            : i % 10 === 8
              ? venues.common
              : venues.dominant;
    const itemTags = [
      ...(i % 1000 === 0 ? [tags.rare] : []),
      ...(i % 10 === 5 ? [tags.common] : []),
      ...(i % 5 < 3 ? [tags.dominant] : []),
    ].map((name) => ({ name, type: 0 as const }));
    const collectionIDs = [
      ...(i % 10 === 6 ? [common.collectionID] : []),
      ...(i % 1000 === 1 ? [rare.collectionID] : []),
      ...(i % 5 >= 2 ? [dominant.collectionID] : []),
    ];
    // A multiplicative scramble by a prime keeps modification order apart
    // from key order, one second apart for each Item.
    const modifiedOffset = (i * 7919) % Math.max(count, 1);
    const dateModified = new Date(
      STRESS_LIBRARY_MODIFIED_EPOCH + modifiedOffset * 1000,
    )
      .toISOString()
      .replace("T", " ")
      .slice(0, 19);
    return {
      itemID: firstItemID + i,
      libraryID: USER_LIBRARY_ID,
      key: stressItemKey(STRESS_BUILD_SEED + i),
      itemType,
      citationKey: `stress${String(ordinal).padStart(7, "0")}`,
      title:
        i === uniqueTitleIndex
          ? STRESS_LIBRARY_VALUES.uniqueTitle
          : `Synthetic stress item ${ordinal}`,
      venue,
      date: String(2000 + (i % 25)),
      creators: [author("Stress", `Author ${ordinal}`)],
      tags: itemTags,
      dateModified,
      collectionIDs,
    };
  });
  return { items, collections };
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

/**
 * One find-and-replace against a shipped default, which stands in for a
 * reader's own customization.
 */
export interface FixtureTemplateEdit {
  /** Text present in the shipped default source; the build fails otherwise. */
  readonly find: string;
  /** Visible edit that stands in for a user's customization. */
  readonly replace: string;
}

/**
 * Shipped default one ejected Legacy Template File starts from: a Literature
 * Note slot's default file, or one 2.1.x citation branch.
 */
export type FixtureLegacyTemplateOrigin =
  | "filename"
  | "note"
  | "content"
  | "annotation"
  | "cite"
  | "cite2";

/**
 * The bare 2.1.x partial the Upgrader vault ejects. The one-pass conversion
 * renames it to `zotlit-partial.annotation-callout.md`.
 */
export const UPGRADER_LEGACY_PARTIAL_NAME = "annotation-callout";

/**
 * One 2.1.x Legacy Template File the Upgrader vault ejects. The file is
 * `zotlit-<name>.<language>.md` in the template folder, and its text is the
 * shipped default of the same name with the edit applied. The bare partial is
 * the exception: it has no default of its own, so it names the one it starts
 * from in `from`.
 */
export type FixtureLegacyTemplate = FixtureTemplateEdit & {
  /** The language the file is written in; it picks the extension. */
  readonly language: "liquid" | "eta";
} & (
    | { readonly name: FixtureLegacyTemplateOrigin }
    | {
        readonly name: typeof UPGRADER_LEGACY_PARTIAL_NAME;
        readonly from: FixtureLegacyTemplateOrigin;
      }
  );

export interface FixtureVaultCase {
  id: "configured" | "fresh" | "upgrader" | "demo";
  /** One line for the maintainer choosing a case. */
  summary: string;
  /** Core features for a capture scenario. */
  corePlugins?: Readonly<Record<string, boolean>>;
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
      "Current settings, the Books Profile, an edited Citation Template, the Shared Partial that Profile calls, Literature Notes (one stamped under the Books Profile), and Imported Notes. This is the default.",
  },
  {
    id: "fresh",
    summary:
      "Vault with no notes, ZotLit installed, and no settings file: the new-user path.",
  },
  {
    id: "upgrader",
    summary:
      "A ZotLit v2.1 vault: version-9 settings, an edited Managed Frontmatter list, and ejected Legacy Template Files with visible edits: the note slots, a mixed-language citation pair, and one bare partial.",
  },
  {
    id: "demo",
    corePlugins: { sync: false },
    summary:
      "A researcher's vault for screenshots and walkthroughs: the demo papers' PDFs, their Literature Notes, and the pages that cite them, with only the demo papers and their annotations, English Zotero UI, and Sync disabled.",
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

/** The Zotero rows one build writes. */
export interface FixtureZoteroData {
  libraries: readonly FixtureLibrary[];
  collections: readonly FixtureCollection[];
  items: readonly FixtureItem[];
  notes: readonly FixtureNote[];
  attachments: readonly FixtureAttachment[];
  annotations: readonly FixtureAnnotation[];
}

/** Select one complete data set, including the parents of every selected row. */
export function vaultCaseZoteroData(
  vaultCaseId: string,
  items: readonly FixtureItem[],
  collections: readonly FixtureCollection[] = COLLECTIONS,
): FixtureZoteroData {
  if (findVaultCase(vaultCaseId).id !== "demo") {
    return {
      items,
      libraries: LIBRARIES,
      collections,
      notes: NOTES,
      attachments: ATTACHMENTS,
      annotations: ANNOTATIONS,
    };
  }
  const selected = new Set(DEMO_ITEMS.map(({ itemID }) => itemID));
  const demoItems = items.filter(({ itemID }) => selected.has(itemID));
  const children = <T extends { itemID: number; parentItemID: number | null }>(
    rows: readonly T[],
  ): T[] =>
    rows.filter((row) => {
      if (row.parentItemID === null || !selected.has(row.parentItemID))
        return false;
      selected.add(row.itemID);
      return true;
    });
  const attachments = children(ATTACHMENTS);
  const notes = children(NOTES);
  const annotations = children(ANNOTATIONS);
  const collectionIDs = new Set(
    demoItems.flatMap((item) => item.collectionIDs),
  );
  for (const id of collectionIDs) {
    const parent = COLLECTIONS.find(
      (collection) => collection.collectionID === id,
    )?.parentCollectionID;
    if (parent != null) collectionIDs.add(parent);
  }
  const libraryIDs = new Set(demoItems.map((item) => item.libraryID));
  return {
    items: demoItems,
    attachments,
    notes,
    annotations,
    collections: COLLECTIONS.filter((collection) =>
      collectionIDs.has(collection.collectionID),
    ),
    libraries: LIBRARIES.filter((library) => libraryIDs.has(library.libraryID)),
  };
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
 * Legacy Template Files the Upgrader vault ejects into its template folder:
 * the four Literature Note slots, the two citation slots, and one bare
 * partial. Each starts from a shipped default and carries one visible edit, so
 * a converted document is recognizably the user's own and the trashed files
 * are easy to tell from the defaults.
 *
 * The pair is mixed-language on purpose: `cite` is Liquid and `cite2` is Eta,
 * so the fold takes the Liquid side and the conversion leaves the Eta file in
 * the vault and names it in its notice.
 */
export const UPGRADER_LEGACY_TEMPLATES: readonly FixtureLegacyTemplate[] = [
  {
    name: "filename",
    language: "liquid",
    find: "{{ zt.citationKey",
    replace: "lit-{{ zt.citationKey",
  },
  {
    name: "note",
    language: "liquid",
    find: "# {{ zt.title }}",
    replace: "# {{ zt.title }} (v2.1 template)",
  },
  {
    name: "content",
    language: "liquid",
    find: "## Notes",
    replace: "## Zotero notes",
  },
  {
    name: "annotation",
    language: "liquid",
    find: "[!note] Page",
    replace: "[!quote] Page",
  },
  {
    name: "cite",
    language: "liquid",
    find: "{{ zt.citations | pandoc_cite }}",
    replace: "({{ zt.citations | pandoc_cite }})",
  },
  {
    name: "cite2",
    language: "eta",
    find: "<%= pandocCite(",
    replace: "cf. <%= pandocCite(",
  },
  {
    name: UPGRADER_LEGACY_PARTIAL_NAME,
    language: "liquid",
    from: "annotation",
    find: "[!note] Page",
    replace: "[!tip] Page",
  },
];
