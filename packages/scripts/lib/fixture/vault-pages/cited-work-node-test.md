---
title: Cited Work Node Test
---
# Cited Work Node Test

This note cites works that the generated Zotero data holds and that no single Literature Note
in the Fixture Vault ends on. The Fixture seeds a Literature Note for each My Library Item
only, so a Citation Key naming a group-Library Item stays a cited work without a note, and the
last key here names two Items instead of one. Use this note for the Cited Work Node states of
spec #1052 and the source-less Citation Popover of spec #1063.

## Unique key, no Literature Note

The Lab Archive holds this work, and that Library takes part in the `all`, `available`, and
`partial` Scope Cases. The key names one Item, so its node creates the Literature Note on
click:

The lab archive reports the same effect [@labArchiveAlpha2021].

## Unique key that the Library Scope can drop

The Shared Reading group takes part in the `all` and `available` Scope Cases only. In the
`partial` Scope Case this key names no Item in scope, so the same node becomes an unresolved
key:

An earlier reading group reached this conclusion [@sharedReadingAlpha2023].

The read-only Consortium Reading Room behaves the same way:

The consortium published a parallel result [@consortiumAlpha2020].

## Ambiguous key across Libraries

My Library and the Lab Archive each hold an Item with this key. My Library's Item has a
Literature Note, and the key still names two Items, so it keeps its cited-work state and
offers both candidates on click:

Both copies record the same study [@duplicateAcross2019].
