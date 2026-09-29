// The items every Directory Entry renders over: the Workbench Sample Items, and invented items of the types they lack.

import { SAMPLE_ANNOTATIONS, SAMPLE_ITEMS } from "@zotlit/workbench/render";
import type { AnnotationExample } from "@zotlit/workbench/render";
import type { ItemSnapshot } from "@zotlit/workbench/snapshot";

export interface DirectorySample {
  /** Stable name of the sample, which a property entry's `expected` keys use. */
  readonly id: string;
  /** The item type as a reader names it. */
  readonly label: string;
  readonly snapshot: ItemSnapshot;
}

type Creator =
  | { readonly given: string; readonly family: string; readonly role: string }
  | { readonly literal: string; readonly role: string };

type SampleDate =
  | { readonly year: number }
  | { readonly year: number; readonly month: number; readonly day: number };

interface DerivedItem {
  readonly id: string;
  readonly label: string;
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
    label: "Book chapter",
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
    label: "Letter",
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
    label: "Manuscript",
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
    label: "Interview",
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
    label: "Document",
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

const SAMPLE_ITEM_LABELS: Readonly<Record<string, string>> = {
  journalArticle: "Journal article",
  conferencePaper: "Conference paper",
  book: "Book",
  thesis: "Thesis",
};

/** The four Sample Items, then the derived items, in the order samples show. */
export const DIRECTORY_SAMPLES: readonly DirectorySample[] = [
  ...SAMPLE_ITEMS.map((snapshot) => ({
    id: snapshot.provenance.kind === "sample" ? snapshot.provenance.id : "",
    label: SAMPLE_ITEM_LABELS[snapshot.item.itemType]!,
    snapshot,
  })),
  // The book carries no annotations or attachments, so nothing of its own
  // leaks into an item of another type.
  ...DERIVED_ITEMS.map((item) => ({
    id: item.id,
    label: item.label,
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
    label: "Journal article with four authors",
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
    label: "Report whose title holds characters a file name cannot",
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
    label: "Web page with no author, date, or citation key",
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
    label: item.label,
    snapshot: derive(SAMPLE_ITEMS[2]!, item),
  }),
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
        annotations: [],
        attachments: [],
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
        ],
        temporalValues: [
          ...temporal,
          ...related.flatMap(({ temporalValues }) => temporalValues),
        ],
        graphReferences: [],
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
