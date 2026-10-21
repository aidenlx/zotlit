# Testing strategy

- **E2E and integration first:** Prove features through real modules and complete user workflows. Extend an existing E2E path when it reaches the behavior.
- **Unit-test scope:** Use unit tests for syntax, queries, and dense pure logic. List failure modes before writing an isolated test.
- **Boundary mocks:** Mock only process, network, and OS boundaries. Assert outputs and effects. `zotlit-tests/no-internal-mock` enforces the module boundary.
- **Behavior:** Test the behavior a file produces. Use fixtures for test data. `zotlit-tests/no-source-text` enforces source, configuration, workflow, and documentation reads.
- **Matrices:** Give each distinct behavior one case. A combination of inputs joins the matrix only when it changes the outcome.
- **Test gates:** Run every test in a package's `test` task or the root `test:eval-runtime` task, and every `*.e2e.ts` file in the `@zotlit/e2e` `e2e` task, which `pnpm verify --release` runs on the desktop. `packages/scripts/scripts/check-test-gates.ts` checks membership during `pnpm lint`.
- **Baseline:** `packages/config/oxlint-tests-baseline.json` lists the test files that predate the two rules above. Delete an entry when its file meets both; `pnpm lint` fails on a new entry or a disable directive for either rule.
- **Regression issues:** Cite the issue in a regression test. Add a test when the existing behavior tests leave a gap.
- **Static rules:** Prefer a type or lint rule for a static authoring constraint.
