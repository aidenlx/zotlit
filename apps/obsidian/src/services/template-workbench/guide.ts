// Man-page-style quickstart and contract sections for the Workbench Guide

import { TEMPLATE_SLOT_ROOTS } from "@zotlit/db";
import {
  LIQUID_BUILTIN_FILTER_NAMES,
  LIQUID_BUILTIN_TAG_NAMES,
  ZOTLIT_FILTER_NAMES,
} from "@zotlit/templates/liquid";

import { DOCS_SITE_URL, RESERVED_KEYS } from "@/lib/constants";

import type { DiagnosticCode } from "./envelope";
import { CONTRACT_ROOT_NAMES } from "./schema";
import {
  FRONTMATTER_LANGUAGE_NAMES,
  FRONTMATTER_MERGE_NAMES,
  quotedList,
  TEMPLATE_SLOT_NAMES,
} from "./vocabulary";

function rootRow(slot: keyof typeof TEMPLATE_SLOT_ROOTS): string {
  return `  ${slot.padEnd(12)} ${TEMPLATE_SLOT_ROOTS[slot]}`;
}

function manList(names: readonly string[]): string {
  const rows: string[] = [];
  let row = "  ";
  for (const name of names) {
    const entry = row === "  " ? name : `, ${name}`;
    if (row.length + entry.length > 78) {
      rows.push(row);
      row = `  ${name}`;
    } else {
      row += entry;
    }
  }
  if (row !== "  ") rows.push(row);
  return rows.join("\n");
}

const ANNOTATION_REQUIRED: DiagnosticCode = "ANNOTATION_REQUIRED";
const ETA_OPT_IN_REQUIRED: DiagnosticCode = "ETA_OPT_IN_REQUIRED";

const TEMPLATE_DATA_SYNOPSIS = `obsidian zotlit:template-data key=<zotero-key> \\
    root=<${CONTRACT_ROOT_NAMES.join("|")}> expect-source=<source-id>`;

const TEMPLATE_RENDER_SYNOPSIS = `obsidian zotlit:template-render key=<zotero-key> \\
    template=<${TEMPLATE_SLOT_NAMES.join("|")}> expect-source=<source-id> \\
    [format=<json|markdown>]`;

const DOCUMENT_RENDER_SYNOPSIS = `obsidian zotlit:template-document-render key=<zotero-key> \\
    (profile=<default|profile-id> | document=<reference> | source=<document-source>) \\
    [expect-source=<source-id>]`;

const FRONTMATTER_EVAL_SYNOPSIS = `obsidian zotlit:frontmatter-eval key=<zotero-key> \\
    [expr=<expression> [language=<${FRONTMATTER_LANGUAGE_NAMES.join("|")}>]] \\
    [expect-source=<source-id>]`;

const FRONTMATTER_SET_SYNOPSIS = `obsidian zotlit:frontmatter-set field=<key> \\
    [expr=<expression>] [language=<${FRONTMATTER_LANGUAGE_NAMES.join("|")}>] \\
    [merge=<${FRONTMATTER_MERGE_NAMES.join("|")}>]`;

const FRONTMATTER_SYNOPSIS = `obsidian zotlit:frontmatter-status
  ${FRONTMATTER_EVAL_SYNOPSIS}
  ${FRONTMATTER_SET_SYNOPSIS}
  obsidian zotlit:frontmatter-remove field=<key>
  obsidian zotlit:frontmatter-reorder order=<k1,k2,...>`;

const SIZE_SECTION = `SIZE
  template-data output and the downloaded schema can be very large. Pipe JSON
  directly to jq and select only the definitions, fields, or array entries
  needed.`;

const DATA_SECTION = `TEMPLATE DATA

SYNOPSIS
  obsidian zotlit:template-schema
  ${TEMPLATE_DATA_SYNOPSIS}

DESCRIPTION
  All template data is under zt. The root selects the shape of zt, not the field
  to inspect.

ROOTS
  note       One Item. Use for note and content templates. zt.annotations is the
             Item's annotation array.
  annotation One Annotation. zt is that annotation; there is no zt.annotations.
  filename   One Item with filename-safe fields only.

SERIALIZATION
  Workbench output is serialized JSON, not a live runtime object.

  $helper  Callable helper: { "$helper": name, "signature": ..., "value": ... }.
           Failed evaluation also adds "error".
  $inert   Operation omitted by the Workbench: { "$inert": reason }. Only helpers
           marked inert-capable in the schema use this form.
  $ref     Repeated reference: { "$ref": path }.
  Temporal  Dates, instants, and durations serialize to strings.

KEY RESOLUTION
  note, filename
           Accept an Item key or a child Annotation, Attachment, or Child Note key.
           Child keys resolve to the parent Item.
  annotation
           Requires an Annotation key, not an Item key. Other keys fail with
           ${ANNOTATION_REQUIRED}.

  See ${DOCS_SITE_URL}/docs/how-to/explore-template-data#indexed-key for how to
  obtain a Zotero key.

OUTPUT
  template-data stores the template object under the literal key "zt".
  Example: jq '.zt.annotations'.

  template-schema takes no parameters. It answers with schemas.<root>.url and
  schemas.<root>.fileName for every root. Each schema file is a release asset of
  the installed version. Download the one root the edit needs to a temporary
  folder under its fileName, then read the local copy.

${SIZE_SECTION}`;

const RENDER_SECTION = `TEMPLATE RENDER

SYNOPSIS
  ${TEMPLATE_RENDER_SYNOPSIS}

TEMPLATES
  ${quotedList(TEMPLATE_SLOT_NAMES)}

  note        Complete literature-note body. Used on create and overwrite. The
              built-in note template includes content.
  content     Managed region only. Note updates replace this output and preserve
              text outside the region.
  annotation  One annotation. Usually called by content for each annotation.
  filename    Name of a new literature note.

DATA ROOTS
  template-render infers the root from the template. It has no root option. For
  template-data, select the root shown below.

${TEMPLATE_SLOT_NAMES.map(rootRow).join("\n")}

FORMATS
  json        Default. Returns an envelope with "markdown", echoed request,
              identity, active template, and warnings. Check ok, then warnings.
  markdown    Returns exact rendered bytes without an envelope.

BEHAVIOR
  filename output is reduced to one trimmed line, as during note creation.
  Includes use the winning file from the named-template registry.
  Rendering waits for observed template edits to compile.`;

const EDITING_SECTION = `TEMPLATE EDITING

PATHS
  winner.source.path
              Active file for a template name. Reported by template-status.
  editablePath
              Vault path to edit or create when no vault file is active.

SOURCE
  template-source returns the winning body. This includes the built-in default when
  no vault file exists. Use this body as the edit base.

PROCEDURE
  1. Read the active source.
  2. Preserve unrelated content.
  3. Write through a vault-aware operation so Obsidian observes the change.

  External writes take effect after Obsidian detects the file change.

STATUS
  shadowedFiles
              Files that lose to the active file for the same name.
  inertFiles  Eta files blocked by the JavaScript Templates gate.`;

const ETA_SECTION = `ETA TEMPLATES

DESCRIPTION
  Liquid is the default language. Eta is the JavaScript power-user language.
  The JavaScript Templates gate controls Eta and is off by default on each device.
  See ADR 0004.

STATUS
  javascriptTemplatesEnabled
              Reports local user consent. The user changes this setting in ZotLit.

  When disabled, Eta files are inert. Rendering an Eta-only name fails with
  ${ETA_OPT_IN_REQUIRED}; it does not fall back to a Liquid default.

PRECEDENCE
  A Liquid file wins over an Eta file with the same name. Check shadowedFiles and
  inertFiles before editing Eta.

SECURITY
  Change the gate only through ZotLit settings. Do not change it through eval,
  local storage, or file edits.

HELPERS
  renderAnnotation(annotation)
              Render one annotation with the argument as zt.
              Missing or null data is an error. Equivalent to
              include("annotation", annotation). Both use the Profile's
              Annotation Section during Profile rendering; generic named
              rendering keeps its existing lookup.
  pandocCite(zt.citations)
              Produce one complete Pandoc Citation Cluster.
  pandocCite(zt.citations, "prefer-author-in-text")
              Prefer an Author-in-text Citation. A first-item Citation Prefix
              or Suppress Author selects a Citation Cluster.`;

const LIQUID_SECTION = `LIQUID DIALECT

ENGINE
  liquidjs with the built-in tags and filters listed below.

BUILT-IN TAGS
${manList(LIQUID_BUILTIN_TAG_NAMES)}

BUILT-IN FILTERS
${manList(LIQUID_BUILTIN_FILTER_NAMES)}

DATA
  All data is under zt. Reads from another root render empty output and appear in
  template-render warnings.

ERRORS
  An unknown filter is a render error.

ZOTLIT TAGS
  {% render_annotation annotation %}
              Render one annotation with the argument as zt.
              Requires one argument; missing or null data is an error.
              Equivalent to {% render "annotation" with annotation as zt %}.
              Both use the Profile's Annotation Section during Profile rendering;
              generic named rendering keeps its existing lookup.
              Native render remains available for general partial composition.
  {% bq %}...{% endbq %}
              Render the body as a Markdown blockquote.
  {% suffix length, prepend, append %}
              Emit a filename-suffix placeholder.

ZOTLIT FILTERS
  ${ZOTLIT_FILTER_NAMES.join(", ")}

  arr_prefix  Prepend a string to every element of an array.
              {{ zt.creators | map: "lastName" | arr_prefix: "@" }}
  arr_suffix  Append a string to every element of an array.
              {{ zt.creators | map: "lastName" | arr_suffix: "!" }}
  arr_replace Replace every occurrence of a substring in every element.
              The replacement defaults to an empty string, which deletes it.
              {{ zt.collections | collection_paths | arr_replace: "/", " > " }}
  flatten     Flatten an array by one level. Pass a non-negative integer for
              more levels. Order and duplicates stay unchanged; use uniq to
              deduplicate explicitly.
              {{ zt.collections | map: "path" | flatten | uniq }}
  pandoc_cite Produce one complete Pandoc Citation Cluster from zt.citations.
              {{ zt.citations | pandoc_cite }}
              Pass "prefer-author-in-text" to prefer an Author-in-text Citation.
              A first-item Citation Prefix or Suppress Author selects a cluster.
              {{ zt.citations | pandoc_cite: "prefer-author-in-text" }}
  obsidian_tag
              Convert text into a valid Obsidian tag, with an optional prefix.
              Accepts an array or one value, and reads the name of a Zotero
              tag object, so map is not needed.
              {{ zt.tags | obsidian_tag: "#" }}

  obsidian_tag replaces each run of characters Obsidian rejects with one
  underscore, collapses and trims slashes, and prefixes an all-digit name,
  which Obsidian rejects on its own. A name that keeps nothing is dropped from
  an array. The prefix is added last and stays verbatim, so it can be "#" for
  the note body or "zotero/" for a nested tag. Use obsidian_tag for every tag,
  and arr_replace for free text.

  The date filter also accepts Temporal values and Zotero multipart dates.

WHITESPACE
  A trailing -%} removes inline blanks and exactly one following newline.
  A leading {%- removes same-line indentation only.`;

const FRONTMATTER_SECTION = `MANAGED FRONTMATTER

SYNOPSIS
  ${FRONTMATTER_SYNOPSIS}

DESCRIPTION
  Managed frontmatter fields are template expressions stored in plugin settings
  whose values ZotLit writes into literature note YAML on every update. This
  family inspects, evaluates, and mutates that configuration through the
  settings service, so the settings modal, compilation, and sync all observe
  the same change.

PROFILE DOCUMENTS
  A Profile document stores Managed Frontmatter in its ordered frontmatter list.
  Each entry has exactly one value member: expr for a Liquid value expression,
  value for a JSON-e template, or js for a gated JavaScript expression.
  A static-key entry declares key. Static keys must be unique and non-reserved.
  merge is replace (default), append, or keep.

SPREAD ENTRIES
  Omit key to produce several fields from one value or js entry. The result must
  be a string-keyed mapping. A keyless expr is a document-validation error.
  One spread entry can supply the whole frontmatter list, inside the shared
  Profile file. Its merge strategy applies to every produced key.

  Use a top-level $let to share a calculation across fields, and \${} interpolation
  to compute key names. A false $if inside the mapping omits that key and leaves
  its existing note value untouched. A false $if at the root contributes an
  empty patch. Explicit null, arrays, and scalar root results refuse the operation.

  Entries evaluate independently against the same zt context and pinned now.
  Merge follows list order against the note overlaid by the pending patch.
  Later replace entries win; append and keep compose with pending values.
  On create, the first entry that produces a key sets its position. On update,
  existing keys keep their position. Unproduced keys remain untouched.

  Delete a field with a static-key value entry whose JSON-e result is absent
  under replace. Spread omission preserves the field. No deletion sentinel
  or ownership tracking is part of a spread mapping.

  A produced reserved or empty key refuses the whole operation. Diagnostics
  name the key and the producing entry's 1-based list position, with a recovery
  hint. Other spread failures name the entry position. A js spread entry with
  JavaScript Templates off refuses by position, before compilation.
  Values use the same plain-frontmatter output domain and has, uniq, basename
  host functions as static JSON-e entries.

  Example:
    frontmatter:
      - value:
          title: { $eval: zt.title }
          "zotero/\${zt.itemType}": true
      - key: title
        expr: zt.title | upcase

  The frontmatter-* commands below edit legacy settings fields. Edit the Profile
  document's text to author or repair its static-key and spread entries.

EXPRESSIONS
  Field expressions are value expressions (filter chains), not template blocks.
  Tags such as {% assign %}, {% for %}, and {% if %} are not supported.
  Use filters to transform data: where, map, arr_prefix, arr_suffix,
  arr_replace, obsidian_tag, join, etc.

COMMANDS
  frontmatter-status
              List the configured fields, the reserved keys, and the
              JavaScript Templates gate state. Takes no parameters.
  frontmatter-eval
              Evaluate the configured field set against key=<zotero-key>.
              With expr=, evaluate that one ad-hoc expression instead, in
              language= (default liquid); language= without expr= is rejected.
  frontmatter-set
              Add a field, or patch an existing one, by field=<key>. Omitted
              expr=/language=/merge= keep an existing field's current values;
              a new field defaults to liquid and replace.
  frontmatter-remove
              Delete the field named field=<key>.
  frontmatter-reorder
              Arrange the configured fields into order=<k1,k2,...>, a
              complete permutation of every configured key.

KEYS
  field=      A Managed Frontmatter field key. Used by frontmatter-set,
              frontmatter-remove, and each entry of frontmatter-reorder's
              order=.
  key=        The CLI-wide Zotero key. Used by frontmatter-eval to select
              the item to evaluate against. See
              ${DOCS_SITE_URL}/docs/how-to/explore-template-data#indexed-key.

VALUES
  language=   ${quotedList(FRONTMATTER_LANGUAGE_NAMES)}
  merge=      ${quotedList(FRONTMATTER_MERGE_NAMES)}
  reserved keys
              ${quotedList([...RESERVED_KEYS])}. A field= naming one of these
              is rejected; frontmatter-status echoes this same list.

GATE
  The JavaScript Templates gate (see ADR 0004) treats evaluation and writes
  differently while it is off:

  evaluate    Partial. liquid fields evaluate; javascript fields report
              inert instead of a value, and a warning names them and states
              that a real note operation would fail to write them.
  write       Refused. frontmatter-set, and frontmatter-eval's ad-hoc mode,
              reject a language=javascript expression outright: with the
              gate off nothing can be compiled, so nothing can be validated.

FIELD ROWS
  frontmatter-status and every mutation echo the resulting fields as
  { key, expr, language, merge, inert }.

  frontmatter-eval reports one row per entry, in YAML write order, as
  { key, value, source, language, merge, inert?, error? }. value is absent
  when error or inert is present instead. source is "system" for the
  zotero-key row, which is always present. Every configured field reports
  "user".`;

const PROFILES_SECTION = `LITERATURE NOTE PROFILES AND DOCUMENTS

MODEL
  A Literature Note Profile is a zotlit-profile.<slug>.md document directly
  inside the template folder. Its manifest id is the stable twelve-character
  Profile ID; name is its label. Rename the file freely while keeping the
  zotlit-profile. prefix. Edit the file to change its look, bindings, or
  Profile Match.

  The flat manifest keys folder, citationStyle, importFolder,
  importColoredHighlights, and importAnnotationsAsTemplate override the
  default Profile bindings. An absent key inherits; citationStyle: null
  selects no style. Leave folder keys absent when sharing a Profile.

  The default Profile has id=default. Its bindings live in settings. Its
  built-in look can be ejected to zotlit-profile.default.md, whose manifest
  has id: default and carries neither bindings nor match. Restore trashes that
  document. Default is the fallback for automatic Profile selection.

PROFILE MATCH
  A non-default Profile may declare match in its manifest. The value is a Match
  condition string or nested and/or objects containing arrays of Match trees.
  An absent match keeps the Profile manual-only. An empty and array or the
  expression true matches every item; an empty or array matches no items.

  Match conditions compare library to personal or group:<groupID> and itemType
  to a built-in Zotero type. tags and collections support contains, containsAny,
  containsAll, and isEmpty. collections.within(path) includes subcollections.
  Collection paths join ancestor names with /. Tag names are exact and
  case-sensitive across manual and automatic Tags. Negation uses !.

  One matching Profile selects it; multiple matches open the candidate picker.
  Manual choices take precedence, then selectors from a command or ZotLit
  Companion, the Zotero add-on, then the Profile Match, then Default. Each batch
  item selects independently. A preview keeps its chosen Profile and destination;
  existing notes keep their Profile.

  Syntax errors, unsupported conditions, unknown item types, and unavailable
  Libraries make a match unevaluable. Automatic selection skips that Profile;
  its settings row shows Needs attention, and Match… shows the diagnostic.
  An unknown Collection path is a valid nonmatch; negation still applies.

  The Match… editor writes only match in the template document. Save keeps all
  other document bytes; Remove match restores manual-only use. Share and Import
  include match conditions by default. Clearing the corresponding checkbox
  omits match from the written document. Names stay as declared.

NOTE MEMBERSHIP AND SOURCES

  A note records its Profile in the zotlit-profile property, written as the
  Profile label, one space, and the Profile id in parentheses: Reading notes
  (V1StGXR8Z5jd). ZotLit reads only the id in parentheses; the label is a hint
  for the reader. A property that holds the bare id is also valid. A note
  without the property belongs to the default Profile.

  One document contains a YAML manifest with its filename rule, the note source,
  and a required final Annotation Section. Both sources use one language, Liquid
  or Eta. The note source starts immediately after the manifest. The exact,
  unindented standalone line --- zotlit:annotation --- ends the note source and
  starts the Annotation Section, which continues to EOF. An empty section is
  valid, including a header at EOF. Duplicate and unknown --- zotlit: headers,
  including an explicit note header, fail validation.

  The section boundary is parsed before either engine, including inside Markdown
  fences, Liquid raw/comment blocks, and Eta code. Splitting consumes only the
  header and its following line break, when present. Surrounding bytes, blank
  lines, and LF or CRLF line endings stay unchanged. Source ranges refer to the
  original document. Rendered-output whitespace rules remain separate.

  The note source can contain zero or one Managed Block. Zero gives a static
  note; one renders in place on creation and supplies the update scope. Duplicate
  blocks fail validation. The block renders with isolated data. A Managed Block
  tag alone on its own line owns its indentation and line break.

  The Annotation Section renders only when called. Shortcuts, native Liquid
  render and Eta include calls to annotation, and calls from shared partials
  use this section with isolated Annotation Root data. Creation, managed updates,
  direct insertion, and Imported Notes use their applicable Profile's section.
  The binding stays local to each Profile render. Generic named-template rendering
  and other partial lookup keep their existing behavior. A manifest partial named
  annotation fails validation; rename that partial.

  Export retains both sources and bundles reachable shared partials from them and
  the filename rule. The local section satisfies annotation calls, so export does
  not bundle an unrelated global annotation partial.

EDITING CONTRACT
  The web Workbench has an Annotation tab beside Note, Properties, and
  Name and folder. It edits the final Annotation Section, including in a Profile
  whose note has no annotation calls. Each recognized call in Basic is a compact
  inline Annotation placeholder with a preview arrow and an Edit format action.
  One read-only preview opens below the call's line, with an annotation chooser.
  Opening another preview moves this shared block to that call.
  Annotation calls and managed tags reveal their source when the cursor or
  selection touches them. Moving away restores the widgets.
  Edits target the final section in one source buffer and undo history, preserving
  unrelated bytes. ADR 0032 retains invalid drafts in memory and blocks Save on
  document or Profile validation errors.

  Searchable suggesters select the paper for the note result and one annotation
  for the format result. Annotation examples keep their own parent Item and
  citation data. They include the current Item Snapshot's annotations and six
  built-in types: highlight, underline, note, text, image, and ink. Selection is
  kept with the browser draft and stays outside the saved Profile source.
  Reading previews use bundled image placeholders. Markdown retains the original
  image references. ADR 0041 records the interaction and selection rules.

INSPECTION
  template-status reports Profiles and their resolved bindings under profiles,
  documents under documents, and excluded files under profileDiagnostics.
  invalid-profile-document names a broken file. duplicate-profile-id names all
  paths claiming one ID; each is excluded until the collision is fixed.
  Duplicate labels remain usable. Identity comes from the manifest ID. Read the
  template document for its Profile Match; template-status lists the Profile's
  identity and bindings, plus document validation and exclusion diagnostics.

RENDER
  ${DOCUMENT_RENDER_SYNOPSIS}

  Select exactly one input. profile resolves a Profile's installed document;
  document resolves one installed reference; source parses an in-memory source
  override, whether installed or not. The command loads real root=note data and
  returns render.create plus render.update. update is null for a static body.
  Inspection and rendering do not write a note, document, or setting.`;

/** Canonical `topic` registry for `template-guide`. */
export const GUIDE_TOPICS = {
  data: DATA_SECTION,
  render: RENDER_SECTION,
  editing: EDITING_SECTION,
  eta: ETA_SECTION,
  liquid: LIQUID_SECTION,
  frontmatter: FRONTMATTER_SECTION,
  profiles: PROFILES_SECTION,
} as const satisfies Record<string, string>;

export type GuideTopic = keyof typeof GUIDE_TOPICS;

/** Accepted `topic` values in selector and topic-index order. */
export const GUIDE_TOPIC_NAMES = Object.keys(
  GUIDE_TOPICS,
) as readonly GuideTopic[];

export function parseGuideTopic(value: string | undefined): GuideTopic | null {
  return value !== undefined && Object.hasOwn(GUIDE_TOPICS, value)
    ? (value as GuideTopic)
    : null;
}

const TOPIC_SUMMARIES = {
  data: "Data roots, serialization, and key resolution",
  render: "Template roles, data roots, formats, and rendering behavior",
  editing: "Active source, edit procedure, and file status",
  eta: "JavaScript Templates gate, precedence, and security",
  liquid: "Engine, data root, tags, filters, and whitespace",
  frontmatter: "Commands, field= vs key=, value lists, and gate behavior",
  profiles: "Profile state, document validation, and in-memory rendering",
} as const satisfies Record<GuideTopic, string>;

const TOPIC_INDEX = GUIDE_TOPIC_NAMES.map(
  (topic) => `  ${topic.padEnd(12)} ${TOPIC_SUMMARIES[topic]}`,
).join("\n");

const QUICKSTART = `ZOTLIT-TEMPLATE-WORKBENCH(1)

NAME
  zotlit-template-workbench - inspect, edit, and test ZotLit templates
                              and managed frontmatter

SYNOPSIS
  obsidian zotlit:template-status
  obsidian zotlit:template-schema
  ${TEMPLATE_DATA_SYNOPSIS}
  obsidian zotlit:template-source template=<${TEMPLATE_SLOT_NAMES.join("|")}>
  ${TEMPLATE_RENDER_SYNOPSIS}
  ${DOCUMENT_RENDER_SYNOPSIS}
  ${FRONTMATTER_SYNOPSIS}
  obsidian zotlit:template-guide [topic=<${GUIDE_TOPIC_NAMES.join("|")}>]

DESCRIPTION
  The Template Workbench inspects template state and data, reads active source,
  renders changes in memory, and manages Managed Frontmatter field configuration.
  template-status also reports Literature Note Profiles and documents.

NAMESPACES
  root=<name> Selects a CLI data shape. It does not select a field.
  zt.<field>  Reads a field inside Liquid or Eta template source.
  .zt.<field> Reads the same field from template-data JSON with jq.

  Template roots: note and content use root=note; annotation uses root=annotation;
  filename uses root=filename. The annotation root is one annotation, so zt is the
  annotation. To read an Item's annotation array, use root=note and zt.annotations.

WORKFLOW
  1. Run template-status. Record identity.source.id and verify the active file.
  2. Select the template and its data root from NAMESPACES.
  3. Run template-data with expect-source=<identity.source.id>. Inspect the fields
     needed by the edit. Run template-schema only when their shape is unclear.
  4. Run template-source. Use the active vault file or built-in default as the edit base.
  5. Edit winner.source.path, or editablePath when no vault file is active.
  6. Run template-render with expect-source=<identity.source.id>; test ok, then read
     warnings. Use format=markdown for raw bytes.

LITERATURE NOTE DOCUMENTS
  Run template-status to inspect Profile references and document validation.
  Run template-document-render with a Profile, installed document, or source
  override to return create and update bytes without touching a note.

MANAGED FRONTMATTER
  Template expressions stored in plugin settings whose values ZotLit writes
  into literature note YAML on every update. The frontmatter-* commands
  inspect, evaluate, and mutate this configuration through the settings service.

  1. Run frontmatter-status. Review configured fields and gate state.
  2. Run frontmatter-eval key=<zotero-key> to test evaluation against an item.
  3. Use frontmatter-set, frontmatter-remove, frontmatter-reorder to edit the
     field set. Each command echoes the resulting field list.

OUTPUT
  JSON responses have { contractVersion, command, ok, ... }. Commands add the echoed
  request and identity where applicable. contractVersion versions the workbench
  commands alone; every other zotlit:* namespace versions its own CLI Contract
  independently.

  ok=false    On failure, follow diagnostic.hint.
  template-data
              The template object is under "zt". Example: jq '.zt.annotations'.
  template-schema
              Download URLs are under "schemas.<root>.url", each with the file
              name to save it as under "schemas.<root>.fileName".
  template-render
              Rendered bytes are under "markdown"; diagnostics are under "warnings".
  template-source
              Active template text is under "source".
  template-document-render
              Create and update bytes are under "render". Static update is null.

${SIZE_SECTION}

TOPICS
${TOPIC_INDEX}

  Read one topic with:
    obsidian zotlit:template-guide topic=<name>

SEE ALSO
  obsidian help zotlit
  ${DOCS_SITE_URL}/docs/reference/templates`;

export function renderGuide(topic: GuideTopic | null): string {
  return topic === null ? QUICKSTART : GUIDE_TOPICS[topic];
}
