// The content directory as the build sees it, outside the app's module graph.
//
// Vite loads its config outside the app's module graph, so the collection index
// (`collections/server`, built on `import.meta.glob`) is out of reach for the
// build-time lists — the prerender page list and the OG card inventory. Both
// read the content directory through this scan instead, using fumadocs' own
// `getSlugs` and frontmatter reader so the folder-group and `index` rules match
// what the loaders apply. `src/http.test.ts` walks the loaders and asserts the
// built site carries a file for every page they publish, so a drift between
// this scan and the collections fails the test run.

import { frontmatter } from "fumadocs-core/content/md/frontmatter";
import { getSlugs } from "fumadocs-core/source";
import { globSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import type { MarkdownSection } from "./markdown-routes.ts";

/** One content file, addressed the way the loaders address it. */
export interface ContentEntry {
  slugs: string[];
  /** Raw YAML frontmatter; the collection schemas in `source.config.ts` own its shape. */
  frontmatter: unknown;
}

/**
 * One content directory per section, matching the file patterns the
 * collections in `source.config.ts` pick up.
 */
const sections: Record<MarkdownSection, { dir: string; files: string }> = {
  docs: { dir: "content/docs", files: "**/[!_]*.mdx" },
  changelog: { dir: "content/changelog", files: "**/*.{mdx,md}" },
  blog: { dir: "content/blog", files: "**/*.{mdx,md}" },
};

/**
 * Every page file of every section, with its frontmatter parsed.
 * @param packageRoot the app's own root, which `vite.config.ts` owns.
 */
export function scanContent(
  packageRoot: string,
): Record<MarkdownSection, ContentEntry[]> {
  return Object.fromEntries(
    Object.entries(sections).map(([section, { dir, files }]) => {
      const cwd = resolve(packageRoot, dir);
      const entries = globSync(files, { cwd }).map(
        (file): ContentEntry => ({
          slugs: getSlugs(file),
          frontmatter: frontmatter(readFileSync(join(cwd, file), "utf8")).data,
        }),
      );
      return [section, entries];
    }),
  ) as Record<MarkdownSection, ContentEntry[]>;
}
