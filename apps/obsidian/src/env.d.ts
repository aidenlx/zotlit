declare module "*.css" {}

declare module "@zotlit/templates/defaults/*?raw" {
  const source: string;
  export default source;
}

declare module "*.yaml?raw" {
  const source: string;
  export default source;
}

/** Built by the `pandoc-filter-variants` Vite plugin, one variant per query. */
declare module "*.lua?variant=cli" {
  const source: string;
  export default source;
}

declare module "*.lua?variant=sandbox" {
  const source: string;
  export default source;
}

var __DEV__: boolean;
var __MIN_ELECTRON_VERSION__: string;
var __LANGUAGE_PACK_DEV_SERVER__: string | undefined;
var __PANDOC_ENGINE__: import("@/services/pandoc/pinned-engine").PinnedPandocEngine;
