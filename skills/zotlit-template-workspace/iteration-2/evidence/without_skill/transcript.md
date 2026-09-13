# ZotLit 1086 baseline evaluation (without Workbench skill)

Date: 2026-09-13 (Asia/Singapore)
Workspace: /Users/aidenlx/repo/zotlit-repo/zotlit-v2
Scratch root: /private/tmp/zotlit-1086-luna-final/without_skill
Skill use: none (per task instruction)
Token usage: unavailable from tool runtime

## Commands and outputs

### identity

```sh
obsidian vault=fixture-vault-zotlit-v2 zotlit:template-inspect
```
Exit: 0; elapsed: 83 ms

```text
{"contractVersion":7,"command":"zotlit:template-inspect","identity":{"vault":{"name":"fixture-vault-zotlit-v2","path":"/Users/aidenlx/repo/zotlit-repo/zotlit-v2/tests/fixture-vault-zotlit-v2"},"source":{"id":"8a19f09e","databasePath":"/Users/aidenlx/repo/zotlit-repo/zotlit-v2/tmp/acceptance-fixture/zotero-data/zotero.sqlite"}},"profileDiagnostics":[],"ok":true,"documents":[{"kind":"profile","id":"zotlit-profile.books.md","label":"Books","path":"templates/zotlit-profile.books.md","profileIdentity":{"id":"V1StGXR8Z5jd","label":"Books"},"profile":{"id":"V1StGXR8Z5jd","label":"Books","bindings":{"note.literature-folder":"books","citation.references-style":"http://www.zotero.org/styles/chinese-gb7714-1987-numeric","note.import-folder":"zotero_notes","note.import-colored-highlights":false,"note.import-annotations-as-template":false}},"problems":[]},{"kind":"profile","id":"zotlit-profile.default.md","label":"Default","path":"templates/zotlit-profile.default.md","profileIdentity":{"id":"default","label":"Default"},"profile":{"id":"default","label":"Default","bindings":{"note.literature-folder":"literatures","citation.references-style":null,"note.import-folder":"zotero_notes","note.import-colored-highlights":false,"note.import-annotations-as-template":false}},"problems":[]},{"kind":"citation","id":"citation","label":"Citation Template","path":"templates/zotlit-citation.md","problems":[]},{"kind":"partial","id":"partial:book-details","label":"book-details","path":"templates/zotlit-partial.book-details.md","problems":[]}],"problems":[]}
```

### invalid-help-selector

```sh
obsidian vault=fixture-vault-zotlit-v2 zotlit:template-check --help
```
Exit: 0; elapsed: 67 ms

```text
{"contractVersion":7,"command":"zotlit:template-check","ok":false,"diagnostic":{"code":"INVALID_SELECTOR","message":"Use help zotlit:template-check for accepted selectors and disclosure flags."}}
```

### check-guide

```sh
obsidian vault=fixture-vault-zotlit-v2 zotlit:template-guide topic=check
```
Exit: 0; elapsed: 65 ms

```text
TEMPLATE CHECK

  obsidian zotlit:template-check [profile=<id-or-label>] [key=<indexed-key>] [output=all]
  obsidian zotlit:template-check draft=/absolute/path/draft.md [profile=<id-or-label>] [key=<indexed-key>]
  obsidian zotlit:template-check attempt=<id> evidence=full [output=all]

  Checks saved Profile source and dependencies, then all operation components.
  draft reads a complete document from a scratch file, without installing or saving it.
  With profile, the draft ID must match that Profile. Without profile, its manifest
  supplies a standalone identity. Draft bindings inherit current Default settings.
  Saved source is the default. Editor source is selected explicitly by template-inspect;
  to check unsaved edits, write them to a scratch file and supply draft.
  Use mode=update key=<indexed-key> to read the item's real Literature Note.
  Multiple notes require note=<vault-path>. existing=<text> supplies a controlled
  in-memory baseline. An item without a note uses a labeled synthetic baseline.
  Update follows the baseline's Profile stamp; an explicit Profile or document
  previews a proposed change. Baseline path, revision, stamp, and selected Profile
  identify the inputs. Body and frontmatter outputs show the final update fold.
  Static bodies remain unchanged. Failed fields or invalid blocks refuse the operation.
  No check writes notes, changes Profiles, or imports attachments.
  Omit key for structural validation; rendering is explicitly not checked.
  Every response includes every component status. output changes disclosure only.
  Citation Templates use document=citation with key or example and variant=main|alt.
  Shared Partials use document=partial:<name> and root=note|annotation|citation.
  Note and Annotation callers select key. Citation callers select key or example.
  Direct partial checks use the selected Profile's bindings, or Default. Partials
  called by a Profile draft use that draft's bindings. Supply document with draft
  to identify plain draft source, which stays uninstalled.
  An empty rendered string is a successful output. Any component failure fails the check.
  Each run receives a new attempt ID. The last 32 attempts remain available until
  plugin reload. Reading an expired attempt reports ATTEMPT_NOT_FOUND.

FLAGS
  root: Shared Partial caller root; required for partial rendering
  example: Built-in Citation example
[output truncated here; selected complete check data is in evaluation-output.json]
```

### create-BBBB2222

```sh
obsidian vault=fixture-vault-zotlit-v2 zotlit:template-check draft=/private/tmp/zotlit-1086-luna-final/without_skill/books-profile-draft.md profile=Books key=BBBB2222 expect-source=8a19f09e output=all
```
Exit: 0; elapsed: 78 ms

```text
{"contractVersion":7,"command":"zotlit:template-check","identity":{"vault":{"name":"fixture-vault-zotlit-v2","path":"/Users/aidenlx/repo/zotlit-repo/zotlit-v2/tests/fixture-vault-zotlit-v2"},"source":{"id":"8a19f09e","databasePath":"/Users/aidenlx/repo/zotlit-repo/zotlit-v2/tmp/acceptance-fixture/zotero-data/zotero.sqlite"}},"profileDiagnostics":[],"ok":true,"document":{"kind":"profile","id":"V1StGXR8Z5jd","label":"Books","path":"/private/tmp/zotlit-1086-luna-final/without_skill/books-profile-draft.md","profile":{"id":"V1StGXR8Z5jd","label":"Books","bindings":{"note.literature-folder":"books","citation.references-style":"http://www.zotero.org/styles/chinese-gb7714-1987-numeric","note.import-folder":"zotero_notes","note.import-colored-highlights":false,"note.import-annotations-as-template":false}},"problems":[]},"dependencies":[{"kind":"citation","id":"citation","label":"Citation Template","path":"templates/zotlit-citation.md","problems":[]},{"kind":"partial","id":"partial:book-details","label":"book-details","path":"templates/zotlit-partial.book-details.md","problems":[]}],"dependencyScope":"installed-partial-registry","freshness":{"state":"current","versions":[{"path":"templates/zotlit-citation.md","requested":"3316042624dbac5b27ccecccb5c427964223d4ca7e93dc646d89db61ac7e8b70","disk":"3316042624dbac5b27ccecccb5c427964223d4ca7e93dc646d89db61ac7e8b70","loaded":"3316042624dbac5b27ccecccb5c427964223d4ca7e93dc646d89db61ac7e8b70"},{"path":"templates/zotlit-partial.book-details.md","requested":"9db8c823b54163890b1e87789817230d2fc83a7e625a6ceff4784d5d84c8c08f","disk":"9db8c823b54163890b1e87789817230d2fc83a7e625a6ceff4784d5d84c8c08f","loaded":"9db8c823b54163890b1e87789817230d2fc83a7e625a6ceff4784d5d84c8c08f"}]},"input":{"origin":"draft","path":"/private/tmp/zotlit-1086-luna-final/without_skill/books-profile-draft.md","revision":"c0ccb4af9d1178a73cff9a42efb99d0da5fcf6aaeb5853d9333f8486c0b7558c"},"problems":[],"checks":{"structure":{"status":"passed","diagnostics":[]},"filename":{"status":"passed","diagnostics":[]},"properties":{"status":"passed","diagnostics":[],"entries":[{"key":"fixture-title","position":1,"status":"passed"},{"key":"fixture-kind","position":2,"status":"passed"},{"key":"fixture-obsolete","position":3,"status":"passed"},{"position":4,"status":"passed"},{"position":5,"status":"passed"}]},"fold":{"status":"passed","diagnostics":[]},"frontmatter":{"statu
[output truncated here; selected complete check data is in evaluation-output.json]
```

### create-BKPUBLR4

```sh
obsidian vault=fixture-vault-zotlit-v2 zotlit:template-check draft=/private/tmp/zotlit-1086-luna-final/without_skill/books-profile-draft.md profile=Books key=BKPUBLR4 expect-source=8a19f09e output=all
```
Exit: 0; elapsed: 71 ms

```text
{"contractVersion":7,"command":"zotlit:template-check","identity":{"vault":{"name":"fixture-vault-zotlit-v2","path":"/Users/aidenlx/repo/zotlit-repo/zotlit-v2/tests/fixture-vault-zotlit-v2"},"source":{"id":"8a19f09e","databasePath":"/Users/aidenlx/repo/zotlit-repo/zotlit-v2/tmp/acceptance-fixture/zotero-data/zotero.sqlite"}},"profileDiagnostics":[],"ok":true,"document":{"kind":"profile","id":"V1StGXR8Z5jd","label":"Books","path":"/private/tmp/zotlit-1086-luna-final/without_skill/books-profile-draft.md","profile":{"id":"V1StGXR8Z5jd","label":"Books","bindings":{"note.literature-folder":"books","citation.references-style":"http://www.zotero.org/styles/chinese-gb7714-1987-numeric","note.import-folder":"zotero_notes","note.import-colored-highlights":false,"note.import-annotations-as-template":false}},"problems":[]},"dependencies":[{"kind":"citation","id":"citation","label":"Citation Template","path":"templates/zotlit-citation.md","problems":[]},{"kind":"partial","id":"partial:book-details","label":"book-details","path":"templates/zotlit-partial.book-details.md","problems":[]}],"dependencyScope":"installed-partial-registry","freshness":{"state":"current","versions":[{"path":"templates/zotlit-citation.md","requested":"3316042624dbac5b27ccecccb5c427964223d4ca7e93dc646d89db61ac7e8b70","disk":"3316042624dbac5b27ccecccb5c427964223d4ca7e93dc646d89db61ac7e8b70","loaded":"3316042624dbac5b27ccecccb5c427964223d4ca7e93dc646d89db61ac7e8b70"},{"path":"templates/zotlit-partial.book-details.md","requested":"9db8c823b54163890b1e87789817230d2fc83a7e625a6ceff4784d5d84c8c08f","disk":"9db8c823b54163890b1e87789817230d2fc83a7e625a6ceff4784d5d84c8c08f","loaded":"9db8c823b54163890b1e87789817230d2fc83a7e625a6ceff4784d5d84c8c08f"}]},"input":{"origin":"draft","path":"/private/tmp/zotlit-1086-luna-final/without_skill/books-profile-draft.md","revision":"c0ccb4af9d1178a73cff9a42efb99d0da5fcf6aaeb5853d9333f8486c0b7558c"},"problems":[],"checks":{"structure":{"status":"passed","diagnostics":[]},"filename":{"status":"passed","diagnostics":[]},"properties":{"status":"passed","diagnostics":[],"entries":[{"key":"fixture-title","position":1,"status":"passed"},{"key":"fixture-kind","position":2,"status":"passed"},{"key":"fixture-obsolete","position":3,"status":"passed"},{"position":4,"status":"passed"},{"position":5,"status":"passed"}]},"fold":{"status":"passed","diagnostics":[]},"frontmatter":{"statu
[output truncated here; selected complete check data is in evaluation-output.json]
```

### update-BBBB2222

```sh
obsidian vault=fixture-vault-zotlit-v2 zotlit:template-check draft=/private/tmp/zotlit-1086-luna-final/without_skill/books-profile-draft.md profile=Books key=BBBB2222 mode=update note=books/books-duplicateWithin2020.md expect-source=8a19f09e output=all
```
Exit: 0; elapsed: 73 ms

```text
{"contractVersion":7,"command":"zotlit:template-check","identity":{"vault":{"name":"fixture-vault-zotlit-v2","path":"/Users/aidenlx/repo/zotlit-repo/zotlit-v2/tests/fixture-vault-zotlit-v2"},"source":{"id":"8a19f09e","databasePath":"/Users/aidenlx/repo/zotlit-repo/zotlit-v2/tmp/acceptance-fixture/zotero-data/zotero.sqlite"}},"profileDiagnostics":[],"ok":true,"document":{"kind":"profile","id":"V1StGXR8Z5jd","label":"Books","path":"/private/tmp/zotlit-1086-luna-final/without_skill/books-profile-draft.md","profile":{"id":"V1StGXR8Z5jd","label":"Books","bindings":{"note.literature-folder":"books","citation.references-style":"http://www.zotero.org/styles/chinese-gb7714-1987-numeric","note.import-folder":"zotero_notes","note.import-colored-highlights":false,"note.import-annotations-as-template":false}},"problems":[]},"dependencies":[{"kind":"citation","id":"citation","label":"Citation Template","path":"templates/zotlit-citation.md","problems":[]},{"kind":"partial","id":"partial:book-details","label":"book-details","path":"templates/zotlit-partial.book-details.md","problems":[]}],"dependencyScope":"installed-partial-registry","freshness":{"state":"current","versions":[{"path":"templates/zotlit-citation.md","requested":"3316042624dbac5b27ccecccb5c427964223d4ca7e93dc646d89db61ac7e8b70","disk":"3316042624dbac5b27ccecccb5c427964223d4ca7e93dc646d89db61ac7e8b70","loaded":"3316042624dbac5b27ccecccb5c427964223d4ca7e93dc646d89db61ac7e8b70"},{"path":"templates/zotlit-partial.book-details.md","requested":"9db8c823b54163890b1e87789817230d2fc83a7e625a6ceff4784d5d84c8c08f","disk":"9db8c823b54163890b1e87789817230d2fc83a7e625a6ceff4784d5d84c8c08f","loaded":"9db8c823b54163890b1e87789817230d2fc83a7e625a6ceff4784d5d84c8c08f"}]},"input":{"origin":"draft","path":"/private/tmp/zotlit-1086-luna-final/without_skill/books-profile-draft.md","revision":"c0ccb4af9d1178a73cff9a42efb99d0da5fcf6aaeb5853d9333f8486c0b7558c"},"problems":[],"checks":{"structure":{"status":"passed","diagnostics":[]},"filename":{"status":"passed","diagnostics":[]},"properties":{"status":"passed","diagnostics":[],"entries":[{"key":"fixture-title","position":1,"status":"passed"},{"key":"fixture-kind","position":2,"status":"passed"},{"key":"fixture-obsolete","position":3,"status":"passed"},{"position":4,"status":"passed"},{"position":5,"status":"passed"}]},"fold":{"status":"passed","diagnostics":[]},"frontmatter":{"statu
[output truncated here; selected complete check data is in evaluation-output.json]
```

### read-existing-note

```sh
obsidian vault=fixture-vault-zotlit-v2 read path=books/books-duplicateWithin2020.md
```
Exit: 0; elapsed: 63 ms

```text
---
title: "Within-library duplicate, first item"
zotero-key: BBBB2222
zotlit-profile: Books (V1StGXR8Z5jd)
citekey: duplicateWithin2020
---
# Within-library duplicate, first item

%%zt-managed%%
## Book details

Citation key: duplicateWithin2020

> [!info] Book details
> Type: journalArticle
> Citation key: duplicateWithin2020
%%/zt-managed%%
```

### draft-diff

```sh
diff -u /private/tmp/zotlit-1086-luna-final/without_skill/books-profile-original.md /private/tmp/zotlit-1086-luna-final/without_skill/books-profile-draft.md
```
Exit: 1; elapsed: 65 ms

```text
--- /private/tmp/zotlit-1086-luna-final/without_skill/books-profile-original.md	2026-09-13 21:40:08
+++ /private/tmp/zotlit-1086-luna-final/without_skill/books-profile-draft.md	2026-09-13 21:38:14
@@ -20,6 +20,7 @@
     value: {"$if":"zt.itemType == 'bookSection'","then":"retained"}
     merge: replace
   - value: {"fixture-spread-title":{"$eval":"zt.title"},"fixture-spread-kind":{"$eval":"zt.itemType"}}
+  - value: {"fixture-reviewed":true}
 ---
 # Book profile: {{ zt.title }}
```

### obsidian-version

```sh
obsidian version
```
Exit: 0; elapsed: 65 ms

```text
1.14.1 (installer 1.13.7)
```

### zotlit-plugin-version

```sh
obsidian vault=fixture-vault-zotlit-v2 plugin id=zotlit
```
Exit: 0; elapsed: 65 ms

```text
type	community
name	ZotLit
version	2.1.4
author	AidenLx
enabled	true
description	Plugin to integrate with Zotero, create literature notes and insert citations from a Zotero library.
```

### Scratch file setup

```sh
mkdir -p /private/tmp/zotlit-1086-luna-final/without_skill
cp /Users/aidenlx/repo/zotlit-repo/zotlit-v2/tests/fixture-vault-zotlit-v2/templates/zotlit-profile.books.md /private/tmp/zotlit-1086-luna-final/without_skill/books-profile-draft.md
```
The draft was edited with apply_patch by adding exactly `  - value: {"fixture-reviewed":true}` after the existing spread entry. `books-profile-original.md` is a scratch copy for the diff.

## Condition results

- Source identity established: yes (template-inspect reported vault fixture-vault-zotlit-v2 and source 8a19f09e).
- Draft freshness: current for create and current for update.
- JSON-e spread emits `fixture-reviewed: true`: yes (position 5).
- Existing Profile fields preserved in draft: yes.
- Literature Note text preserved in update preview: yes.
- Completion: yes; all requested checks passed and update remained a preview.
- Installed vault/Profile/Partial/notes modified: no.

## Recovery

The first help attempt used `zotlit:template-check --help` and returned INVALID_SELECTOR: Use help zotlit:template-check for accepted selectors and disclosure flags.. Recovery used `zotlit:template-guide topic=check`, then supplied the documented draft, profile, key, mode=update, note, and expect-source selectors.

Captured command elapsed time total: 695 ms (not including earlier discovery commands or file patch calls).

## Earlier discovery commands

The following commands ran before the captured verification batch. Their outputs were read only to locate the candidate CLI, target vault, Profile, Partial, and note; no implementation history or issue text was inspected.

```sh
pwd && which obsidian || true && command -v obsidian || true && ls -la /private/tmp
rg --files -g 'AGENTS.md' -g 'package.json' -g '*obsidian*' | sed -n '1,120p'
obsidian --help 2>&1 | sed -n '1,220p'
obsidian --help 2>&1 | sed -n '220,460p'
obsidian --help 2>&1 | sed -n '460,620p'; obsidian help zotlit:frontmatter-set 2>&1; obsidian help zotlit:frontmatter-eval 2>&1
obsidian vaults verbose 2>&1 | sed -n '1,120p'
obsidian vault info=path 2>&1; obsidian vault info=name 2>&1; obsidian plugins format=json 2>&1 | sed -n '1,120p'
rg -l --hidden --glob '!**/node_modules/**' --glob '!**/Library/Caches/**' 'bd0ea1a22beb8f55|8a19f09e' '/Users/aidenlx/Library/Application Support/obsidian' '/Users/aidenlx/.codex' '/Users/aidenlx/repo/zotlit-repo/zotlit-v2' 2>/dev/null | sed -n '1,160p'
jq -r 'to_entries[] | select((.key|contains("bd0ea1a22beb8f55")) or ((.value|tostring)|contains("bd0ea1a22beb8f55"))) | [.key, (.value|tostring)] | @tsv' '/Users/aidenlx/Library/Application Support/obsidian/obsidian.json' 2>&1
target='/Users/aidenlx/repo/zotlit-repo/zotlit-v2/tests/fixture-vault-zotlit-v2'; find "$target" -maxdepth 4 -type f -print | sort | sed -n '1,240p'
target='/Users/aidenlx/repo/zotlit-repo/zotlit-v2/tests/fixture-vault-zotlit-v2'; jq 'keys' "$target/.obsidian/plugins/zotlit/data.json"; jq '.profiles // .templates // .settings // .' "$target/.obsidian/plugins/zotlit/data.json" | sed -n '1,260p'; sed -n '1,220p' "$target/templates/zotlit-profile.books.md"; sed -n '1,220p' "$target/templates/zotlit-partial.book-details.md"; sed -n '1,180p' "$target/literatures/AAAAAAAA.md"
target='/Users/aidenlx/repo/zotlit-repo/zotlit-v2/tests/fixture-vault-zotlit-v2'; sed -n '1,240p' "$target/books/books-duplicateWithin2020.md"; sed -n '1,220p' "$target/literatures/BKPUBLR4.md"; sed -n '1,220p' "$target/literatures/CCCC3333.md"; sed -n '1,220p' "$target/literatures/DDDD4444.md"; sed -n '1,160p' "$target/literatures/EEEE5555.md"; sed -n '1,160p' "$target/literatures/Hensher2011.md"
obsidian vault=fixture-vault-zotlit-v2 zotlit:template-guide topic=profiles 2>&1; obsidian vault=fixture-vault-zotlit-v2 zotlit:template-guide topic=frontmatter 2>&1
obsidian vault=fixture-vault-zotlit-v2 zotlit:template-guide topic=check 2>&1; obsidian vault=fixture-vault-zotlit-v2 zotlit:template-check --help 2>&1 | sed -n '1,220p'; obsidian vault=fixture-vault-zotlit-v2 zotlit:template-inspect 2>&1 | sed -n '1,220p'
target='/Users/aidenlx/repo/zotlit-repo/zotlit-v2/tests/fixture-vault-zotlit-v2'; sed -n '1,220p' "$target/books/books-duplicateWithin2020.md"; sed -n '1,220p' "$target/literatures/BKPUBLR4.md"; sed -n '1,220p' "$target/literatures/CCCC3333.md"; sed -n '1,220p' "$target/literatures/DDDD4444.md"; sed -n '1,160p' "$target/literatures/EEEE5555.md"; sed -n '1,160p' "$target/literatures/Hensher2011.md"
obsidian vault=fixture-vault-zotlit-v2 zotlit:template-data key=BKPUBLR4 root=note expect-source=8a19f09e format=json 2>&1
obsidian vault=fixture-vault-zotlit-v2 zotlit:template-data key=BKPUBLR4 root=note full expect-source=8a19f09e format=json 2>&1 | sed -n '1,180p'
obsidian vault=fixture-vault-zotlit-v2 zotlit:template-check draft=/private/tmp/zotlit-1086-luna-final/without_skill/books-profile-draft.md profile=Books key=BBBB2222 expect-source=8a19f09e output=all 2>&1
obsidian vault=fixture-vault-zotlit-v2 zotlit:template-check draft=/private/tmp/zotlit-1086-luna-final/without_skill/books-profile-draft.md profile=Books key=BBBB2222 mode=update note=books/books-duplicateWithin2020.md expect-source=8a19f09e output=all 2>&1
obsidian vault=fixture-vault-zotlit-v2 zotlit:template-check draft=/private/tmp/zotlit-1086-luna-final/without_skill/books-profile-draft.md profile=Books key=BKPUBLR4 expect-source=8a19f09e output=all 2>&1
obsidian version 2>&1; obsidian vault=fixture-vault-zotlit-v2 plugin id=zotlit 2>&1
cp /Users/aidenlx/repo/zotlit-repo/zotlit-v2/tests/fixture-vault-zotlit-v2/templates/zotlit-profile.books.md /private/tmp/zotlit-1086-luna-final/without_skill/books-profile-original.md
diff -u /private/tmp/zotlit-1086-luna-final/without_skill/books-profile-original.md /private/tmp/zotlit-1086-luna-final/without_skill/books-profile-draft.md
```

Discovery output highlights: `/usr/local/bin/obsidian` was reachable; `obsidian.json` mapped vault id `bd0ea1a22beb8f55` to `tests/fixture-vault-zotlit-v2`; `template-inspect` reported source `8a19f09e`; the original Profile already had four entries (the fourth was an existing spread); the diff returned exit 1 because it showed the single added requested line. The original profile, Partial, and note were read only.

## Final mutation check

```sh
cmp -s /Users/aidenlx/repo/zotlit-repo/zotlit-v2/tests/fixture-vault-zotlit-v2/templates/zotlit-profile.books.md /private/tmp/zotlit-1086-luna-final/without_skill/books-profile-original.md; printf 'installed_profile_equals_original_exit=%s\\n' "$?"; shasum -a 256 /Users/aidenlx/repo/zotlit-repo/zotlit-v2/tests/fixture-vault-zotlit-v2/templates/zotlit-profile.books.md /Users/aidenlx/repo/zotlit-repo/zotlit-v2/tests/fixture-vault-zotlit-v2/templates/zotlit-partial.book-details.md /Users/aidenlx/repo/zotlit-repo/zotlit-v2/tests/fixture-vault-zotlit-v2/books/books-duplicateWithin2020.md
```

Output: `installed_profile_equals_original_exit=0`; Profile SHA-256 `99d3f5f5002545255ea5440eb51d2db264e2f3dd712d4f352457bc62e04d1543`, Partial SHA-256 `9db8c823b54163890b1e87789817230d2fc83a7e625a6ceff4784d5d84c8c08f`, note SHA-256 `98ae1a1495fc6f983e9d23c88f35f8f8ea8844088e2648df2e10205a5a881d8f`. The installed Profile equals the pre-edit scratch copy. All CLI checks were read-only, and update reported `outcome: previewed`.
