# Testing strategy

- **E2E and integration first:** Prove features through real modules and complete user workflows. Extend an existing E2E path when it reaches the behavior.
- **Unit-test scope:** Use unit tests for syntax, queries, and dense pure logic. List failure modes before writing an isolated test.
- **Boundary mocks:** Mock only process, network, and OS boundaries. Assert outputs and effects. `zotlit-tests/no-internal-mock` enforces the module boundary.
- **Behavior:** Test the behavior a file produces. Use fixtures for test data. `zotlit-tests/no-source-text` enforces source, configuration, workflow, and documentation reads.
- **Markup:** A unit test asserts what an element does or says: its text, role, state, or data attributes. Classes and selectors that match them are how the host draws the element; assert them in an `*.e2e.ts` test. `zotlit-tests/no-markup-assertion` enforces it for a class read or class selector that reaches `expect`.
- **Matrices:** Give each distinct behavior one case. A combination of inputs joins the matrix only when it changes the outcome.
- **Test gates:** Run every test in a package's `test` task or the root `test:eval-runtime` task, and every `*.e2e.ts` file in the `@zotlit/e2e` `e2e` task, which `pnpm verify --release` runs on the desktop. `packages/scripts/scripts/check-test-gates.ts` checks membership during `pnpm lint`.
- **Baseline:** `packages/config/oxlint-tests-baseline.json` maps each test file that predates the three rules above, or `zotlit-effect-tests/typed-fake` (Service fakes below), to the rules it breaks. Delete a rule from an entry when its file meets it; `pnpm lint` fails on a new file or rule in an entry, or a disable directive for any of these rules. A new rule seeds its entries when it lands.
- **Regression issues:** Cite the issue in a regression test. Add a test when the existing behavior tests leave a gap. A deliberate behavior change gets its test first, seen red on the old code. A test of a join or share counts a step that runs once per join, such as the refresh call, and is seen red with the join removed.
- **Effect code:** Test it with `@effect/vitest`: `it.effect` per case, `layer(…)` to share one built Layer across cases, and `TestClock` and `TestConsole` from `effect/testing` for time and console output (root `test-timing.md` → Effect). The installed `effect` package's `ai-docs/src/09_testing/` holds the patterns. A package adds `@effect/vitest` from the catalog with its first Effect test; a plain-Vitest Effect test converts when its file is next reworked. In `apps/obsidian`, tests import `@effect/vitest`, and the `effectEntry` Vite plugin resolves it to `src/lib/effect-vitest.ts`, which adds the plugin's runtime services; `zotlit-effect-tests/no-effect-run-in-test` reports an Effect run outside it. A case reads a service's Stream from the service itself, with `Stream.runForEach` on a forked fiber.
- **Service fakes:** A fake of an Effect service or an Obsidian object keeps its real type, so typecheck reports it when the real shape changes. A layer takes `Layer.mock(Tag, { … })`, which fails on a member the test leaves out, or `Layer.succeed(Tag, Tag.of({ … }))`. A legacy consumer takes `stubService<T>(name, { … })` (`apps/obsidian/src/lib/__fixtures__/service-stub.ts`). An Obsidian source is a capability test layer (`layerHostApp`, `MemoryMetadataCache`), and plain Obsidian data has a type annotation. A fake that several tests share lives in its service's `__fixtures__.ts`. A fake's Effect members fail typed, as the real ones do, and at least one test of each consumer runs on the real layer. `zotlit-effect-tests/typed-fake` reports a fake behind a cast.

  ```ts
  const settings = Layer.mock(PluginSettings, {
    current: Effect.succeed(defaults),
  });
  ```

- **Static rules:** Prefer a type or lint rule for a static authoring constraint.
