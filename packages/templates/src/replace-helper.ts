import { EtaError } from "eta/core";

/**
 * Replace the first occurrence of `find` in an eta-generated function string,
 * throwing when `find` is absent.
 *
 * `includeDataPlugin` rewrites eta's generated `include`/`includeAsync` helper
 * source by string match. eta emits both helpers into *every* compiled
 * template, so the target is guaranteed present unless eta's codegen changed
 * (version drift). A plain `String.replace` would silently no-op there and
 * reintroduce the array-spread bug the rewrite guards against; throwing
 * surfaces it at compile time instead.
 *
 * @throws EtaError when `find` is not present in `source`.
 */
export function replaceHelper(
  source: string,
  find: string,
  replace: string,
): string {
  if (!source.includes(find)) {
    throw new EtaError(
      "Template helper rewrite failed — expected eta-generated source not " +
        "found. Re-verify the replace pattern against the installed eta " +
        `version.\nExpected substring:\n  ${find}`,
    );
  }
  return source.replace(find, replace);
}
