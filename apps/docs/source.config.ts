import { metaSchema, pageSchema } from "fumadocs-core/source/schema";
import {
  defineCollections,
  defineConfig,
  defineDocs,
} from "fumadocs-mdx/config";
import { valid as isValidSemVer } from "semver";
import * as v from "valibot";

/** @see https://fumadocs.dev/docs/mdx/collections */
export const docs = defineDocs({
  dir: "content/docs",
  docs: {
    schema: pageSchema,
    postprocess: {
      includeProcessedMarkdown: true,
    },
  },
  meta: {
    schema: metaSchema,
  },
});

const semverSchema = v.pipe(
  v.string(),
  v.check((val) => isValidSemVer(val) !== null, "Invalid semver version"),
);

export const changelogs = defineCollections({
  type: "doc",
  dir: "content/changelog",
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
  mdxOptions: {},
});
