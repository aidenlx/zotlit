# Item Query persona evaluations

These three cases test the Item Query skill with a controlled Zotero Fixture. Each run creates a private vault and a copy of the generated Fixture database under `.scratch/item-query-evals/`. The runner seeds the copy, checks the live source identity, runs one Codex agent, checks its saved query result and final answer, writes a report, then removes the private vault and database. If vault removal fails, it keeps the database and lists the recovery paths in `cleanupRequired`. It does not read a personal Zotero database.

Build the Obsidian development plugin and keep desktop Obsidian open with a host vault. The Codex CLI must be signed in. Run one case at a time from the repository root:

```sh
pnpm exec turbo run build:dev --filter=@zotlit/obsidian
node skills/zotlit-item-query/evals/run.mjs include --model gpt-6-sol --effort medium
node skills/zotlit-item-query/evals/run.mjs export --model gpt-6-sol --effort medium
node skills/zotlit-item-query/evals/run.mjs edge --model gpt-6-sol --effort medium
```

`--timeout-minutes` sets the agent deadline from 1 to 30 minutes; the default is 10. The runner prints the report path. It keeps `report.json`, `check.json`, `answer.json`, `result.json`, `agent-events.jsonl`, and `agent-stderr.txt` under that run's `.scratch` directory when available. The agent sees a copy of the skill and one prompt from [cases.json](cases.json). It does not receive [oracle.json](oracle.json). These copied inputs isolate task context, not filesystem reads; the runner checks observed commands for evaluator-source access.

The article corpus has 125 tagged journal articles. The first 100 are in My Library; the other 25 are in Lab Archive. It includes long abstracts, a `review.status` custom field, and 13 missing publication years. The `include` case expects 42 articles, including five without a year. The `export` case expects all 125. The `edge` case expects three books: two have the bare key `EVALSAME` in different libraries, and an edited handbook has no author. Keys beginning `QEV` use digits 2–9 because Zotero object keys cannot contain 0 or 1.

The report separates `environment` failures during setup or process execution, `agent` failures for missing or malformed agent output, and `task` failures in a complete result or answer. `calls` counts completed shell calls. `queryAttempts` counts Item Query CLI commands; `queryExitZero` counts those with exit code zero. The checker also requires a complete successful envelope, so a redirected CLI reply can pass. `queryRetries` counts a query after an observed failed query. `contextualBytes` is the byte count of completed shell output visible in the Codex event log; it is a context-use proxy, not the model's total token count. Any observed read of evaluator source files invalidates the run.

The helper and checker can also run without an agent. Prepare requires an existing generated Fixture root and a new destination inside this repository's `.scratch` directory:

```sh
node skills/zotlit-item-query/evals/prepare.mjs "$PWD/.scratch/acceptance-fixture" "$PWD/.scratch/item-query-eval-manual"
node skills/zotlit-item-query/evals/check.mjs include "$PWD/.scratch/item-query-eval-manual/results/include.json" "$PWD/.scratch/item-query-eval-manual"
node --test skills/zotlit-item-query/evals/*.test.mjs
```

The checker reads the complete JSON envelope saved at the result path. Its database and vault identity must match the prepared copy. The tests build a temporary Fixture, prove byte-identical seeds, and use a fake agent to check pass, wrong answer, timeout, and cleanup paths. They do not start a model session.
