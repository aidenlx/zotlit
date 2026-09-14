# ZotLit Template Workbench evaluation transcript

Date: 2026-09-13 (Asia/Singapore)
Vault argument: `vault=bd0ea1a22beb8f55`
Expected Zotero source: `8a19f09e`

## Commands and results

1. `mkdir -p /private/tmp/zotlit-1086-luna-final/with_skill && printf '%s\\n' '$ obsidian help zotlit' && obsidian help zotlit`

   Output: command succeeded. The command listed the ZotLit CLI commands, including `zotlit:template-guide`, `zotlit:template-inspect`, and `zotlit:template-check`. This initial discovery call had no vault prefix.

2. `obsidian vault=bd0ea1a22beb8f55 zotlit:template-guide`

   Output: Template Workbench guide printed. It reported contract workflow, the required `vault=<name>` prefix, `expect-source`, freshness, draft checking, and completion rules.

3. These calls were run in one parallel batch, each with the vault prefix:

   - `obsidian vault=bd0ea1a22beb8f55 zotlit:template-guide topic=inspect`
   - `obsidian vault=bd0ea1a22beb8f55 zotlit:template-guide topic=check`
   - `obsidian vault=bd0ea1a22beb8f55 zotlit:template-guide topic=frontmatter`
   - `obsidian vault=bd0ea1a22beb8f55 zotlit:template-guide topic=profiles`
   - `obsidian vault=bd0ea1a22beb8f55 help zotlit:template-inspect`
   - `obsidian vault=bd0ea1a22beb8f55 help zotlit:template-check`

   Output: all calls succeeded. The guides specified `template-inspect` for source selection/freshness, `template-check draft=... mode=update ...` for scratch verification, keyless JSON-e maps as spreads, and Profile ID preservation. The help output listed the supported flags.

4. `obsidian vault=bd0ea1a22beb8f55 zotlit:template-inspect profile=Books source=full expect-source=8a19f09e`

   Output: JSON `contractVersion: 7`, `ok: true`; vault name `fixture-vault-zotlit-v2`; source ID `8a19f09e`; Profile `Books`, ID `V1StGXR8Z5jd`, path `templates/zotlit-profile.books.md`; dependency paths `templates/zotlit-citation.md` and `templates/zotlit-partial.book-details.md`; `freshness.state: current`; `problems: []`. The saved source contained four existing frontmatter entries, with the fourth spread emitting `fixture-spread-title` and `fixture-spread-kind`.

5. `obsidian vault=bd0ea1a22beb8f55 zotlit:template-inspect expect-source=8a19f09e`

   Output: JSON `contractVersion: 7`, `ok: true`; inventory contained the Books Profile, Default Profile, Citation Template, and `book-details` Shared Partial. No profile diagnostics or document problems.

6. `rg --files tests/fixture-vault-zotlit-v2 | sed -n '1,160p'`

   Output: listed the fixture vault files. The relevant existing Literature Note was `books/books-duplicateWithin2020.md`. Shell startup emitted pre-existing `mise` cache permission warnings and fish-config syntax warnings; `rg` still completed successfully.

7. `obsidian vault=bd0ea1a22beb8f55 zotlit:template-inspect note=books/books-duplicateWithin2020.md source=full expect-source=8a19f09e`

   Output: JSON `contractVersion: 7`, `ok: true`; selected Books Profile ID `V1StGXR8Z5jd`; note path `books/books-duplicateWithin2020.md`; item key `BBBB2222`; source ID `8a19f09e`; `freshness.state: current`; all problems empty. The selected source was the saved Books Profile.

8. `sed -n '1,240p' tests/fixture-vault-zotlit-v2/books/books-duplicateWithin2020.md`

   Output:

   ```markdown
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

9. `cp tests/fixture-vault-zotlit-v2/templates/zotlit-profile.books.md /private/tmp/zotlit-1086-luna-final/with_skill/books-profile-draft.md`

   Output: scratch draft created. The installed Profile was not edited.

10. Applied this patch to `/private/tmp/zotlit-1086-luna-final/with_skill/books-profile-draft.md`:

    ```diff
    +  - value: {"fixture-reviewed":true}
    ```

    Output: patch applied successfully (`{}`). The draft body, bindings, manifest, and existing frontmatter entries remained unchanged.

11. `obsidian vault=bd0ea1a22beb8f55 zotlit:template-check mode=update key=BBBB2222 note=books/books-duplicateWithin2020.md draft=/private/tmp/zotlit-1086-luna-final/with_skill/books-profile-draft.md profile=Books output=all expect-source=8a19f09e`

    Output: JSON `contractVersion: 7`, `ok: true`, draft input revision `c0ccb4af9d1178a73cff9a42efb99d0da5fcf6aaeb5853d9333f8486c0b7558c`, dependency `freshness.state: current`, and operation `outcome: previewed`. All checks passed: structure, filename, properties, fold, frontmatter, body, managed, and annotations. Properties output contained:

    ```json
    [
      {"key":"fixture-title","position":1,"missing":false,"value":"Within-library duplicate, first item","merge":"replace"},
      {"key":"fixture-kind","position":2,"missing":false,"value":"reference/article","merge":"replace"},
      {"key":"fixture-obsolete","position":3,"missing":true,"merge":"replace","omission":"static-key-deleted"},
      {"key":"fixture-spread-title","position":4,"missing":false,"value":"Within-library duplicate, first item","merge":"replace"},
      {"key":"fixture-spread-kind","position":4,"missing":false,"value":"journalArticle","merge":"replace"},
      {"key":"fixture-reviewed","position":5,"missing":false,"value":true,"merge":"replace"}
    ]
    ```

    The folded frontmatter included `fixture-reviewed: true`, retained the existing title/kind/spread values, and preserved the note's `title`, `zotero-key`, `zotlit-profile`, and `citekey`. The returned body was exactly the existing Literature Note body, including the managed Book details region. `proposedProfileChange: false`; no write occurred.

12. `diff -u tests/fixture-vault-zotlit-v2/templates/zotlit-profile.books.md /private/tmp/zotlit-1086-luna-final/with_skill/books-profile-draft.md`

    Output: one added line only:

    ```diff
    +  - value: {"fixture-reviewed":true}
    ```

13. `obsidian vault=bd0ea1a22beb8f55 help zotlit`

    Output: command succeeded with the vault prefix. It confirmed the live command surface and documented the current `template-check` draft/attempt flags.

14. `obsidian vault=bd0ea1a22beb8f55 zotlit:template-check attempt=251bcbe2-df91-4787-85a4-5f50f792b7b9 evidence=full output=all expect-source=8a19f09e`

    Output: `ok: false`, diagnostic `INVALID_SELECTOR`: “An attempt lookup takes only attempt, output, and evidence.” This was an invalid argument; no source or vault state changed.

15. Recovery: `obsidian vault=bd0ea1a22beb8f55 zotlit:template-check attempt=251bcbe2-df91-4787-85a4-5f50f792b7b9 evidence=full output=all`

    Output: retained attempt returned `contractVersion: 7`, source ID `8a19f09e`, `ok: true`, `freshness.state: current`, all component statuses `passed`, `fixture-reviewed` value `true`, and the same preserved frontmatter/body output as step 11.

## Conditions

- Preservation established: yes. The draft differs from the installed Profile by one frontmatter spread line. Update output retained existing note identity fields and returned the original Literature Note body unchanged.
- Requested value established: yes. The JSON-e spread at list position 5 emitted `fixture-reviewed: true`.
- Freshness established: yes. Both pre-edit inspection and the retained draft check reported `freshness.state: current`; the check used source ID `8a19f09e`.
- Completion established: yes for a draft-only request. All checks passed and `proposedProfileChange` was `false`. The draft remains uninstalled as required.
- Invalid arguments: one, in step 14; recovered in step 15.
- Diagnostics/recovery: no template diagnostics or source failures. The only recovery was removing the disallowed `expect-source` from attempt lookup.
- Installed-vault writes: none. Only `/private/tmp/zotlit-1086-luna-final/with_skill/books-profile-draft.md` and this transcript are scratch files.
- Timing/tokens: CLI calls reported approximately 0.1–0.2 seconds in the tool results; patch application reported approximately 6.2 seconds. Token counts were not exposed.
