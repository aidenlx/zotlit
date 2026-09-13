import { rehypeCodeDefaultOptions } from "fumadocs-core/mdx-plugins";
import { defineConfig } from "fumadocs-mdx/config";

import { etaGrammar } from "./src/lib/eta-grammar.js";

export default defineConfig({
  mdxOptions: {
    remarkImageOptions: {
      useImport: false,
    },
    rehypeCodeOptions: {
      ...rehypeCodeDefaultOptions,
      langs: ["javascript", etaGrammar],
    },
  },
});
