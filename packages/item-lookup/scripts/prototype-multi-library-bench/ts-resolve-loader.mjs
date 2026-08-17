// Minimal ESM loader: when normal resolution of a relative specifier fails
// (extensionless imports inside this repo's TS sources), retry against a
// sibling `.ts` file so plain `node` (with its built-in type-stripping) can
// import this repo's TS sources without a bundler. Falls through to default
// resolution first so prebuilt `.mjs`/`.js` dependencies are untouched.
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (!specifier.startsWith(".") && !specifier.startsWith("/")) throw err;

    const base = context.parentURL
      ? fileURLToPath(context.parentURL)
      : process.cwd();
    const dir = path.dirname(base);
    const candidate = path.resolve(dir, specifier);
    const tryPaths = [`${candidate}.ts`, path.join(candidate, "index.ts")];
    for (const p of tryPaths) {
      if (existsSync(p)) return nextResolve(pathToFileURL(p).href, context);
    }
    throw err;
  }
}
