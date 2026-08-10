import { rehypeCodeDefaultOptions } from "fumadocs-core/mdx-plugins";
import type { LLMsOptions } from "fumadocs-core/mdx-plugins";
import {
  defineCollections,
  defineConfig,
  defineDocs,
} from "fumadocs-mdx/config";
import { valid as isValidSemVer } from "semver";
import * as v from "valibot";

import { etaGrammar } from "./lib/eta-grammar";
import { CONTRACT_IR } from "./lib/template-contract/contract.ts";
import { renderContractTableMarkdown } from "./lib/template-contract/gfm.ts";
import { buildPageModel } from "./lib/template-contract/page-model.ts";

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
 * The generated reference page carries its tables as `<ContractTable>`, which
 * the Markdown edition would otherwise emit as JSX. Replace each one with the
 * GFM table rendered from the same page model the component reads.
 */
const markdownEdition: LLMsOptions = {
  stringify(node) {
    if (node.type !== "mdxJsxFlowElement" || node.name !== "ContractTable") {
      return undefined;
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

/** @see https://fumadocs.dev/docs/mdx/collections */
export const docs = defineDocs({
  dir: "content/docs",
  docs: {
    schema: v.object({
      ...pageSchema.entries,
      /** First ZotLit release that contained the page's main subject. */
      introduced: semverSchema,
      /** Latest ZotLit release that materially changed the page's main subject. */
      updated: semverSchema,
    }),
    files: ["**/*.mdx", "!**/_*.mdx"],
    postprocess: {
      includeProcessedMarkdown: markdownEdition,
    },
  },
  meta: {
    schema: metaSchema,
  },
});

export const changelogs = defineCollections({
  type: "doc",
  dir: "content/changelog",
  postprocess: {
    includeProcessedMarkdown: true,
  },
  schema: v.object({
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    version: semverSchema,
    /** Version of the Zotero companion released alongside this plugin version, if any. */
    companion: v.optional(semverSchema),
    date: v.pipe(
      v.union([v.string(), v.date()]),
      v.transform((val) => new Date(val)),
    ),
  }),
});

export const blogs = defineCollections({
  type: "doc",
  dir: "content/blog",
  postprocess: {
    includeProcessedMarkdown: true,
  },
  schema: v.object({
    title: v.string(),
    /** Standfirst shown under the title and in the index deck. */
    description: v.optional(v.string()),
    /** @default "aidenlx" */
    author: v.optional(v.string(), "aidenlx"),
    date: v.pipe(
      v.union([v.string(), v.date()]),
      v.transform((val) => new Date(val)),
    ),
  }),
});

export default defineConfig({
  mdxOptions: {
    rehypeCodeOptions: {
      ...rehypeCodeDefaultOptions,
      langs: ["javascript", etaGrammar],
    },
  },
});
