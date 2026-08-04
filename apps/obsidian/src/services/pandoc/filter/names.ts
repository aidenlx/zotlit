// The filenames the Pandoc integration pins, shared by the plugin bundle and by
// the script that drives a native Pandoc over both filter variants.

/** Co-location is the whole location contract: the pair keeps these exact names. */
export const PANDOC_FILTER_FILENAME = "zotlit-cite.lua";
export const PANDOC_DEFAULTS_FILENAME = "zotlit.yaml";

/** Where the sandbox variant reads its resolve map, relative to the working directory. */
export const PANDOC_RESOLVE_MAP_FILENAME = "zotlit-resolve-map.json";
