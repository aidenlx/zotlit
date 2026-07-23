# Comments

Prefer code over comments: use clear logic and naming to express intent, so the implementation reads as documentation.

## JSDoc

- Use JSDoc on functions, methods, and key variables when additional detail (contracts, units, invariants, non-obvious rationale) actually helps a reader.
- When documenting a function, prefer structured JSDoc tags (`@param`, `@returns`, `@throws`) over prose descriptions.
- In JSDoc comment, prefer using `@see` to point at external files, URLs, or sibling symbols rather than inlining the URL in prose. Pin URLs to a specific commit/tag when citing upstream source so the link doesn't drift.
- In JSDoc comments, prefer using `@default` (e.g. `/** @default "text" */`) instead of prose like "Defaults to …".
- Drop comments that only restate what the name, type signature, or implementation already conveys (e.g. `/** Build a fresh shallow clone of X */` above a one-line spread, or `/** Throw if X */` above a method named `requireX`). Keep only the non-obvious parts: invariants, edge cases, design rationale, and "why" over "what".
- Trim mixed JSDoc to the non-obvious parts rather than dropping the whole block. If the first sentence restates the name and the rest explains an invariant, delete the first sentence.

## Module-level

New module files get a brief `//` comment on the first line describing what the file owns or does in one sentence. Skip barrel/index files and files whose filename already names the sole concern unambiguously. Example: `// Per-batch collection-path resolution for Eta template items.`
