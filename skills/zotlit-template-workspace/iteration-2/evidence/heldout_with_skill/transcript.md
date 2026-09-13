# Held-out evaluation transcript

- Task: Check both Citation Variants for the Fixture Citation Template and inspect the Books Shared Partial in its supported caller context.
- Mode: read-only.
- Candidate skill: `/Users/aidenlx/repo/zotlit-repo/zotlit-v2/skills/zotlit-template/SKILL.md`.
- Obsidian CLI skill: `/Users/aidenlx/.agents/skills/obsidian-cli/SKILL.md`.
- Vault selector supplied: `bd0ea1a22beb8f55`.
- Every ZotLit CLI call below uses `vault=bd0ea1a22beb8f55` first and, after identity discovery, `expect-source=8a19f09e`.

## Skill and CLI instructions read

Command:

```sh
sed -n '1,240p' /Users/aidenlx/repo/zotlit-repo/zotlit-v2/skills/zotlit-template/SKILL.md && printf '\n--- obsidian-cli skill ---\n' && sed -n '1,260p' /Users/aidenlx/.agents/skills/obsidian-cli/SKILL.md
```

Relevant candidate workflow facts recorded: inspect first; use `template-guide` topics `citations` and `partials`; use `template-check`; inspect affected outputs; require current source revisions and passing checks before completion. Contract version must be checked.

## Identity and live guide discovery

Command:

```sh
command -v obsidian || true
obsidian help zotlit
```

Output: `/usr/local/bin/obsidian`; the help listed `zotlit:template-guide`, `zotlit:template-inspect`, `zotlit:template-check`, `zotlit:template-data`, and `zotlit:template-status`. The initial help topic list was incomplete for this candidate contract, so the live guide was read next.

Command:

```sh
obsidian help zotlit:template-guide
```

Output: Workbench synopsis with `template-inspect`, `template-check`, and guide topics `inspect|check|data|frontmatter|profiles|citations|partials|troubleshooting|liquid|eta`.

Command:

```sh
obsidian vaults
```

Output included `fixture-vault-zotlit-v2` among the open vaults.

Commands (parallel):

```sh
obsidian vault=bd0ea1a22beb8f55 zotlit:template-guide
obsidian vault=bd0ea1a22beb8f55 zotlit:template-guide topic=citations
obsidian vault=bd0ea1a22beb8f55 zotlit:template-guide topic=partials
obsidian vault=bd0ea1a22beb8f55 zotlit:template-status
```

Guide outputs:

- `citations`: check each requested variant separately; variants are `main` and `alt`; use `document=citation`, `example=two-items`, and select `output=citation`.
- `partials`: check `document=partial:<name> root=note|annotation|citation key=<indexed-key> profile=<id-or-label> output=partial`; a Shared Partial has no root of its own; `profile` selects caller bindings; check the affected Profile or Citation caller as well.

Status output established the identity and contract:

```json
{
  "contractVersion": 7,
  "pluginVersion": "2.1.4",
  "identity": {
    "vault": {
      "name": "fixture-vault-zotlit-v2",
      "path": "/Users/aidenlx/repo/zotlit-repo/zotlit-v2/tests/fixture-vault-zotlit-v2"
    },
    "source": {
      "id": "8a19f09e",
      "databasePath": "/Users/aidenlx/repo/zotlit-repo/zotlit-v2/tmp/acceptance-fixture/zotero-data/zotero.sqlite"
    }
  }
}
```

The status also reported Profile `Books`, id `V1StGXR8Z5jd`, document `zotlit-profile.books.md`, with `match: itemType == "book"`, and the installed `zotlit-citation.md` and `zotlit-partial.book-details.md` files.

## Target inspection

Commands (parallel):

```sh
obsidian vault=bd0ea1a22beb8f55 help zotlit:template-check
obsidian vault=bd0ea1a22beb8f55 zotlit:template-inspect document=zotlit-citation.md source=full expect-source=8a19f09e
obsidian vault=bd0ea1a22beb8f55 read path=templates/zotlit-citation.md
obsidian vault=bd0ea1a22beb8f55 search query="Fixture" path=templates
```

Results:

- `help zotlit:template-check` confirmed `profile`, `document`, `root`, `key`, `example`, `variant`, `output`, and `expect-source` flags.
- Citation inspection: `ok:true`, document kind `citation`, id `citation`, path `templates/zotlit-citation.md`, no problems; dependency was `partial:book-details`.
- Citation source:

```md
---
language: liquid
---
{% if zt.variant == "alt" %}
  cf. {{ zt.citations | pandoc_cite: "prefer-author-in-text" }}
{% else %}
  {{ zt.citations | pandoc_cite }}
{% endif %}
```

- Search output: `templates/zotlit-profile.books.md`.

Commands (parallel):

```sh
obsidian vault=bd0ea1a22beb8f55 zotlit:template-inspect document=partial:book-details profile=Books source=full expect-source=8a19f09e
obsidian vault=bd0ea1a22beb8f55 zotlit:template-inspect document=zotlit-profile.books.md profile=Books source=full expect-source=8a19f09e
obsidian vault=bd0ea1a22beb8f55 read path=templates/zotlit-profile.books.md
obsidian vault=bd0ea1a22beb8f55 read path=templates/zotlit-partial.book-details.md
```

Results:

- The first inspect returned `ok:false`, diagnostic `INVALID_SELECTOR`, message `Select one note, Profile, or document. Editor source requires a target.`, recovery `Run help zotlit:template-inspect for selectors and source=full.`
- Books Profile inspect with both `profile` and `document` returned the same `INVALID_SELECTOR`.
- The two reads succeeded. The Books Profile contains:

```md
{% render "book-details" with zt as zt %}
```

inside its managed note body. The partial source is:

```md
---
language: liquid
---
> [!info] Book details
> Type: {{ zt.itemType }}
> Citation key: {{ zt.citationKey | default: zt.key }}
```

Recovery/selector correction commands (parallel):

```sh
obsidian vault=bd0ea1a22beb8f55 zotlit:template-inspect profile=Books source=full expect-source=8a19f09e
obsidian vault=bd0ea1a22beb8f55 zotlit:template-inspect document=templates/zotlit-partial.book-details.md source=full expect-source=8a19f09e
obsidian vault=bd0ea1a22beb8f55 zotlit:template-inspect document=zotlit-partial.book-details.md source=full expect-source=8a19f09e
```

All three returned `ok:true` and current freshness.

Source revisions from these inspections:

- `templates/zotlit-profile.books.md`: `99d3f5f5002545255ea5440eb51d2db264e2f3dd712d4f352457bc62e04d1543`.
- `templates/zotlit-citation.md`: `3316042624dbac5b27ccecccb5c427964223d4ca7e93dc646d89db61ac7e8b70`.
- `templates/zotlit-partial.book-details.md`: `9db8c823b54163890b1e87789817230d2fc83a7e625a6ceff4784d5d84c8c08f`.

Each inspected dependency had identical `requested`, `disk`, and `loaded` revisions, with `freshness.state: current`.

## Data discovery for the Books caller

Commands (parallel, first discovery pass):

```sh
obsidian vault=bd0ea1a22beb8f55 zotlit:template-data root=note key=NW2CPDTC format=json expect-source=8a19f09e
obsidian vault=bd0ea1a22beb8f55 zotlit:template-data root=note key=IANNP5A2 format=json expect-source=8a19f09e
obsidian vault=bd0ea1a22beb8f55 zotlit:template-data root=note key=BKPUBLR4 format=json expect-source=8a19f09e
obsidian vault=bd0ea1a22beb8f55 zotlit:template-data root=note key=SAKIMA22 format=json expect-source=8a19f09e
obsidian vault=bd0ea1a22beb8f55 zotlit:template-data root=note key=I49R3FTL format=json expect-source=8a19f09e
obsidian vault=bd0ea1a22beb8f55 zotlit:template-data root=note key=KKKKKKKK format=json expect-source=8a19f09e
```

All six returned `ok:true` and the same vault/source identity. Without `query`, each returned the root field list and the discovery hint.

Commands (parallel, focused `itemType` pass):

```sh
obsidian vault=bd0ea1a22beb8f55 zotlit:template-data root=note key=NW2CPDTC query=itemType format=json expect-source=8a19f09e
obsidian vault=bd0ea1a22beb8f55 zotlit:template-data root=note key=IANNP5A2 query=itemType format=json expect-source=8a19f09e
obsidian vault=bd0ea1a22beb8f55 zotlit:template-data root=note key=BKPUBLR4 query=itemType format=json expect-source=8a19f09e
obsidian vault=bd0ea1a22beb8f55 zotlit:template-data root=note key=SAKIMA22 query=itemType format=json expect-source=8a19f09e
obsidian vault=bd0ea1a22beb8f55 zotlit:template-data root=note key=I49R3FTL query=itemType format=json expect-source=8a19f09e
obsidian vault=bd0ea1a22beb8f55 zotlit:template-data root=note key=KKKKKKKK query=itemType format=json expect-source=8a19f09e
```

Focused values:

- `NW2CPDTC`: `zt.itemType = "book"`.
- `IANNP5A2`: `zt.itemType = "journalArticle"`.
- `BKPUBLR4`: `zt.itemType = "book"`.
- `SAKIMA22`: `zt.itemType = "bookSection"`.
- `I49R3FTL`: `zt.itemType = "thesis"`.
- `KKKKKKKK`: `zt.itemType = "journalArticle"`.

`NW2CPDTC` was selected because it is a real book item and therefore matches the Books Profile's `itemType == "book"` caller context.

## Citation Variant checks

First attempt (default profile, as the guide permits when `profile` is omitted):

```sh
obsidian vault=bd0ea1a22beb8f55 zotlit:template-check document=citation example=two-items variant=main output=citation expect-source=8a19f09e
```

Result: `ok:false`; selected citation source and partial were current at revision `3316042624dbac5b27ccecccb5c427964223d4ca7e93dc646d89db61ac7e8b70` and `9db8c823b54163890b1e87789817230d2fc83a7e625a6ceff4784d5d84c8c08f`, but `SOURCE_NOT_LOADED` occurred because the omitted Default profile had `requested:null`, `disk:null`, and `loaded:9e221dd18a445b965344f16aa39273428f9565cfbd041bc2363ee81434abb940`. No citation output was produced. Retained attempt: `6ff92152-b6ae-4d16-965b-547a219a477d`.

Diagnostic recovery command:

```sh
obsidian vault=bd0ea1a22beb8f55 zotlit:template-inspect profile=default source=full expect-source=8a19f09e
```

Result: `ok:false`, same `SOURCE_NOT_LOADED` and recovery hint: `Check the affected paths, allow Obsidian to observe the edits, then inspect again.` The default profile remained unresolved for this selector.

The relevant Books caller was already inspected and current, so the checks were retried with the explicit `profile=Books` caller context.

Main variant command:

```sh
obsidian vault=bd0ea1a22beb8f55 zotlit:template-check profile=Books document=citation example=two-items variant=main output=citation expect-source=8a19f09e
```

Result: `ok:true`; `freshness.state: current`; `structure.status: passed`; `citation.status: passed`; `rendering: checked`. Attempt `434118c6-559c-4ede-bab1-f638e1025bea`; `attemptContext.sourceRevision` `3316042624dbac5b27ccecccb5c427964223d4ca7e93dc646d89db61ac7e8b70`; `dataRevision` `b9d3a26aecd3b3c7b9a31f9f7c26fbd680aceeba860e634b9638104bceedb9d1`; selected profile id `V1StGXR8Z5jd`. Output:

```text
[@ioannidisWhyMost2005; @Kahneman2011]
```

Alt variant command:

```sh
obsidian vault=bd0ea1a22beb8f55 zotlit:template-check profile=Books document=citation example=two-items variant=alt output=citation expect-source=8a19f09e
```

Result: `ok:true`; `freshness.state: current`; `structure.status: passed`; `citation.status: passed`; `rendering: checked`. Attempt `a33a8477-6c57-49ef-9c90-fb2413cd16ae`; `attemptContext.sourceRevision` `3316042624dbac5b27ccecccb5c427964223d4ca7e93dc646d89db61ac7e8b70`; `dataRevision` `688c24b2f31611794cca8e42418d0cb154d3c47d694287b96cf56e5950a7377c`; selected profile id `V1StGXR8Z5jd`. Output:

```text
cf. @ioannidisWhyMost2005 [@Kahneman2011]
```

## Books Shared Partial check

Command:

```sh
obsidian vault=bd0ea1a22beb8f55 zotlit:template-check profile=Books document=partial:book-details root=note key=NW2CPDTC output=partial expect-source=8a19f09e
```

Result: `ok:true`; `freshness.state: current`; `structure.status: passed`; `partial.status: passed`; `rendering: checked`. Attempt `93081f2d-c2d6-45a3-bd5c-df6d38456706`; `attemptContext.sourceRevision` `9db8c823b54163890b1e87789817230d2fc83a7e625a6ceff4784d5d84c8c08f`; `dataRevision` `43f901be58da1ca7adfb3bd7821982a0ac1fe54a710ba185de595ef8ca71ac99`; `attemptContext.root` `note`; selected profile id `V1StGXR8Z5jd`; selected item `NW2CPDTC` with `zt.itemType = "book"`.

Output:

```text
> [!info] Book details
> Type: book
> Citation key: Kahneman2011
```

The caller context is supported because the Books Profile renders `book-details` in its note body and its match expression selects `itemType == "book"`; the check used `root=note` and a real matching book item.

## Final status and completion determination

Command:

```sh
obsidian vault=bd0ea1a22beb8f55 zotlit:template-status
```

Result: `ok:true`, `contractVersion:7`, plugin `2.1.4`, identity still vault `fixture-vault-zotlit-v2` and source `8a19f09e`; Profile `Books` and the Default Profile both had `validation.state: valid`, with no `profileDiagnostics`. The final status listed the same installed Books Profile and Default Profile documents.

Completion was established for the requested checks: both explicit Citation Variant checks passed with current source revision `3316042624dbac5b27ccecccb5c427964223d4ca7e93dc646d89db61ac7e8b70`, and the Books Shared Partial check passed in the supported `root=note` caller context with current partial revision `9db8c823b54163890b1e87789817230d2fc83a7e625a6ceff4784d5d84c8c08f`. The initial omitted-profile attempt was retained as a failed diagnostic and was superseded by the explicit Books-profile checks.
