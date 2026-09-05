# The web Workbench edits one source document

The web Template Workbench presents one Profile document through body and
Annotation editors, Properties, Details, and Advanced. In the
[#930 design session](https://github.com/aidenlx/zotlit/issues/930), we chose
the complete source text as the authority, with parsed values as a derived
view. Every form or editor change applies a targeted source edit, preserving
unrelated bytes, including YAML comments, key order, quoting, and line
endings; Save writes that source. This preserves hand-written documents
across the different editing surfaces, at the cost of source mapping and
targeted YAML edits instead of whole-manifest serialization.

All surfaces share one document undo history, including text edits, form
changes, row operations, and structural actions. Switching Advanced on or
off preserves that history and adds no undo step. Save preserves history
and marks the saved source. Invalid drafts remain editable in memory;
existing document and Profile validation errors block Save, while errors
found only during preview remain separate from Save. Problems shows the
first validation error alongside a local indicator; selecting it opens
the affected Properties row, Details field, Annotation editor, or Advanced
source when its location is available.

Recovery follows KISS. The active editor keeps the user's text while
validation fails, and form refresh and Save wait for a valid document.
The user repairs the text in the current editor, uses Undo, or opens
Advanced. YAML that a form cannot safely edit remains available in
Advanced with its source preserved. Use the existing parser and one
cohesive editing core as the starting point.

Rule rows edit JSON source stored directly under `value` in the YAML
manifest. This keeps incomplete input in the same source buffer and undo
history, while limiting the outer syntax needed for JSON-e editor support.
The [JSON-e editor design](../research/json-e-editor-design.md) restores
the JSON authoring syntax from the
[#938 ruling](https://github.com/aidenlx/zotlit/issues/938#issuecomment-5468828547)
and retains direct source editing. JSON-e remains the evaluation language.
Fixtures and starter rules change with implementation; migration is outside
scope because this beta has not shipped.

The web and Obsidian hosts share document edit rules, history, source
mapping, and structural editor extensions. Each host supplies its layout,
popup presentation, file access, and transport. This keeps the editing
contract consistent when the web surface is ported to Obsidian;
[#931](https://github.com/aidenlx/zotlit/issues/931) owns the transport
contract. The three-column layout and default depth from #938, the language
interactions from #932, and inline Annotation editing from #933 remain
the shell's settled inputs. The detailed Properties, metadata, preview,
data exploration, and onboarding prototypes remain with their respective
child tickets under #863.
