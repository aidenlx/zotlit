---
title: Wikilink Parity Test
---
# Wikilink Parity Test

This note exercises wikilink citation parity rendering (#673): a Literature Note wikilink
carrying a Citation Fragment — and a whole Citation Run — renders exactly like the equivalent
literal Citation Cluster.

Each case pairs the two syntaxes. **Pass condition**: the wikilink line and the citekey line
render identical citation text. Compare them side by side in Live Preview and in reading mode.

A wikilink citation supplies its own parentheses in normal mode, exactly as a bracketed
citekey cluster does, so neither side carries literal parentheses around the citation. A pair
that renders `((Doe 2020))` on one side is a defect, not a fixture typo.

**Settings for a full pass**: Citekey Indexing on, Wikilink Citations on, wikilink display
toggle on, citekey editor treatment on, Pandoc Engine installed.

## Single citation

- Wikilink: Nebulin sets thin filament length [[literatures/wittNebulinRegulatesThin2006#cite:locator=4]].
- Citekey: Nebulin sets thin filament length [@wittNebulinRegulatesThin2006, p. 4].

## Fragment-less wikilink

A fragment-less wikilink is a normal-mode Citation, so its rendered form matches a bracketed
citekey. Its Citation Display Text stays the bare `@citekey` from #663 — the two forms agree
once rendered, not before:

- Wikilink: Nebulin sets thin filament length [[literatures/wittNebulinRegulatesThin2006]].
- Citekey: Nebulin sets thin filament length [@wittNebulinRegulatesThin2006].

## Locator with a label

- Wikilink: Mutation details appear in [[literatures/wangMutationalClinicalSpectrum2020a#cite:label=chapter&locator=2]].
- Citekey: Mutation details appear in [@wangMutationalClinicalSpectrum2020a, chap. 2].

## Prefix and suffix

- Wikilink: This is contested [[literatures/Hensher2011#cite:prefix=see%20also&locator=40&suffix=for%20context]].
- Citekey: This is contested [see also @Hensher2011, p. 40, for context].

## Author-in-text

The citekey editor grammar keeps a bracket after an author-in-text key separate from that key
(`citation-grammar.ts`), where Pandoc's own `bareloc` rule would merge them into one citation.
This pair is expected to render **differently**: the wikilink line merges the locator, the
citekey line does not — that is a pre-existing citekey-syntax scope boundary, not a defect.

- Wikilink: [[literatures/Hensher2011#cite:mode=author-in-text&locator=62]] found inconsistent answers.
- Citekey: @Hensher2011 [p. 62] found inconsistent answers.

## Suppress-author

- Wikilink: The spectrum is described [[literatures/yinClinicopathologicalFeaturesMutational2021#cite:mode=suppress-author&locator=3]].
- Citekey: The spectrum is described [-@yinClinicopathologicalFeaturesMutational2021, p. 3].

## Citation Run — one grouped citation

Same-line semicolons between Literature Note wikilinks form one Citation Run, and the run
renders as **one** widget, matching how export groups it into one Citation:

- Wikilink run: Several studies converge [[literatures/wittNebulinRegulatesThin2006]]; [[literatures/wallgren-petterssonDistalMyopathyCaused2007]]; [[literatures/wangMutationalClinicalSpectrum2020a]].
- Citekey cluster: Several studies converge [@wittNebulinRegulatesThin2006; @wallgren-petterssonDistalMyopathyCaused2007; @wangMutationalClinicalSpectrum2020a].

## Citation Run — per-item fragments

- Wikilink run: Evidence spans studies [[literatures/wangMutationalClinicalSpectrum2020a#cite:locator=7]]; [[literatures/yinClinicopathologicalFeaturesMutational2021#cite:locator=3]].
- Citekey cluster: Evidence spans studies [@wangMutationalClinicalSpectrum2020a, p. 7; @yinClinicopathologicalFeaturesMutational2021, p. 3].

## Citation Run — mixed modes inside one run

An author-in-text item may occupy only the first position of a run, so this run leads with one:

- Wikilink run: [[literatures/Hensher2011#cite:mode=author-in-text]]; [[literatures/yinClinicopathologicalFeaturesMutational2021#cite:mode=suppress-author&locator=3]].
- Citekey cluster: [@Hensher2011; -@yinClinicopathologicalFeaturesMutational2021, p. 3].

## Citation Run — no space around the separator

`[[A]];[[B]]` is a run too. Both forms group into one citation:

- Wikilink run: Two sources agree [[literatures/wittNebulinRegulatesThin2006]];[[literatures/Hensher2011]].
- Citekey cluster: Two sources agree [@wittNebulinRegulatesThin2006; @Hensher2011].

## Not a run — separated by other text

A semicolon is the only joiner. A comma is not, so these stay two citations:

- Wikilink: One source [[literatures/wittNebulinRegulatesThin2006]], another [[literatures/Hensher2011]].
- Citekey: One source [@wittNebulinRegulatesThin2006], another [@Hensher2011].

## Not a run — split across lines

A run is same-line by definition. A soft line break between the semicolon and the next link
ends the run, so these stay two citations:

The first half sits here [[literatures/wittNebulinRegulatesThin2006#cite:locator=1]];
the second half sits on the next line [[literatures/Hensher2011#cite:locator=2]].

## Repeated works across syntaxes

The same work cited through both syntaxes must reach the same Zotero Item, share one
Reference Number in the References Sidebar, and render the same text:

Cited as a wikilink [[literatures/wittNebulinRegulatesThin2006#cite:locator=5]] and as a
citekey [@wittNebulinRegulatesThin2006, p. 5] in one paragraph.

## Pending-render fallback

While a render is pending or superseded, the Citation Display Text from #663 stays visible —
raw source never flashes. Force a pending state and watch every case above:

1. Change the References Style and watch every citation re-render.
2. Restart the Pandoc Engine and watch the same.
3. Edit one of these items in Zotero and watch its citations follow.

At each step, a wikilink citation must show its Citation Display Text in the gap — for the
single-citation case, `[@wittNebulinRegulatesThin2006, p. 4]`, never
`literatures/wittNebulinRegulatesThin2006 > cite:locator=4`.

## No-engine fallback

Uninstall or disable the Pandoc Engine and reload. Both syntaxes fall back to the shared
`Creators (Year)` item summary, and both stay identical to each other:

- Wikilink: [[literatures/wittNebulinRegulatesThin2006#cite:locator=4]]
- Citekey: [@wittNebulinRegulatesThin2006, p. 4]

## Interaction carries over from #663

Reveal on conceal-group contact, plain click, Mod-click, hover page preview, and drag behave
on a parity-rendered wikilink exactly as they do on an undecorated wikilink. Walk the caret
through each run above and confirm the whole run reverts to raw text as one unit.
