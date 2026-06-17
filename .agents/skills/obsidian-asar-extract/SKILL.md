---
name: obsidian-asar-extract
description: |
  Extract and format Obsidian's runtime source (app.js and siblings) from an Obsidian
  `.asar` archive into `node_modules/.ob-rev-<version>/` so it can be grepped and read for
  reverse engineering. Use this whenever you need to inspect Obsidian internals, look up a
  minified export, hook an undocumented API, or before running the obsidian-reverse-engineer
  agent — anytime the analysis needs a readable `app.js` and it isn't extracted yet.
---

# Extract Obsidian source for reverse engineering

Obsidian ships its runtime as a single minified `app.js` packed inside an `.asar` archive.
To analyze it (grep for export tables, trace minified classes, map internal vars to public
API names), you first need that `app.js` extracted and formatted into many lines so line
numbers and `rg` are meaningful. This skill does exactly that.

The output lands at `node_modules/.ob-rev-<version>/` — `app.js` plus the other top-level
runtime bundles (`enhance.js`, `i18n.js`, `worker.js`, …), all formatted with oxfmt. The
`obsidian-reverse-engineer` agent reads `node_modules/.ob-rev-<version>/app.js` as its
source of truth.

## Resolve a version, reuse if already extracted

First settle on a **target version** `V`. If the user names one, use it. Otherwise default to
the version the plugin is built against — see "Default version" below. Then walk this order;
stop at the first hit:

1. **Reuse exact** — `node_modules/.ob-rev-<V>/app.js` exists → use it directly.
2. **Reuse near** — newest `node_modules/.ob-rev-<V.major>.<V.minor>.*/` exists → use it, and
   note the patch substitution (e.g. "analyzing 1.13.2 for target 1.13.1").
3. **Extract a named installed asar** — newest `obsidian-<V.major>.<V.minor>.*.asar` in the
   per-user dir (version is free from the filename) → extract it.
4. **Probe + extract the bundled archive** — read the bundled `obsidian.asar`'s version with
   `probe-version.mjs`; if it shares `V`'s `major.minor`, extract it.
5. **GitHub** — exact `vV` release exists → download `.asar.gz`, extract.
6. **Stop and ask** — nothing matches `V`'s `major.minor` (insider build, offline) → report `V`
   and the versions you found, and ask for an `--asar` path.

Never substitute across a **minor** boundary: a `1.12.x` archive is not a stand-in for a
`1.13.x` target. Reuse is the common case across repeated RE sessions, so always check the
`.ob-rev-*` directories before touching an archive.

### Default version

When no version is named, the target is the Obsidian API the plugin actually compiles against:

- **Primary** — the `obsidian` package version *as resolved from `apps/obsidian`* (it declares
  `"obsidian"` as a dependency; follow that resolution rather than hardcoding a path):
  ```bash
  node -e "import('node:module').then(({createRequire})=>console.log(createRequire('$PWD/apps/obsidian/')('obsidian/package.json').version))"
  ```
- **Fallback** — if that can't resolve, `apps/obsidian/package.json` → `obsidian.minAppVersion`.

`minAppVersion` is only a compatibility floor, so it is the fallback, not the default: you want
the `app.js` whose export tables line up with the `obsidian.d.ts` you cross-reference.

### Probe an archive's version

`obsidian-<version>.asar` filenames carry the version, but the bundled `obsidian.asar` does not.
Read it without extracting:

```bash
node .agents/skills/obsidian-asar-extract/probe-version.mjs --asar <path-to-archive>   # prints e.g. 1.12.7
```

This is read-only (in-memory Buffer). Do **not** use the `asar extract-file` CLI to peek — it
writes the file into the current directory and will clobber a same-named file.

## Run it

```bash
node .agents/skills/obsidian-asar-extract/extract.mjs --asar <path-to-archive> [--force]
```

- `--asar` (required) — path to the archive. The script does **not** search your disk; you
  point it at the file. Run with no `--asar` to print the common per-OS locations.
- `--out` (optional) — override the output directory (default `node_modules/.ob-rev-<version>/`).
- `--force` — re-extract even if `node_modules/.ob-rev-<version>/app.js` already exists.

The version is read from the archive's internal `package.json` — the single source of truth —
so the output directory always matches the runtime.

The script prints the resolved output directory as the final stdout line, so a caller can
capture it. Re-runs are idempotent (skip unless `--force`).

## Get an archive

A runtime archive contains `app.js`. The sibling `app.asar` is only the launcher (no
`app.js` — the script rejects it). Two on-disk sources:

**Auto-updated** (newest), per-user — version is in the filename:

| Platform | Path |
| --- | --- |
| macOS | `~/Library/Application Support/obsidian/obsidian-<version>.asar` |
| Linux | `~/.config/obsidian/obsidian-<version>.asar` |
| Windows | `%APPDATA%\obsidian\obsidian-<version>.asar` |

**Bundled with the installed app** (installer version, often older) — `obsidian.asar`
with no version in its name; the version comes from its internal `package.json` either way:

| Platform | Path |
| --- | --- |
| macOS | `/Applications/Obsidian.app/Contents/Resources/obsidian.asar` |
| Windows / Linux | `<install dir>/resources/obsidian.asar` |

To analyze a version you don't have installed, download it from GitHub releases:

```bash
gh release download v<version> --repo obsidianmd/obsidian-releases --pattern '*.asar.gz'
gunzip obsidian-<version>.asar.gz
node .agents/skills/obsidian-asar-extract/extract.mjs --asar obsidian-<version>.asar
```

## After extraction

Analyze `node_modules/.ob-rev-<version>/app.js` with `rg` and targeted `Read` (it is large —
~200k lines). The minified export tables (`PublicName: () => minifiedVar`) live in `app.js`
itself and are the source for name mappings. See the `obsidian-reverse-engineer` agent for
the full analysis workflow.

## Implementation notes

- Extraction uses `@electron/asar` (root devDependency); formatting uses the `oxfmt` Node API
  (`format(fileName, source, opts)`). Both resolve from the repo's `node_modules`.
- Only top-level `*.js` files are formatted; `lib/` (vendored deps) is left raw since the RE
  workflow rarely needs it.
- Reading from an archive uses the in-memory `extractFile`/`extractAll` APIs, never the
  `asar extract-file` CLI (which writes into the current directory). `extract.mjs` also refuses
  to delete an `--out` directory unless it is empty or a prior extraction (carries `app.js`),
  so a misaimed `--out` can't wipe real files.
- Minified variable names drift between Obsidian versions — always re-derive mappings from the
  `app.js` of the version you extracted.
