# ZotLit

## Repo shape

Turborepo + pnpm monorepo for **ZotLit**, an Obsidian plugin that integrates Zotero. Workspaces are `apps/*` and `packages/*` (declared in `pnpm-workspace.yaml`).

- `apps/obsidian` — the plugin itself (`@zotlit/obsidian`).
- `apps/zotero` — Zotero-side companion.
- `apps/website` — the ZotLit website.
- `packages/config` — shared `tsconfig.*`, `oxlint.base.ts`, `oxfmt.base.ts`. Consumed via the `@zotlit/config` exports map.
- `packages/db` — Drizzle ORM client for Zotero database query.
- `packages/item-lookup` — fuzzy item-search engine over `@zotlit/db`.
- `packages/protocol` — wire format (valibot schemas) for ZotLit ↔ Zotero HTTP + URL protocol.
- `packages/shared` — shared utilities.
- `packages/templates` — Eta-based template rendering for literature notes and citations.
- `packages/scripts` — helpful scripts.
- `packages/pdfjs-dist` — vendored pdf.js type declarations.
- `packages/zotero-types` — generated standalone TypeScript item-field shapes from Zotero's upstream schema.
- `packages/obsidian-api` — **git submodule** (`obsidianmd/obsidian-api`) providing `obsidian.d.ts`. Must be initialized via `mise run init` (or `git submodule update --init --recursive`) before typecheck succeeds.

## Bootstrap & toolchain

- `mise` pins to Node 26 version (see `mise.toml`). It also runs `corepack enable` post-install to activate pnpm at the version declared in root `package.json`.
- `mise run init` initializes git submodules, including `packages/obsidian-api` and `packages/zotero-types/zotero-schema`.

## Commands

**Prefer turbo for `build` / `test` / `lint`.** Going through turbo resolves the workspace dependency graph (upstream packages build first) and caches outputs, so repeat runs are near-instant. The root scripts below already delegate to `turbo run` — run them from the repo root:

| Command                           | What it does                                                                                                                |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `pnpm build`                      | `turbo run build` across the graph.                                                                                         |
| `pnpm dev`                        | `turbo run dev` (persistent, no cache).                                                                                     |
| `pnpm test`                       | `turbo run test` across packages that define a `test` script (typecheck + Vitest in each).                                  |
| `pnpm lint` / `pnpm lint:fix`     | Root-level `oxlint` over the whole tree. Builds deps via turbo caching, then typechecks (tsgo) + lints in one pass. **Preferred over per-package typecheck.** |
| `pnpm format` / `pnpm format:fix` | Root-level `oxfmt`.                                                                                                         |
| `pnpm quality[:fix]`              | Lint + format together via turbo.                                                                                           |

Linter/formatter are **oxlint + oxfmt**, not ESLint/Prettier. Configs live at `oxlint.config.ts` / `oxfmt.config.ts` at root and per-package, extending `@zotlit/config/oxlint` and `@zotlit/config/oxfmt`.

Scope a task to one package with a turbo filter so its deps still build first: `turbo run <task> --filter=@zotlit/obsidian`. For tight inner-loop iteration that doesn't need the dep graph (single-file Vitest, `db:pull`, etc.), call the package tool directly — see each package's `AGENTS.md`.

## Truth-first reasoning

Correctness comes before agreement. Produce the most correct, logical, and useful answer, even when that means disagreeing with the user. Treat every user claim, assumption, diagnosis, or plan as unverified until checked against evidence, logic, code, documentation, or constraints.

Default behavior:

- Reserve "yes," "correct," "exactly," and "you're right" for claims you have actually verified.
- When the user is wrong, say so clearly.
- When the user is partially right, separate the correct part from the incorrect part.
- When evidence is insufficient, say the answer is unknown or unproven.
- State facts as they are rather than reshaping them to fit the user's framing.
- Prioritize being accurate over sounding agreeable.
- Surface a better plan or alternative when one exists rather than preserving the user's plan by default.
- Hold a verified conclusion when the user pushes back; revise only when new evidence or argument actually warrants it, and say what changed your mind.

Disagreement is direct, not softened with fake agreement. Lead with the correction, then the reason:

- Good: "No. The issue is…"
- Avoid: "Yes, you're right, but…"

Avoid: agreeing without verification, flattering the user, defaulting to "you're absolutely right," treating an assumption as fact, hiding disagreement, giving a comforting answer instead of a correct one, implementing bad instructions silently, presenting uncertainty as certainty (or vice versa), and over-apologizing for correcting the user.

## Affirmative specifications

Describe the target state — what exists and what to do. Negation activates the concept it tries to suppress (the "pink elephan
t" effect), so state the replacement, not the rejection.

- Lead with what the code/spec looks like now, not what was removed or changed.
- If a contrast is needed, the positive target comes first: "Use X" or "Prefer X over Y."
- Separate "why not X" rationale into a Decisions section or conversation; keep the spec body affirmative.

## Code patterns

### Simplicity

Minimum code that solves the problem. Nothing speculative.

- Prefer KISS implementations: keep code local and direct unless abstraction has a concrete payoff.
- No features beyond what was asked. No abstractions for single-use code. No "flexibility" or "configurability" that wasn't requested.
- Bias against over-engineering: avoid speculative layers, one-caller helper files, generic plumbing, and exported DTOs/types that do not clarify a real boundary.
- Avoid defensive fallback code for APIs or invariants we intentionally depend on. Type or validate the expected boundary once, then use it directly; don't add speculative probes, alternate readiness heuristics, broad structural casts, or "just in case" branches unless there is a known runtime compatibility case to support.
- If you write 200 lines and it could be 50, rewrite it.
- When reviewing designs or code, call out unnecessary abstraction and suggest the smallest maintainable alternative. Ask: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### Function parameters

At most 3 positional parameters. Positional slots go to required, stable, obvious-from-value arguments (primary operand first). Bundle the rest into one options object — typed inline or as a named type.

### Surgical Changes

Touch only what you must. Clean up only your own mess.

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: every changed line should trace directly to the user's request.

### Comments

- Prefer code over comments: use clear logic and naming to express intent, so the implementation reads as documentation.
- Use JSDoc on functions, methods, and key variables when additional detail (contracts, units, invariants, non-obvious rationale) actually helps a reader.
- When documenting a function, prefer structured JSDoc tags (`@param`, `@returns`, `@throws`) over prose descriptions.
- In JSDoc comment, prefer using `@see` to point at external files, URLs, or sibling symbols rather than inlining the URL in prose. Pin URLs to a specific commit/tag when citing upstream source so the link doesn't drift.
- In JSDoc comments, prefer using `@default` (e.g. `/** @default "text" */`) instead of prose like "Defaults to …".
- Drop comments that only restate what the name, type signature, or implementation already conveys (e.g. `/** Build a fresh shallow clone of X */` above a one-line spread, or `/** Throw if X */` above a method named `requireX`). Keep only the non-obvious parts: invariants, edge cases, design rationale, and "why" over "what".
- Trim mixed JSDoc to the non-obvious parts rather than dropping the whole block. If the first sentence restates the name and the rest explains an invariant, delete the first sentence.
- New module files get a brief `//` comment on the first line describing what the file owns or does in one sentence. Skip barrel/index files and files whose filename already names the sole concern unambiguously. Example: `// Per-batch collection-path resolution for Eta template items.`

### Separate pure logic from stateful orchestration

Default to one cohesive module. Extract pure helpers only when the split removes real complexity from stateful orchestration, makes meaningful edge cases easier to test, or matches an existing local pattern. Pure helpers take all inputs as args, return plain results, hold no state, perform no I/O, and never import the orchestrator. Dependencies flow one direction (leaves → root); no cycles, no peer imports between same-level helpers.

Use the smallest useful split:

- Prefer private functions or private class methods before creating sibling files.
- Do not create a new file just to make an entry module look like a thin orchestrator.
- Do not introduce exported DTOs/types that are only plumbing for one caller unless they clarify a real boundary.
- If you split, keep the public import path stable by re-exporting the public surface from the entry module (aka index.ts).

Split only when at least one of the following is true and the extraction has a clear payoff:

- The file is past ~250 lines and still growing because unrelated concerns are accumulating.
- The same pure logic appears in multiple methods or modules.
- A reader has to hold both orchestration and detailed branching in their head simultaneously to follow the code.
- The pure logic has enough edge cases that unit-testing it through the orchestrator requires awkward mocking or setup.

If none of those apply, a single file with private methods is the simpler answer. Do not pre-split for hypothetical future complexity.

### Resource disposal

Use `using` / `await using` when the resource lifetime matches a lexical block scope — acquired, used, and cleaned up when control exits the enclosing `{}`.

```ts
// Scope-bound — use `await using`
await using client = createClient(uri);
await using stack = new AsyncDisposableStack();
const abort = stack.use(new DisposableAbortController());
stack.defer(() => watcher.close());

// Field disposal at arbitrary time — manual call
this.#currentSink = null;
await sink[Symbol.asyncDispose]();
```

Use manual `[Symbol.dispose]()` / `[Symbol.asyncDispose]()` when:

- The resource is stored in a class field and disposed at a different time than scope exit.
- Ownership is transferred out of the creating scope (e.g., `stack.move()`).
- Disposal is conditional on runtime logic.

`DisposableStack` / `AsyncDisposableStack` coordinate multi-resource lifetimes. Use the safe-constructor pattern (`await using stack` locally, then `stack.move()` on the success path) so partial construction rolls back automatically.

In tests: prefer `await using` for routine cleanup so disposal is exception-safe. Keep manual calls only when the test is **exercising disposal behavior itself** (drain-on-dispose, idempotent dispose, racing dispose with in-flight work).

```ts
// Routine cleanup — `await using` handles it
it("opens the resource", async () => {
  await using svc = new MyService(deps);
  await svc.ready;
  expect(svc.state).toBe("ready");
});

// Testing disposal behavior — manual call IS the assertion
it("drains on dispose", async () => {
  const svc = new MyService(deps);
  svc.enqueue("pending");
  await svc[Symbol.asyncDispose]();
  expect(svc.drained).toBe(true);
});
```

`await using` does not support destructuring. When a factory returns a plain object with multiple fields, either make the returned object itself `AsyncDisposable` or use a two-step pattern:

```ts
await using harness = await makeHarness();
const { service, settings } = harness;
```

### Regex

`arkregex`'s `regex(...)` is a zero-runtime wrapper whose only payoff is **typed capture groups**: named and positional captures come back typed off `.exec()` / `.match()` instead of `string | undefined`, and referencing a group that doesn't exist is a compile error rather than a runtime `undefined`.

Use `regex(...)` when a pattern has capture groups whose match results are read in code — especially named groups, where it removes the manual `RegExpExecArray` indexing and casts. For a pattern with no captures, or one whose results you don't consume (`.test()`, `.split()`, `.replace()` with a literal replacement), a plain regex literal or `new RegExp(...)` is the simpler choice and gains nothing from the wrapper.

For dynamic literal text, use native `RegExp.escape`.

Run the `/arkregex` skill when authoring or migrating capture-group regexes — it covers the bare `regex("…")` form, the `String.raw` pitfall that defeats type inference, and points at the library README for the full API.

### Logging

Use LogTape for all runtime logging — never `console.log` / `console.info` / `console.debug` / `console.warn` / `console.error` in feature code.

Categories form a hierarchy rooted at the workspace name: `["zotlit", "<workspace>", ...]`. See each package's `AGENTS.md` for the import pattern.

Library packages must **never** call `configure()` — that is the application's job. Libraries only `getLogger()`. The obsidian app owns `configure()` via `LoggingService`.

Prefer **structured** logging over interpolated strings:

```ts
// Good — fields are searchable
logger.info("Indexed library", { count, durationMs });
logger.error("Failed to sync attachment", { itemKey, error });
logger.warn("Database {source} watcher error", { source, error });

// Avoid — opaque blob
logger.info(`Indexed ${count} items in ${durationMs}ms`);
logger.info`Indexed ${count} items in ${durationMs}ms`;
logger.warn(`Database ${source} watcher error`, { error });
```

For expensive context, pass a lazy callback so the work is skipped when the level is filtered:

```ts
logger.debug("Stats computed", () => ({
  result: expensive(),
  elapsed: perf.now() - t0,
}));
```

### i18n

User-facing strings go through Paraglide JS. sourced from `messages/{locale}.json`.

Run `/paraglide-i18n` skill for related task

## Conventions worth knowing

- Dependency versions shared by multiple packages go in the **catalog** in
  `pnpm-workspace.yaml`; package-local dependencies stay in that package's
  `package.json`. Catalog users reference shared entries as `"oxlint": "catalog:"`.
- pnpm settings (`allowBuilds`, `minimumReleaseAge`, `catalog`) belong in `pnpm-workspace.yaml`, not under a `"pnpm"` key in `package.json`.
- `minimumReleaseAge` in `pnpm-workspace.yaml` is intentional, a supply-chain hardening measure.
- `__DEV__` is replaced at build time (`true` in dev mode, `false` in production).
- Use ripgrep (`rg`) in shell calls — a global hook denies `grep`/`egrep`/`fgrep`.
- **Package manager is pnpm.** Use `pnpm exec` instead of `npx`.
- Use ECMAScript private fields and methods (`#field`, `#method`) for internal state. Avoid TypeScript `private` for service internals.

## Agent skills

### Issue tracker

Issues and PRDs are tracked as local markdown files under `.scratch/<feature-slug>/`; there is no external PR triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Default label vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Multi-context layout — `CONTEXT-MAP.md` at the repo root points to per-workspace `CONTEXT.md` files under `apps/*` and `packages/*`. See `docs/agents/domain.md`.
