---
language: liquid
---
{%- comment -%}
Color meanings: what each Zotero highlight color means in your notes.

Each line below names a Zotero color, the callout type that shows it, and the
meaning that titles the callout. Change a meaning or a callout type on its
line, and every note that uses these meanings follows on its next update.

Built-in callout types, by the color they show without a CSS snippet:
  red: failure, danger, bug
  orange: warning, question
  green: success
  cyan: tip, abstract
  blue: info, note, todo
  purple: example
  gray: quote
No built-in callout type shows yellow or pink.
{%- endcomment -%}
{%- case zt.colorName -%}
  {%- when "yellow" -%}  {%- assign callout = "warning" -%}  {%- assign meaning = "Important" -%}
  {%- when "red" -%}     {%- assign callout = "failure" -%}  {%- assign meaning = "Disagree" -%}
  {%- when "green" -%}   {%- assign callout = "success" -%}  {%- assign meaning = "Agree" -%}
  {%- when "blue" -%}    {%- assign callout = "info" -%}     {%- assign meaning = "Background" -%}
  {%- when "purple" -%}  {%- assign callout = "example" -%}  {%- assign meaning = "Definitions" -%}
  {%- when "magenta" -%} {%- assign callout = "example" -%}  {%- assign meaning = "Examples" -%}
  {%- when "orange" -%}  {%- assign callout = "question" -%} {%- assign meaning = "Questions" -%}
  {%- when "gray" -%}    {%- assign callout = "quote" -%}    {%- assign meaning = "Quotes to use" -%}
  {%- when "plum" -%}    {%- assign callout = "danger" -%}   {%- assign meaning = "Paraphrases" -%}
  {%- else -%}           {%- assign callout = "note" -%}     {%- assign meaning = "Other highlights" -%}
{%- endcase -%}
