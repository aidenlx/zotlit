// Compile-time schemas and Markdown transforms used by the native collections.

import type { LLMsOptions } from "fumadocs-core/mdx-plugins";
import { readFile } from "node:fs/promises";
import { valid as isValidSemVer } from "semver";
import * as v from "valibot";

import type { ContractIR } from "@zotlit/db/contract/ir";

import { stringifyAttention } from "./src/lib/markdown-attention.js";
import { publishedOn } from "./src/lib/shared.js";
import { renderContractTableMarkdown } from "./src/lib/template-contract/gfm.js";
import { buildPageModel } from "./src/lib/template-contract/page-model.js";

const contractIR = JSON.parse(
  await readFile(
    new URL(import.meta.resolve("@zotlit/db/contract/ir.json")),
    "utf8",
  ),
) as ContractIR;

const model = buildPageModel(contractIR);

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
 * rather than a string: prose is still stringified at build time, while a JSX
 * element keeps its evaluated props and resolves from the components map
 * `src/lib/markdown-editions.tsx` hands it. A component that calls
 * `asMarkdown()` there decides its own Markdown form; one that does not is
 * serialized as JSX, the way the whole page once was. `stringify` also serializes
 * every bold and italic span itself, which keeps the opening marker literal —
 * see `src/lib/markdown-attention.ts`.
 */
export const markdownEdition: LLMsOptions = {
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
export const docsMarkdownEdition: LLMsOptions = {
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

export const docsSchema = v.object({
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
});

export const changelogSchema = v.object({
  title: v.optional(v.string()),
  description: v.optional(v.string()),
  version: semverSchema,
  /** Version of ZotLit Companion, the Zotero add-on, released alongside this plugin version, if any. */
  companion: v.optional(semverSchema),
  date: publishedOn,
});

export const blogSchema = v.object({
  title: v.string(),
  /** Standfirst shown under the title and in the index deck. */
  description: v.optional(v.string()),
  /** @default "aidenlx" */
  author: v.optional(v.string(), "aidenlx"),
  date: publishedOn,
});
