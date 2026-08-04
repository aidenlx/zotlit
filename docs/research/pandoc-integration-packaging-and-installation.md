# Pandoc integration packaging and installation

Research question: GitHub issue
[#610, “Choose Pandoc integration packaging and installation”](https://github.com/aidenlx/zotlit/issues/610),
an open research child of the workflow map in
[#603](https://github.com/aidenlx/zotlit/issues/603).

> **Updated by spec [#612](https://github.com/aidenlx/zotlit/issues/612).**
> The Lua filter and defaults file no longer ship as Resource Release
> download assets; they are bundled inside the plugin package itself and
> reach the user through a CLI handler or a UI action. Spec #612 also adds a
> built-in WASM export command that needs neither file. The sections below
> describe both the bundled Lua-filter path (for advanced users, agents, and
> large documents) and the new built-in export path.

## Decision

Bundle these two files with the plugin build, not as a separate release
asset:

```text
zotlit-cite.lua
zotlit.yaml
```

The plugin release remains limited to `main.js`, `manifest.json`, and
`styles.css`, and the Obsidian community-directory scanner still reports any
other release attachment as an unsupported additional file:

```text
WARNING: The release contains additional files: zotlit.zip. Only main.js, manifest.json, and styles.css are supported.
```

Obsidian installs only those standard assets from a community-plugin release
([Obsidian, “Submit your plugin”](https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin#Step+2%3A+Create+a+release)).
Bundling the two files as plugin assets — rather than uploading them as a
separate release artifact — keeps the scanner constraint satisfied without a
parallel release. It also removes the version-matching problem the earlier
Resource Release approach had to solve: because the files ship inside the
same build as `main.js`, they can never drift from the installed plugin
version.

The plugin does not download, locate, edit, or remove these files on the
user's behalf. An agent or user asks the running plugin for the Lua filter
and defaults file — through the read-only `zotlit:pandoc-guide` CLI handler,
a content-returning CLI handler, or a settings/command UI action — chooses a
workflow directory, and saves both files there. The files become user-managed
workflow files from that point on.

The defaults file locates the filter by co-location:

```yaml
from: markdown+wikilinks_title_after_pipe
filters:
  - ${.}/zotlit-cite.lua
  - citeproc
fail-if-warnings: true
```

Pandoc expands `${.}` to the directory that contains the defaults file. It
applies filters in listed order, so the ZotLit filter constructs `Cite` nodes
before citeproc resolves them
([Pandoc User's Guide, “Defaults files”](https://pandoc.org/MANUAL.html#defaults-files),
[“Lua filters”](https://pandoc.org/MANUAL.html#option--lua-filter)).
The two files must stay in one directory with these exact names. This is the
complete location contract.

The supplied defaults deliberately omit bibliography, CSL style, output
format, output path, and input path. Those values belong to the user's workflow
and remain editable without changing a ZotLit-owned bundled file.

`zotlit-cite.lua` is built in two variants from one source: a **CLI variant**
that resolves citations by calling the `zotlit:resolve` Obsidian CLI handler
against a running Obsidian instance, and a **sandbox variant** that reads a
pre-written resolve-map JSON file from the Pandoc virtual filesystem instead
of calling out to Obsidian. There is no runtime fallback between the two —
the workflow directory holds the variant that matches how the filter will
run. The sandbox variant exists for environments (WASM sandboxes,
CI, headless agents) that cannot reach a live Obsidian CLI process. Its
contract, including the shape of the resolve-map file, is defined in
[the resolver contract](./wikilink-resolver-pandoc-filter-contract.md).

## Bundled files and retrieval

Ship `zotlit-cite.lua` and `zotlit.yaml` (both filter variants) as plugin
build assets, generated or copied into the plugin bundle the same way other
generated runtime text (for example the Template Workbench Guide) is built
into `main.js`. Because they come from the same build as the running plugin,
no separate version tag, download URL, or compatibility check is needed: the
files an agent retrieves are always the pair for the installed plugin
version.

Two retrieval paths reach the user:

- **CLI handler.** A read-only handler returns the file content (or a
  reference the caller can write to disk) for an agent to save into a
  chosen workflow directory.
- **UI action.** A command or settings-panel button opens a save dialog and
  writes both files to the location the user picks.

Both paths write the *pair* together under their exact filenames. Neither
path installs the files automatically into any default location, because the
plugin does not own the user's chosen workflow directory.

## Pandoc CLI Guide

Register one agent-facing, read-only CLI handler:

```text
obsidian zotlit:pandoc-guide
```

It takes no parameters. It renders a short man-page-style guide from runtime
facts, following the existing Template Workbench Guide pattern
([`template-workbench/guide.ts`](../../apps/obsidian/src/services/template-workbench/guide.ts)).
The output must include:

- the installed `plugin.manifest.version`;
- the filter variant names (`zotlit-cite.lua` CLI variant and sandbox
  variant) and `zotlit.yaml`;
- the retrieval CLI handler and the equivalent UI action;
- the requirement to choose one user-owned workflow directory and save both
  assets there under their exact names;
- the co-location rule and the `${.}/zotlit-cite.lua` defaults behavior;
- a pointer to the built-in WASM export command as the no-file alternative;
  and
- the update procedure below.

The guide tells the agent to write into a temporary location first. Only
after both files are written successfully does the agent replace the two
destination files as a pair. Its command examples quote every user-selected
path. The guide does not write files itself; it only reports facts and the
retrieval handler's name.

The guide's facts must come from the same `plugin.manifest.version` read used
elsewhere in the plugin, so the reported filenames and variant descriptions
never mix state from two different builds. This is the same self-consistency
rule already tested for Template Workbench guide responses
([`template-workbench/cli.test.ts`](../../apps/obsidian/src/services/template-workbench/cli.test.ts)).

## Install and update workflow

For the first setup:

1. Run `obsidian zotlit:pandoc-guide` against the target vault, or open the
   equivalent settings UI.
2. Record the installed plugin version and which filter variant is needed
   (CLI or sandbox).
3. Ask the user to choose a workflow directory.
4. Retrieve both files through the CLI handler or the UI save action.
5. Place them together in the chosen directory as `zotlit-cite.lua` and
   `zotlit.yaml`.
6. Invoke Pandoc with the full quoted path to `zotlit.yaml`.

After every ZotLit update, query the guide again. Because the bundled files
always match the running plugin build, re-running retrieval after an update
gives the current pair; replace both local files together. A partial write
leaves the prior local pair unchanged. A local pair saved from an older
plugin version remains usable only with that plugin version; pairing it with
an updated plugin is outside the supported contract.

ZotLit does not automatically overwrite old copies because it does not own
the chosen workflow directory. An agent may update a copy only after the
user has placed that directory and pair in scope. Copies in other
directories remain untouched.

Do not install the pair into Pandoc's global data directory by default. Pandoc
uses an XDG data path on macOS and Unix, `%APPDATA%\pandoc` on Windows, and a
legacy `~/.pandoc` fallback; it does not create the directory
([Pandoc `--data-dir`](https://pandoc.org/MANUAL.html#option--data-dir)). A
user-chosen workflow directory is explicit, project-local when desired, and
does not create a cross-vault last-writer-wins location.

## Runtime and compatibility

This section covers the CLI variant of the filter, which is what the install
workflow above retrieves by default for a user running Pandoc against a live
Obsidian instance. The sandbox variant's virtual-filesystem resolve-map
contract is defined in
[the resolver contract](./wikilink-resolver-pandoc-filter-contract.md).

The CLI variant resolves the one input file to an absolute path, then runs
the `obsidian` subprocess with the input file's containing directory as its
working directory. Obsidian CLI selects the vault that contains its working
directory instead of the currently active vault
([Obsidian CLI, “Target a vault”](https://help.obsidian.md/cli#Target+a+vault)).

Wrap the existing `pandoc.pipe("obsidian", ...)` call in
`pandoc.system.with_working_directory(pandoc.path.directory(input), callback)`.
Pandoc has exposed the path helper since 2.12 and the scope-bound
working-directory helper since 2.8
([Pandoc Lua path API](https://pandoc.org/lua-filters.html#pandoc.path.directory),
[Pandoc Lua system API](https://pandoc.org/lua-filters.html#pandoc.system.with_working_directory)).
The handler interface from
[the resolver contract](./wikilink-resolver-pandoc-filter-contract.md) remains
`obsidian zotlit:resolve file=<absolute-path>`.

Require Pandoc **3.1.1 or newer** for the CLI and sandbox filter variants.
`pandoc.json.decode`, which the agreed filter uses, is available since 3.1.1
([Pandoc Lua `pandoc.json.decode`](https://pandoc.org/lua-filters.html#pandoc.json.decode),
[Pandoc 3.1.1 release](https://github.com/jgm/pandoc/releases/tag/3.1.1)).
Pandoc 3.1.0 is below the supported floor. Call
`PANDOC_VERSION:must_be_at_least("3.1.1", ...)` at filter startup
([Pandoc Lua version API](https://pandoc.org/lua-filters.html#Version.must_be_at_least)).
The resolver behavior was also exercised with Pandoc 3.6.4
([verified behavior](./wikilink-resolver-pandoc-filter-contract.md#verified-pandoc-behavior)).

The desktop prerequisites for the CLI filter variant remain:

- ZotLit's declared Obsidian app minimum, currently 1.13.4
  ([`apps/obsidian/package.json`](../../apps/obsidian/package.json));
- Obsidian installer 1.12.7 or newer, with **Command line interface** enabled;
- the `obsidian` launcher available to Pandoc;
- Obsidian running with the input vault and ZotLit loaded; and
- one Markdown input file inside that vault.

Obsidian documents the installer requirement separately from the app version
and requires the desktop app for CLI control
([Obsidian CLI, installation and startup](https://help.obsidian.md/cli#Install+Obsidian+CLI)).
The sandbox variant relaxes the last three of these because it never invokes
the `obsidian` CLI; it only needs its resolve-map file, per
[the resolver contract](./wikilink-resolver-pandoc-filter-contract.md).

## Built-in WASM export

Spec #612 adds a second export path that needs neither bundled file. One
command on the active file opens a modal with three choices: output format
(`docx` or `html`; PDF is not offered because it is impossible to produce
from the WASM Pandoc build), CSL style, and a save-dialog destination. The
command runs the conversion in the same persistent WASM worker the
References Sidebar uses for bibliography rendering — see
[the standalone CSL rendering architecture note](./standalone-csl-rendering-architecture.md)
for the worker and engine.

**Bibliography source.** Built-in export does not use `itemToCsl()` or any
other read of the local `zotero.sqlite` file. It resolves bibliographic data
through this chain, in order:

1. Better BibTeX, when its JSON-RPC endpoint is alive — `item.citationkey`
   plus `item.export` with the Better CSL JSON translator.
2. Otherwise Zotero's local HTTP API —
   `GET /api/users/0/items?itemKey=...&include=csljson`, sending the
   `Zotero-Allowed-Request: 1` header. The local-API preference is off by
   default; ZotLit pre-detects whether it is enabled using the existing
   Zotero prefs reader and shows a guided enable prompt when it is not.
3. Otherwise a guided error.

Nothing in this chain works while Zotero is closed; that is an error state
for built-in export, unlike the References Sidebar, which reads the database
file directly and works with Zotero closed.

**Join semantics.** Results are re-indexed by Zotero item key. Each wikilink
cites whatever CSL `id` the resolved item carries — its native Zotero
citation key when populated, or its item URI otherwise. The literal
`@citekey` syntax requires a populated citation key on the target item. Any
unresolvable citekey or missing item stops the export; built-in export is
all-or-nothing, with no partial output.

**Better BibTeX is recommended, never required.** It adds citation-key
generation, collision disambiguation, and auto-export freshness on top of the
local-API baseline. The supported floor is Zotero 7.0.31+ or 8 for the native
citation-key field, and Zotero 7.0 for the local API's multi-item
`?itemKey=` form.

## Tutorial contract

The tutorial first tells the reader or agent to query
`zotlit:pandoc-guide`, retrieve the matching filter pair, and keep it
together. It then uses the full path to the saved defaults file:

```shell
pandoc "/absolute/path/to/input.md" \
  --defaults "/user/chosen/workflow/zotlit.yaml" \
  --bibliography "/absolute/path/to/references.json" \
  --output "/absolute/path/to/output.docx"
```

Pandoc accepts a full defaults path. A named defaults file is otherwise
searched first in the working directory and then in the Pandoc user data
directory
([Pandoc `--defaults`](https://pandoc.org/MANUAL.html#option--defaults)).

Document
`--from markdown+wikilinks_title_after_pipe --lua-filter <workflow-directory>/zotlit-cite.lua --citeproc --fail-if-warnings`
as the equivalent advanced form. The defaults form is the primary path because
it keeps the reader extension, filter order, and warning policy together.

For a reader who wants a quick docx or html export without installing
anything, the tutorial should point to the built-in export command instead of
this filter path.

## Rejected choices

| Choice | Reason |
| --- | --- |
| Ship the pair on a parallel Resource Release (the earlier decision) | Solved the community-scanner constraint, but required a version-pinned tag per release, download URLs, and matching-version checks the plugin had to keep in sync. Bundling the files as plugin build assets satisfies the same scanner constraint and removes the version-coupling machinery entirely. |
| Attach the pair to the plugin release | The community-directory scanner accepts only `main.js`, `manifest.json`, and `styles.css`; every additional release file triggers the same release-validation failure recorded by ADR 0019. |
| Embed the pair in `main.js` and materialize it as loose files automatically | This makes the plugin write executable workflow files without an explicit user or agent action. Retrieval must be an explicit CLI call or UI action into a user-chosen directory. |
| Let the plugin download the pair | The plugin does not own a user workflow directory. The guide and UI action give an agent or user the file content; the user chooses the destination. |
| Install into Pandoc's global user data directory | The path varies by platform and environment, may not exist, and creates one shared cross-vault location. |
| Put the two files in separate directories | `${.}/zotlit-cite.lua` is the portable location contract. Keep the exact names together. |
| Keep local copies current automatically | Local copies are user-managed. Query the installed plugin after an update and replace the authorized pair explicitly. |
| Resolve the active vault implicitly | Obsidian CLI uses the active vault outside a vault working directory. Run it from the input file's directory. |
| Require the Lua filter for every export | A user who only wants a quick docx or html render should not need to install and manage workflow files. The built-in WASM export command covers that case without any bundled file. |

## Implementation consequences

1. Add reviewed source files for `zotlit-cite.lua` (both the CLI and sandbox
   variants) and `zotlit.yaml`, and build them into the plugin bundle from one
   source per filter variant.
2. Register the read-only `zotlit:pandoc-guide` CLI handler and a
   content-returning retrieval CLI handler. Render the version, variant
   names, filenames, co-location rule, install steps, and update steps from
   `plugin.manifest.version`.
3. Add a UI action (command or settings button) that saves both files to a
   user-chosen directory through a save dialog.
4. Add the built-in WASM export command: format/style/destination modal,
   Better-BibTeX-then-local-API bibliography resolution chain with a guided
   enable prompt for the local API preference, item-key join and citekey
   fallback, and all-or-nothing failure on any unresolved citation.
5. Update the end-to-end tutorial to query the guide before first setup and
   after every plugin update, and to mention the built-in export command as
   the no-install alternative.
6. Test the bundled filter against Pandoc 3.1.1 and the project's newest
   tested Pandoc version, for both variants.

## Acceptance cases

- The installed plugin bundles `zotlit-cite.lua` (both variants) and
  `zotlit.yaml` built from the same commit as `plugin.manifest.version`.
- The plugin release still contains only `main.js`, `manifest.json`, and
  `styles.css`.
- `zotlit:pandoc-guide` reports the installed plugin version, the filter
  variant names, the exact filenames, and the retrieval handler/UI action to
  use.
- The retrieval CLI handler and UI action have no side effects until the
  agent or user chooses a destination and confirms the write; both files are
  written together as a pair.
- `zotlit.yaml` resolves `${.}/zotlit-cite.lua`, applies the ZotLit filter
  before citeproc, and enables `fail-if-warnings`.
- Paths containing spaces, quotes, Unicode, and Windows separators work when
  the workflow directory and command arguments are quoted.
- After a ZotLit update, the guide reports the updated build's facts.
  Existing local copies remain unchanged until an authorized agent replaces
  that pair.
- A failed or partial retrieval write preserves the complete prior local
  pair.
- Invoking Pandoc with the CLI filter variant while another vault is active
  still routes `zotlit:resolve` to the input file's vault.
- Pandoc 3.1.0 fails immediately with the explicit 3.1.1 requirement; tests
  pass on 3.1.1 and the project's newest tested version.
- Built-in export with Zotero closed fails with a guided error; it never
  falls back to reading `zotero.sqlite` directly.
- Built-in export with Better BibTeX alive, and separately with only the
  local API enabled, both produce equivalent joined output keyed by Zotero
  item key.
- Built-in export stops with no output file when any cited item is
  unresolvable.
