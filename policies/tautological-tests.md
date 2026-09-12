# Tautological tests

- **Independent oracles:** Derive expected values, membership, and counts from worked examples or known-good fixtures; keep them independent of returned results and production algorithms.
- **Mock echoes:** Assert the real code's decisions, transformations, or effects, rather than a mocked value passing through unchanged.
- **Declaration mirrors:** Exercise rendered controls or registered actions instead of asserting definition literals.
- **Canonical sources:** Authoritative declarations are valid oracles for consumers. Pin exact translated copy at the translation boundary; consumers use canonical messages.
- **Duplicate coverage:** Keep detailed behavior tests in the owning module and integration tests at consumers. Before deleting a duplicate, identify the retained test that catches the same regression.
