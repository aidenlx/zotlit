// Lets a script Node runs directly import plugin sources under the `@/` alias.

import { registerHooks } from "node:module";

const ALIAS = "@/";
const SOURCE = new URL("../src/", import.meta.url);

// Registration happens as this module is evaluated, so an aliased module has to
// be reached through `await import(...)`: a static import of one resolves before
// any module body runs.
registerHooks({
  /**
   * Resolves the two things the bundler resolves and Node does not: the `@/`
   * alias onto `src/`, and an extensionless specifier onto the `.ts` file
   * behind it. Everything else, node builtins and packages alike, resolves as
   * usual.
   */
  resolve(specifier, context, next) {
    const target = specifier.startsWith(ALIAS)
      ? new URL(specifier.slice(ALIAS.length), SOURCE).href
      : specifier;
    try {
      return next(target, context);
    } catch (error) {
      if (
        !Error.isError(error) ||
        (error as NodeJS.ErrnoException).code !== "ERR_MODULE_NOT_FOUND"
      ) {
        throw error;
      }
      return next(`${target}.ts`, context);
    }
  },
});
