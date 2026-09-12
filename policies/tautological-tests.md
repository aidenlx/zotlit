# Tautological tests

- **Independent oracles:** Derive expected values, membership, and counts from worked examples or known-good fixtures; keep them independent of returned results and production algorithms.
- **Mock echoes:** Assert the real code's decisions, transformations, or effects, rather than a mocked value passing through unchanged.
- **Declaration mirrors:** Exercise rendered controls or registered actions instead of asserting definition literals.
- **Canonical sources:** Authoritative declarations are valid oracles for consumers. Pin exact translated copy at the translation boundary; consumers use canonical messages.
- **Consumer boundaries:** Verify wiring through the real consumer lifecycle. Direct hook calls establish hook behavior only; generated output must work when consumed.
- **Bulk output:** Parse or index artifacts once, then compare relevant keys and fields. Keep whole-output scans constant per artifact as the expected collection grows.
- **Duplicate coverage:** Keep detailed behavior tests in the owning module and integration tests at consumers. Before deleting a duplicate, identify the retained test that catches the same regression.
