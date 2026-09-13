---
id: V1StGXR8Z5jd
name: Books
folder: books
citationStyle: http://www.zotero.org/styles/chinese-gb7714-1987-numeric
version: 1.0.0
author: ZotLit
description: A visibly distinct book layout for the End-to-end Run
contract: 3
filename: 'books-{{ zt.citationKey | default: zt.key }}{% suffix %}'
match: 'itemType == "book"'
frontmatter:
  - key: fixture-title
    expr: zt.title
    merge: replace
  - key: fixture-kind
    value: {"$if":"zt.itemType == 'journalArticle'","then":"reference/article","else":"reference/other"}
    merge: replace
  - key: fixture-obsolete
    value: {"$if":"zt.itemType == 'bookSection'","then":"retained"}
    merge: replace
  - value: {"fixture-spread-title":{"$eval":"zt.title"},"fixture-spread-kind":{"$eval":"zt.itemType"}}
  - value: {"fixture-reviewed":true}
---
# Book profile: {{ zt.title }}

{% managed %}
## Book details

Citation key: {{ zt.citationKey }}

{% render "book-details" with zt as zt %}
{% endmanaged %}

--- zotlit:annotation ---
{% bq %}
[!quote] Fixture page {{ zt.pageLabel }}

{{ zt.text }}
{% endbq %}
