// The items behind the example variants: for each item type an entry can be made for, one item with every detail and an annotation set, and one with few details.

import type { AnnotationSpec, DerivedItem } from "./samples.ts";

const COLORS = {
  yellow: { name: "yellow", hex: "#ffd400" },
  red: { name: "red", hex: "#ff6666" },
  green: { name: "green", hex: "#5fb236" },
  blue: { name: "blue", hex: "#2ea8e5" },
  purple: { name: "purple", hex: "#a28ae5" },
  orange: { name: "orange", hex: "#f19837" },
} as const;

/** A highlight of `quote`, or of `[quote, comment]` when the reader commented on it. */
function highlight(
  page: number,
  color: keyof typeof COLORS,
  quote: string | readonly [string, string],
): AnnotationSpec {
  const [text, comment = null] = typeof quote === "string" ? [quote] : quote;
  return { type: "highlight", page, color: COLORS[color], text, comment };
}

function image(
  page: number,
  color: keyof typeof COLORS,
  file: string,
): AnnotationSpec {
  return {
    type: "image",
    page,
    color: COLORS[color],
    text: null,
    comment: null,
    image: file,
  };
}

/** What an item type's example variants are made from. */
export interface ExampleItems {
  /** The variant id's item type part, such as `book-section`. */
  readonly slug: string;
  /** Every detail, an abstract, and an annotation set: three or four colored highlights, one with a comment, and one image. */
  readonly full: DerivedItem;
  /** A title, a creator, a year, and one highlight. */
  readonly few: DerivedItem;
}

/**
 * The example items of every item type an entry can be made for, in the order
 * the site lists item types. The full journal article, conference paper, book,
 * book chapter, and thesis, and the few-details article, book, and book
 * chapter, are real publications with their real details; their highlights,
 * comments, and abstracts are invented, and the archive items are fictional.
 * Every string is plain data the reader would see in Zotero.
 */
const ITEMS: readonly ExampleItems[] = [
  {
    slug: "journal-article",
    full: {
      id: "journal-article-full-details",
      key: "KAHPRT79",
      itemType: "journalArticle",
      title: "Prospect theory: An analysis of decision under risk",
      date: { year: 1979 },
      dateText: "1979",
      primaryCreatorType: "author",
      creators: [
        { given: "Daniel", family: "Kahneman", role: "author" },
        { given: "Amos", family: "Tversky", role: "author" },
      ],
      citekey: "kahnemanProspectTheoryAnalysis1979",
      abstract:
        "People do not judge a risky choice by the final wealth it may bring. They judge gains and losses from a reference point, and a loss weighs more than a gain of the same size.\n\nThe article sets out prospect theory, which describes these choices better than expected utility theory does.",
      tags: ["decision making", "risk"],
      fields: {
        publicationTitle: "Econometrica",
        containerTitle: "Econometrica",
        volume: "47",
        issue: "2",
        pages: "263–291",
        DOI: "10.2307/1914185",
        ISSN: "0012-9682",
        language: "en",
      },
      pdf: { key: "KAHPDF79", filename: "prospect-theory.pdf" },
      annotations: [
        highlight(264, "yellow", [
          "People judge an outcome as a gain or a loss from a reference point.",
          "Compare with the framing study in week 4.",
        ]),
        highlight(
          279,
          "blue",
          "A loss weighs more than a gain of the same size.",
        ),
        highlight(
          283,
          "purple",
          "Small probabilities are often given too much weight.",
        ),
        image(281, "green", "prospect-theory-p281.png"),
      ],
    },
    few: {
      id: "journal-article-few-details",
      key: "IOAWMP05",
      itemType: "journalArticle",
      title: "Why most published research findings are false",
      date: { year: 2005 },
      dateText: "2005",
      primaryCreatorType: "author",
      creators: [{ given: "John P. A.", family: "Ioannidis", role: "author" }],
      citekey: "ioannidisWhyMostPublished2005",
      fields: {
        publicationTitle: "PLoS Medicine",
        containerTitle: "PLoS Medicine",
        language: "en",
      },
      pdf: { key: "IOAPDF05", filename: "why-most-findings-are-false.pdf" },
      annotations: [
        highlight(
          2,
          "yellow",
          "A finding is less likely to be true when studies are small.",
        ),
      ],
    },
  },
  {
    slug: "conference-paper",
    full: {
      id: "conference-paper-full-details",
      key: "VASATT17",
      itemType: "conferencePaper",
      title: "Attention is all you need",
      date: { year: 2017 },
      dateText: "2017",
      primaryCreatorType: "author",
      creators: [
        { given: "Ashish", family: "Vaswani", role: "author" },
        { given: "Noam", family: "Shazeer", role: "author" },
        { given: "Niki", family: "Parmar", role: "author" },
        { given: "Jakob", family: "Uszkoreit", role: "author" },
        { given: "Llion", family: "Jones", role: "author" },
        { given: "Aidan N.", family: "Gomez", role: "author" },
        { given: "Łukasz", family: "Kaiser", role: "author" },
        { given: "Illia", family: "Polosukhin", role: "author" },
      ],
      citekey: "vaswaniAttentionAllYou2017",
      abstract:
        "Most sequence models pass information along a chain of steps, which limits how much of the work a computer can do at once.\n\nThe paper describes the Transformer, a model built on attention alone, and shows that it translates text well and trains faster than the models it replaces.",
      tags: ["machine learning", "translation"],
      fields: {
        publicationTitle:
          "Advances in Neural Information Processing Systems 30",
        containerTitle: "Advances in Neural Information Processing Systems 30",
        publisher: "Curran Associates",
        place: "Red Hook, NY",
        pages: "5998–6008",
        language: "en",
      },
      pdf: { key: "VASPDF17", filename: "attention-is-all-you-need.pdf" },
      annotations: [
        highlight(2, "yellow", [
          "The Transformer relies entirely on attention to draw global dependencies between input and output.",
          "Read before the seminar on sequence models.",
        ]),
        highlight(
          3,
          "blue",
          "Attention lets a model relate every word in a sentence to every other word in one step.",
        ),
        highlight(
          8,
          "orange",
          "The model reaches a new best score for translation from English to German.",
        ),
        image(4, "green", "attention-is-all-you-need-p4.png"),
      ],
    },
    few: {
      id: "conference-paper-few-details",
      key: "RIVCNF26",
      itemType: "conferencePaper",
      title: "Designing reproducible research interfaces",
      date: { year: 2026 },
      dateText: "2026",
      primaryCreatorType: "author",
      creators: [
        { given: "Ana", family: "Rivera", role: "author" },
        { given: "Wei", family: "Chen", role: "author" },
      ],
      citekey: "riveraDesigningReproducibleResearch2026",
      fields: {
        publicationTitle: "Proceedings of the Open Research Conference",
        containerTitle: "Proceedings of the Open Research Conference",
        language: "en",
      },
      pdf: {
        key: "RIVPDF26",
        filename: "reproducible-research-interfaces.pdf",
      },
      annotations: [
        highlight(
          1,
          "yellow",
          "A reproducible interface makes its inputs and outputs inspectable.",
        ),
      ],
    },
  },
  {
    slug: "book",
    full: {
      id: "book-full-details",
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
      abstract:
        "A guide to planning, drafting, and revising a research paper.\n\nThe book shows how to turn a topic into a question, a question into a problem, and a problem into an argument that readers can follow.",
      fields: {
        publisher: "University of Chicago Press",
        place: "Chicago",
        edition: "4",
        ISBN: "978-0-226-23973-6",
        language: "en",
      },
      pdf: { key: "BOOTPDF1", filename: "the-craft-of-research.pdf" },
      annotations: [
        highlight(14, "yellow", [
          "A good research question names what you do not yet understand.",
          "Use this wording in my introduction.",
        ]),
        highlight(
          32,
          "blue",
          "Readers judge a claim by the reasons and evidence behind it.",
        ),
        highlight(
          47,
          "purple",
          "A warrant explains why a reason supports a claim.",
        ),
        image(58, "green", "the-craft-of-research-p58.png"),
      ],
    },
    few: {
      id: "book-few-details",
      key: "KAHTFS11",
      itemType: "book",
      title: "Thinking, fast and slow",
      date: { year: 2011 },
      dateText: "2011",
      primaryCreatorType: "author",
      creators: [{ given: "Daniel", family: "Kahneman", role: "author" }],
      citekey: "kahnemanThinkingFastSlow2011",
      fields: { language: "en" },
      pdf: { key: "KAHPDF11", filename: "thinking-fast-and-slow.pdf" },
      annotations: [
        highlight(20, "yellow", "Intuition is thinking that feels effortless."),
      ],
    },
  },
  {
    slug: "book-section",
    full: {
      id: "book-section-full-details",
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
        {
          key: "TVKQUES3",
          title: "Questions for the decision-making seminar",
        },
      ],
      related: ["book"],
      pdf: { key: "TVKPDF82", filename: "judgment-under-uncertainty.pdf" },
      annotations: [
        highlight(4, "yellow", [
          "People rely on a limited number of heuristic principles to assess probabilities.",
          "Ask in the seminar how this applies to peer review.",
        ]),
        highlight(
          7,
          "blue",
          "The more easily an event comes to mind, the more likely it seems.",
        ),
        highlight(
          12,
          "purple",
          "People start from an initial value and adjust it too little.",
        ),
        image(10, "green", "judgment-under-uncertainty-p10.png"),
      ],
    },
    few: {
      id: "book-section-few-details",
      key: "BOUFOC86",
      itemType: "bookSection",
      title: "The forms of capital",
      date: { year: 1986 },
      dateText: "1986",
      primaryCreatorType: "author",
      creators: [{ given: "Pierre", family: "Bourdieu", role: "author" }],
      citekey: "bourdieuFormsCapital1986",
      fields: {
        publicationTitle:
          "Handbook of Theory and Research for the Sociology of Education",
        containerTitle:
          "Handbook of Theory and Research for the Sociology of Education",
        language: "en",
      },
      pdf: { key: "BOUPDF86", filename: "the-forms-of-capital.pdf" },
      annotations: [
        highlight(
          3,
          "yellow",
          "Capital takes time to accumulate and can produce profits.",
        ),
      ],
    },
  },
  {
    slug: "thesis",
    full: {
      id: "thesis-full-details",
      key: "NASHNC50",
      itemType: "thesis",
      title: "Non-cooperative games",
      date: { year: 1950 },
      dateText: "1950",
      primaryCreatorType: "author",
      creators: [{ given: "John F.", family: "Nash", role: "author" }],
      citekey: "nashNoncooperativeGames1950",
      abstract:
        "The thesis studies games in which the players cannot make binding agreements.\n\nIt defines an equilibrium point, a set of strategies in which no player gains by changing alone, and proves that every finite game has one.",
      tags: ["game theory"],
      fields: {
        type: "PhD thesis",
        publisher: "Princeton University",
        place: "Princeton, NJ",
        numPages: "27",
        language: "en",
      },
      pdf: { key: "NASPDF50", filename: "non-cooperative-games.pdf" },
      annotations: [
        highlight(5, "yellow", [
          "An equilibrium point is a set of strategies in which no player gains by changing alone.",
          "Compare with the cooperative case in chapter 2.",
        ]),
        highlight(
          8,
          "blue",
          "Every finite game has at least one equilibrium point.",
        ),
        highlight(12, "purple", "The proof rests on a fixed-point argument."),
        image(15, "green", "non-cooperative-games-p15.png"),
      ],
    },
    few: {
      id: "thesis-few-details",
      key: "BATBIC10",
      itemType: "thesis",
      title:
        "Bicycle sharing in developing countries: A proposal towards sustainable transportation",
      date: { year: 2010 },
      dateText: "2010",
      primaryCreatorType: "author",
      creators: [{ given: "Rafael", family: "Batista", role: "author" }],
      citekey: "batistaBicycleSharingDeveloping2010",
      fields: { language: "en" },
      pdf: { key: "BATPDF10", filename: "bicycle-sharing.pdf" },
      annotations: [
        highlight(
          9,
          "yellow",
          "Bicycle sharing works best where trips are short.",
        ),
      ],
    },
  },
  {
    slug: "letter",
    full: {
      id: "letter-full-details",
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
      pdf: { key: "ALDPDF87", filename: "aldous-letter-1887-03-14.pdf" },
      annotations: [
        highlight(1, "yellow", [
          "The water rose above the mill race on the third night.",
          "Matches the report in the Gazette.",
        ]),
        highlight(
          1,
          "blue",
          "I should be glad of any news of the survey of the lower fields.",
        ),
        highlight(2, "purple", "Pray give my regards to your brother."),
        image(2, "green", "aldous-letter-1887-signature.png"),
      ],
    },
    few: {
      id: "letter-few-details",
      key: "ALDLET88",
      itemType: "letter",
      title: "Letter to the mill committee",
      date: { year: 1888 },
      dateText: "1888",
      primaryCreatorType: "author",
      creators: [{ given: "Henry", family: "Aldous", role: "author" }],
      citekey: "aldousLetterMillCommittee1888",
      fields: {},
      pdf: { key: "ALDPDF88", filename: "aldous-letter-1888.pdf" },
      annotations: [
        highlight(
          1,
          "yellow",
          "The committee will meet on the first Monday of the month.",
        ),
      ],
    },
  },
  {
    slug: "manuscript",
    full: {
      id: "manuscript-full-details",
      key: "ALDMSS85",
      itemType: "manuscript",
      title: "Survey notebook of the Brackenridge estate",
      date: { year: 1885 },
      dateText: "1885",
      primaryCreatorType: "author",
      creators: [{ given: "Henry", family: "Aldous", role: "author" }],
      citekey: "aldousSurveyNotebookBrackenridge1885",
      abstract:
        "A field notebook with the boundaries, the fields, and the water courses of the Brackenridge estate.",
      tags: ["survey"],
      fields: {
        type: "Notebook",
        place: "Brackenridge",
        numPages: "96",
        archive: "Brackenridge County Record Office",
        archiveLocation: "Aldous papers, box 1, item 4",
      },
      pdf: { key: "ALDPDF85", filename: "survey-notebook-1885.pdf" },
      annotations: [
        highlight(6, "yellow", [
          "The eastern boundary follows the old mill race.",
          "Check against the 1887 letter.",
        ]),
        highlight(
          19,
          "blue",
          "Twelve acres of meadow lie below the flood line.",
        ),
        highlight(41, "orange", "The lower fields were let to two tenants."),
        image(23, "green", "survey-notebook-p23.png"),
      ],
    },
    few: {
      id: "manuscript-few-details",
      key: "ALDMSS86",
      itemType: "manuscript",
      title: "Account book of the mill",
      date: { year: 1886 },
      dateText: "1886",
      primaryCreatorType: "author",
      creators: [{ given: "Henry", family: "Aldous", role: "author" }],
      citekey: "aldousAccountBookMill1886",
      fields: {},
      pdf: { key: "ALDPDF86", filename: "mill-account-book-1886.pdf" },
      annotations: [
        highlight(3, "yellow", "Wheat was ground at four pence a bushel."),
      ],
    },
  },
  {
    slug: "interview",
    full: {
      id: "interview-full-details",
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
      tags: ["oral history"],
      fields: {
        medium: "Audio recording",
        archive: "Riverside Community Archive",
        archiveLocation: "OH-2019-014",
        url: "https://archive.example.org/oral-histories/oh-2019-014",
        language: "en",
      },
      pdf: { key: "OKAPDF19", filename: "okafor-interview-transcript.pdf" },
      annotations: [
        highlight(3, "yellow", [
          "We met in the laundry room because it was the only place with chairs.",
          "Ask about the first meeting date.",
        ]),
        highlight(
          9,
          "blue",
          "The strike began when the landlord refused to repair the heating.",
        ),
        highlight(
          14,
          "purple",
          "By the winter of 1979 every floor had a representative.",
        ),
        image(11, "green", "okafor-transcript-p11.png"),
      ],
    },
    few: {
      id: "interview-few-details",
      key: "BELFOH18",
      itemType: "interview",
      title: "Oral history interview with Tomas Bell",
      date: { year: 2018 },
      dateText: "2018",
      primaryCreatorType: "interviewee",
      creators: [{ given: "Tomas", family: "Bell", role: "interviewee" }],
      citekey: "bellOralHistoryInterview2018",
      fields: {},
      pdf: { key: "BELPDF18", filename: "bell-interview-transcript.pdf" },
      annotations: [
        highlight(2, "yellow", "The bakery opened at five every morning."),
      ],
    },
  },
  {
    slug: "document",
    full: {
      id: "document-full-details",
      key: "BFLMIN23",
      itemType: "document",
      title: "Minutes of the Board of Trustees, 12 March 1923",
      date: { year: 1923, month: 3, day: 12 },
      dateText: "12 March 1923",
      primaryCreatorType: "author",
      creators: [{ literal: "Brackenridge Free Library", role: "author" }],
      citekey: "brackenridgefreelibraryMinutesBoardTrustees1923",
      abstract:
        "The trustees vote to open a reading room for children and to extend the library's evening hours.",
      tags: ["library history"],
      fields: {
        publisher: "Brackenridge Free Library",
        archive: "Brackenridge Free Library archives",
        archiveLocation: "Board minutes, vol. 7",
      },
      pdf: { key: "BFLPDF23", filename: "board-minutes-1923-03-12.pdf" },
      annotations: [
        highlight(1, "yellow", [
          "Resolved, that a reading room for children be opened in the spring.",
          "The first mention of the children's room.",
        ]),
        highlight(
          2,
          "blue",
          "The library shall stay open until nine on weekday evenings.",
        ),
        highlight(
          3,
          "purple",
          "The treasurer reported a balance of forty-two dollars.",
        ),
        image(2, "green", "board-minutes-1923-p2.png"),
      ],
    },
    few: {
      id: "document-few-details",
      key: "BFLNOT24",
      itemType: "document",
      title: "Notice of the annual meeting",
      date: { year: 1924 },
      dateText: "1924",
      primaryCreatorType: "author",
      creators: [{ literal: "Brackenridge Free Library", role: "author" }],
      citekey: "brackenridgefreelibraryNoticeAnnualMeeting1924",
      fields: {},
      pdf: { key: "BFLPDF24", filename: "notice-annual-meeting-1924.pdf" },
      annotations: [highlight(1, "yellow", "All members are asked to attend.")],
    },
  },
  {
    slug: "newspaper-article",
    full: {
      id: "newspaper-article-full-details",
      key: "BGZFLD87",
      itemType: "newspaperArticle",
      title: "The flood at Aldous's mill",
      date: { year: 1887, month: 3, day: 18 },
      dateText: "18 March 1887",
      primaryCreatorType: "author",
      creators: [{ given: "Thomas", family: "Hale", role: "author" }],
      citekey: "haleFloodAldousMill1887",
      abstract:
        "A report of the spring flood that stopped the Aldous mill for nine days.",
      tags: ["flood"],
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
      pdf: { key: "BGZPDF87", filename: "gazette-1887-03-18.pdf" },
      annotations: [
        highlight(3, "yellow", [
          "The mill stood idle for nine days while the water fell.",
          "Compare with the letter of 14 March.",
        ]),
        highlight(
          3,
          "blue",
          "Two cottages on the low road were flooded to the windows.",
        ),
        highlight(
          3,
          "orange",
          "Mr. Aldous has promised to repair the mill race before summer.",
        ),
        image(3, "green", "gazette-1887-flood-column.png"),
      ],
    },
    few: {
      id: "newspaper-article-few-details",
      key: "BGZSAL88",
      itemType: "newspaperArticle",
      title: "Sale of the mill",
      date: { year: 1888 },
      dateText: "1888",
      primaryCreatorType: "author",
      creators: [],
      citekey: "saleMill1888",
      fields: {
        publicationTitle: "Brackenridge Gazette",
        containerTitle: "Brackenridge Gazette",
      },
      pdf: { key: "BGZPDF88", filename: "gazette-1888-sale.pdf" },
      annotations: [
        highlight(1, "yellow", "The mill will be sold by auction in June."),
      ],
    },
  },
];

/** An item with its annotations in page order, as Zotero lists them. */
function inPageOrder(item: DerivedItem): DerivedItem {
  return item.annotations === undefined
    ? item
    : {
        ...item,
        annotations: [...item.annotations].sort((a, b) => a.page - b.page),
      };
}

export const EXAMPLE_ITEMS: readonly ExampleItems[] = ITEMS.map((items) => ({
  ...items,
  full: inPageOrder(items.full),
}));
