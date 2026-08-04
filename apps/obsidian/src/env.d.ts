declare module "*.css" {}

declare module "@zotlit/templates/defaults/*?raw" {
  const source: string;
  export default source;
}

var __DEV__: boolean;
var __MIN_ELECTRON_VERSION__: string;
var __LANGUAGE_PACK_DEV_SERVER__: string | undefined;
var __PANDOC_ENGINE__: import("@/services/pandoc/pinned-engine").PinnedPandocEngine;
