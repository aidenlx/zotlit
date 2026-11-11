// The research data every landing replica shows: the five papers of the docs
// Fixture's test vault, with their real metadata, the collection
// "Reproducibility", the draft "Chapter 3 - Presenting the results", and the
// reader's highlights on Sandve et al. 2013.
// Source: packages/scripts/lib/fixture/spec.ts (`DOCS_ITEMS`, `DEMO_ITEMS`,
// `DOCS_ANNOTATIONS`) on the docs walks branch.

import { m } from "@/paraglide/messages.js";

export interface Paper {
  citekey: string;
  title: string;
  /** Family names, in order. */
  authors: readonly string[];
  year: number;
  venue: string;
  /** Volume, issue and pages as the reference list prints them. */
  locator: string;
  pdf: boolean;
  annotated: boolean;
  note: boolean;
}

export const PAPERS: readonly Paper[] = [
  {
    citekey: "sandve2013",
    title: "Ten Simple Rules for Reproducible Computational Research",
    authors: ["Sandve", "Nekrutenko", "Taylor", "Hovig"],
    year: 2013,
    venue: "PLOS Computational Biology",
    locator: "9 (10): e1003285",
    pdf: true,
    annotated: true,
    note: true,
  },
  {
    citekey: "wilson2014",
    title: "Best Practices for Scientific Computing",
    authors: [
      "Wilson",
      "Aruliah",
      "Brown",
      "Chue Hong",
      "Davis",
      "Guy",
      "Haddock",
      "Huff",
      "Mitchell",
      "Plumbley",
      "Waugh",
      "White",
      "Wilson",
    ],
    year: 2014,
    venue: "PLOS Biology",
    locator: "12 (1): e1001745",
    pdf: true,
    annotated: false,
    note: false,
  },
  {
    citekey: "rougier2014",
    title: "Ten Simple Rules for Better Figures",
    authors: ["Rougier", "Droettboom", "Bourne"],
    year: 2014,
    venue: "PLOS Computational Biology",
    locator: "10 (9): e1003833",
    pdf: true,
    annotated: false,
    note: false,
  },
  {
    citekey: "ioannidis2005",
    title: "Why Most Published Research Findings Are False",
    authors: ["Ioannidis"],
    year: 2005,
    venue: "PLoS Medicine",
    locator: "2 (8): e124",
    pdf: true,
    annotated: false,
    note: true,
  },
  {
    citekey: "munafo2017",
    title: "A manifesto for reproducible science",
    authors: [
      "Munafò",
      "Nosek",
      "Bishop",
      "Button",
      "Chambers",
      "Percie du Sert",
      "Simonsohn",
      "Wagenmakers",
      "Ware",
      "Ioannidis",
    ],
    year: 2017,
    venue: "Nature Human Behaviour",
    locator: "1: 0021",
    pdf: false,
    annotated: false,
    note: false,
  },
];

export const paper = (citekey: string) =>
  PAPERS.find((p) => p.citekey === citekey)!;

export const COLLECTION = "Reproducibility";
export const DRAFT = "Chapter 3 - Presenting the results";

/** The suggester's byline: the plugin's own creator summary and the year, "Sandve et al. (2013)". */
export const byline = (p: Paper) =>
  `${m.creator_summary({ count: p.authors.length, first: p.authors[0]! })} (${p.year})`;

/** The library row's meta line: "Sandve et al. · 2013 · PLOS Computational Biology". */
export const metaLine = (p: Paper) =>
  [
    m.creator_summary({ count: p.authors.length, first: p.authors[0]! }),
    p.year,
    p.venue,
  ].join(" · ");

/**
 * An in-text citation in Chicago author-date, as the Pandoc engine renders it
 * in Live Preview: `[@sandve2013, p. 2]` → "(Sandve et al. 2013, 2)".
 */
export function chicagoCite(p: Paper, page?: string) {
  const a = p.authors;
  const names =
    a.length === 1
      ? a[0]
      : a.length === 2
        ? `${a[0]} and ${a[1]}`
        : a.length === 3
          ? `${a[0]}, ${a[1]}, and ${a[2]}`
          : `${a[0]} et al.`;
  return `(${names} ${p.year}${page ? `, ${page}` : ""})`;
}

/** A reference-list entry in Chicago author-date, in parts: names and year, the title, the venue, the rest. */
export interface Reference {
  lead: string;
  title: string;
  venue: string;
  rest: string;
}

export const REFERENCES: Readonly<Record<string, Reference>> = {
  ioannidis2005: {
    lead: "Ioannidis, John P. A. 2005.",
    title: "“Why Most Published Research Findings Are False.”",
    venue: "PLoS Medicine",
    rest: "2 (8): e124.",
  },
  munafo2017: {
    lead: "Munafò, Marcus R., Brian A. Nosek, Dorothy V. M. Bishop, Katherine S. Button, Christopher D. Chambers, Nathalie Percie du Sert, Uri Simonsohn, Eric-Jan Wagenmakers, Jennifer J. Ware, and John P. A. Ioannidis. 2017.",
    title: "“A Manifesto for Reproducible Science.”",
    venue: "Nature Human Behaviour",
    rest: "1: 0021.",
  },
  sandve2013: {
    lead: "Sandve, Geir Kjetil, Anton Nekrutenko, James Taylor, and Eivind Hovig. 2013.",
    title: "“Ten Simple Rules for Reproducible Computational Research.”",
    venue: "PLOS Computational Biology",
    rest: "9 (10): e1003285.",
  },
};

/**
 * The draft's paragraphs, from the docs Fixture's chapter plan and the
 * "Cite while you write" walk: text runs and the citations between them.
 */
export const DRAFT_TEXT: readonly (
  | string
  | { key: string; page?: string }
)[][] = [
  [
    "Open with the problem: small studies and flexible analyses make false findings likely ",
    { key: "ioannidis2005" },
    ". Then the response: preregistration and open data ",
    { key: "munafo2017" },
    ".",
  ],
  [
    "Every figure in this chapter comes from a script that records how it ran ",
    { key: "sandve2013", page: "2" },
    ".",
  ],
];

/** A Zotero highlight on Sandve et al. 2013. */
export interface Highlight {
  color: string;
  text: string;
  comment: string | null;
  page: string;
  tag: string | null;
}

export const SANDVE_HIGHLIGHTS: readonly Highlight[] = [
  {
    color: "var(--z-green)",
    text: "good habits of reproducibility may actually turn out to be a time-saver in the longer run.",
    comment: "The argument to use when the extra bookkeeping feels slow.",
    page: "1",
    tag: "argument",
  },
  {
    color: "var(--z-yellow)",
    text: "As a minimal requirement, you should at least be able to reproduce the results yourself.",
    comment: "The bar for every analysis in my methods chapter.",
    page: "1",
    tag: "reproducibility",
  },
  {
    color: "var(--z-red)",
    text: "a failure to take notes may make exact reproduction essentially impossible.",
    comment: null,
    page: "1",
    tag: "pitfall",
  },
  {
    color: "var(--z-purple)",
    text: "Rule 1: For Every Result, Keep Track of How It Was Produced",
    comment: null,
    page: "2",
    tag: null,
  },
  {
    color: "var(--z-blue)",
    text: "you should ensure that every detail that may influence the execution of the step is recorded.",
    comment: "Keep a run log beside each figure script.",
    page: "2",
    tag: "workflow",
  },
];
