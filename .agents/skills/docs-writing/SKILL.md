---
name: docs-writing
description: >
  Plan and produce ZotLit's reader-facing docs: lessons at /learn, recipes, answer pages and reference pages at /docs, landing copy. Use when adding, rewriting, moving or retitling a docs page, writing a fact sheet or writer brief, or checking a draft's labels, anchors and search title.
---

# Docs writing

The reader is a non-technical academic who arrives tired, with a chapter due. [`references/brief/shared.md`](references/brief/shared.md) is the single source for who they are, the voice, and "Show first"; read it before you plan a page.

Gemini writes the reader-facing prose. Your work is the facts, the structure, and the check.

## Page kinds

Every page serves one of eight research jobs: bring your library, find a paper, read and annotate, take notes, cite, see connections, export, make it yours.

| Kind | Reader | Where | Shape |
| --- | --- | --- | --- |
| **Lesson** | first run, guided | `/learn`, outside the docs layout | 5–7 steps, each about 40 words of caption, one action, one check line, a recording of the real app |
| **Recipe** | mid-task | `/docs` | the answer in the first screen, numbered steps, fixes by what the reader sees; near 300 words before the first fold-out |
| **Answer page** | comparing or stuck | `/docs` | 600–900 words, one table, a short list of questions and answers |
| **Reference** | looking something up | `/docs` | the complete list of settings, commands or template fields, compiled from its source |

A lesson or recipe names the one control it needs and links to the reference page for the rest.

An explanation lives in one of three places: one or two sentences beside the action it affects; a trust page, which is an answer page whose question is a worry ("Does ZotLit change my Zotero library?"); or the opening of a reference page. When a task moves pages, map the existing `tutorial/`, `how-to/` and `concepts/` folders onto these kinds; use `fumadocs-page-tree` for the tree mechanics.

## Search

- One page owns one search intent, in the searcher's words. Before you plan a page, search the titles and descriptions under `apps/docs/content/` for a page that owns the intent already, and extend that page.
- `searchTitle` (docs pages): one plain statement of the task, at most 60 characters, naming Zotero or Obsidian where the task involves them. It is the page's H1 and `<title>`. `title` is the sidebar label: two to four words. A lesson's title follows the same rule through its brief.
- `description`: at most 160 characters, with the answer in the first 120.

`apps/docs/src/lib/source.test.ts` checks the lengths and uniqueness.

## Procedure

Keep every working file under `apps/docs/.scratch/<page-slug>/`.

1. **Place the page.** Name its job, its kind, and its search intent.
2. **Collect the facts from the product.** Every fact comes from the product, an existing docs page on `next`, or a source you opened.
   - A lesson's steps are its **docs walk**, `packages/e2e/src/docs-walks/<slug>.walk.ts` (on branch `docs/learn-walks` until it merges): one `it` per step, run through the real apps. The walk also takes the step stills and recordings; read "Docs walks" in `packages/e2e/AGENTS.md`. A step the walk does not assert is a step to add to the walk first.
   - A recipe or answer page takes its facts from the running apps (`obsidian-debug`, `zotero-rdp-debug`), the source, and the existing page. Its screenshots come from `docs-screenshot`.
   - A ZotLit label is the exact string in `messages/en.json`; note its message key beside it. A label of Obsidian or Zotero is the string you read in the running app.
3. **Write the fact sheet** (`facts.md`). Model: [`references/fact-sheet-model.md`](references/fact-sheet-model.md). It holds, in order:
   - where the facts were checked (app versions, branch, walk);
   - the page: what the reader ends with, the search words, what the reader needs, what is true and worth saying once, the next or related pages;
   - each step or section: the action with the exact labels in bold, the result the reader sees, the picture file, and the fixes as "what the reader sees: what to do". An answer page lists its table rows and columns and its questions with their answers in place of steps.
4. **Assemble the writer brief** (`brief.md`) for the page kind (`lesson`, `recipe` or `answer`) from [`references/brief/`](references/brief/), with `R` set to that folder:

   ```sh
   { cat "$R/<kind>.opening.md"; echo; cat "$R/shared.md"; echo; cat "$R/<kind>.shape.md"; } > brief.md
   ```

5. **Run the writer**, from a folder with no `AGENTS.md` above it that you want read (the flags below already turn context files off):

   ```sh
   pi -p --provider google --model gemini-3.8-flash --no-tools --no-skills \
     --no-prompt-templates --no-extensions --no-context-files --no-session \
     --system-prompt "$(cat <brief>.md)" \
     "Write this page from this fact sheet.

   $(cat <facts>.md)" > <draft>.md 2> <draft>.err < /dev/null
   ```

   Run one at a time; parallel runs have stalled. `< /dev/null` is required.

6. **Check the draft against the fact sheet:** every label exact, every step present once, nothing added that the fact sheet does not hold, lengths within the brief. Then run `slop-check` on it. Fix a wrong fact by correcting the fact sheet and running again, or by the smallest edit to the wrong words; fix a slop flag by the smallest edit. Leave Gemini's wording alone otherwise.
7. **Build the page** from the checked draft:
   - Render every ZotLit label through the typed label components, as [`apps/docs/policies/ui-labels.md`](../../../apps/docs/policies/ui-labels.md) says.
   - Give every heading that is a deep-link target a stable `[#slug]` anchor, and place images, as "Content and writing docs" in `apps/docs/AGENTS.md` says.
   - Turn each figure request into the view it asks for (see "Show first").
   - Use the components the neighbouring pages import: `Steps`/`Step`, `Callout`, `Cards`/`Card`, `UiLabel`, `Command`, `SettingsPath`.
8. **Report** the paths of the fact sheet, the brief and the draft.

## Show first

A view explains before a paragraph does: a recording, a replica, a map, a before/after pair or a small table. The rules for each surface are "Illustration" in [`apps/docs/DESIGN.md`](../../../apps/docs/DESIGN.md): a lesson step shows the walk's recording with the still as its poster; the landing shows web replicas built from the real app's assets. Captions, check lines and table text stay HTML beside the picture.
