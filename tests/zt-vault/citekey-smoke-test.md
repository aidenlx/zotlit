---
title: Citekey Smoke Test
---
# Citekey Smoke Test

This note exercises literal Pandoc `@citekey` citations described in spec #642. Use it to
smoke-test the References Sidebar, Live Preview widgets, and reading-mode rendering against
`src/lib/citation-grammar.test.ts`. Each Literature Note referenced here lives under
`literatures/` with a matching Citation Key Property.

## Author-in-text citekey

A bare key outside brackets renders as author-in-text:

@wittNebulinRegulatesThin2006 first described nebulin's role in thin filament length.

## Suppress-author citekey

A leading dash before the `@` suppresses the author in running text:

The protein was later confirmed by other means [see -@wittNebulinRegulatesThin2006, p. 4].

## Bracketed single citekey

A single key inside brackets renders as a parenthetical citation:

Distal myopathy can result from nebulin mutations [@wallgren-petterssonDistalMyopathyCaused2007].

## Bracketed citekey with locator (prefix and suffix)

Free text before the comma is a prefix; free text after is a suffix:

Mutation details are discussed [see @wangMutationalClinicalSpectrum2020a, p. 7, chap. 2].

## Citation cluster (semicolon-separated group)

Multiple keys in one bracket, separated by `;`, form one cluster:

Several studies converge on this point [see @wittNebulinRegulatesThin2006; also @wallgren-petterssonDistalMyopathyCaused2007; @wangMutationalClinicalSpectrum2020a].

## Mixed suppress-author inside a cluster

Author suppression applies per item inside a cluster:

[-@yinClinicopathologicalFeaturesMutational2021 p. 3; see also @Hensher2011].

## Unresolved citekey (error entry)

A citekey with no matching Literature Note should surface as an error-state entry showing the
raw key, not vanish:

This cites a key with no note: [@nonexistentCitekeyForSmokeTest2099].

## Braced key containing special characters

A braced key allows characters the bare-key grammar would otherwise stop at, such as a bracket
or extra punctuation:

Braced keys survive punctuation a bare key would trim [@{wangMutationalClinicalSpectrum2020a}].

## Citekey next to Markdown emphasis

Emphasis around the surrounding text should not break key detection:

*See* @Hensher2011 **for methodology**.

## Text that must never resolve as a citekey

Ordinary `@` usage inside emails and URLs is left alone:

Contact mail me@example.com or visit https://user@example.com/x — neither is a citation.

## Citekey inside code (must be ignored)

A citekey inside inline code or a fenced code block is masked out of the index:

Use `@wittNebulinRegulatesThin2006` as a literal example, not a citation.

```
@wittNebulinRegulatesThin2006 inside a fenced code block is not a citation.
```

## Citekey inside a footnote reference (must be ignored)

A footnote reference label is not a citekey, even though it starts with `@`:

Here is a claim.[^@wittNebulinRegulatesThin2006]

[^@wittNebulinRegulatesThin2006]: This footnote label looks like a citekey but is not one.

## Citekey inside an inline note (recognized)

An inline note is not a footnote label, so a key inside it is still a citation:

This is an aside ^[see @Hensher2011 for background].

## Mixed literal citekeys and Literature Note wikilinks

Both syntaxes can appear in the same paragraph; Wikilink Citations must be enabled to see the
wikilink as an indexed citation too:

According to @Hensher2011, the method compares with [[literatures/wangMutationalClinicalSpectrum2020a]].
