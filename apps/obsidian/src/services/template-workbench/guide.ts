// Man-page-style quickstart and contract sections for the Workbench Guide

import { TEMPLATE_SLOT_ROOTS } from "@zotlit/db";
import {
  LIQUID_BUILTIN_FILTER_NAMES,
  LIQUID_BUILTIN_TAG_NAMES,
} from "@zotlit/templates/liquid";

import { DOCS_SITE_URL } from "@/lib/constants";

import { type DiagnosticCode } from "./envelope";
import { CONTRACT_ROOT_NAMES } from "./schema";
import { quotedList, TEMPLATE_SLOT_NAMES } from "./vocabulary";

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

const DATA_SECTION = `TEMPLATE DATA

SYNOPSIS
  obsidian-cli zotlit:template-schema root=<${CONTRACT_ROOT_NAMES.join("|")}>
  obsidian-cli zotlit:template-data key=<indexed-key> \\
    root=<${CONTRACT_ROOT_NAMES.join("|")}> expect-source=<source-id>

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
  obtain an indexed key.

OUTPUT
  template-data stores the template object under the literal key "zt".
  Example: jq '.zt.annotations'.

SIZE
  template-schema and template-data output can be very large. Pipe JSON directly
  to jq and select only the definitions, fields, or array entries needed.`;

const RENDER_SECTION = `TEMPLATE RENDER

SYNOPSIS
  obsidian-cli zotlit:template-render key=<indexed-key> \\
    template=<${TEMPLATE_SLOT_NAMES.join("|")}> expect-source=<source-id> \\
    [format=<json|markdown>]

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
  template-data and template-schema, select the root shown below.

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
  embed, file_link, note_link, img_link, note_links, collection_paths

  The date filter also accepts Temporal values and Zotero multipart dates.

WHITESPACE
  A trailing -%} removes inline blanks and exactly one following newline.
  A leading {%- removes same-line indentation only.`;

/** Canonical `topic` registry for `template-guide`. */
export const GUIDE_TOPICS = {
  data: DATA_SECTION,
  render: RENDER_SECTION,
  editing: EDITING_SECTION,
  eta: ETA_SECTION,
  liquid: LIQUID_SECTION,
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
} as const satisfies Record<GuideTopic, string>;

const TOPIC_INDEX = GUIDE_TOPIC_NAMES.map(
  (topic) => `  ${topic.padEnd(9)} ${TOPIC_SUMMARIES[topic]}`,
).join("\n");

const QUICKSTART = `ZOTLIT-TEMPLATE-WORKBENCH(1)

NAME
  zotlit-template-workbench - inspect, edit, and test ZotLit templates

SYNOPSIS
  obsidian-cli zotlit:template-status
  obsidian-cli zotlit:template-schema root=<${CONTRACT_ROOT_NAMES.join("|")}>
  obsidian-cli zotlit:template-data key=<indexed-key> \\
    root=<${CONTRACT_ROOT_NAMES.join("|")}> expect-source=<source-id>
  obsidian-cli zotlit:template-source template=<${TEMPLATE_SLOT_NAMES.join("|")}>
  obsidian-cli zotlit:template-render key=<indexed-key> \\
    template=<${TEMPLATE_SLOT_NAMES.join("|")}> expect-source=<source-id> \\
    [format=<json|markdown>]
  obsidian-cli zotlit:template-guide [topic=<${GUIDE_TOPIC_NAMES.join("|")}>]

DESCRIPTION
  The Template Workbench inspects template state and data, reads active source, and
  renders changes in memory.

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

OUTPUT
  JSON responses have { contractVersion, command, ok, ... }. Commands add the echoed
  request and identity where applicable.

  ok=false    On failure, follow diagnostic.hint.
  template-data
              The template object is under "zt". Example: jq '.zt.annotations'.
  template-render
              Rendered bytes are under "markdown"; diagnostics are under "warnings".
  template-source
              Active template text is under "source".

SIZE
  template-schema and template-data output can be very large. Pipe JSON directly
  to jq and select only the definitions, fields, or array entries needed.

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
