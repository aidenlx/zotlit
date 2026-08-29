# The Fixture

This guide describes the generated test environment for ZotLit and the commands that maintain it.

## Definition

The Fixture is one disposable test environment. It contains a Zotero data directory, a Zotero profile, and an Obsidian vault.

The Fixture Spec is the committed source of truth for the semantic content of the Fixture. It is in `packages/scripts/lib/fixture/spec.ts`. Each build removes the old generated tree and reproduces the environment from this spec.

The [Fixture context glossary](../packages/scripts/CONTEXT.md) defines the required terms for code and documentation.

## Build the Fixture

Run the build from the workspace root:

```sh
pnpm fixture
```

This command builds the required workspace packages and development plugin bundles. It then builds the default `all` Scope Case. The command installs and enables the ZotLit development bundle in the Fixture Vault. It also installs the pinned Better BibTeX add-on in the Fixture profile.

The generated tree is under `tmp/acceptance-fixture`:

| Path | Content |
| --- | --- |
| `tmp/acceptance-fixture/zotero-data` | Zotero data directory |
| `tmp/acceptance-fixture/zotero-data/zotero.sqlite` | Generated Zotero database |
| `tmp/acceptance-fixture/zotero-data/styles` | Bundled CSL styles, plus the Fixture Spec's user-installed styles |
| `tmp/acceptance-fixture/linked-files` | Host-native files for linked-file attachments |
| `tmp/acceptance-fixture/zotero-profile` | Zotero profile whose preferences select the generated data directory |
| `tmp/acceptance-fixture/zt-fixture-vault` | Fixture Vault |
| `tmp/acceptance-fixture/zt-fixture-vault/.obsidian/plugins/zotlit` | Installed ZotLit development bundle and Fixture settings |

`tmp/acceptance-fixture` is a path only. The generated artifact is the Fixture.

Print the three main runtime paths at any time:

```sh
pnpm fixture paths
```

## Use the Fixture Vault

The Fixture Vault contains generated Literature Notes, imported-note mirrors, and committed test pages. Its Literature Notes reference only Items in the generated Zotero data.

For plugin development, use the per-worktree Development Vault:

```sh
pnpm --filter @zotlit/obsidian dev:vault
```

This command builds the development plugin, creates or synchronizes the vault, and starts the watch build. An ordinary worktree uses `tests/fixture-vault-<worktree-folder-name>`. A Codex worktree under `.codex/worktrees/<id>/<repo>` uses `tests/fixture-vault-<repo>-<id>`. These names keep Development Vaults distinct across worktrees.

The open and sync operations rebuild the Fixture Vault before they copy it. A normal sync keeps files that exist only in the Development Vault. Use a purge sync to restore the complete generated seed:

```sh
packages/scripts/scripts/obsidian-vault.ts open --purge
```

Vault creation needs Obsidian 1.13.4 or later. Enable **Settings → General → Advanced → Command line interface**, and keep one Obsidian vault window open to host the registration calls.

Verify the registered cross-platform command in a new terminal:

```sh
obsidian version
```

Use the registered `obsidian` command on Windows, macOS, and Linux. If the command is missing, follow the official [Obsidian CLI installation guide](https://obsidian.md/help/cli#Install%20Obsidian%20CLI), then restart the terminal. ZotLit calls this command directly.

Check the host vault before you create, open, or synchronize a Development Vault:

```sh
packages/scripts/scripts/obsidian-vault.ts check
```

A successful check confirms host readiness. When it fails, open the host vault that you select and follow the exact recovery instructions in the error.

## Run a Paired Run

A Paired Run opens Paired Zotero and a Development Vault on the same Fixture. Use it to prepare both applications for a manual smoke test on macOS or Windows.

Before you start, install Obsidian 1.13.4 or later. Start Obsidian, enable **Settings → General → Advanced → Command line interface**, and complete the host-vault check above.

1. Open a finite Paired Run:

   ```sh
   pnpm fixture open [scope-case] [--purge]
   ```

   The command builds the Obsidian and Zotero extensions in parallel. It then rebuilds the Fixture, synchronizes and opens the Development Vault, and starts Paired Zotero. This order puts the selected HTTP port in the profile before Zotero starts. For an existing Development Vault, it copies the generated `data.json` and reloads ZotLit. It stores the Fixture profile and data-directory Device Overrides in vault-scoped local storage, then verifies that ZotLit opened the Fixture database. It also verifies that the companion loaded in Zotero before it reports readiness. A successful command then exits and leaves both applications open.

2. For a live development session, start a supervised Paired Run:

   ```sh
   pnpm fixture dev [scope-case] [--purge]
   ```

   This command keeps the Obsidian and Zotero watchers running after readiness. Press `Ctrl-C` to stop both watchers and Paired Zotero. The Development Vault stays open in Obsidian. If a watcher or Paired Zotero stops unexpectedly, the command stops the remaining processes and exits with an error.

Each Paired Run takes two free TCP ports. It writes the Live Updates port into the Development Vault as `server.port`, and into the Fixture profile as `extensions.zotlit.notify-url`. It writes the Zotero HTTP port into the Fixture profile as `extensions.zotero.httpServer.port`. Zotero uses that HTTP server for Better BibTeX and the local API. The ready report names both ports. A Paired Run therefore stays clear of the default Live Updates port `9091` and Zotero HTTP port `23119` used by other profiles.

The Scope Case defaults to `all`. You can use `available`, `partial`, or `unavailable` instead. Each command uses the per-worktree Development Vault and keeps files that exist only there. Add `--purge` to restore the exact generated seed. Add `--vault-case <id>` to open the Development Vault of a different [Vault Case](#vault-cases).

Both commands check for an existing Paired Zotero before they rebuild the Fixture. Close that instance if the command refuses to start. Both commands also support `ZOTERO_APP` as described in [Run the Paired Zotero](#run-the-paired-zotero).

These commands prepare the environment and report readiness. Run the manual smoke-test checklist separately.

### Trial the Pandoc export cases

Use these cases to compare the built-in and native export workflows in one Paired Run:

1. Start a clean Paired Run with `pnpm fixture open --purge`.
2. In Obsidian, open **Settings → ZotLit → Citations → Formatting**. Under **Native Pandoc workflow**, select **Save integration files**. Save `zotlit-cite.lua` and `zotlit.yaml` in one workflow folder.
3. In Paired Zotero, export the Items cited by `pandoc-export-success.md` as Better CSL JSON. Save the bibliography as `references.json`. Leave the Item cited by `pandoc-export-missing-bibliography.md` out of this file.
4. Open each note in Obsidian and run **ZotLit: Export note with citations**. Record the output file or the complete failure message.
5. Run native Pandoc for the same note. Use absolute paths and a separate output path for each case:

   ```sh
   pandoc "/absolute/path/to/input.md" --defaults "/absolute/path/to/workflow/zotlit.yaml" --bibliography "/absolute/path/to/references.json" --fail-if-warnings --output "/absolute/path/to/output.docx"
   ```

6. Compare the results with this checklist:

   | Fixture Vault note | Built-in result | Native result |
   | --- | --- | --- |
   | `pandoc-export-success.md` | The export succeeds. Check the repeated source, Citation Fragments, Citation Run, literal citation, bibliography entries, and ordinary vault link. | The export succeeds. Check the same content against the built-in output. |
   | `pandoc-export-error-intent.md` | The export stops because the `#cite:` target is not a Literature Note. | The export stops with `unresolved-citation-intent`. |
   | `pandoc-export-missing-bibliography.md` | The export succeeds because ZotLit fetches the bibliography item. Check for the Xu citation and bibliography entry. | The export stops on the citeproc warning that `xuLiteratureNoteWhose2019` is missing. Add that Item to `references.json`, then check that the next run succeeds. |

Keep Obsidian and Paired Zotero open during this trial. Save the outputs and failure text with the trial result.

## Scope Cases

A Scope Case is a named, saved Library Scope state.

| Scope Case | Saved state |
| --- | --- |
| `all` | All Fixture Libraries take part in discovery. This is the default. |
| `available` | Every selected Library is available. |
| `partial` | One selected Library is unavailable. |
| `unavailable` | No selected Library is available. |

Select a Scope Case in an existing Fixture Vault without rebuilding the database:

```sh
pnpm fixture select partial
```

Build the complete Fixture directly in a Scope Case:

```sh
pnpm fixture build partial
```

The short build form is also valid:

```sh
pnpm fixture partial
```

Use `all`, `available`, `partial`, or `unavailable` in each command.

## Vault Cases

A Vault Case is a named, saved Fixture Vault state. The Scope Case selects the saved Library Scope. The Vault Case selects everything else the vault holds: the settings file, the notes, the Profiles, and the template files.

| Vault Case | Saved state |
| --- | --- |
| `configured` | Current settings, the Books Profile, generated Literature Notes, and Imported Notes. This is the default. One Literature Note sits in the Books Profile folder and carries the Profile stamp `zotlit-profile: Books (V1StGXR8Z5jd)`; every other note is unstamped and belongs to the default Profile. |
| `fresh` | A vault with no notes, ZotLit installed, and no settings file. This is the new-user path. |
| `upgrader` | A ZotLit v2.1 vault: version-9 settings, ejected legacy slot files with visible edits, and an edited Managed Frontmatter list. |

Build the complete Fixture directly in a Vault Case:

```sh
pnpm fixture build --vault-case fresh
```

Name a Vault Case on a Paired Run:

```sh
pnpm fixture open --vault-case upgrader
```

Each Vault Case other than the default opens its own Development Vault, `tests/fixture-vault-<worktree-folder-name>-<case>`, so the cases never overwrite one another. The first open seeds the case vault with the bundle from `apps/obsidian/dist-dev`. The `select` command changes only the Scope Case; rebuild to change the Vault Case.

`pnpm fixture dev --vault-case <id>` sets `ZT_VAULT_CASE` for the Obsidian watcher, so the Vite build copies each bundle into that case's vault and hot reload reaches it. Set `ZT_VAULT_CASE` yourself to point `dev:vault` or a plain `obsidian-vault.ts open` at a case vault:

```sh
ZT_VAULT_CASE=fresh pnpm --filter @zotlit/obsidian dev:vault
```

The `fresh` case writes no settings file. It accepts only the default `all` Scope Case, and Live Updates stay off. The Paired Run still points ZotLit at the Fixture database through the Device Overrides, so the first Literature Note needs no Zotero setup.

The `upgrader` case writes the ZotLit 2.1.0 shape:

- Settings version 9, with the note bindings vault-global and no Profiles.
- `release.previous-version` set to `2.1.0`, so the release check sees a real upgrade.
- A `note.frontmatter-fields` list of the four shipped defaults plus a visible `year` field.
- The four legacy slot files `zotlit-filename.liquid.md`, `zotlit-note.liquid.md`, `zotlit-content.liquid.md`, and `zotlit-annotation.liquid.md` in the template folder. Each starts from the shipped Liquid default and carries one visible edit.

On load, ZotLit migrates the settings to the current version, sets `note.template-conversion-pending`, and opens the conversion prompt. Run `pnpm fixture --help` for the exact field list and edits, which come from the Fixture Spec.

## Run the Paired Zotero

Paired Zotero is a real Zotero 10 instance that opens the Fixture profile and data directory. Build the Fixture first, then launch it:

```sh
pnpm fixture
pnpm fixture zotero
```

The launcher uses the pinned Zotero version in `packages/scripts/lib/fixture/paired-zotero.ts`. On first use, it downloads the official macOS DMG or the Windows portable archive for the host architecture. It installs the application in a per-user, per-version cache:

| Platform | Managed application |
| --- | --- |
| macOS | `~/Library/Caches/zotlit/zotero/<version>/Zotero.app` |
| Windows | `%LOCALAPPDATA%\zotlit\zotero\<version>\<target>\Zotero_<target>` |

All worktrees reuse the cache. Windows selects the `win-arm64`, `win-x64`, or `win32` target from the Node.js host architecture. The Fixture profile disables automatic application updates, first-run prompts, sync, and backups so the managed application stays on the pinned version.

Before launch, the command writes a Gecko extension proxy into the Fixture profile. The proxy maps the ZotLit companion add-on ID to the absolute `apps/zotero/dist-dev/addon` path in the current worktree.

The build and launcher install pinned Better BibTeX 9.0.55 from an official release XPI. They verify the XPI checksum and reuse the verified download from the per-user ZotLit cache. The Fixture Spec supplies native Citation Keys. The profile disables Better BibTeX key generation and regeneration, so these keys stay stable and intentionally unkeyed Items stay unkeyed.

Set `ZOTERO_APP` to run a different application through the same profile and companion setup.

On macOS:

```sh
ZOTERO_APP=/Applications/Zotero.app pnpm fixture zotero
```

On Windows PowerShell:

```powershell
$env:ZOTERO_APP = "C:\Program Files\Zotero"
pnpm fixture zotero
```

The override must contain `Contents/MacOS/zotero` on macOS or `zotero.exe` on Windows. Unset `ZOTERO_APP` to use the managed application.

A Paired Zotero session can change the generated database. Close Paired Zotero and run `pnpm fixture` to reset the complete Fixture to the Fixture Spec. This reset behavior is part of [ADR 0022](adr/0022-fixture-database-copies-a-committed-pristine-template.md).

## Regenerate the pristine Zotero template

Each build copies `packages/scripts/lib/fixture/pristine-zotero.sqlite.gz`, then inserts the Fixture Spec rows. Zotero itself creates this committed pristine database.

Each build also lays down `packages/scripts/lib/fixture/pristine-styles.json.gz` under `zotero-data/styles`. It holds the CSL styles the same first run unpacked, so the Citation and References Style picker lists them immediately after a build.

Beside that bundled set, each build copies the styles the Fixture Spec declares in `INSTALLED_STYLES`, from `packages/scripts/lib/fixture/assets/styles/`. These stand for the styles a user installs in Zotero. Add a style by placing the `.csl` file in that folder and declaring its file, ID, and title in the Spec.

Before regeneration, align these version declarations with the target Zotero release:

| Declaration | File |
| --- | --- |
| `PINNED_ZOTERO_VERSION` | `packages/scripts/lib/fixture/paired-zotero.ts` |
| `PRISTINE_SCHEMA_VERSIONS` | `packages/scripts/lib/fixture/pristine.ts` |
| `SUPPORTED_SCHEMA_VERSIONS` | `packages/db/src/queries/schema-version.ts` |

Raise the pinned application version and the pristine schema values together. Widen the supported schema ranges when the target release writes versions outside the current ranges.

Regenerate the template with one command on macOS or Windows:

```sh
pnpm fixture harvest
```

The command first-runs the resolved Zotero application on an empty data directory. It waits for initialization, stops Zotero, checkpoints the write-ahead log, switches to the delete journal, and vacuums the database. It then checks database integrity, foreign keys, and schema versions before it writes the compressed template. It writes the compressed style archive from the same run, and reports the style count.

Rebuild and run the generator tests:

```sh
pnpm fixture && pnpm exec turbo run test --filter=@zotlit/scripts
```

Commit the regenerated template and style archive with all related version changes.

## Run the End-to-end Run suite

An End-to-end Run starts the plugin in a real desktop Obsidian window. The plugin reads the Fixture Zotero data directory from disk.

Run the suite from the workspace root:

```sh
pnpm e2e
```

Requirements:

- Obsidian 1.13.4 or later is running on the desktop.
- **Settings → General → Advanced → Command line interface** is enabled.
- The development plugin bundle can be built. The suite uses its development-only `zotlit:library-scope` command.

The suite creates and registers `tmp/e2e-fixture-vault`, points it at the Fixture data, and removes it after the run. It covers a Literature Note render through the update-all-notes batch operation. It also changes to the `available` Scope Case and verifies the reported Library Scope.

The suite does not require a running Paired Zotero. If desktop Obsidian is not reachable, all tests skip and the command exits successfully.

The `@zotlit/e2e` package has an `e2e` script and no `test` script. Therefore, the suite stays outside `pnpm test` and CI. See the [End-to-end Run maintainer instructions](../packages/e2e/AGENTS.md) for the suite contract.

## Create a Stress Build

A Stress Build adds a deterministic synthetic corpus to the Fixture for performance work. The default command uses the count declared by the Fixture Spec:

```sh
pnpm fixture stress
```

Pass a non-negative safe integer to set the synthetic Item count:

```sh
pnpm fixture stress 100000
```

Stress Build content uses one fixed seed. An ordinary `pnpm fixture` build returns to the committed Fixture Spec size.

## Inspect, discard, or change the Fixture

Use the CLI help as the current reference for data-derived Library, Collection, Item, Note, and collision details:

```sh
pnpm fixture --help
```

Discard the complete generated tree:

```sh
pnpm fixture discard
```

To change semantic content, edit `packages/scripts/lib/fixture/spec.ts` and rebuild. The generator tests in `packages/scripts/lib/fixture/build.test.ts` guard the Fixture Spec properties.
