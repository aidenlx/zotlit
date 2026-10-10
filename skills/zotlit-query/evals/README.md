# ZotLit Query research evaluations

The 29 cases test research answers and contract usability: one Collection discovery task, 15 existing tasks, and all 13 extra questions from `prototype/query-cli-redesign:packages/item-query/prototype-query-cli/cases.mjs`. Questions in `cases.json` are the agent's task; `oracle.json` holds expected answers and reference requests. Agents see the skill, one version-matched schema catalog, live CLI output, and their own files. Observed reads of evaluator sources fail the run.

Each run builds a private Fixture vault, copies and seeds its database, checks source identity, runs one agent, checks the saved Query Result and final answer, and removes the private vault and database. Each agent uses one executable, `obsidian`, in its agent folder. It forwards arguments to a runner-owned Unix socket; the runner invokes the fixed Obsidian CLI for that run’s vault and appends receipts to `cli-calls.jsonl` outside the agent folder. The agent needs socket access, not permission to write the log. Short socket paths live under `/tmp` to fit the macOS Unix socket path limit and are removed at cleanup. If vault removal fails, it retains the database and reports recovery paths. It does not use a personal Zotero database.

## Run

Keep desktop Obsidian open with its CLI enabled. Build the development plugin. Sign in to the selected CLI. Run desktop work sequentially through the shared lock:

```sh
taskpolicy -c utility lockf -k /tmp/zotlit-query-gate.lock pnpm exec turbo run build:dev --filter=@zotlit/obsidian --concurrency=1
taskpolicy -c utility lockf -k /tmp/zotlit-query-gate.lock caffeinate -i node skills/zotlit-query/evals/run.mjs include --agent codex --model gpt-6.1-sol --effort high
taskpolicy -c utility lockf -k /tmp/zotlit-query-gate.lock caffeinate -i node skills/zotlit-query/evals/run.mjs include --agent claude --model claude-sonnet-5-5 --effort high
```

Run every case once per model on the final integration branch:

```sh
taskpolicy -c utility lockf -k /tmp/zotlit-query-gate.lock caffeinate -i node skills/zotlit-query/evals/run.mjs all --agent codex --model gpt-6.1-sol --effort high
taskpolicy -c utility lockf -k /tmp/zotlit-query-gate.lock caffeinate -i node skills/zotlit-query/evals/run.mjs all --agent claude --model claude-sonnet-5-5 --effort high
```

`--agent` defaults to `codex`; model and effort are explicit. `--timeout-minutes` accepts 1–30 and defaults to 10. A batch runs cases sequentially, continues after a failed case, and writes `summary.json` and `summary.md` under `.scratch/zotlit-query-evals/<run>/`. Interrupting a run stops the agent process group and cleans up its vault.

Codex runs `exec --json --ephemeral --sandbox workspace-write --output-schema`. Claude runs `-p --output-format stream-json --verbose --json-schema`, with the prompt on stdin and the agent folder as its working directory. Both receive the same answer schema. Claude's `--effort` accepts the requested effort. Its restricted mode confines file tools to the working directory; Bash runs in its enabled sandbox with unsandboxed execution disabled. `dontAsk` plus allowed Bash/Read/Write/Edit tools permits unattended work. The sandbox allows the Obsidian CLI socket and denies writes to the shared Git directory. It fails at startup if sandboxing is unavailable. Safe mode and strict MCP configuration keep local hooks and connectors out of the evaluation. OS temporary files remain available to the CLI runtime. These settings follow the [Claude sandbox documentation](https://code.claude.com/docs/en/sandboxing).

The tiny `claude-sample.jsonl` records a real Claude Code 2.1.296 Bash exchange and structured final output. Session IDs, billing, and unrelated metadata were removed. Parser tests also cover warnings, failures, retries, duplicate events, and evaluator reads.

## Corpus and coverage

The base Fixture provides real source documents, an Excerpt Image, multiple Libraries, and a deliberately missing linked file. The eval seed adds:

- 125 tagged articles and three books for completeness, long exports, custom fields, creator roles, and shared bare keys.
- The same marked paper and bare Annotation key in My Library and Lab Archive, an unmarked paper, and a mark on a missing source.
- Five papers in **Query thesis**, with zero, one, and two PDFs; marks on both PDF editions; a missing linked file; a publisher link with no local path; EPUB and snapshot Attachments; and an Attachment Tag.

| Prototype case | Research task |
| --- | --- |
| no_usable_pdf | Papers without an available PDF |
| broken_links | Missing linked files |
| duplicate_pdfs | Papers with two PDFs and each file's tags |
| recently_annotated | Papers marked in a fixed date interval, each once |
| count_per_paper | Marks per paper across editions |
| count_by_year | Papers by publication year, including missing years |
| unread_in_collection | Collection papers without highlights |
| attachment_types | Files counted by type |
| fuzzy_search | Explain unavailable fuzzy search, then use the requested literal fallback |
| files_of_paper | All files of one paper, including a publisher link |
| csv_for_advisor | Convert verified JSON locally to a CSV |
| recent_with_pdf_unread | Recent papers with files and no to-read tag |
| chinese_title | Titles containing Chinese text |

The prototype's `search=` and `format=csv` forms are outside ADR 0071. Those tasks test honest capability reporting and local conversion. The date case uses January–April 2024 so the expected answer stays stable. The reading-plan case now starts from Items and returns Annotation summaries, retaining zero-mark papers in one query.

## Evidence and design issues

Each case keeps `report.json`, `report.md`, `check.json`, `answer.json`, `result.json`, `agent-events.jsonl`, and `agent-stderr.txt`. Image and export cases retain their receipts; the CSV case retains `advisor.csv`.

Reports separate environment failures, missing or malformed agent output, and wrong task answers. Metrics count Query calls by dataset, schema, guide, and Annotation Image calls from `cli-calls.jsonl`, including calls made through nested shell scripts. Each receipt records argv, exit code, stdout byte length, and time. A successful value-listing receipt also records the returned values; the Collection discovery case requires its exact path before the result query. `cliStdoutBytes` sums those bytes. Event streams still supply misreadings, evaluator-source read detection, and tool-output context bytes. A command mentioned in an event stream does not count as a CLI call without a receipt. `contextualBytes` measures completed tool-output bytes visible to the agent, including Claude Read results. It is a context-use proxy, not a token count.

Each report has **Misreadings**: the command, Diagnostic Report or Query Warnings, retry status, and observed recovery command. A successful final answer can still have misreadings. Recovery means a later successful response on that command surface; a maintainer must confirm whether it resolves the original mistake. Review these entries, excess calls, and task failures together for wrong datasets, path forms, guessed fields, and recovery loops. Triage each candidate design issue before closing the spec.

`live-projections.json` contains saved live projections and labelled contract examples. `corpus-query.test.mjs` checks all 28 reference queries against the real seeded database with the product attachment path resolver, independently of the final-answer checker. `prepare.test.mjs` checks every Item and Collection key with the product’s `isItemKey` validator. Fixture keys use Zotero’s eight-character alphabet `23456789ABCDEFGHIJKLMNPQRSTUVWXYZ`; the single-PDF and missing-file Attachments use `QCPDFS22` and `QCBRKN22`. Runner tests exercise both agent paths and batch ordering without starting model sessions.

```sh
taskpolicy -c utility lockf -k /tmp/zotlit-query-gate.lock node --test skills/zotlit-query/evals/*.test.mjs
```

For manual evidence checks, prepare a new corpus inside `.scratch`, then run the checker on a saved full envelope:

```sh
node skills/zotlit-query/evals/prepare.mjs "$PWD/.scratch/acceptance-fixture" "$PWD/.scratch/query-manual"
node skills/zotlit-query/evals/check.mjs no_usable_pdf /absolute/query-result.json "$PWD/.scratch/query-manual"
```

The `count_per_paper` checker accepts either an Annotation Query grouped by paper or an Item Query with `annotations.length` or `annotations[]`. Both are checked against the same paper/count facts. Library answers accept display names or selectors; row Indexed Keys establish Library identity for `edge` and `shared_marks`.
