---
title: A Literature Note whose Zotero item carries no native citation key
related: []
collections: []
zotero-key: 7ZQK4M8T
---
# A Literature Note whose Zotero item carries no native citation key

A fixture for the Citation Display Text fallback in #663 and #675: `zotero-key` alone makes a
file a Literature Note, so this note is indexed, and a wikilink to it must display
`@xuNoCitationKeyProperty2019` — the filename, never the folder path.

The Indexed Key is synthetic. No Zotero Item stands behind it, so the resolution snapshot holds
no native citation key for it — the same shape as a real Item with none — and the References
Sidebar shows this note as an error-state entry with no bibliography text. That is the intended
shape: display-text fallback reads the resolution snapshot, and Item resolution is a separate
question.

%%zt-managed%%

%%/zt-managed%%
