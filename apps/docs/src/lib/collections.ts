// Native Fumadocs collections for server loaders and lazy browser bodies.

import { defineCollections, defineDocs } from "fumadocs-mdx/macro";

// These imports are inside macro arguments, so compilation removes them from
// the app module. Validation and Markdown transforms stay in the Node process.
export const docs = defineDocs({
  dir: "content/docs",
  docs: {
    async: true,
    lastModified: true,
    // Underscore-prefixed partials enter through <include>, as part of a page.
    files: ["**/[^_]*.mdx"],
    schema: (await import("#content-config")).docsSchema,
    postprocess: {
      includeProcessedMarkdown: (await import("#content-config"))
        .docsMarkdownEdition,
    },
  },
  meta: {
    schema: (await import("#content-config")).metaSchema,
  },
});

export const changelogs = defineCollections({
  type: "doc",
  dir: "content/changelog",
  async: true,
  schema: (await import("#content-config")).changelogSchema,
  postprocess: {
    includeProcessedMarkdown: (await import("#content-config")).markdownEdition,
  },
});

export const blogs = defineCollections({
  type: "doc",
  dir: "content/blog",
  async: true,
  lastModified: true,
  schema: (await import("#content-config")).blogSchema,
  postprocess: {
    includeProcessedMarkdown: (await import("#content-config")).markdownEdition,
  },
});
