# Tautological tests

A test that restates the implementation proves the mirror, not the behavior.

- Assert against a **hand-derived** expected value — one computed independently of the code under test.
- A mock that returns X, then asserts X was returned, tests the mock setup.
- When the expected value requires the same logic as production, extract the expectation from the spec, a worked example, or a known-good fixture.
- An authoritative declarative source is a valid oracle for its consumers. For example, compare UI text with `m.message_name()` from the generated Language Pack facade: this verifies that the consumer selects the correct message while `messages/en.json` remains the single source of truth.
- A declarative definition is its own mirror: render the row and assert the controls it gives the user, or perform its action and assert the effect. Asserting a `getSettingDefinitions()` item's `type`, `name`, `desc`, `heading`, or which page carries it restates the object literal (`apps/obsidian/src/setting-tab/`).
- Pin exact translated copy at the Language Pack boundary with a known-good locale fixture. Consumer tests keep localized strings in the message source and assert through its generated facade.
