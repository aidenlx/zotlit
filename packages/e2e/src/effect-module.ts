// The `effect` module the plugin bundles, for an eval that stands in for an
// Effect member of a plugin service: the stub builds its Effect with it.
import { createRequire } from "node:module";
import { join } from "node:path";

/** An eval expression that requires the plugin's `effect` module from the workspace. */
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

export const EFFECT_MODULE = `require(${JSON.stringify(EFFECT_MODULE_PATH)})`;
