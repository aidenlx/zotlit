// The items every Directory Entry renders over: the Workbench Sample Items, and invented items of the types they lack.

import { SAMPLE_ANNOTATIONS, SAMPLE_ITEMS } from "@zotlit/workbench/render";
import type { AnnotationExample } from "@zotlit/workbench/render";
import type { ItemSnapshot } from "@zotlit/workbench/snapshot";

import { EXAMPLE_ITEMS } from "./example-items.ts";

/**
 * How much of an item an example variant carries: every detail with an
 * abstract and an annotation set, few details, or the full details with no
 * annotations yet.
 */
export type VariantKind = "full-details" | "few-details" | "no-annotations";

export interface DirectorySample {
  /**
   * Stable name of the sample, which a property entry's `expected` keys use
   * and the site's messages name.
   */
  readonly id: string;
  readonly snapshot: ItemSnapshot;
  /** Set on an example variant, which an entry made for its item type shows. */
  readonly variant?: VariantKind;
}

type Creator =
  | { readonly given: string; readonly family: string; readonly role: string }
  | { readonly literal: string; readonly role: string };

type SampleDate =
  | { readonly year: number }
  | { readonly year: number; readonly month: number; readonly day: number };

export interface DerivedItem {
  readonly id: string;
  /** Eight characters, like a Zotero item key. */
  readonly key: string;
  readonly itemType: string;
  readonly title: string;
  /** Null for an item with no date. */
  readonly date: SampleDate | null;
  /** The raw Zotero date's user-facing half, after the ISO prefix. */
  readonly dateText: string;
  readonly primaryCreatorType: string;
  readonly creators: readonly Creator[];
  /** Null for an item with no citation key. */
  readonly citekey: string | null;
  readonly abstract?: string;
  readonly tags?: readonly string[];
  readonly extra?: string;
  /** Base fields and the item type's own fields, under their `zt` names. */
  readonly fields: Readonly<Record<string, string>>;
  /** The item's Zotero child notes, in the order Zotero added them. */
  readonly notes?: readonly { readonly key: string; readonly title: string }[];
  /** The Sample Items in the item's Related panel, by sample id. */
  readonly related?: readonly string[];
  /** The item's PDF, which its annotations belong to. */
  readonly pdf?: { readonly key: string; readonly filename: string };
  /** The item's annotations in page order, on its PDF. */
  readonly annotations?: readonly AnnotationSpec[];
}

/** A highlight or an image the reader made in an item's PDF. */
export interface AnnotationSpec {
  readonly type: "highlight" | "image";
  readonly page: number;
  readonly color: { readonly name: string; readonly hex: string };
  /** The highlighted text; null for an image. */
  readonly text: string | null;
  readonly comment: string | null;
  /** The file an image annotation is saved as. */
  readonly image?: string;
}

/** Root fields every item carries, null unless the item records them. */
const OPTIONAL_BASE_FIELDS = [
  "abstract",
  "containerTitle",
  "shortTitle",
  "DOI",
  "url",
  "ISBN",
  "ISSN",
  "volume",
  "issue",
  "pages",
  "publisher",
  "place",
  "edition",
  "language",
  "extra",
] as const;

/** The lists a related item leaves out, since the relation graph stops at depth 1. */
const UNRELATED_FIELDS = new Set([
  "annotations",
  "attachments",
  "relatedItems",
  "notes",
]);

/**
 * Invented items for the item types no Sample Item covers, so type-specific
 * entries render over the data they are made for. The book chapter is a real
 * publication; the archive items are fictional. Every string is plain data
 * the reader would see in Zotero.
 */
const DERIVED_ITEMS: readonly DerivedItem[] = [
  {
    id: "book-section",
    key: "TVKHEUR1",
    itemType: "bookSection",
    title: "Judgment under uncertainty: Heuristics and biases",
    date: { year: 1982 },
    dateText: "1982",
    primaryCreatorType: "author",
    creators: [
      { given: "Amos", family: "Tversky", role: "author" },
      { given: "Daniel", family: "Kahneman", role: "author" },
      { given: "Daniel", family: "Kahneman", role: "editor" },
      { given: "Paul", family: "Slovic", role: "editor" },
      { given: "Amos", family: "Tversky", role: "editor" },
    ],
    citekey: "tverskyJudgmentUncertaintyHeuristics1982",
    abstract:
      "People rely on a limited number of heuristic principles to assess probabilities and predict values.\n\nThe chapter describes three of them (representativeness, availability, and adjustment from an anchor) and the systematic errors each one causes.",
    tags: ["decision making", "heuristics"],
    extra: "original-date: 1974\ncover: judgment-under-uncertainty.jpg",
    fields: {
      publicationTitle: "Judgment under Uncertainty: Heuristics and Biases",
      containerTitle: "Judgment under Uncertainty: Heuristics and Biases",
      publisher: "Cambridge University Press",
      place: "Cambridge",
      pages: "3–20",
      ISBN: "978-0-521-28414-1",
      DOI: "10.1017/CBO9780511809477.002",
      language: "en",
    },
    notes: [
      { key: "TVKSUMM2", title: "Summary of the three heuristics" },
      { key: "TVKQUES3", title: "Questions for the decision-making seminar" },
    ],
    related: ["book"],
  },
  {
    id: "letter",
    key: "ALDLET87",
    itemType: "letter",
    title: "Letter to Eleanor Whitcombe",
    date: { year: 1887, month: 3, day: 14 },
    dateText: "14 March 1887",
    primaryCreatorType: "author",
    creators: [
      { given: "Henry", family: "Aldous", role: "author" },
      { given: "Eleanor", family: "Whitcombe", role: "recipient" },
    ],
    citekey: "aldousLetterEleanorWhitcombe1887",
    abstract:
      "Aldous describes the spring flood at the mill and asks Whitcombe for news of the estate survey.",
    tags: ["correspondence"],
    fields: {
      type: "Letter",
      archive: "Brackenridge County Record Office",
      archiveLocation: "Aldous papers, box 3, folder 12",
      language: "en",
    },
  },
  {
    id: "manuscript",
    key: "ALDMSS85",
    itemType: "manuscript",
    title: "Survey notebook of the Brackenridge estate",
    date: { year: 1885 },
    dateText: "1885",
    primaryCreatorType: "author",
    creators: [{ given: "Henry", family: "Aldous", role: "author" }],
    citekey: "aldousSurveyNotebookBrackenridge1885",
    fields: {
      type: "Notebook",
      place: "Brackenridge",
      numPages: "96",
      archive: "Brackenridge County Record Office",
      archiveLocation: "Aldous papers, box 1, item 4",
    },
  },
  {
    id: "interview",
    key: "OKAFOH19",
    itemType: "interview",
    title: "Oral history interview with Ada Okafor",
    date: { year: 2019, month: 11, day: 2 },
    dateText: "2 November 2019",
    primaryCreatorType: "interviewee",
    creators: [
      { given: "Ada", family: "Okafor", role: "interviewee" },
      { given: "Samuel", family: "Reyes", role: "interviewer" },
    ],
    citekey: "okaforOralHistoryInterview2019",
    abstract:
      "Okafor recalls the founding of the Riverside tenants' association and the 1978 rent strike.",
    fields: {
      medium: "Audio recording",
      archive: "Riverside Community Archive",
      archiveLocation: "OH-2019-014",
      url: "https://archive.example.org/oral-histories/oh-2019-014",
      language: "en",
    },
  },
  {
    id: "document",
    key: "BFLMIN23",
    itemType: "document",
    title: "Minutes of the Board of Trustees, 12 March 1923",
    date: { year: 1923, month: 3, day: 12 },
    dateText: "12 March 1923",
    primaryCreatorType: "author",
    creators: [{ literal: "Brackenridge Free Library", role: "author" }],
    citekey: "brackenridgefreelibraryMinutesBoardTrustees1923",
    fields: {
      publisher: "Brackenridge Free Library",
      archive: "Brackenridge Free Library archives",
      archiveLocation: "Board minutes, vol. 7",
    },
  },
];

/** The four Sample Items, then the derived items, in the order samples show. */
export const DIRECTORY_SAMPLES: readonly DirectorySample[] = [
  ...SAMPLE_ITEMS.map((snapshot) => ({
    id: snapshot.provenance.kind === "sample" ? snapshot.provenance.id : "",
    snapshot,
  })),
  // The book carries no annotations or attachments, so nothing of its own
  // leaks into an item of another type.
  ...DERIVED_ITEMS.map((item) => ({
    id: item.id,
    snapshot: derive(SAMPLE_ITEMS[2]!, item),
  })),
];

/**
 * Items at the edges a note name or a citation must handle, which no
 * Directory Sample reaches: more than two authors, a title that holds every
 * character a file name cannot, and an item with no author, date, or citation
 * key. Citation text and note-name entries render over these too. The
 * many-author article is a real publication, listed with its first four
 * authors; the other two items are invented.
 */
const EDGE_ITEMS: readonly DerivedItem[] = [
  {
    id: "many-authors",
    key: "KLNMLB14",
    itemType: "journalArticle",
    title:
      'Investigating variation in replicability: A "many labs" replication project',
    date: { year: 2014 },
    dateText: "2014",
    primaryCreatorType: "author",
    creators: [
      { given: "Richard A.", family: "Klein", role: "author" },
      { given: "Kate A.", family: "Ratliff", role: "author" },
      { given: "Michelangelo", family: "Vianello", role: "author" },
      { given: "Reginald B.", family: "Adams", role: "author" },
    ],
    citekey: "kleinInvestigatingVariationReplicability2014",
    fields: {
      publicationTitle: "Social Psychology",
      containerTitle: "Social Psychology",
      volume: "45",
      issue: "3",
      pages: "142–152",
      DOI: "10.1027/1864-9335/a000178",
      language: "en",
    },
  },
  {
    id: "unsafe-title",
    key: "LEEIOR21",
    itemType: "report",
    title:
      'Input/output: Is "fair" <always> fair? A #review of R^2 * [draft] | part 1 \\ 2',
    date: { year: 2021 },
    dateText: "2021",
    primaryCreatorType: "author",
    creators: [{ given: "Min-jun", family: "Lee", role: "author" }],
    citekey: "leeInputOutputFair2021",
    fields: { publisher: "Brackenridge University", language: "en" },
  },
  {
    id: "no-author-date-or-citekey",
    key: "WEBFAQ24",
    itemType: "webpage",
    title: "Open access: Frequently asked questions",
    date: null,
    dateText: "",
    primaryCreatorType: "author",
    creators: [],
    citekey: null,
    fields: {
      publicationTitle: "Brackenridge University Library",
      containerTitle: "Brackenridge University Library",
      url: "https://library.example.edu/open-access/faq",
      language: "en",
    },
  },
];

export const EDGE_SAMPLES: readonly DirectorySample[] = EDGE_ITEMS.map(
  (item) => ({
    id: item.id,
    snapshot: derive(SAMPLE_ITEMS[2]!, item),
  }),
);

/**
 * Items that fill the fields a type-specific entry reads and no Directory
 * Sample holds: a thesis with its university and thesis type, a book with its
 * place and edition, a newspaper article, and a journal article with its
 * volume, issue, and pages. An entry renders over each one
 * whose item type it is made for. The thesis and the book are real
 * publications; the newspaper article is invented, from the town of the
 * archive items.
 */
const TYPE_ITEMS: readonly DerivedItem[] = [
  {
    id: "thesis-with-university",
    key: "NASHNC50",
    itemType: "thesis",
    title: "Non-cooperative games",
    date: { year: 1950 },
    dateText: "1950",
    primaryCreatorType: "author",
    creators: [{ given: "John F.", family: "Nash", role: "author" }],
    citekey: "nashNoncooperativeGames1950",
    fields: {
      type: "PhD thesis",
      publisher: "Princeton University",
      place: "Princeton, NJ",
      numPages: "27",
      language: "en",
    },
  },
  {
    id: "book-with-edition",
    key: "BOOTCR16",
    itemType: "book",
    title: "The craft of research",
    date: { year: 2016 },
    dateText: "2016",
    primaryCreatorType: "author",
    creators: [
      { given: "Wayne C.", family: "Booth", role: "author" },
      { given: "Gregory G.", family: "Colomb", role: "author" },
      { given: "Joseph M.", family: "Williams", role: "author" },
      { given: "Joseph", family: "Bizup", role: "author" },
      { given: "William T.", family: "FitzGerald", role: "author" },
    ],
    citekey: "boothCraftResearch2016",
    fields: {
      publisher: "University of Chicago Press",
      place: "Chicago",
      edition: "4",
      ISBN: "978-0-226-23973-6",
      language: "en",
    },
  },
  {
    id: "newspaper-article",
    key: "BGZFLD87",
    itemType: "newspaperArticle",
    title: "The flood at Aldous's mill",
    date: { year: 1887, month: 3, day: 18 },
    dateText: "18 March 1887",
    primaryCreatorType: "author",
    creators: [],
    citekey: "floodAldousMill1887",
    abstract:
      "A report of the spring flood that stopped the Aldous mill for nine days.",
    fields: {
      publicationTitle: "Brackenridge Gazette",
      containerTitle: "Brackenridge Gazette",
      place: "Brackenridge",
      section: "Local news",
      pages: "3",
      archive: "Brackenridge County Record Office",
      archiveLocation: "Newspaper collection, reel 14",
      language: "en",
    },
  },
  {
    ...EXAMPLE_ITEMS[0]!.full,
    id: "journal-article-with-volume",
    pdf: undefined,
    annotations: undefined,
  },
];

const TYPE_SAMPLES: readonly DirectorySample[] = TYPE_ITEMS.map((item) => ({
  id: item.id,
  snapshot: derive(SAMPLE_ITEMS[2]!, item),
}));

/** The type examples of the item types an entry is made for, in the order samples show. */
export function typeSamples(
  itemTypes: readonly string[],
): readonly DirectorySample[] {
  return TYPE_SAMPLES.filter(({ snapshot }) =>
    itemTypes.includes(snapshot.item.itemType),
  );
}

/**
 * The example variants of each item type an entry can be made for, in the
 * order of `EXAMPLE_ITEMS`: every detail with an abstract and annotations,
 * few details, and the full item with no PDF or annotations, a note nobody
 * has read yet. Each variant is defined once and shared by every entry made
 * for its item type.
 */
export const EXAMPLE_VARIANTS: readonly DirectorySample[] =
  EXAMPLE_ITEMS.flatMap(({ slug, full, few }) =>
    (
      [
        ["full-details", full],
        ["few-details", few],
        [
          "no-annotations",
          {
            ...full,
            id: `${slug}-no-annotations`,
            pdf: undefined,
            annotations: undefined,
          },
        ],
      ] as const
    ).map(([variant, item]) => ({
      id: item.id,
      variant,
      snapshot: derive(SAMPLE_ITEMS[2]!, item),
    })),
  );

/**
 * Every Zotero annotation color under its contract name but yellow, which the
 * first Sample Annotation shows, then a color outside every palette, which
 * Zotero names no color.
 */
const HIGHLIGHT_COLORS: readonly { hex: string; name: string | null }[] = [
  { hex: "#ff6666", name: "red" },
  { hex: "#5fb236", name: "green" },
  { hex: "#2ea8e5", name: "blue" },
  { hex: "#a28ae5", name: "purple" },
  { hex: "#e56eee", name: "magenta" },
  { hex: "#f19837", name: "orange" },
  { hex: "#aaaaaa", name: "gray" },
  { hex: "#a6507b", name: "plum" },
  { hex: "#1f8a70", name: null },
];

/**
 * Every Zotero color a highlight example shows, by its contract name and hex,
 * in the order of Zotero's color menu.
 */
export const ZOTERO_COLORS: readonly { name: string; hex: string }[] = [
  { name: "yellow", hex: "#ffd400" },
  ...HIGHLIGHT_COLORS.flatMap(({ hex, name }) =>
    name === null ? [] : [{ name, hex }],
  ),
];

/**
 * The yellow Sample Annotation's highlight in every other Zotero color and a
 * custom color, without its comment and tags, for entries that show highlight
 * colors.
 */
export const COLOR_HIGHLIGHTS: readonly AnnotationExample[] =
  HIGHLIGHT_COLORS.map(({ hex, name }, index) => {
    const base = SAMPLE_ANNOTATIONS[0]!;
    const key = `HLCOLR${String(index + 1).padStart(2, "0")}`;
    return {
      id: `color:${name ?? hex}`,
      revision: `derived:color:${hex}`,
      root: {
        ...base.root,
        key,
        indexedKey: key,
        colorHex: hex,
        colorName: name,
        comment: null,
        commentHtml: null,
        tags: [],
        backlink: `zotero://open/library/items/CNPDF26A?annotation=${key}&page=${String(base.root.page)}`,
      },
      descriptors: {
        ...base.descriptors,
        stringCoercions: base.descriptors.stringCoercions.filter(
          ({ path }) => path[0] !== "tags",
        ),
      },
    };
  });

/**
 * The conference paper with the Sample Annotations and the color highlights as
 * its annotations, in page order, for entries that group annotations by color.
 */
export const EVERY_COLOR_SAMPLE: DirectorySample = everyColorSample(
  SAMPLE_ITEMS[1]!,
  [SAMPLE_ANNOTATIONS[0]!, ...COLOR_HIGHLIGHTS, ...SAMPLE_ANNOTATIONS.slice(1)],
);

/**
 * Put annotation examples into an item's note root, each as the note lists
 * its annotations: no `citation`, and `parentItem` pointing back at the item.
 */
function everyColorSample(
  base: ItemSnapshot,
  examples: readonly AnnotationExample[],
): DirectorySample {
  const own = base.descriptors.note;
  const outsideAnnotations = <T extends { path: readonly unknown[] }>(
    entries: readonly T[],
  ) => entries.filter(({ path }) => path[0] !== "annotations");
  const nested = <T extends { path: readonly (string | number)[] }>(
    entries: readonly T[],
    index: number,
  ) =>
    entries.flatMap((entry) =>
      entry.path[0] === "parentItem"
        ? []
        : [{ ...entry, path: ["annotations", index, ...entry.path] }],
    );
  const annotations = examples.map(({ root }) => {
    const { citation: _citation, ...annotation } = root;
    return { ...annotation, parentItem: { $ref: "zt" } };
  });
  return {
    id: "every-color",
    snapshot: {
      ...base,
      revision: "derived:every-color",
      provenance: {
        kind: "sample",
        id: "every-color",
        source: "template-directory",
      },
      roots: { ...base.roots, note: { ...base.roots.note, annotations } },
      descriptors: {
        ...base.descriptors,
        note: {
          stringCoercions: [
            ...outsideAnnotations(own.stringCoercions),
            ...examples.flatMap(({ descriptors }, index) =>
              nested(descriptors.stringCoercions, index),
            ),
          ],
          temporalValues: [
            ...outsideAnnotations(own.temporalValues),
            ...examples.flatMap(({ descriptors }, index) =>
              nested(descriptors.temporalValues, index),
            ),
          ],
          graphReferences: [
            ...outsideAnnotations(own.graphReferences),
            ...examples.map((_example, index) => ({
              path: ["annotations", index, "parentItem"],
              target: [],
            })),
          ],
        },
      },
    },
  };
}

/**
 * The yellow Sample Annotation's highlight in orange, with a comment that
 * starts with "todo" and no tags, for entries that turn such comments into
 * tasks.
 */
export const TODO_HIGHLIGHT: AnnotationExample = (() => {
  const base = SAMPLE_ANNOTATIONS[0]!;
  const key = "TODOHL01";
  const comment = "todo Check the sample size before citing this result.";
  return {
    id: "todo:highlight",
    revision: "derived:todo:highlight",
    root: {
      ...base.root,
      key,
      indexedKey: key,
      colorHex: "#f19837",
      colorName: "orange",
      comment,
      commentHtml: comment,
      tags: [],
      backlink: `zotero://open/library/items/CNPDF26A?annotation=${key}&page=${String(base.root.page)}`,
    },
    descriptors: {
      ...base.descriptors,
      stringCoercions: base.descriptors.stringCoercions.filter(
        ({ path }) => path[0] !== "tags",
      ),
    },
  };
})();

/**
 * Build an item of another type on a Sample Item's shape, so it carries every
 * root field the contract requires and the descriptors a render restores.
 */
function derive(base: ItemSnapshot, item: DerivedItem): ItemSnapshot {
  const creators = item.creators.map((creator) =>
    "literal" in creator
      ? {
          family: "",
          given: "",
          literal: creator.literal,
          role: creator.role,
          fullName: creator.literal,
        }
      : {
          family: creator.family,
          given: creator.given,
          literal: null,
          role: creator.role,
          fullName: `${creator.given} ${creator.family}`,
        },
  );
  const authors = creators.filter(
    ({ role }) => role === item.primaryCreatorType,
  );
  const tags = (item.tags ?? []).map((name) => ({ name, type: "manual" }));
  const extra = item.extra === undefined ? null : parseExtra(item.extra);
  const date =
    item.date === null
      ? null
      : "month" in item.date
        ? {
            kind: "date",
            value: isoDate(item.date),
            year: item.date.year,
            month: item.date.month,
            day: item.date.day,
            raw: `${isoDate(item.date)} ${item.dateText}`,
          }
        : {
            kind: "year",
            value: null,
            year: item.date.year,
            month: null,
            day: null,
            raw: `${item.date.year}-00-00 ${item.dateText}`,
          };
  const fields = {
    ...Object.fromEntries(OPTIONAL_BASE_FIELDS.map((name) => [name, null])),
    ...item.fields,
    title: item.title,
    date,
    citationKey: item.citekey,
    citekey: item.citekey,
    abstract: item.abstract ?? null,
    ...(item.abstract === undefined ? {} : { abstractNote: item.abstract }),
    key: item.key,
    indexedKey: item.key,
    itemType: item.itemType,
    creators,
    authors,
    authorsShort: authorsShort(authors),
    primaryCreatorType: item.primaryCreatorType,
    tags,
    extra,
  };
  const coercions = [
    ...(date === null
      ? []
      : [{ path: ["date"], value: date.value ?? String(date.year) }]),
    ...creators.map(({ fullName }, index) => ({
      path: ["creators", index],
      value: fullName,
    })),
    ...authors.map(({ fullName }, index) => ({
      path: ["authors", index],
      value: fullName,
    })),
    ...tags.map(({ name }, index) => ({ path: ["tags", index], value: name })),
    ...(extra === null
      ? []
      : [
          { path: ["extra"], value: extra.raw },
          ...extra.lines.map(({ raw }, index) => ({
            path: ["extra", "lines", index],
            value: raw,
          })),
        ]),
  ];
  const temporal = [
    ...base.descriptors.filename.temporalValues,
    ...(date === null || date.value === null
      ? []
      : [{ path: ["date", "value"], type: "Temporal.PlainDate" as const }]),
  ];
  const notes = (item.notes ?? []).map(childNote);
  const related = (item.related ?? []).map(relatedItem);
  const pdf = item.pdf === undefined ? null : attachment(item.pdf);
  const annotations = (item.annotations ?? []).map((spec, index) =>
    annotation(item, spec, index),
  );
  return {
    ...base,
    revision: `derived:${item.id}`,
    item: {
      key: item.key,
      indexedKey: item.key,
      itemType: item.itemType,
      title: item.title,
      library: base.item.library,
    },
    provenance: { kind: "sample", id: item.id, source: "template-directory" },
    roots: {
      note: {
        ...base.roots.note,
        ...fields,
        backlink: `zotero://select/library/items/${item.key}`,
        annotations: annotations.map(({ root }) => root),
        attachments: pdf === null ? [] : [pdf],
        collections: [],
        notes,
        relatedItems: related.map(({ root }) => root),
      },
      filename: { ...base.roots.filename, ...fields, collections: [] },
      annotations: [],
    },
    descriptors: {
      note: {
        stringCoercions: [
          { path: [], value: item.title },
          ...coercions,
          ...notes.map(({ title }, index) => ({
            path: ["notes", index],
            value: title,
          })),
          ...related.flatMap(({ stringCoercions }) => stringCoercions),
          ...(item.pdf === undefined
            ? []
            : [{ path: ["attachments", 0], value: item.pdf.filename }]),
          ...annotations.flatMap(({ stringCoercions }) => stringCoercions),
        ],
        temporalValues: [
          ...temporal,
          ...related.flatMap(({ temporalValues }) => temporalValues),
          ...annotations.flatMap(({ temporalValues }) => temporalValues),
        ],
        graphReferences: annotations.flatMap(
          ({ graphReferences }) => graphReferences,
        ),
      },
      filename: {
        stringCoercions: coercions,
        temporalValues: temporal,
        graphReferences: [],
      },
      annotations: [],
    },
    unavailable: [],
  };
}

/** A PDF as the note root lists an item's attachments. */
function attachment({ key, filename }: { key: string; filename: string }) {
  return {
    key,
    indexedKey: key,
    filename,
    contentType: "application/pdf",
    linkMode: "imported_file",
    backlink: `zotero://open/library/items/${key}`,
    filePath: null,
    fileLink: linkValue("fileLink", `[[${filename}]]`),
  };
}

function linkValue(helper: string, value: string) {
  return {
    $helper: helper,
    signature:
      helper === "imgLink"
        ? "(alias?: string, subpath?: string) => string"
        : "(alias?: string, subpath?: string) => string | null",
    value,
  };
}

/**
 * One annotation as the note root lists it, with the descriptors that restore
 * it, at `index` in the item's annotation list. It is built on the yellow
 * Sample Annotation's shape, so it carries every field the contract requires.
 */
function annotation(item: DerivedItem, spec: AnnotationSpec, index: number) {
  const {
    citation: _citation,
    parentItem: _parentItem,
    ...base
  } = SAMPLE_ANNOTATIONS[0]!.root;
  const pdf = item.pdf!;
  const key = `${item.key.slice(0, 4)}AN${String(index + 1).padStart(2, "0")}`;
  const at = (...path: (string | number)[]) => ["annotations", index, ...path];
  return {
    root: {
      ...base,
      key,
      indexedKey: key,
      type: spec.type,
      text: spec.text,
      comment: spec.comment,
      commentHtml: spec.comment,
      colorHex: spec.color.hex,
      colorName: spec.color.name,
      pageLabel: String(spec.page),
      page: spec.page,
      tags: [],
      imgLink:
        spec.image === undefined
          ? null
          : linkValue("imgLink", `[[${spec.image}]]`),
      fileLink: linkValue("fileLink", `[[${pdf.filename}#page=${spec.page}]]`),
      backlink: `zotero://open/library/items/${pdf.key}?annotation=${key}&page=${spec.page}`,
      parentItem: { $ref: "zt" },
      parentAttachment: attachment(pdf),
    },
    stringCoercions: [
      { path: at(), value: spec.text ?? spec.comment ?? spec.type },
      { path: at("parentAttachment"), value: pdf.filename },
    ],
    temporalValues: [
      { path: at("dateAdded"), type: "Temporal.Instant" as const },
      { path: at("dateModified"), type: "Temporal.Instant" as const },
    ],
    graphReferences: [{ path: at("parentItem"), target: [] }],
  };
}

/** A Zotero child note as the note root lists it: a link to its imported note. */
function childNote({ key, title }: { key: string; title: string }) {
  return {
    key,
    indexedKey: key,
    title,
    noteLink: {
      $helper: "noteLink",
      signature: "(alias?: string, subpath?: string) => string",
      value: `[[${title}]]`,
    },
  };
}

/**
 * A Sample Item as the Related panel of the item at `index` lists it, linked
 * to the literature note its citation key names, with the descriptors that
 * restore it moved under `relatedItems`.
 */
function relatedItem(id: string, index: number) {
  const { roots, descriptors } = SAMPLE_ITEMS.find(
    ({ provenance }) => provenance.kind === "sample" && provenance.id === id,
  )!;
  const citekey = String(roots.note.citekey);
  const kept = ({ path }: { path: readonly (string | number)[] }) =>
    !UNRELATED_FIELDS.has(String(path[0]));
  const moved = <T extends { path: readonly (string | number)[] }>(
    descriptor: T,
  ): T => ({
    ...descriptor,
    path: ["relatedItems", index, ...descriptor.path],
  });
  return {
    root: {
      ...Object.fromEntries(
        Object.entries(roots.note).filter(
          ([name]) => !UNRELATED_FIELDS.has(name),
        ),
      ),
      notePath: `${citekey}.md`,
      noteLink: {
        $helper: "noteLink",
        signature: "(alias?: string, subpath?: string) => string | null",
        value: `[[${citekey}]]`,
      },
    },
    stringCoercions: descriptors.note.stringCoercions.filter(kept).map(moved),
    temporalValues: descriptors.note.temporalValues.filter(kept).map(moved),
  };
}

function isoDate({
  year,
  month,
  day,
}: {
  year: number;
  month: number;
  day: number;
}): string {
  return [
    String(year).padStart(4, "0"),
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0"),
  ].join("-");
}

/** Zotero's Author Summary: one name, two joined by "&", or the first with "et al.". */
function authorsShort(
  authors: readonly { family: string; literal: string | null }[],
): string {
  const names = authors.map(({ family, literal }) => literal ?? family);
  if (names.length <= 2) return names.join(" & ");
  return `${names[0]} et al.`;
}

/** The Extra field as the contract parses it: one `key: value` pair per line. */
function parseExtra(raw: string) {
  const lines = raw.split("\n").map((line) => {
    const separator = line.indexOf(":");
    return {
      raw: line,
      key: line.slice(0, separator).trim(),
      value: line.slice(separator + 1).trim(),
    };
  });
  return {
    raw,
    fields: Object.fromEntries(lines.map(({ key, value }) => [key, value])),
    lines,
  };
}
