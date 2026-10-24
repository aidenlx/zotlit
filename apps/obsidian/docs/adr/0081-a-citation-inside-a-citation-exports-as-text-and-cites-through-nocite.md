---
status: accepted
---

# A Citation inside a Citation exports as text and cites through `nocite`

A Citation written inside another Citation's Citation Prefix or Citation Suffix, such as `[@a with [[Note]]]` or `[@a with @b]`, exports as the text it was written with, and its Item reaches the bibliography through `nocite`. The outer Citation keeps its own Items, grouping, and wording: `(Alpha 2020 with Note)`, with both works in the bibliography.

Pandoc reads both forms as a `Cite` nested in the outer one's prefix or suffix, and citeproc renders the nested `Cite` in place of the outer: `[@a with [[Note]]]` exported as `(Beta 2021)`, and the outer work and the word "with" were gone. The bibliography still listed both works, so a bibliography-only check passed (issue #1699).

This settles one case of the membership ADR-0032 leaves to Pandoc's reading: a nested Citation is still a Citation of the document, so its Item stays a member, but it takes no place in the prose.

## Consequences

- The rule covers every nested Citation, the Literature Note link the filter converts and the literal `@citation-key` Pandoc's reader converts alike, in a prefix as in a suffix. One rule, because the reader produces one shape for both.
- A nested Literature Note link shows its alias where it has one, and its link text otherwise. A nested literal Citation shows its source text, `@b`. Neither is formatted by the style.
- A nested link with a `#cite:` fragment stops the export with an error. The fragment asks for a formatted Citation, with a Locator or a mode, that this rule cannot give, and dropping it without a word would export something other than what the author wrote.
- Both filter variants apply the rule, so the Native Pandoc Workflow exports a nested Citation the same way the built-in export does.

## Considered options

- **Promote the nested work into the outer Citation's list**: `(Alpha 2020; Beta 2021)`. This changes the grouping the author wrote and leaves "with" stranded in the outer Item's suffix. It is the obvious-looking fix and the one most likely to be proposed again.
- **Render the nested work as formatted citation text in the suffix**: `(Alpha 2020 with Beta 2021)`. This needs a second citeproc pass, or a style-dependent splice, for a construct citeproc itself does not support.
- **Stop every export that has a nested Citation**: this refuses documents Pandoc reads fine and that render sensibly as text.
