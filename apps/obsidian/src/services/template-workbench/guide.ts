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

const TEMPLATE_DATA_SYNOPSIS = `obsidian-cli zotlit:template-data key=<zotero-key> \\
    root=<${CONTRACT_ROOT_NAMES.join("|")}> expect-source=<source-id>`;

const TEMPLATE_RENDER_SYNOPSIS = `obsidian-cli zotlit:template-render key=<zotero-key> \\
    template=<${TEMPLATE_SLOT_NAMES.join("|")}> expect-source=<source-id> \\
    [format=<json|markdown>]`;

const FRONTMATTER_EVAL_SYNOPSIS = `obsidian-cli zotlit:frontmatter-eval key=<zotero-key> \\
    [expr=<expression> [language=<${FRONTMATTER_LANGUAGE_NAMES.join("|")}>]] \\
    [expect-source=<source-id>]`;

const FRONTMATTER_SET_SYNOPSIS = `obsidian-cli zotlit:frontmatter-set field=<key> \\
    [expr=<expression>] [language=<${FRONTMATTER_LANGUAGE_NAMES.join("|")}>] \\
    [merge=<${FRONTMATTER_MERGE_NAMES.join("|")}>]`;

const FRONTMATTER_SYNOPSIS = `obsidian-cli zotlit:frontmatter-status
  ${FRONTMATTER_EVAL_SYNOPSIS}
  ${FRONTMATTER_SET_SYNOPSIS}
  obsidian-cli zotlit:frontmatter-remove field=<key>
  obsidian-cli zotlit:frontmatter-reorder order=<k1,k2,...>`;

const SIZE_SECTION = `SIZE
  template-data output and the downloaded schema can be very large. Pipe JSON
  directly to jq and select only the definitions, fields, or array entries
  needed.`;

const DATA_SECTION = `TEMPLATE DATA

SYNOPSIS
  obsidian-cli zotlit:template-schema
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
  local storage, or file edits.`;

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

/** Canonical `topic` registry for `template-guide`. */
export const GUIDE_TOPICS = {
  data: DATA_SECTION,
  render: RENDER_SECTION,
  editing: EDITING_SECTION,
  eta: ETA_SECTION,
  liquid: LIQUID_SECTION,
  frontmatter: FRONTMATTER_SECTION,
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
} as const satisfies Record<GuideTopic, string>;

const TOPIC_INDEX = GUIDE_TOPIC_NAMES.map(
  (topic) => `  ${topic.padEnd(12)} ${TOPIC_SUMMARIES[topic]}`,
).join("\n");

const QUICKSTART = `ZOTLIT-TEMPLATE-WORKBENCH(1)

NAME
  zotlit-template-workbench - inspect, edit, and test ZotLit templates
                              and managed frontmatter

SYNOPSIS
  obsidian-cli zotlit:template-status
  obsidian-cli zotlit:template-schema
  ${TEMPLATE_DATA_SYNOPSIS}
  obsidian-cli zotlit:template-source template=<${TEMPLATE_SLOT_NAMES.join("|")}>
  ${TEMPLATE_RENDER_SYNOPSIS}
  ${FRONTMATTER_SYNOPSIS}
  obsidian-cli zotlit:template-guide [topic=<${GUIDE_TOPIC_NAMES.join("|")}>]

DESCRIPTION
  The Template Workbench inspects template state and data, reads active source,
  renders changes in memory, and manages Managed Frontmatter field configuration.

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
  request and identity where applicable.

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

${SIZE_SECTION}

TOPICS
${TOPIC_INDEX}

  Read one topic with:
    obsidian-cli zotlit:template-guide topic=<name>

SEE ALSO
  obsidian-cli help zotlit
  ${DOCS_SITE_URL}/docs/reference/templates`;

export function renderGuide(topic: GuideTopic | null): string {
  return topic === null ? QUICKSTART : GUIDE_TOPICS[topic];
}
