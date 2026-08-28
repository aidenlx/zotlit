# Tautological tests

A test that restates the implementation proves the mirror, not the behavior.

- Assert against a **hand-derived** expected value — one computed independently of the code under test.
- A mock that returns X, then asserts X was returned, tests the mock setup.
- When the expected value requires the same logic as production, extract the expectation from the spec, a worked example, or a known-good fixture.
