# CLI + skill pair

Tooling facts — flags, value lists, diagnostics, error codes — belong in the CLI, drawn from the same registries the handlers use. A skill that restates them is a **cache** that drifts from the code.

The skill carries what the CLI cannot: **process** (steps and order), **policy** (choices), and **tone** (interaction style). Hand-authored, rarely changed, no canonical source in code to drift from.

- First steps discover the live contract: `help` and guide commands before acting.
- Guide commands expose tiered reference as literal English from the same code the handlers run.
- Diagnostic hints travel inside the error envelope — corrective guidance at failure time, zero standing context cost.
- If a line in the skill restates something the CLI reports, delete the line and point to the command.

See [ADR 0016](../docs/adr/0016-workbench-guidance-lives-in-the-cli-skill-stays-thin.md).
