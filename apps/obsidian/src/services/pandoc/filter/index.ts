// The Pandoc integration files the plugin bundles: the two built filter variants
// and the defaults file that locates a filter beside it.

export { default as pandocCliFilter } from "./zotlit-cite.lua?variant=cli";
export { default as pandocSandboxFilter } from "./zotlit-cite.lua?variant=sandbox";
export { default as pandocDefaults } from "./zotlit.yaml?raw";

export {
  PANDOC_DEFAULTS_FILENAME,
  PANDOC_FILTER_FILENAME,
  PANDOC_RESOLVE_MAP_FILENAME,
} from "./names";
