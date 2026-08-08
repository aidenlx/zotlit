---
title: A Literature Note carrying no Citation Key Property
related: []
collections: []
zotero-key: 7ZQK4M8T
---
# A Literature Note carrying no Citation Key Property

A fixture for the Citation Display Text fallback in #663 and #675: `zotero-key` alone makes a
file a Literature Note, so this note is indexed, and a wikilink to it must display
`@xuNoCitationKeyProperty2019` — the filename, never the folder path.

The Indexed Key is synthetic. No Zotero Item stands behind it, so the References Sidebar shows
this note as an error-state entry and the engine renders no bibliography text for it. That is
the intended shape: display-text fallback is a Note Index question, and Item resolution is a
separate one.

%%zt-managed%%

%%/zt-managed%%
