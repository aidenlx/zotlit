# Testing strategy

- **E2E and integration first:** Prove features through real modules and complete user workflows. Extend an existing E2E path when it reaches the behavior.
- **Unit-test scope:** Use unit tests for syntax, queries, and dense pure logic. List failure modes before writing an isolated test.
- **Boundary mocks:** Mock only process, network, and OS boundaries. Assert outputs and effects. `zotlit-tests/no-internal-mock` enforces the module boundary.
- **Behavior:** Test the behavior a file produces. Use fixtures for test data. `zotlit-tests/no-source-text` enforces source, configuration, workflow, and documentation reads.
- **Test gates:** Run every test in a package's `test` task or the root `test:eval-runtime` task. `packages/scripts/scripts/check-test-gates.ts` checks membership during `pnpm lint`.
- **Regression issues:** Cite the issue in a regression test. Add a test when the existing behavior tests leave a gap.
- **Static rules:** Prefer a type or lint rule for a static authoring constraint.
