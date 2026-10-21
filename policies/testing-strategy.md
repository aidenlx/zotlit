# Testing strategy

- **E2E and integration first:** Prove features through real modules and complete user workflows. Extend an existing E2E path when it reaches the behavior.
- **Unit-test scope:** Use unit tests for syntax, queries, and dense pure logic. List failure modes before writing an isolated test.
- **Boundary mocks:** Mock only process, network, and OS boundaries. Assert outputs and effects. `zotlit-tests/no-internal-mock` enforces the module boundary.
- **Behavior:** Test the behavior a file produces. Use fixtures for test data. `zotlit-tests/no-source-text` enforces source, configuration, workflow, and documentation reads.
- **Markup:** A unit test asserts what an element does or says: its text, role, state, or data attributes. Classes and selectors that match them are how the host draws the element; assert them in an `*.e2e.ts` test. `zotlit-tests/no-markup-assertion` enforces it for a class read or class selector that reaches `expect`.
- **Matrices:** Give each distinct behavior one case. A combination of inputs joins the matrix only when it changes the outcome.
- **Test gates:** Run every test in a package's `test` task or the root `test:eval-runtime` task, and every `*.e2e.ts` file in the `@zotlit/e2e` `e2e` task, which `pnpm verify --release` runs on the desktop. `packages/scripts/scripts/check-test-gates.ts` checks membership during `pnpm lint`.
- **Baseline:** `packages/config/oxlint-tests-baseline.json` maps each test file that predates the three rules above to the rules it breaks. Delete a rule from an entry when its file meets it; `pnpm lint` fails on a new file or rule in an entry, or a disable directive for any of the three. A new rule seeds its entries when it lands.
- **Regression issues:** Cite the issue in a regression test. Add a test when the existing behavior tests leave a gap.
- **Static rules:** Prefer a type or lint rule for a static authoring constraint.
