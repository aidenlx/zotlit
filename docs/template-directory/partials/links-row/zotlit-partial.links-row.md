---
language: liquid
---
{%- assign pdf_link = "" -%}
{%- for attachment in zt.attachments -%}
  {%- if pdf_link == "" and attachment.contentType == "application/pdf" -%}
    {%- capture pdf_link %}{{ attachment | file_link: "PDF" }}{% endcapture -%}
  {%- endif -%}
{%- endfor -%}
[Zotero]({{ zt.backlink }}){% if pdf_link != "" %} · {{ pdf_link }}{% endif %}{% if zt.DOI %} · [DOI](https://doi.org/{{ zt.DOI }}){% endif %}{% if zt.url %} · [Web page]({{ zt.url }}){% endif %}
