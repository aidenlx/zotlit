// Built-in Profile used by standalone Workbench previews and Sample Item checks.

import { CONTRACT_VERSION } from "@zotlit/db";
import { DEFAULT_ANNOTATION_LIQUID } from "@zotlit/templates/facade";

export const DEFAULT_PROFILE_SOURCE = `---
id: default
name: Default
version: 1.0.0
author: ZotLit
description: The built-in Literature Note Profile.
contract: ${CONTRACT_VERSION}
filename: '{{ zt.citationKey | default: zt.DOI | default: zt.title | default: zt.key }}{% suffix %}'
language: liquid
frontmatter:
  - key: title
    expr: zt.title
    merge: replace
  - key: related
    expr: zt.relatedItems | note_links
    merge: replace
  - key: collections
    expr: zt.collections | collection_paths
    merge: replace
  - key: citekey
    value: {"$eval":"zt.citationKey"}
    merge: replace
---
# {{ zt.title }}

[Zotero]({{ zt.backlink }}) {{ zt.attachments | map: "fileLink" | compact | join: " " }}

## Annotations

\`\`\`zotquery
views:
  - type: annotations
    name: Annotations
    from: annotations
    filters: item == this.item
    sort:
      - property: attachment.dateAdded
        direction: ASC
      - property: sortIndex
        direction: ASC
\`\`\`

--- zotlit:annotation ---
${DEFAULT_ANNOTATION_LIQUID}`;
