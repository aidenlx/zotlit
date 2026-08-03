# Pandoc integration packaging and installation

Research question: GitHub issue
[#610, “Choose Pandoc integration packaging and installation”](https://github.com/aidenlx/zotlit/issues/610),
an open research child of the workflow map in
[#603](https://github.com/aidenlx/zotlit/issues/603).

## Decision

Publish these two files as assets of each version-pinned ZotLit Resource
Release:

```text
zotlit-cite.lua
zotlit.yaml
```

For plugin version `<version>`, the exact URLs are:

```text
https://github.com/aidenlx/zotlit/releases/download/res-<version>/zotlit-cite.lua
https://github.com/aidenlx/zotlit/releases/download/res-<version>/zotlit.yaml
```

This uses the existing `res-<pluginVersion>` channel that supplies Language
Packs and template-data JSON Schemas. The plugin release remains limited to
`main.js`, `manifest.json`, and `styles.css`. The Obsidian community-directory
scanner reports any other release attachment as an unsupported additional
file. The failure that established this boundary was:

```text
WARNING: The release contains additional files: zotlit.zip. Only main.js, manifest.json, and styles.css are supported.
```

Obsidian installs only those standard assets from a community-plugin release
([Obsidian, “Submit your plugin”](https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin#Step+2%3A+Create+a+release)).
ZotLit's current release workflow already stages, publishes, anonymously
downloads, and byte-compares every file under `dist/resources` before it
publishes the plugin release
([release workflow](../../.github/workflows/release.yml),
[ADR 0019](../adr/0019-runtime-assets-ship-on-a-parallel-resource-release.md)).
The Lua filter and defaults file use the Resource Release for this same scanner
constraint, independent of their size or whether the plugin reads them at
runtime.

The plugin does not download, install, locate, edit, or remove the two files.
An agent asks the running plugin for the Pandoc CLI Guide, chooses a workflow
directory with the user, and downloads both matching-version assets into that
directory. The files become user-managed workflow files.

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
and remain editable without changing a ZotLit-owned release asset.

## Resource Release and version coupling

Stage `zotlit-cite.lua` and `zotlit.yaml` into
`apps/obsidian/dist/resources/` beside the generated Language Packs and
template-data JSON Schemas. The existing release job then uploads and verifies
them through the same glob. Extend the Resource Release description to name
the Pandoc files
([release staging and verification](../../.github/workflows/release.yml)).

The Resource Release tag and asset URLs derive from the plugin version. ZotLit
already centralizes this base URL as
`resourceReleaseUrl(pluginVersion)`
([`constants.ts`](../../apps/obsidian/src/lib/constants.ts)). The release job
creates and verifies `res-<version>` before it creates the `<version>` plugin
release. After the plugin release exists, the resource pair is immutable. This
ordering ensures that an installed plugin version can only point agents at a
published, verified pair built from the same commit
([ADR 0019](../adr/0019-runtime-assets-ship-on-a-parallel-resource-release.md)).

Stamp both asset headers with the compatible ZotLit plugin version. Treat an
exact plugin version and its `res-<version>` pair as one supported contract.
Do not use a rolling “latest” asset URL and do not fall back to another
version. A beta plugin points at its beta Resource Release in the same way as a
stable plugin points at its stable Resource Release.

The release assets are the canonical copies. A local download is a snapshot
owned by the user's workflow. ZotLit does not record its path or report that it
is current.

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
- Resource Release tag `res-<version>`;
- asset names `zotlit-cite.lua` and `zotlit.yaml`;
- both exact URLs built with `resourceReleaseUrl(pluginVersion)`;
- the requirement to choose one user-owned workflow directory and save both
  assets there under their exact names;
- the co-location rule and the `${.}/zotlit-cite.lua` defaults behavior;
- a matching-version warning; and
- the update procedure below.

The guide tells the agent to download into a temporary directory first. Only
after both downloads succeed does the agent replace the two destination files
as a pair. Its command examples follow redirects, fail on HTTP errors, and quote
every user-selected path. The guide does not execute downloads itself.

A representative guide fragment for installed version `2.0.0-beta.4` is:

```text
PLUGIN VERSION
  2.0.0-beta.4

ASSETS
  zotlit-cite.lua
  https://github.com/aidenlx/zotlit/releases/download/res-2.0.0-beta.4/zotlit-cite.lua

  zotlit.yaml
  https://github.com/aidenlx/zotlit/releases/download/res-2.0.0-beta.4/zotlit.yaml

INSTALL
  Choose one workflow directory. Download both assets to a temporary
  directory, then replace the destination pair. Keep the exact filenames.

DOWNLOAD
  curl --fail --location \
    --output "<temporary-directory>/zotlit-cite.lua" \
    "https://github.com/aidenlx/zotlit/releases/download/res-2.0.0-beta.4/zotlit-cite.lua"

  curl --fail --location \
    --output "<temporary-directory>/zotlit.yaml" \
    "https://github.com/aidenlx/zotlit/releases/download/res-2.0.0-beta.4/zotlit.yaml"
```

The runtime version and URLs must come from one function input so the text
cannot mix versions. This is the same version-derived URL rule already tested
for Template Workbench schema responses
([`template-workbench/cli.test.ts`](../../apps/obsidian/src/services/template-workbench/cli.test.ts)).

## Install and update workflow

For the first setup:

1. Run `obsidian zotlit:pandoc-guide` against the target vault.
2. Record the installed plugin version and the two URLs.
3. Ask the user to choose a workflow directory.
4. Download both assets to a temporary directory.
5. After both downloads succeed, place them together in the chosen directory
   as `zotlit-cite.lua` and `zotlit.yaml`.
6. Invoke Pandoc with the full quoted path to `zotlit.yaml`.

After every ZotLit update, query the guide again. Download the pair from the
new `res-<version>` URLs and replace both local files together. A failed or
partial download leaves the prior local pair unchanged. The old pair remains
usable only with its matching old plugin version; using it with the updated
plugin is outside the supported contract.

ZotLit does not automatically overwrite old copies because it does not own the
chosen workflow directory. An agent may update a copy only after the user has
placed that directory and pair in scope. Copies in other directories remain
untouched.

Do not install the pair into Pandoc's global data directory by default. Pandoc
uses an XDG data path on macOS and Unix, `%APPDATA%\pandoc` on Windows, and a
legacy `~/.pandoc` fallback; it does not create the directory
([Pandoc `--data-dir`](https://pandoc.org/MANUAL.html#option--data-dir)). A
user-chosen workflow directory is explicit, project-local when desired, and
does not create a cross-vault last-writer-wins location.

## Runtime and compatibility

The filter resolves the one input file to an absolute path, then runs the
`obsidian` subprocess with the input file's containing directory as its working
directory. Obsidian CLI selects the vault that contains its working directory
instead of the currently active vault
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

Require Pandoc **3.1.1 or newer**. `pandoc.json.decode`, which the agreed
filter uses, is available since 3.1.1
([Pandoc Lua `pandoc.json.decode`](https://pandoc.org/lua-filters.html#pandoc.json.decode),
[Pandoc 3.1.1 release](https://github.com/jgm/pandoc/releases/tag/3.1.1)).
Pandoc 3.1.0 is below the supported floor. Call
`PANDOC_VERSION:must_be_at_least("3.1.1", ...)` at filter startup
([Pandoc Lua version API](https://pandoc.org/lua-filters.html#Version.must_be_at_least)).
The resolver behavior was also exercised with Pandoc 3.6.4
([verified behavior](./wikilink-resolver-pandoc-filter-contract.md#verified-pandoc-behavior)).

The desktop prerequisites remain:

- ZotLit's declared Obsidian app minimum, currently 1.13.4
  ([`apps/obsidian/package.json`](../../apps/obsidian/package.json));
- Obsidian installer 1.12.7 or newer, with **Command line interface** enabled;
- the `obsidian` launcher available to Pandoc;
- Obsidian running with the input vault and ZotLit loaded; and
- one Markdown input file inside that vault.

Obsidian documents the installer requirement separately from the app version
and requires the desktop app for CLI control
([Obsidian CLI, installation and startup](https://help.obsidian.md/cli#Install+Obsidian+CLI)).

## Tutorial contract

The tutorial first tells the reader or agent to query
`zotlit:pandoc-guide`, download the matching pair, and keep it together. It then
uses the full path to the downloaded defaults file:

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

## Rejected choices

| Choice | Reason |
| --- | --- |
| Embed the pair in `main.js` and materialize it from the plugin | This makes the plugin write executable workflow files and hides installation from the agent. Use the existing versioned Resource Release and an explicit user-chosen directory. |
| Attach the pair to the plugin release | The community-directory scanner accepts only `main.js`, `manifest.json`, and `styles.css`; every additional file triggers the same release-validation failure recorded by ADR 0019. |
| Use one rolling Resource Release | It can give an older installed plugin a newer filter contract. Use the existing immutable `res-<version>` release. |
| Let the plugin download the pair | The plugin does not own a user workflow directory. The guide gives an agent exact versioned URLs; the user chooses the destination. |
| Install into Pandoc's global user data directory | The path varies by platform and environment, may not exist, and creates one shared cross-vault location. |
| Put the two files in separate directories | `${.}/zotlit-cite.lua` is the portable location contract. Keep the exact names together. |
| Keep local copies current automatically | Local copies are user-managed. Query the installed plugin after an update and replace the authorized pair explicitly. |
| Resolve the active vault implicitly | Obsidian CLI uses the active vault outside a vault working directory. Run it from the input file's directory. |

## Implementation consequences

1. Add reviewed source files for `zotlit-cite.lua` and `zotlit.yaml` and stamp
   their release copies with the plugin version.
2. Stage both under `apps/obsidian/dist/resources/`. Keep the plugin release at
   its existing three files. The Resource Release glob, anonymous verification,
   and attestation then cover the pair.
3. Update the Resource Release notes to list the two Pandoc workflow assets and
   state that agents install them into a user-chosen directory.
4. Register the read-only `zotlit:pandoc-guide` CLI handler. Render the version,
   tag, filenames, URLs, co-location rule, install steps, and update steps from
   `plugin.manifest.version` and `resourceReleaseUrl()`.
5. Update the end-to-end tutorial to query the guide before first setup and
   after every plugin update.
6. Test the released filter against Pandoc 3.1.1 and the project's newest
   tested Pandoc version.

## Acceptance cases

- Each `res-<version>` release contains `zotlit-cite.lua` and `zotlit.yaml`
  built from the same commit as plugin version `<version>`.
- The plugin release still contains only `main.js`, `manifest.json`, and
  `styles.css`.
- Release verification downloads and byte-compares both Pandoc assets before
  the plugin release is created.
- `zotlit:pandoc-guide` reports the installed plugin version, exact Resource
  Release tag, exact filenames, and two URLs containing that same version.
- The guide has no side effects and tells the agent to choose a directory,
  download both files to a temporary location, and replace the destination pair
  only after both downloads succeed.
- `zotlit.yaml` resolves `${.}/zotlit-cite.lua`, applies the ZotLit filter before
  citeproc, and enables `fail-if-warnings`.
- Paths containing spaces, quotes, Unicode, and Windows separators work when
  the workflow directory and command arguments are quoted.
- After a ZotLit update, the guide reports new versioned URLs. Existing local
  copies remain unchanged until an authorized agent replaces that pair.
- A failed update download preserves the complete prior pair.
- Invoking Pandoc while another vault is active still routes
  `zotlit:resolve` to the input file's vault.
- Pandoc 3.1.0 fails immediately with the explicit 3.1.1 requirement; tests
  pass on 3.1.1 and the project's newest tested version.
