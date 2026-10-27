// The `effect` module the plugin bundles, for an eval that stands in for an
// Effect member of a plugin service: the stub builds its Effect with it.
import { createRequire } from "node:module";
import { join } from "node:path";

/** Resolved path for typed page callbacks that use the plugin's Effect module. */
export const EFFECT_MODULE_PATH = createRequire(
  join(
    import.meta.dirname,
    "..",
    "..",
    "..",
    "apps",
    "obsidian",
    "package.json",
  ),
).resolve("effect");
