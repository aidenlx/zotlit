// Compile-time schemas and Markdown transforms used by the native collections.

import type { LLMsOptions } from "fumadocs-core/mdx-plugins";
import { valid as isValidSemVer } from "semver";
import * as v from "valibot";

import { publishedOn } from "./src/lib/shared.js";

export const metaSchema = v.object({
  title: v.optional(v.string()),
  pages: v.optional(v.array(v.string())),
  pagesIndex: v.optional(v.string()),
  description: v.optional(v.string()),
  root: v.optional(v.boolean()),
  defaultOpen: v.optional(v.boolean()),
  collapsible: v.optional(v.boolean()),
  icon: v.optional(v.string()),
});

const pageSchema = v.object({
  title: v.string(),
  description: v.optional(v.string()),
  icon: v.optional(v.string()),
  full: v.optional(v.boolean()),
  _openapi: v.optional(v.record(v.string(), v.unknown())),
});

const semverSchema = v.pipe(
  v.string(),
  v.check((val) => isValidSemVer(val) !== null, "Invalid semver version"),
);

/**
 * Every collection's Markdown edition compiles to a `_markdown` component
 * rather than a string: prose is sliced from the authored source at build time,
 * while a JSX element keeps its evaluated props and resolves from the components
 * map `src/lib/markdown-editions.tsx` hands it. A component that calls
 * `asMarkdown()` there decides its own Markdown form; one that does not is
 * serialized as JSX, the way the whole page once was.
 */
export const markdownEdition: LLMsOptions = { output: "function" };

/**
 * One question of a page's `## Questions` section, published as FAQPage
 * JSON-LD. `answer` is the plain text of the paragraph under the question's
 * heading; `src/lib/source.test.ts` fails when the two drift apart.
 */
const faqEntrySchema = v.object({
  question: v.string(),
  answer: v.string(),
});

export const docsSchema = v.object({
  ...pageSchema.entries,
  /**
   * The page's own title, in the words a searcher types: its H1, `<title>`,
   * og:title, OG card, Markdown edition, and `llms.txt` entry. `title` stays
   * the short sidebar label, and stands in when this is absent.
   */
  searchTitle: v.optional(v.string()),
  faq: v.optional(v.array(faqEntrySchema)),
});

export const changelogSchema = v.object({
  title: v.optional(v.string()),
  description: v.optional(v.string()),
  version: semverSchema,
  /** Version of ZotLit Companion, the Zotero add-on, released alongside this plugin version, if any. */
  companion: v.optional(semverSchema),
  date: publishedOn,
});

/**
 * A `/learn` lesson. The frontmatter holds every part the page and the build
 * read without the body: the course order, the chore the lesson removes, the
 * opener, each step's name, title and picture text, and the end. The body
 * holds one `<Step n>` per entry of `steps`, in order, with the action, the
 * check line, any figure and the fixes — the parts that name ZotLit labels
 * through `UiLabel`. `src/lib/lessons.test.ts` checks that the two agree.
 */
export const learnSchema = v.object({
  /** One plain statement of the task, in the searcher's words. */
  title: v.pipe(v.string(), v.maxLength(60)),
  description: v.pipe(v.string(), v.maxLength(160)),
  /** Position in the course, from 1. */
  lesson: v.pipe(v.number(), v.integer(), v.minValue(1)),
  minutes: v.pipe(v.number(), v.integer(), v.minValue(1)),
  /** Folder under `public/img/learn/` holding `step-<n>.webp` and any `step-<n>.webm`/`.mp4` clip. */
  media: v.pipe(v.string(), v.regex(/^[a-z0-9-]+$/)),
  /** The chore in the reader's own words: the course page's card title. */
  chore: v.string(),
  /** The one action that replaces the chore once the lesson is done: the lede sentence under the H1. */
  instead: v.string(),
  /** One sentence on what the reader will have at the end, for the Markdown edition. */
  lede: v.string(),
  /** The opener's answer to a worry about the reader's library, when the lesson raises one. */
  note: v.optional(v.string()),
  needs: v.pipe(
    v.array(v.object({ item: v.string(), detail: v.string() })),
    v.minLength(1),
  ),
  steps: v.pipe(
    v.array(
      v.object({
        title: v.string(),
        /** Text alternative of the step's picture. */
        alt: v.string(),
      }),
    ),
    v.minLength(1),
  ),
  end: v.object({
    /** What the reader now has: the caption of the opener's result picture. */
    title: v.string(),
    /** What ZotLit now does for the reader: the line under "All N done". */
    caption: v.string(),
    /** The Markdown edition's line beside the link to the next lesson, or to the how-to guides after the last one. */
    next: v.string(),
  }),
});

export const blogSchema = v.object({
  title: v.string(),
  /** Standfirst shown under the title and in the index deck. */
  description: v.optional(v.string()),
  /** @default "aidenlx" */
  author: v.optional(v.string(), "aidenlx"),
  date: publishedOn,
});
