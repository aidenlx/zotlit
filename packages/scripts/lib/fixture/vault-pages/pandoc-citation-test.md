---
title: Pandoc Citation Test
---
# Pandoc Citation Test

This note exercises the Literature Note Citation workflow described in spec #612.

## Simple citations

A plain Literature Note wikilink becomes a parenthetical citation:

The nebulin protein regulates thin filament length ([[literatures/wittNebulinRegulatesThin2006]]).

Distal myopathy can result from nebulin mutations ([[literatures/wallgren-petterssonDistalMyopathyCaused2007]]).

## Repeated citation (shared reference number)

The same source cited again shares one reference number:

As shown previously ([[literatures/wittNebulinRegulatesThin2006]]), nebulin is essential.

## Citation Fragment — locator

A wikilink with a locator produces a citation with a page number:

Mutation details are on [[literatures/wangMutationalClinicalSpectrum2020a#cite:locator=7]].

## Citation Fragment — author-in-text mode

Author-in-text mode places the author name in running text:

[[literatures/Hensher2011#cite:mode=author-in-text&locator=62]] found that respondent answers are inconsistent.

## Citation Fragment — suppress-author mode

Suppress-author keeps only the year and locator:

The work of Yin ([[literatures/yinClinicopathologicalFeaturesMutational2021#cite:mode=suppress-author&locator=3]]) describes the mutational spectrum.

## Citation Fragment — prefix and suffix

Percent-encoded prefix and suffix wrap the citation:

This has been questioned ([[literatures/Hensher2011#cite:prefix=see%20&suffix=%2C%20emphasis%20added]]).

## Citation Fragment — label (locator type)

A non-default locator label changes the locator abbreviation:

Details appear in [[literatures/wangMutationalClinicalSpectrum2020a#cite:label=chapter&locator=2]].

## Citation Run (grouped citation)

Same-line semicolons between Literature Note wikilinks form one grouped citation:

Multiple sources support this finding ([[literatures/wittNebulinRegulatesThin2006]]; [[literatures/wallgren-petterssonDistalMyopathyCaused2007]]; [[literatures/wangMutationalClinicalSpectrum2020a]]).

## Citation Run with fragments

Grouped citations can each carry their own fragment:

Evidence spans several studies ([[literatures/wangMutationalClinicalSpectrum2020a#cite:locator=7]]; [[literatures/yinClinicopathologicalFeaturesMutational2021#cite:locator=3]]).

## Non-literature-note wikilink (stays as link)

A link to an ordinary note is not converted to a citation:

See also [[pandoc-citation-test]] for the test itself.

## Embed (stays as embed)

An embed of a Literature Note is not converted to a citation:

![[literatures/wittNebulinRegulatesThin2006]]

## Alias on a Literature Note wikilink

An alias affects only Obsidian display, not citation resolution:

The study by [[literatures/Hensher2011|Hensher & Collins (2011)]] addressed this.

## Citation intent on non-literature-note (export error)

A `#cite:` fragment on a non-literature-note target should stop export:

This should error: [[pandoc-citation-test#cite:locator=1]].

## Mixed content

A paragraph with both citation wikilinks and ordinary wikilinks:

According to [[literatures/Hensher2011#cite:mode=author-in-text]], the method in [[pandoc-citation-test]] produces valid output ([[literatures/wangMutationalClinicalSpectrum2020a#cite:locator=9]]; [[literatures/yinClinicopathologicalFeaturesMutational2021]]).
