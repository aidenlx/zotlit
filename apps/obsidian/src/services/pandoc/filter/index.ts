// The Pandoc integration files the plugin bundles: the two built filter variants
// and the defaults file that locates a filter beside it.

export { default as pandocCliFilter } from "./zotlit-cite.lua?variant=cli";
export { default as pandocSandboxFilter } from "./zotlit-cite.lua?variant=sandbox";
export { default as pandocDefaults } from "./zotlit.yaml?raw";

/** Co-location is the whole location contract: the pair keeps these exact names. */
export const PANDOC_FILTER_FILENAME = "zotlit-cite.lua";
export const PANDOC_DEFAULTS_FILENAME = "zotlit.yaml";

/** Where the sandbox variant reads its resolve map, relative to the working directory. */
export const PANDOC_RESOLVE_MAP_FILENAME = "zotlit-resolve-map.json";
