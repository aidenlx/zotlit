# Skill Benchmark: zotlit-template

Model: `gpt-5.6-luna`, reasoning `xhigh`. Date: 2026-09-13.

Three trials ran: one JSON-e spread trial per configuration, and one held-out
citation/partial trial with the skill. The held-out case has no no-skill baseline.

| Trial | Assertions passed | Recorded Obsidian commands | Measured command time |
| --- | --- | --- | --- |
| Spread, with skill | 3/3 | 15 | Approximate CLI range only: 0.1–0.2 s per call |
| Spread, without skill | 3/3 | 30 | 0.695 s for 10 verification commands only |
| Held-out, with skill | 3/3 | 36 | Unavailable |

Counts come from the committed transcripts in [evidence](evidence/README.md).
The baseline transcript lists repeated commands under earlier discovery and
verification; counts retain those records. These are command-record counts,
not measured runtime tool-call totals. The baseline timed subset contains nine
Obsidian invocations and one shell diff. It excludes discovery and edits.

Full trial durations, token counts, and runtime tool-call counts are unavailable
and are `null` in benchmark.json. A time or token delta cannot be computed.
The paired spread case passed in both configurations; it does not establish a
correctness advantage. One trial per tested configuration cannot establish
variance or repeatability. The held-out case is separate coverage.

One [supplemental Luna xhigh recovery trial](evidence/final-recovery-luna3/transcript.md)
on the final `c37419836` bundle records four commands (status plus three
recovery commands), the invalid-selector hint, and successful corrected
lookup. It is listed separately in benchmark.json: four retained Luna trials
in total, three in the original comparison. Supplemental duration and tokens
are unavailable. The broader fixed-case and fresh-Vault-Case gap remains open.
