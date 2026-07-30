// Literal-English quickstart and contract sections for the Workbench Guide.

import { TEMPLATE_SLOT_ROOTS } from "@zotlit/db";

import { type DiagnosticCode } from "./envelope";
import { CONTRACT_ROOT_NAMES } from "./schema";
import { quotedList, TEMPLATE_SLOT_NAMES } from "./vocabulary";

function rootRow(slot: keyof typeof TEMPLATE_SLOT_ROOTS): string {
  return `  ${slot} -> ${TEMPLATE_SLOT_ROOTS[slot]}`;
}

const ANNOTATION_REQUIRED: DiagnosticCode = "ANNOTATION_REQUIRED";
const ETA_OPT_IN_REQUIRED: DiagnosticCode = "ETA_OPT_IN_REQUIRED";

const DATA_SECTION = `Template data

Root values: ${quotedList(CONTRACT_ROOT_NAMES)}.

Every value the Workbench returns is serialized JSON, not the live runtime object:

- $helper marks a callable helper: { "$helper": name, "signature": ..., "value": ... }.
- $inert marks an operation the Workbench does not perform: { "$inert": reason }. Only
  helpers the schema marks inert-capable can appear this way.
- $ref marks a repeated reference to an object already in the tree: { "$ref": path }.
- Temporal values (dates, instants, durations) serialize as their string form, never
  as objects.

Key resolution:

- A note or filename root resolves an Item from its own key, or from a child
  Annotation, Attachment, or Child Note key by walking up to the parent Item.
- An annotation root requires an Annotation key; a non-annotation key fails with
  ${ANNOTATION_REQUIRED}.`;

const RENDER_SECTION = `Template render

Template values: ${quotedList(TEMPLATE_SLOT_NAMES)}.

Each Template infers its data root; template-render does not accept a root flag:

${TEMPLATE_SLOT_NAMES.map(rootRow).join("\n")}

- format=markdown returns the exact rendered bytes, unmodified.
- format=json wraps the same bytes as markdown, plus the echoed request, identity,
  active template, and warnings.
- The filename Template is collapsed to one trimmed line, the same way note creation
  collapses it.
- Includes resolve through the same named-template registry status reports, so an
  include renders with its winning file.
- Render waits for observed Template edits to compile before it renders.`;

const EDITING_SECTION = `Template editing

- winner.source.path (from template-status) is the file currently active for a
  Template name; editablePath is the vault path to edit or create when no vault file
  is active yet.
- Read the active file before you edit it, and keep unrelated content.
- Write with a vault-aware operation so Obsidian observes the change in process; a
  write made outside Obsidian is picked up only once Obsidian notices the file.
- shadowedFiles lists files that lose to the active file for the same name.
  inertFiles lists Eta files the JavaScript Templates gate blocks.`;

const ETA_SECTION = `Eta templates

- Liquid is the default template language; Eta is a power-user tier gated by
  JavaScript Templates, off by default per device (see ADR 0004).
- javascriptTemplatesEnabled in the status response reports the local consent. Only
  the user changes it, in ZotLit settings; never through eval, local storage, or
  file edits.
- While the gate is off, an Eta Template is inert: a render of that name fails with
  ${ETA_OPT_IN_REQUIRED} instead of falling back to a Liquid default.
- A Liquid file wins over an Eta file for the same name; check shadowedFiles and
  inertFiles in status before assuming an Eta edit is active.`;

/** Canonical `topic` registry for `template-guide`. */
export const GUIDE_TOPICS = {
  data: DATA_SECTION,
  render: RENDER_SECTION,
  editing: EDITING_SECTION,
  eta: ETA_SECTION,
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
  data: "serialization markers, Temporal values, and key resolution.",
  render: "root inference, byte fidelity, and compile settling.",
  editing: "the editable path, read-before-edit, and vault-aware writes.",
  eta: "the JavaScript Templates gate and Eta's inert behavior.",
} as const satisfies Record<GuideTopic, string>;

const TOPIC_INDEX = GUIDE_TOPIC_NAMES.map(
  (topic) => `- ${topic} — ${TOPIC_SUMMARIES[topic]}`,
).join("\n");

const QUICKSTART = `ZotLit Template Workbench quickstart

1. obsidian zotlit:template-status
   Confirm the connected vault and Zotero source, and each Template's active file
   and language.
2. obsidian zotlit:template-schema root=<${CONTRACT_ROOT_NAMES.join("|")}>
   Read the bundled JSON Schema for one data root.
3. obsidian zotlit:template-data key=<indexed-key> root=<${CONTRACT_ROOT_NAMES.join("|")}> format=json
   Inspect the exact serialized data for one Zotero object.
4. Edit the active Template file, at winner.source.path or editablePath from status.
5. obsidian zotlit:template-render key=<indexed-key> template=<${TEMPLATE_SLOT_NAMES.join("|")}> format=<markdown|json>
   Render the edited Template in memory.

Envelope rule: test ok on every JSON response. On ok: false, follow diagnostic.hint.

Topics (topic=<name>):
${TOPIC_INDEX}

Run 'obsidian zotlit:template-guide topic=<name>' for one section, or
'obsidian help zotlit' for every command's flags.`;

export function renderGuide(topic: GuideTopic | null): string {
  return topic === null ? QUICKSTART : GUIDE_TOPICS[topic];
}
