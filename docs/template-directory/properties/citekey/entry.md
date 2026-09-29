---
title: Citation key
summary: The item's citation key, from Zotero or Better BibTeX, left out when the item has none.
minAppVersion: "2.2.0-beta.0"
tasks: [general-reading, literature-review, writing]
features: [properties, citations]
recommended: true
problems:
  - I want the citekey of each paper as a property.
  - My citekey property shows null when the item has no citation key.
  - I want to find a literature note by its citation key.
keywords:
  - citekey
  - citation key
  - citationKey
  - Better BibTeX
  - BBT
  - Pandoc
  - LaTeX
  - bibtex
audience: Readers who cite with citation keys in Pandoc, LaTeX, or Markdown, and want each literature note to carry its key.
effort: Add one property to your profile in the Properties tab.
expected:
  journal-article: { citekey: ioannidisWhyMost2005 }
  book: { citekey: Kahneman2011 }
  book-section: { citekey: tverskyJudgmentUncertaintyHeuristics1982 }
  thesis: { citekey: Batista2010 }
---

The item's citation key, as a `citekey` property. The key comes from Zotero's own **Citation Key** field or from the Better BibTeX plugin.

| Item | `citekey` |
| --- | --- |
| Journal article | ioannidisWhyMost2005 |
| Book | Kahneman2011 |
| Book chapter | tverskyJudgmentUncertaintyHeuristics1982 |
| Thesis | Batista2010 |

When the item has no citation key, the note gets no `citekey` property, in place of `citekey: null`.

When the note updates: **Replace the existing value**. When the key changes in Zotero, the note gets the new key on its next update.

To add it to a profile:

1. Open **Settings > ZotLit > Literature note profiles** and select **Edit profile**, the pencil button, on your profile.
2. In the **Properties** tab, select **Add a property**. Enter `citekey` as the **Property name**.
3. In the **Value format** menu beside **Value**, choose **Rule · JSON-e**, then select **Change format and reset value**.
4. Paste the rule into **Value**.
5. Set **When the note is updated** to **Replace the existing value**.

Limits: a profile made from the Default profile already has a `citekey` property, which writes `null` for an item with no key. A profile holds each property name once, so select that property in place of step 2, then do steps 3 to 5.
