# ZotLit Query persona evaluations

These 15 cases test the ZotLit Query skill with a controlled Zotero Fixture. The Item Query cases cover selection, export, and Indexed Key edge cases. The Annotation Query cases cover reading records, parent filters, Item-to-Annotation work, Library and Attachment identities, colors, pages, source files, file export, diagnostic recovery, positions, and Excerpt Images.

Each run creates a private vault and a copy of the generated Fixture database under `.scratch/zotlit-query-evals/`. The runner seeds the Query corpus, checks the live source identity, runs one Codex agent, checks its saved query result and final answer, writes a report, then removes the private vault and database. It keeps the database and reports recovery paths when vault removal fails. It never reads a personal Zotero database.

Build the Obsidian development plugin and keep desktop Obsidian open with a host vault. The Codex CLI must be signed in. Pass the model and reasoning effort explicitly. For this bounded CLI workflow, `gpt-5.6-sol` with `high` effort fits the multiple command surfaces and the cost of accepting a false positive.

```sh
pnpm exec turbo run build:dev --filter=@zotlit/obsidian
node skills/zotlit-query/evals/run.mjs include --model gpt-5.6-sol --effort high
node skills/zotlit-query/evals/run.mjs export --model gpt-5.6-sol --effort high
node skills/zotlit-query/evals/run.mjs edge --model gpt-5.6-sol --effort high
node skills/zotlit-query/evals/run.mjs annotations --model gpt-5.6-sol --effort high
node skills/zotlit-query/evals/run.mjs mixed --model gpt-5.6-sol --effort high
node skills/zotlit-query/evals/run.mjs position --model gpt-5.6-sol --effort high
node skills/zotlit-query/evals/run.mjs image --model gpt-5.6-sol --effort high
node skills/zotlit-query/evals/run.mjs reading_plan --model gpt-5.6-sol --effort high
node skills/zotlit-query/evals/run.mjs shared_marks --model gpt-5.6-sol --effort high
node skills/zotlit-query/evals/run.mjs attachment --model gpt-5.6-sol --effort high
node skills/zotlit-query/evals/run.mjs colors --model gpt-5.6-sol --effort high
node skills/zotlit-query/evals/run.mjs reverse_pages --model gpt-5.6-sol --effort high
node skills/zotlit-query/evals/run.mjs missing_source --model gpt-5.6-sol --effort high
node skills/zotlit-query/evals/run.mjs repair_filter --model gpt-5.6-sol --effort high
node skills/zotlit-query/evals/run.mjs export_annotations --model gpt-5.6-sol --effort high
```

`--timeout-minutes` sets the agent deadline from 1 to 30 minutes; the default is 10. The runner prints the report path. It keeps `report.json`, `check.json`, `answer.json`, `result.json`, `agent-events.jsonl`, and `agent-stderr.txt` for each run. The image case also keeps `image.json`; `reading_plan` keeps `item-result.json`; `export_annotations` keeps `export-receipt.json`. The agent receives a copy of the skill, both query schema catalogs, and one prompt from [cases.json](cases.json). It does not receive [oracle.json](oracle.json). The runner rejects observed reads of evaluator sources.

The Item Query corpus has 125 tagged journal articles and three edge-case books across My Library and Lab Archive. The Annotation Query corpus adds two marked copies of a figure-design paper with shared bare Zotero keys, one unmarked paper, and one mark whose source file is missing. Its PDF copies contain the committed *Ten Simple Rules for Better Figures* PDF; their quoted text and positions follow reviewed Fixture Annotations. The Fixture's original paper has eight Annotations in reading order, including the image Annotation `FDRFQ7C2`. The image case requires the agent to query that Annotation, follow `hasExcerptImage`, call `zotlit:annotation-image`, and read the returned PNG.

The report separates `environment` failures during setup or process execution, `agent` failures for missing or malformed agent output, and `task` failures in a complete result or answer. Its metrics distinguish Item Query, Annotation Query, and Excerpt Image calls. `contextualBytes` counts completed shell output visible in the Codex event log as a context-use proxy.

The helper and checker can also run without an agent. Prepare requires an existing generated Fixture root and a new destination inside this repository's `.scratch` directory:

```sh
node skills/zotlit-query/evals/prepare.mjs "$PWD/.scratch/acceptance-fixture" "$PWD/.scratch/zotlit-query-eval-manual"
node skills/zotlit-query/evals/check.mjs annotations "$PWD/.scratch/zotlit-query-eval-manual/results/annotations.json" "$PWD/.scratch/zotlit-query-eval-manual"
node skills/zotlit-query/evals/check.mjs reading_plan "$PWD/.scratch/zotlit-query-eval-manual/results/reading-plan-annotations.json" "$PWD/.scratch/zotlit-query-eval-manual" "$PWD/.scratch/zotlit-query-eval-manual/results/reading-plan-items.json"
node --test skills/zotlit-query/evals/*.test.mjs
```

The checker reads the complete JSON envelope saved at the result path. Its database and vault identity must match the prepared copy. The tests build a temporary Fixture, prove byte-identical seeds, and use a fake agent to check pass, wrong answer, timeout, and cleanup paths. They do not start a model session.
