# Multi-Library acceptance fixture

A disposable Zotero database plus a disposable Obsidian vault, generated from a
committed specification. Live acceptance of Library Scope runs against this
fixture instead of a personal Zotero profile.

Everything lands under `tmp/acceptance-fixture/`, which git ignores. Nothing in
the fixture is personal data, and every build reproduces the same semantic
content from `packages/scripts/lib/acceptance-fixture/spec.ts`.

## Build

```sh
pnpm fixture
```

One command from a clean checkout. It builds the workspace packages the
generator needs plus the ZotLit dev bundle, deletes any previous fixture, and
writes:

| Path                                          | Role                                          |
| --------------------------------------------- | --------------------------------------------- |
| `tmp/acceptance-fixture/zotero-data/`         | Stands in for a Zotero data directory         |
| `tmp/acceptance-fixture/zotero-profile/`      | Zotero profile whose `prefs.js` names that data directory |
| `tmp/acceptance-fixture/zt-fixture-vault/`    | Disposable Obsidian vault                     |

The vault gets ZotLit installed and enabled: `pnpm fixture` builds
`apps/obsidian/dist-dev` through turbo and copies it into the vault's plugin
folder. Running `packages/scripts/scripts/acceptance-fixture.ts` on its own
skips that build, so the vault carries the fixture data with ZotLit neither
installed nor enabled, and it says so.

## Point ZotLit at it

1. Register the vault: `packages/scripts/scripts/obsidian-vault.ts create tmp/acceptance-fixture/zt-fixture-vault`.
2. In that vault, open the ZotLit settings and set **Zotero profile** to
   `tmp/acceptance-fixture/zotero-profile` through "Choose folder…". ZotLit reads
   the data directory from that profile's `prefs.js`, so one override moves the
   whole install onto the fixture.

The override is a Device Override in the vault's local storage, so it never
touches your real Zotero settings. From an Obsidian window on that vault, the
CLI sets it directly:

```sh
obsidian-cli vault=zt-fixture-vault eval \
  "code=app.saveLocalStorage('zotlit-zotero-paths',{profileDir:'<abs path>/tmp/acceptance-fixture/zotero-profile'})"
```

## What the fixture contains

| Selector     | `libraryID` | Membership | Name                    |
| ------------ | ----------- | ---------- | ----------------------- |
| `my-library` | 1           | editable   | My Library              |
| 118          | 3           | editable   | Lab Archive             |
| 990117       | 4           | read-only  | Consortium Reading Room |
| 4200309      | 2           | editable   | Shared Reading          |

Local `libraryID` order disagrees with group ID order on purpose, so a
canonical-order check proves that selector order does not follow database row
order. Group IDs 606001 and 606002 never exist, and stand in for unavailable
selectors.

The item set carries the collisions Library Scope has to survive:

- `duplicateWithin2020` on two My Library items — ambiguity inside one Library.
- `duplicateAcross2019` in My Library and Lab Archive — ambiguity across Libraries.
- Zotero key `AAAAAAAA` in My Library and Shared Reading — one bare key, two items.
- Collection key `SHAREDCL` in three Libraries — a collection target must name its Library.
- Modification times that descend globally, with one tie across Libraries
  (`HHHH8888` and `FFFF6666`) and one inside My Library (`JJJJJJJJ` and `KKKKKKKK`).

Every Library also holds Zotero notes, so a scoped or exact note import always
finds work:

- Child notes on `AAAAAAAA` and `EEEE5555` in My Library, on `AAAAAAAA` in Shared
  Reading, on `HHHH8888` in Lab Archive, and on `IIII9999` in the read-only
  Consortium Reading Room.
- One standalone note filed in the `PERSNAL2` collection, so a collection-scoped
  import covers both a filed note and the child notes of the items filed there.
- Note key `NNNNAAAA` in My Library and Shared Reading — one bare key, two notes,
  so an exact note target must name its Library.

`pnpm fixture paths` prints the paths again, and a build prints this table.

## Select a saved scope

```sh
pnpm fixture select partial
```

| Case          | Saved Library Scope                                    |
| ------------- | ------------------------------------------------------ |
| `all`         | All Libraries (the case a fresh build starts on)       |
| `available`   | Selected Libraries, every selector available           |
| `partial`     | Selected Libraries, one selector unavailable           |
| `unavailable` | Selected Libraries, no selector available              |

`select` rewrites only the scope entry of the vault's `data.json`; restart or
reload the plugin to pick it up. A build also accepts a case:
`pnpm fixture build available`.

The persisted key and value shape live in `LIBRARY_SCOPE_SETTING_KEY` and
`PersistedLibraryScope` in `spec.ts`. They are the one place to update when the
Library Scope setting changes shape.

## Cancel a run mid-write

A batch update writes 32 items at once and the fixture holds 12, so every item
starts immediately and no item ever waits in a queue. A cancel that arrives one
macrotask after the confirm click therefore finds the whole plan in flight, and
the run reports `Done.`. Click Cancel in the same JavaScript turn as the confirm
button to reach the write-phase abort:

```sh
obsidian-cli vault=zt-fixture-vault eval code='
const modal = document.querySelector(".modal-container .modal");
[...modal.querySelectorAll("button")].find((b) => b.classList.contains("mod-cta")).click();
[...modal.querySelectorAll("button")].find((b) => /cancel/i.test(b.textContent)).click();
'
```

The confirm click renders the progress phase before it returns, so the second
click aborts the run that phase already started. The modal reports
`Stopped. 0 created, 0 updated, 0 failed.` and lists every row under `Not run`.
Delete one literature note before the run to prove the abort wrote nothing: the
aborted run leaves the note absent, and the same run without the cancel creates
it.

## Discard

```sh
pnpm fixture discard
```

Deletes `tmp/acceptance-fixture/` entirely. Unregister the vault first when you
registered it:

```sh
packages/scripts/scripts/obsidian-vault.ts remove tmp/acceptance-fixture/zt-fixture-vault --purge
```

## Changing the fixture

Edit `packages/scripts/lib/acceptance-fixture/spec.ts` and rebuild.
`packages/scripts/lib/acceptance-fixture/build.test.ts` guards the properties
the acceptance run depends on, including that a rebuild reproduces the same
semantic data.
