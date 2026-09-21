# Testing strategy

- **E2E-first:** Prefer end-to-end tests as the primary verification. Use them to confirm complex features work; end each run with a verifiable, repeatable artifact.
- **Failure-mode-first:** When isolated testing is justified, enumerate every failure mode before writing the code — the test list drives the implementation.
- **Earned regression tests:** A bug fix earns a regression test only when existing behavior tests leave a genuine gap. If the failure is already reachable through an E2E path, extend that path.
