// Shared facts for inspection parsing, registered flags, and generated help.
import type { CliFlags } from "obsidian";

export const TEMPLATE_INSPECT_COMMAND = "zotlit:template-inspect";
export const INSPECT_SOURCE_FULL = "full";
export const INSPECT_TIMEOUT_MS = 1_000;
export const INSPECT_SELECTORS = ["note", "profile", "document"] as const;
export const inspectFlags = {
  note: {
    value: "<vault-path>",
    description: "Literature Note path; resolves its item and owning Profile",
  },
  profile: {
    value: "<id-or-label>",
    description: "Profile ID, unique label, or default",
  },
  document: {
    value: "<path-or-reference>",
    description:
      "Template Document path, filename, citation, or partial:<name>",
  },
  source: {
    value: INSPECT_SOURCE_FULL,
    description: "Include complete source; omitted by default",
  },
  editor: {
    description:
      "Explicitly inspect unsaved source in the selected document's active editor",
  },
  "expect-source": {
    value: "<source-id>",
    description: "Required Zotero source identity",
  },
} satisfies CliFlags;

export const INSPECT_DIAGNOSTICS = {
  INVALID_SELECTOR: {
    message:
      "Select one note, Profile, or document. Editor source requires a target.",
    recovery: `Run help ${TEMPLATE_INSPECT_COMMAND} for selectors and source=${INSPECT_SOURCE_FULL}.`,
  },
  TARGET_MISMATCH: {
    message: "The connected Zotero source differs from expect-source.",
    recovery: "Select the intended vault and Zotero source.",
  },
  AMBIGUOUS_TARGET: {
    message: "The target matches more than one document.",
    recovery:
      "Use an exact vault path or Profile ID from the inspection inventory.",
  },
  TARGET_NOT_FOUND: {
    message: "The target does not select a document.",
    recovery:
      "Run template-inspect without selectors, then use an exact document path or Profile ID.",
  },
  NOT_LITERATURE_NOTE: {
    message: "The selected note has no Zotero item key.",
    recovery: "Select an existing Literature Note.",
  },
  UNKNOWN_PROFILE_STAMP: {
    message: "The note's Profile stamp does not resolve.",
    recovery: "Restore the stamped Profile or correct the note's stamp.",
  },
  SOURCE_NOT_LOADED: {
    message: "The requested saved sources are not loaded.",
    recovery:
      "Check the affected paths, allow Obsidian to observe the edits, then inspect again.",
  },
  SOURCE_READ_FAILED: {
    message: "A saved source could not be read.",
    recovery:
      "Check the reported adapter error and file access, then inspect again.",
  },
  SOURCE_SUPERSEDED: {
    message: "The selected document changed during inspection.",
    recovery: "Inspect the target again.",
  },
  EDITOR_TARGET_MISMATCH: {
    message: "The active editor does not hold the selected document.",
    recovery:
      "Open the selected document or omit editor to inspect its saved source.",
  },
  DOCUMENT_NOT_FOUND: {
    message: "Configured document is missing.",
    recovery: "Restore the configured document at the reported path.",
  },
  RESERVED_PARTIAL_NAME: {
    message: "The Shared Partial filename uses a reserved template name.",
    recovery:
      "Rename this Shared Partial to a non-reserved name and update its callers.",
  },
} as const;

const argumentsText = Object.entries(inspectFlags).map(
  ([name, flag]) => `${name}${"value" in flag ? `=${flag.value}` : ""}`,
);
export const INSPECT_SYNOPSIS = `obsidian ${TEMPLATE_INSPECT_COMMAND} ${argumentsText.map((argument) => `[${argument}]`).join(" ")}`;
export const INSPECT_GUIDE = `TEMPLATE INSPECTION

SYNOPSIS
  ${INSPECT_SYNOPSIS}

DESCRIPTION
  Select at most one of ${INSPECT_SELECTORS.join(", ")}. Omit the target for a compact
  inventory across Template Document kinds. Invalid documents remain readable;
  built-in Default can be inspected without creating a file.
  Saved source and installed Shared Partial dependencies are compared with disk.
  Reconciliation waits up to ${INSPECT_TIMEOUT_MS} ms. Results identify requested,
  disk, and loaded revisions. Source selection never silently uses an editor.
  Editor responses mark document metadata, bindings, dependencies, and problems
  as saved context; editor source is disclosed without validation.

FLAGS
${Object.entries(inspectFlags)
  .map(([name, flag]) => `  ${name}: ${flag.description}`)
  .join("\n")}

DIAGNOSTICS
${Object.entries(INSPECT_DIAGNOSTICS)
  .map(([code, entry]) => `  ${code}: ${entry.message} ${entry.recovery}`)
  .join("\n")}`;
