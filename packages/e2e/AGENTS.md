# @zotlit/e2e

The End-to-end Run suite — the plugin running in a real desktop Obsidian window, reading the Fixture's Zotero data directory from disk. See `packages/scripts/CONTEXT.md` for the glossary (Fixture, Fixture Vault, Scope Case, End-to-end Run).

## Commands

- `pnpm e2e` (root) or `pnpm --filter @zotlit/e2e e2e` — runs the suite.
- `pnpm --filter @zotlit/e2e typecheck` — type-checks the suite.

Deliberately no `test` script: this suite drives a real Electron app and stays out of `pnpm test` / CI, which only invoke packages that declare one.

## Requirements

Needs desktop Obsidian 1.13.4+ running locally with the CLI enabled (Settings → General → Advanced → "Command line interface"). Without a reachable Obsidian, `pnpm e2e` skips its tests cleanly and exits 0 — it does not fail.

The registered command is `obsidian` on every platform. Run `obsidian version` in a new terminal to verify registration.

The e2e vault's plugin bundle comes from `@zotlit/obsidian`'s dev build (`build:dev`), never the production build: the Scope Case assertion reads `zotlit:library-scope`, a CLI command registered only under `__DEV__` and absent from production plugin bundles.

## Scope

Two suites.

`src/end-to-end.e2e.ts` builds and registers a dedicated vault for the End-to-end Run under `.scratch/e2e-fixture-vault`, drives it over the Obsidian CLI, and tears the vault down afterward. See the [Fixture guide](../../docs/fixture.md) for the complete workflow.

`src/paired-run.e2e.ts` attaches to a Paired Run that is already up — Paired Zotero serving its Local API, and the Development Vault that run opened. It never rebuilds the Fixture: a rebuild pulls `zotero.sqlite` out from under the Paired Zotero holding it open. `src/paired-zotero.ts` carries its probes, its Local API client, and its RDP levers.

## Reproduce the Paired Run scenario

```sh
pnpm fixture open --local-api   # or: pnpm fixture dev --local-api
pnpm e2e
```

`--local-api` is what opens Zotero's Local API on the Fixture profile's HTTP port. Both commands need desktop Obsidian running with the CLI enabled, and both write the Paired Zotero's process id and remote debugging port to `<fixture root>/paired-zotero.json`.

While that Paired Run is live, `pnpm e2e` runs this scenario and skips `src/end-to-end.e2e.ts` with its reason, because that suite rebuilds the Fixture (`obsidian-vault create` → `buildFixture`) and would replace `zotero.sqlite` under the Paired Zotero holding it open. Close the Paired Run and the two swap places. The signal both suites read is `livePairedZotero` from `@zotlit/scripts/fixture`: the report has to exist **and** name a process that is still running, so a report a crashed Zotero left behind never silences the suite.

Three probes decide what runs, each evaluated at module scope before collection, each swallowing its own failures:

| Probe | Source | Absent means |
| --- | --- | --- |
| Zotero Local API | `extensions.zotero.httpServer.port` in `<fixture root>/zotero-profile/prefs.js`, then `GET /api/` with `Zotero-Allowed-Request: 1` | the whole file skips |
| Remote debugging port | `<fixture root>/paired-zotero.json`, else `ZOTERO_RDP_PORT` | the authorization tiers and the ZotLit surfaces skip |
| Development Vault | `node packages/scripts/scripts/obsidian-vault.ts id` | the tests that drive Obsidian skip |

The scenario runs in three tiers: the Local API read contract with no dialog, the authorization branches driven through a stubbed prompt over RDP, and Zotero's own dialog clicked by button slot over RDP. Afterward it restores Zotero's prompt, clears the authorizations it caused on both sides — Zotero's stored keys and ZotLit's own remembered key, so neither is left holding what the other has forgotten — and erases every Annotation it created.
