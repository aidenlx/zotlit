import { rehypeCodeDefaultOptions } from "fumadocs-core/mdx-plugins";
import type { LLMsOptions } from "fumadocs-core/mdx-plugins";
import {
  defineCollections,
  defineConfig,
  defineDocs,
} from "fumadocs-mdx/config";
import lastModified from "fumadocs-mdx/plugins/last-modified";
import { valid as isValidSemVer } from "semver";
import * as v from "valibot";

import { etaGrammar } from "./src/lib/eta-grammar.js";
import { stringifyAttention } from "./src/lib/markdown-attention.js";
import { publishedOn } from "./src/lib/shared.js";
import { CONTRACT_IR } from "./src/lib/template-contract/contract.js";
import { renderContractTableMarkdown } from "./src/lib/template-contract/gfm.js";
import { buildPageModel } from "./src/lib/template-contract/page-model.js";

const model = buildPageModel(CONTRACT_IR);

const metaSchema = v.object({
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
 * rather than a string: prose is still stringified at build time, while a JSX
 * element keeps its evaluated props and resolves from the components map
 * `src/lib/markdown-editions.tsx` hands it. A component that calls
 * `asMarkdown()` there decides its own Markdown form; one that does not is
 * serialized as JSX, the way the whole page once was. `stringify` also serializes
 * every bold and italic span itself, which keeps the opening marker literal —
 * see `src/lib/markdown-attention.ts`.
 */
const markdownEdition: LLMsOptions = {
  output: "function",
  // oxlint-disable-next-line max-params -- signature dictated by LLMsOptions.stringify
  stringify(node, _parent, state, info) {
    return stringifyAttention(node, state, info);
  },
};

/**
 * The generated reference page carries its tables as `<ContractTable>`, which
 * the Markdown edition would otherwise emit as JSX. Replace each one with the
 * GFM table rendered from the same page model the component reads. `stringify`
 * runs ahead of the JSX collection step, so the table lands as build-time text.
 */
const docsMarkdownEdition: LLMsOptions = {
  ...markdownEdition,
  // oxlint-disable-next-line max-params -- signature dictated by LLMsOptions.stringify
  stringify(node, _parent, state, info) {
    if (node.type !== "mdxJsxFlowElement" || node.name !== "ContractTable") {
      return stringifyAttention(node, state, info);
    }
    const attribute = node.attributes.find(
      (entry) => entry.type === "mdxJsxAttribute" && entry.name === "section",
    );
    const section = attribute?.value;
    if (typeof section !== "string") {
      throw new Error("<ContractTable> carries no section attribute");
    }
    return renderContractTableMarkdown(model, section);
  },
};

/** @see https://github.com/fuma-nama/fumadocs/blob/fumadocs-mdx%4015.2.1/apps/docs/content/docs/mdx/collections.mdx */
export const docs = defineDocs({
  dir: "content/docs",
  docs: {
    // Frontmatter loads eagerly, page bodies behind a dynamic import, so
    // listing pages through the loader costs no MDX compilation.
    async: true,
    schema: v.object({
      ...pageSchema.entries,
      /**
       * First ZotLit release that contained the page's main subject. Unset
       * until `release.ts`'s docs-availability phase assigns it at release
       * time — see ADR 0002.
       */
      introduced: v.optional(semverSchema),
      /**
       * Latest ZotLit release that materially changed the page's main
       * subject. Unset until `release.ts`'s docs-availability phase assigns
       * it at release time — see ADR 0002.
       */
      updated: v.optional(semverSchema),
    }),
    // Content partials are `_`-prefixed and reach a page through `<include>`,
    // never as pages of their own. The exclusion is a character class rather
    // than a `!` negation because fumadocs-mdx's Vite codegen prefixes every
    // pattern with `./`, which turns `!**/_*.mdx` into the inert `./!**/_*.mdx`.
    files: ["**/[!_]*.mdx"],
    postprocess: {
      includeProcessedMarkdown: docsMarkdownEdition,
    },
  },
  meta: {
    schema: metaSchema,
  },
});

export const changelogs = defineCollections({
  type: "doc",
  dir: "content/changelog",
  async: true,
  postprocess: {
    includeProcessedMarkdown: markdownEdition,
  },
  schema: v.object({
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    version: semverSchema,
    /** Version of ZotLit Companion, the Zotero add-on, released alongside this plugin version, if any. */
    companion: v.optional(semverSchema),
    date: publishedOn,
  }),
});

export const blogs = defineCollections({
  type: "doc",
  dir: "content/blog",
  async: true,
  postprocess: {
    includeProcessedMarkdown: markdownEdition,
  },
  schema: v.object({
    title: v.string(),
    /** Standfirst shown under the title and in the index deck. */
    description: v.optional(v.string()),
    /** @default "aidenlx" */
    author: v.optional(v.string(), "aidenlx"),
    date: publishedOn,
  }),
});

export default defineConfig({
  // Each docs page and blog post carries its file's last commit date, read
  // from git history at build time. A changelog entry is fixed at its release
  // `date`, so the plugin leaves that collection alone. The date rides with
  // the compiled body, so an `async` collection reaches it through `load()`,
  // never off the frontmatter head. The deploy workflow checks out full
  // history for it.
  plugins: [
    lastModified({
      filter: (collection) => collection === "docs" || collection === "blogs",
    }),
  ],
  mdxOptions: {
    rehypeCodeOptions: {
      ...rehypeCodeDefaultOptions,
      langs: ["javascript", etaGrammar],
    },
  },
});
