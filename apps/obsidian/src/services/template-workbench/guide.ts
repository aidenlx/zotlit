// Focused Workbench reference, using the executable command vocabularies.
import {
  LIQUID_BUILTIN_FILTER_NAMES,
  LIQUID_BUILTIN_TAG_NAMES,
  ZOTLIT_FILTER_NAMES,
} from "@zotlit/templates/liquid";

import { DOCS_SITE_URL, RESERVED_KEYS } from "@/lib/constants";
import { PROFILE_ID_LENGTH } from "@/lib/profile-stamp";
import { RESERVED_PARTIAL_NAME_LIST } from "@/services/template/defaults";

import { CHECK_GUIDE } from "./check";
import { DISCOVERY_HELP } from "./discovery";
import { DIAGNOSTIC_HINTS } from "./envelope";
import { INSPECT_GUIDE, INSPECT_SYNOPSIS } from "./inspect-contract";
import { CONTRACT_ROOT_NAMES } from "./schema";
import {
  CITATION_EXAMPLE_NAMES,
  CITATION_VARIANT_NAMES,
  FRONTMATTER_MERGE_NAMES,
  PARTIAL_CONTEXT_NAMES,
  quotedList,
} from "./vocabulary";

const DATA_SECTION = `TEMPLATE DATA

SYNOPSIS
  obsidian zotlit:template-data root=<${CONTRACT_ROOT_NAMES.join("|")}>
    (key=<indexed-key> | note=<vault-path> | example=<${CITATION_EXAMPLE_NAMES.join("|")}>)
    [query=<words> | path=<zt.path> | full] [expect-source=<source-id>]

DESCRIPTION
  Discovery is optional when the source already shows the fields the edit needs.
  ${DISCOVERY_HELP}
  All template data is under zt. root selects its shape, not a field.
  note and filename take an Item or child key and resolve the parent Item.
  annotation takes one Annotation key; zt is that Annotation.
  citation takes an Item key or a built-in example set. zt.citations holds
  citation details; zt.items holds the bare Items; zt.variant names the gesture.
  Use query=title or path=zt.annotations[0].comment for focused discovery.
  With full, the complete object is under the literal key "zt"; select only
  needed values with jq, for example jq '.zt.annotations'.

SERIALIZATION
  $helper describes a callable helper and its evaluated value or error.
  $inert marks an operation omitted by the Workbench. $ref names a repeated
  reference. Temporal values serialize to strings.
  See ${DOCS_SITE_URL}/docs/how-to/explore-template-data#indexed-key for keys.`;

const FRONTMATTER_SECTION = `MANAGED FRONTMATTER

PROFILE DOCUMENTS
  Edit the Profile document's ordered frontmatter list with file tools.
  Each entry has exactly one value member: expr for a Liquid value expression,
  value for a JSON-e template, or js for a gated JavaScript expression.
  A static-key entry declares key. Static keys are unique and non-reserved.
  merge is ${quotedList(FRONTMATTER_MERGE_NAMES)}; replace is the default.
  Reserved keys: ${quotedList([...RESERVED_KEYS])}.
  Liquid expr is a value expression (a filter chain), not a template block.

JSON-E AND SPREAD ENTRIES
  Omit key to produce several fields from one value or js entry. The result
  must be a string-keyed mapping. A keyless expr is invalid.
  A top-level $let shares calculations across fields; \${} computes key names.
  A false $if inside a mapping omits that key and preserves its note value.
  A false $if at the root contributes an empty patch. Explicit null, arrays,
  and scalar spread results refuse the operation.
  Entries evaluate against the same zt context and pinned now. List order
  controls the fold: later replace wins; append and keep see pending values.
  Existing note keys keep their position. Unproduced keys remain untouched.
  To delete a key, use a static-key value entry whose JSON-e result is absent
  under replace. Spread omission preserves it.
  A reserved or empty produced key refuses the complete operation. Diagnostics
  identify the key and the producing entry's 1-based list position.

EXAMPLE
  frontmatter:
    - value:
        title: { $eval: zt.title }
        "zotero/\${zt.itemType}": true

CHECK
  Run template-check with output=frontmatter and inspect the proposed values.
  With mode=update key=<indexed-key> note=<vault-path>, it includes the update fold.
  Read topic=check for all outputs and retained error evidence.`;

const PROFILES_SECTION = `LITERATURE NOTE PROFILES

SOURCE
  A Profile is a zotlit-profile.<slug>.md document directly in the template folder.
  Its manifest id is a stable ${PROFILE_ID_LENGTH}-character Profile ID; name is the label.
  Keep id and bindings when changing output. template-inspect reports selectable
  Profiles, paths, source revisions, validation, and the built-in Default.
  Default can use built-in source with no installed file and no existing note.

CREATE AND UPDATE
  template-check profile=<id-or-label> key=<indexed-key> checks a create.
  template-check mode=update key=<indexed-key> note=<vault-path> checks that note.
  Select output=body,frontmatter,filename to read complete proposed output.
  Create uses the complete body. Update replaces the Managed Region and folds
  Managed Frontmatter into the existing note, preserving unrelated user text.
  A static body has no Managed Region; update preserves the existing body.
  A failed component fails the complete check. Check output does not write notes.

DRAFTS
  Save complete Markdown source to a scratch file outside the template folder.
  Add draft=<absolute-path> to template-check. With a selected Profile, the
  draft's ID must match. Add mode=update key=<indexed-key> note=<vault-path>
  to test draft-plus-update.
  Checking a draft leaves it uninstalled. After installing it with file tools,
  check the saved document again to verify the loaded revision.
  Read topic=check for attempt evidence and the full output contract.`;

const CITATIONS_SECTION = `CITATION VARIANTS
  template-check document=citation example=two-items variant=main output=citation
  Citation Variants: ${quotedList(CITATION_VARIANT_NAMES)}.
  Check each requested variant separately and compare the actual citation bytes.
  zt.variant carries the selected variant. main is the normal insertion gesture;
  alt is Shift+Enter or a trailing slash in the suggester.
  Use key=<indexed-key> for one real Item or example=<set> for a built-in set:
  ${quotedList(CITATION_EXAMPLE_NAMES)}.
  The installed zotlit-citation.md or built-in source supplies the template.
  Add draft=<absolute-path> to check a complete scratch document.`;

const PARTIALS_SECTION = `SHARED PARTIAL CALLERS
  template-check document=partial:<name> root=note key=<indexed-key>
    profile=<id-or-label> output=partial
  A Shared Partial lives in zotlit-partial.<name>.md in the template folder.
  Names contain letters, digits, and hyphens. Reserved names:
  ${quotedList(RESERVED_PARTIAL_NAME_LIST)}.
  Optional YAML sets language; the remaining source is the body. Default is Liquid.
  A partial has no data root of its own. Select the caller root explicitly:
  ${quotedList(PARTIAL_CONTEXT_NAMES)}. annotation requires an Annotation key;
  citation accepts key or example and variant. profile selects caller bindings;
  omitted profile uses Default. Profile drafts supply their own caller bindings.
  Check the affected Profile or Citation caller as well as the partial output.
  Add draft=<absolute-path> to check scratch source without installing it.
  Installed dependency revisions appear in freshness evidence. Profile manifest
  partials are share transport; import unpacks them into individual files.`;

const LIQUID_SECTION = `LIQUID DIALECT
  Built-in tags: ${LIQUID_BUILTIN_TAG_NAMES.join(", ")}.
  Built-in filters: ${LIQUID_BUILTIN_FILTER_NAMES.join(", ")}.
  ZotLit filters: ${ZOTLIT_FILTER_NAMES.join(", ")}.
  All data is under zt. Unknown filters fail rendering.
  {% render_annotation annotation %} renders a Profile's Annotation Section.
  {% render "name" with zt as zt %} renders a Shared Partial.
  {% bq %}...{% endbq %} emits a Markdown blockquote.
  {% suffix length, prepend, append %} emits a filename-suffix placeholder.
  obsidian_tag converts tag values for Obsidian; it accepts arrays and tag objects.
  pandoc_cite formats zt.citations; "prefer-author-in-text" selects that form.
  arr_prefix, arr_suffix, arr_replace transform arrays; flatten accepts a depth.
  The date filter accepts Temporal values and Zotero multipart dates.
  A trailing -%} removes inline blanks and one following newline; a leading
  {%- removes same-line indentation only.`;

const ETA_SECTION = `ETA TEMPLATES
  Liquid is the default. Eta needs JavaScript Templates enabled on this device.
  The user changes this gate through ZotLit settings. Disabled Eta is inert;
  a check reports the failure and its recovery hint.
  renderAnnotation(annotation) renders the Profile's Annotation Section.
  pandocCite(zt.citations) formats citations; its optional second argument
  "prefer-author-in-text" selects that form.`;

const TROUBLESHOOTING_SECTION = `TROUBLESHOOTING
  Use yq to edit YAML with jq query syntax.
  For Markdown frontmatter, edit only the YAML between its delimiter lines and
  preserve the remaining Markdown bytes. Check the complete repaired document.
  Use template-inspect source=full to read invalid saved source and its problems.
  External edits require matching disk and loaded revisions; read topic=inspect.
  A failed template-check returns diagnostic.hint and attempt evidence. Read
  topic=check to retrieve detailed cause, input revisions, and component output.
  Compare requested output before reporting success, including preserved user
  text during update. A successful compact check alone does not show that output.

LEGACY CONVERSION
  ${DIAGNOSTIC_HINTS.COMMAND_RETIRED}`;

/** Canonical topic registry shared by parsing, generated help, and the index. */
export const GUIDE_TOPICS = {
  inspect: INSPECT_GUIDE,
  check: CHECK_GUIDE,
  data: DATA_SECTION,
  frontmatter: FRONTMATTER_SECTION,
  profiles: PROFILES_SECTION,
  citations: CITATIONS_SECTION,
  partials: PARTIALS_SECTION,
  troubleshooting: TROUBLESHOOTING_SECTION,
  liquid: LIQUID_SECTION,
  eta: ETA_SECTION,
} as const satisfies Record<string, string>;

export type GuideTopic = keyof typeof GUIDE_TOPICS;
export const GUIDE_TOPIC_NAMES = Object.keys(
  GUIDE_TOPICS,
) as readonly GuideTopic[];

export function parseGuideTopic(value: string | undefined): GuideTopic | null {
  return value !== undefined && Object.hasOwn(GUIDE_TOPICS, value)
    ? (value as GuideTopic)
    : null;
}

const QUICKSTART = `ZOTLIT TEMPLATE WORKBENCH

WORKFLOW
  1. template-inspect selects source and verifies vault/source identity and freshness.
  2. Edit the Template Document directly with file tools; preserve unrelated text.
  3. template-check verifies saved or scratch source against a real Item or note.
     Select and inspect the requested outputs before declaring the change complete.
  template-data provides optional focused field discovery when the edit needs it.

SYNOPSIS
  ${INSPECT_SYNOPSIS}
  obsidian zotlit:template-check profile=<id-or-label> key=<indexed-key> output=all
  obsidian zotlit:template-check mode=update key=<indexed-key> note=<vault-path> draft=<absolute-path> output=all
  obsidian zotlit:template-data root=note key=<indexed-key> query=<words>
  obsidian zotlit:template-guide [topic=<${GUIDE_TOPIC_NAMES.join("|")}>]

IDENTITY AND OUTPUT
  Keep vault=<name> first on each call and verify identity.vault and identity.source.
  Supply expect-source=<identity.source.id> when inspecting, discovering data,
  or running a new check. Omit expect-source for retained attempt lookups;
  read topic=check for their accepted flags and recovery example. JSON includes
  contractVersion, command, and ok. On failure, follow diagnostic.hint.
  template-inspect reports source and dependency revisions. template-check runs
  all checks independently of output selection; compact is the default.
  Preview commands write no Template Document, note, or setting.

TOPICS
  ${GUIDE_TOPIC_NAMES.join(", ")}
  Read one topic with obsidian zotlit:template-guide topic=<name>.
  Read command flags with obsidian help zotlit:template-check.

SEE ALSO
  obsidian help zotlit
  ${DOCS_SITE_URL}/docs/reference/templates`;

export function renderGuide(topic: GuideTopic | null): string {
  return topic === null ? QUICKSTART : GUIDE_TOPICS[topic];
}
