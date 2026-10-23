// Registers the citation commands with Obsidian's CLI.
//
// Command, flag, and diagnostic text is all hardcoded English: an
// agent-facing contract surface, not localized UI. See
// apps/obsidian/policies/cli-text.md.
import type { App, CliFlag, CliFlags, FileSystemAdapter } from "obsidian";

import type { CliHost } from "@/lib/cli-command";
import type { CitationIndex } from "@/services/citation-index/service";
import type { ZoteroPrefService } from "@/services/zotero-pref/service";

import {
  ANNOTATION_USES_COMMAND,
  CITATIONS_GUIDE_COMMAND,
  CITED_BY_COMMAND,
  createCitationsCliHandlers,
  REFERENCES_COMMAND,
} from "./commands";
import type {
  AnnotationUsesParam,
  CitedByParam,
  ReferencesParam,
} from "./request";

interface CitationsCliRegistrationDeps {
  app: App;
  citationIndex: Pick<
    CitationIndex,
    "readCitedBy" | "readReferences" | "readAnnotationUses"
  >;
  zoteroPref: Pick<ZoteroPrefService, "ready" | "sourceId" | "databasePath">;
}

/** Neither selector is `required`: the command takes exactly one. */
function citedByFlags(): CliFlags {
  return {
    key: {
      value: "<zotero-key>",
      description: "Zotero key of the item; use instead of citekey",
    },
    citekey: {
      value: "<citation-key>",
      description: "Citation key of the item; use instead of key",
    },
    "expect-source": {
      value: "<source-id>",
      description: "Zotero source ID the call must match",
    },
  } satisfies Record<CitedByParam, CliFlag>;
}

function referencesFlags(): CliFlags {
  return {
    file: {
      value: "<vault-path>",
      description: "Vault path of the note, such as notes/review.md",
      required: true,
    },
    "expect-source": {
      value: "<source-id>",
      description: "Zotero source ID the call must match",
    },
  } satisfies Record<ReferencesParam, CliFlag>;
}

export function registerCitationsCli(
  host: CliHost,
  deps: CitationsCliRegistrationDeps,
): void {
  const handlers = createCitationsCliHandlers({
    getIdentity: async () => {
      await deps.zoteroPref.ready;
      return {
        vault: {
          name: deps.app.vault.getName(),
          // Desktop-only plugin: the adapter is always a FileSystemAdapter.
          path: (deps.app.vault.adapter as FileSystemAdapter).getBasePath(),
        },
        source: {
          id: deps.zoteroPref.sourceId,
          databasePath: deps.zoteroPref.databasePath,
        },
      };
    },
    index: deps.citationIndex,
  });

  host.registerCliCommand(ANNOTATION_USES_COMMAND, {
    description:
      "List the notes that use one Zotero annotation, with every occurrence",
    flags: {
      key: {
        value: "<annotation-key>",
        description:
          "Annotation key, with a g<group-id> suffix for a group library",
        required: true,
      },
      "expect-source": {
        value: "<source-id>",
        description: "Zotero source ID the call must match",
      },
    } satisfies Record<AnnotationUsesParam, CliFlag>,
    handler: handlers[ANNOTATION_USES_COMMAND],
  });
  host.registerCliCommand(CITED_BY_COMMAND, {
    description:
      "List the notes that cite one Zotero item, with the position of every citation",
    flags: citedByFlags(),
    handler: handlers[CITED_BY_COMMAND],
  });
  host.registerCliCommand(REFERENCES_COMMAND, {
    description:
      "List what one note cites, with the position of every citation",
    flags: referencesFlags(),
    handler: handlers[REFERENCES_COMMAND],
  });
  host.registerCliCommand(CITATIONS_GUIDE_COMMAND, {
    description: "Print the ZotLit citations CLI guide",
    flags: null,
    handler: handlers[CITATIONS_GUIDE_COMMAND],
  });
}
