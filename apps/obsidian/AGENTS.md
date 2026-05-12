# @zotlit/obsidian

## Testing

Vitest runs in Node and resolves `"obsidian"` to a local mock via
`resolve.alias`. Types still come from `packages/obsidian-api`.

Run from this package:

- `pnpm test` — typechecks `tsconfig.test.json` with tsgo, then runs `vitest run`.
- `pnpm typecheck:test` — typecheck only (no test execution).
- `pnpm exec vitest run path/to/file.test.ts` — single file, no typecheck.
- `pnpm exec vitest` — watch mode.

Files:

- Runtime mock: [`__mocks__/obsidian.ts`](./__mocks__/obsidian.ts)
- Vitest config (alias + test glob): [`vitest.config.ts`](./vitest.config.ts)
- Test tsconfig (includes `src/`, `__mocks__/`, `vitest.config.ts`):
  [`tsconfig.test.json`](./tsconfig.test.json)

Extend the mock when a service starts touching new `obsidian` exports; add the
new symbol and keep the surface minimal.
