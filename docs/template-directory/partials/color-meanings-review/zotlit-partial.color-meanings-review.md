---
language: liquid
---
{%- comment -%}
Color meanings for a literature review: what each Zotero highlight color
means in your notes.

Each line below names a Zotero color, the callout type that shows it, and the
meaning that titles the callout. Change a meaning or a callout type on its
line, and every note that uses these meanings follows on its next update.
Change only the words between the quotation marks.

The colors line sets the order of the groups in a note that groups
annotations by color. To move a group, move its color in that line.

Built-in callout types, by the color they show without a CSS snippet:
  red: failure, danger, bug
  orange: warning, question
  green: success
  cyan: tip, important, abstract
  blue: info, note, todo
  purple: example
  gray: quote
No built-in callout type shows yellow or pink.
{%- endcomment -%}
{%- assign colors = "yellow,blue,green,red,orange,magenta,purple,gray,plum" -%}
{%- case zt.colorName -%}
  {%- when "yellow" -%}  {%- assign callout = "warning" -%}  {%- assign meaning = "Aim" -%}
  {%- when "blue" -%}    {%- assign callout = "info" -%}     {%- assign meaning = "Methods" -%}
  {%- when "green" -%}   {%- assign callout = "success" -%}  {%- assign meaning = "Findings" -%}
  {%- when "red" -%}     {%- assign callout = "failure" -%}  {%- assign meaning = "Limitations" -%}
  {%- when "orange" -%}  {%- assign callout = "question" -%} {%- assign meaning = "Gaps and future research" -%}
  {%- when "magenta" -%} {%- assign callout = "example" -%}  {%- assign meaning = "Related work" -%}
  {%- when "purple" -%}  {%- assign callout = "example" -%}  {%- assign meaning = "Definitions" -%}
  {%- when "gray" -%}    {%- assign callout = "quote" -%}    {%- assign meaning = "Quotes to use" -%}
  {%- when "plum" -%}    {%- assign callout = "danger" -%}   {%- assign meaning = "Paraphrases" -%}
  {%- else -%}           {%- assign callout = "note" -%}     {%- assign meaning = "Other highlights" -%}
{%- endcase -%}
