import { register } from "node:module";
import { pathToFileURL } from "node:url";

register(
  "./ts-resolve-loader.mjs",
  pathToFileURL(
    "./packages/item-lookup/scripts/prototype-multi-library-bench/",
  ),
);
