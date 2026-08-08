---
title: Wikilink Display Test
---
# Wikilink Display Test

This note exercises the Wikilink Editor Treatment (#663, Live Preview) and the Wikilink
Reading Rendering (#675, reading mode). Both surfaces show the same Citation Display Text,
so every case below applies to both.

Expected display text is written in `inline code` beside each case. Inline code is masked out
of the Citation Index, so the expected values never register as citations themselves.

**Settings for a full pass**: Citekey Indexing on, Wikilink Citations on, wikilink display
toggle on. The "Gating" section below tells you what to switch off for the second pass.

## Fragment-less Literature Note wikilink

A resolved Literature Note wikilink with no fragment shows `@` plus its Item's native Zotero
citation key, read through the citekey resolution snapshot:

The nebulin protein regulates thin filament length ([[literatures/wittNebulinRegulatesThin2006]]).
Expect `@wittNebulinRegulatesThin2006`.

Distal myopathy follows from nebulin mutations ([[literatures/wallgren-petterssonDistalMyopathyCaused2007]]).
Expect `@wallgren-petterssonDistalMyopathyCaused2007`.

## No native citation key: filename fallback

A Literature Note whose Zotero item carries no native citation key falls back to its filename —
never its folder path:

An indexed note without a citekey ([[literatures/xuNoCitationKeyProperty2019]]).
Expect `@xuNoCitationKeyProperty2019`.

## Fragment — locator

Mutation details are on [[literatures/wangMutationalClinicalSpectrum2020a#cite:locator=7]].
Expect `[@wangMutationalClinicalSpectrum2020a, p. 7]`.

## Fragment — label and locator

Details appear in [[literatures/wangMutationalClinicalSpectrum2020a#cite:label=chapter&locator=2]].
Expect `[@wangMutationalClinicalSpectrum2020a, chap. 2]`.

## Fragment — prefix, suffix, and both

This has support ([[literatures/Hensher2011#cite:prefix=see]]).
Expect `[see @Hensher2011]`.

This has support ([[literatures/Hensher2011#cite:prefix=see%20also&locator=40]]).
Expect `[see also @Hensher2011, p. 40]`.

This has support ([[literatures/Hensher2011#cite:suffix=for%20context]]).
Expect `[@Hensher2011, for context]`.

This has support ([[literatures/wallgren-petterssonDistalMyopathyCaused2007#cite:prefix=see%20also&label=chapter&locator=3&suffix=for%20context]]).
Expect `[see also @wallgren-petterssonDistalMyopathyCaused2007, chap. 3, for context]`.

## Fragment — suppress-author

The mutational spectrum is described ([[literatures/yinClinicopathologicalFeaturesMutational2021#cite:mode=suppress-author&locator=3]]).
Expect `[-@yinClinicopathologicalFeaturesMutational2021, p. 3]`.

The same work again ([[literatures/yinClinicopathologicalFeaturesMutational2021#cite:mode=suppress-author]]).
Expect `[-@yinClinicopathologicalFeaturesMutational2021]`.

## Fragment — author-in-text

[[literatures/Hensher2011#cite:mode=author-in-text&locator=62]] found that respondent answers are inconsistent.
Expect `@Hensher2011 [p. 62]`.

[[literatures/Hensher2011#cite:mode=author-in-text]] used a stated-choice experiment.
Expect `@Hensher2011`.

[[literatures/Hensher2011#cite:mode=author-in-text&locator=62&suffix=for%20context]] reported the same effect.
Expect `@Hensher2011 [p. 62, for context]`.

## Fragment — encoded and Unicode values

A percent-encoded locator keeps its slash ([[literatures/wittNebulinRegulatesThin2006#cite:locator=6%2F7]]).
Expect `[@wittNebulinRegulatesThin2006, p. 6/7]`.

An accented locator survives the decode ([[literatures/wittNebulinRegulatesThin2006#cite:locator=%C3%A9]]).
Expect `[@wittNebulinRegulatesThin2006, p. é]`.

A Cyrillic locator survives the decode ([[literatures/wittNebulinRegulatesThin2006#cite:locator=%D0%BF]]).
Expect `[@wittNebulinRegulatesThin2006, p. п]`.

An equals sign inside a value belongs to the value ([[literatures/wittNebulinRegulatesThin2006#cite:suffix=a=b]]).
Expect `[@wittNebulinRegulatesThin2006, a=b]`.

An explicit normal mode reads like the default ([[literatures/wittNebulinRegulatesThin2006#cite:mode=normal&locator=33]]).
Expect `[@wittNebulinRegulatesThin2006, p. 33]`.

## Malformed fragment — raw display

Every case below is a fragment the Pandoc exporter rejects. Each one shows its raw wikilink
text, in Live Preview and in reading mode. Error styling is a follow-up, so plain raw display
is the pass condition.

- Empty fragment: [[literatures/Hensher2011#cite:]]
- Unknown parameter: [[literatures/Hensher2011#cite:page=33]]
- Label without locator: [[literatures/Hensher2011#cite:label=chapter]]
- Prefix with author-in-text: [[literatures/Hensher2011#cite:mode=author-in-text&prefix=see]]
- Unsupported mode: [[literatures/Hensher2011#cite:mode=narrative]]
- Unsupported label: [[literatures/Hensher2011#cite:label=slide&locator=3]]
- Duplicate parameter: [[literatures/Hensher2011#cite:locator=1&locator=2]]
- Malformed percent encoding: [[literatures/Hensher2011#cite:locator=%zz]]
- Trailing whitespace: [[literatures/Hensher2011#cite:locator=33%20]]
- Euro sign carries a control byte: [[literatures/Hensher2011#cite:locator=%E2%82%AC]]

## Untouched — alias always wins

An alias is the author's own display text, so the decoration stays out of its way. Both the
fragment-less and the fragment-carrying form keep the alias:

The study by [[literatures/Hensher2011|Hensher & Collins (2011)]] addressed this.

The same study at page 62 ([[literatures/Hensher2011#cite:locator=62|Hensher & Collins, p. 62]]).

## Untouched — heading and block subpaths

A subpath that is not a Citation Fragment stays Obsidian's rendering:

- Heading subpath: [[literatures/Hensher2011#Notes]]
- Block subpath: [[literatures/Hensher2011#^b7c1a2]]

## Untouched — embeds

An embed renders its target, not a citation:

![[literatures/wittNebulinRegulatesThin2006]]

## Untouched — links that resolve to no Literature Note

- An ordinary vault note: [[citekey-smoke-test]]
- An ordinary note carrying a Citation Fragment: [[citekey-smoke-test#cite:locator=1]]
- A link that resolves to nothing: [[literatures/noSuchLiteratureNote2099]]
- A broken link carrying a Citation Fragment: [[literatures/noSuchLiteratureNote2099#cite:locator=1]]

## Gating

Second pass — switch **Wikilink Citations** off, or switch the **wikilink display toggle**
off, and read this section again:

- Fragment-less link, gated: [[literatures/wittNebulinRegulatesThin2006]] shows raw text while
  either toggle is off, `@wittNebulinRegulatesThin2006` while both are on.
- Fragment-carrying link, unconditional: [[literatures/wittNebulinRegulatesThin2006#cite:locator=4]]
  shows `[@wittNebulinRegulatesThin2006, p. 4]` under every combination of both toggles.

Third pass — switch **Citekey Indexing** off. It is the master switch for the literal-citekey
surfaces, so every link above reads exactly as it did in the pass before: a wikilink is a
separate syntax and answers to the two wikilink toggles alone.

## Reveal on cursor and selection contact

Live Preview only. Put the caret inside each decorated link and confirm the raw text returns;
move it away and confirm the display text comes back. Source mode always shows raw text.

- Caret walk, left to right: [[literatures/wangMutationalClinicalSpectrum2020a#cite:locator=7]] then past it.
- Selection that only touches the left boundary: [[literatures/Hensher2011#cite:locator=1]]
- Selection that spans the whole line, including this link: [[literatures/yinClinicopathologicalFeaturesMutational2021#cite:locator=2]]
- Blur the editor with the caret inside a link, then focus another pane: [[literatures/wittNebulinRegulatesThin2006#cite:locator=9]]

## Reveal grouping next to emphasis

A #663 runtime check: reveal follows Obsidian's conceal group, not the link span. Emphasis
directly against a link puts both in one conceal group, so the caret inside the emphasis may
reveal the link too. Record the observed behavior on the ticket.

- Emphasis wrapping the link: *[[literatures/Hensher2011#cite:locator=5]]*
- Emphasis against the left edge: **see**[[literatures/Hensher2011#cite:locator=6]]
- Emphasis against the right edge: [[literatures/Hensher2011#cite:locator=7]]**here**
- Emphasis on both edges: *a*[[literatures/Hensher2011#cite:locator=8]]*b*

## Adjacency and boundary positions

[[literatures/wittNebulinRegulatesThin2006#cite:locator=1]] starts this line.

This line ends with a decorated link [[literatures/wittNebulinRegulatesThin2006#cite:locator=2]]

Two links with no separator: [[literatures/wittNebulinRegulatesThin2006#cite:locator=3]][[literatures/Hensher2011#cite:locator=4]]

A link inside a list item:

- Item one [[literatures/wangMutationalClinicalSpectrum2020a#cite:locator=11]]
- Item two [[literatures/yinClinicopathologicalFeaturesMutational2021#cite:locator=12]]

A link inside a blockquote:

> Quoted claim [[literatures/Hensher2011#cite:mode=author-in-text&locator=13]] with a source.

A link inside a table cell. This is the one adjacency position the Wikilink Editor Treatment
leaves alone: Live Preview renders a table through the reading-mode pipeline, so each cell
carries Obsidian's own `a.internal-link` rather than a Live Preview widget. The cells therefore
show Obsidian's `#`-split breadcrumb until the Wikilink Reading Rendering (#675) lands, and
their Citation Display Text after it.

| Claim           | Source                                                      |
| --------------- | ----------------------------------------------------------- |
| Thin filament   | [[literatures/wittNebulinRegulatesThin2006#cite:locator=14]] |
| Distal myopathy | [[literatures/wallgren-petterssonDistalMyopathyCaused2007]]  |

Expect `literatures/wittNebulinRegulatesThin2006 > cite:locator=14` and
`literatures/wallgren-petterssonDistalMyopathyCaused2007` on this ticket; expect
`[@wittNebulinRegulatesThin2006, p. 14]` and `@wallgren-petterssonDistalMyopathyCaused2007`
once #675 ships.

A link inside a heading:

### Heading with [[literatures/Hensher2011#cite:locator=15]] in it

## Wikilinks the metadata cache omits

Links inside code carry no metadata-cache entry, so the editor and the sidebar cannot disagree.
Neither of these is decorated:

Use `[[literatures/Hensher2011#cite:locator=16]]` as a literal example, not a citation.

```
[[literatures/Hensher2011#cite:locator=17]] inside a fenced code block is not a citation.
```

## Wikilinks inside a `%%` comment

A #663 runtime check: record whether the metadata cache lists these links, and confirm the
editor decoration and the References Sidebar agree with each other either way.

%%[[literatures/Hensher2011#cite:locator=18]]%%

%%
A block comment holding [[literatures/wittNebulinRegulatesThin2006#cite:locator=19]] and a
fragment-less [[literatures/wangMutationalClinicalSpectrum2020a]].
%%

## Interaction parity

A #663 runtime check on every decorated link above. Each gesture must behave exactly as it
does on an undecorated wikilink, because the plugin registers no handlers:

1. Plain click opens the Literature Note in the active tab.
2. Click the **right half** of the widget — the right-edge click resolution check. The click
   must reach the same link, not the position after it.
3. Mod-click opens a new tab; Mod-Shift-click splits; middle-click opens a new tab.
4. Hover shows the page preview under Obsidian's Page preview settings.
5. Drag the link into another note and confirm the dropped text.
6. The right-click context menu offers the native link entries.

Reading mode carries two deliberate differences, documented in the user docs (#666): drag out
of reading mode and the context menu's **Copy** both carry the displayed Citation Display Text.

## Index refresh

Each action below must refresh open editors and reading views with no reopen:

1. Re-key the item in Zotero and let the database refresh, and watch this note's
   `@wittNebulinRegulatesThin2006` displays follow it.
2. Rename that Literature Note and watch the links follow.
3. Delete a Literature Note and watch its links fall back to Obsidian's rendering.
4. Create `literatures/noSuchLiteratureNote2099.md` with a `zotero-key` for its Zotero item
   and watch the broken links above become decorated.
