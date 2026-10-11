// Registers the citation commands with Obsidian's CLI.
//
// Command, flag, and diagnostic text is all hardcoded English: an
// agent-facing contract surface, not localized UI. See
// apps/obsidian/policies/cli-text.md.
import type {
  App,
  CliFlag,
  CliFlags,
  FileSystemAdapter,
  Plugin,
} from "obsidian";

import { isChildItemFields } from "@zotlit/db";

import { Effect } from "@/lib/effect";
import { itemSummary } from "@/lib/item-summary";
import { getLogger } from "@/lib/log";
import type { CitationLookup } from "@/services/citation-index/lookup-service";
import { readReferenceSources } from "@/services/citation-index/service";
import type {
  CitationIndex,
  CitationSyntax,
} from "@/services/citation-index/service";
import type { ZoteroPrefService } from "@/services/zotero-pref/service";
import type { ZoteroReadsService } from "@/services/zotero-reads/service";

import {
  CITATIONS_GUIDE_COMMAND,
  CITED_BY_COMMAND,
  createCitationsCliHandlers,
  REFERENCES_COMMAND,
} from "./commands";
import type { DocumentReferences, ItemLookup } from "./commands";
import type { CITED_BY_PARAMS, REFERENCES_PARAMS } from "./request";

const logger = getLogger(["citation-index", "cli"]);

interface CitationsCliRegistrationDeps {
  app: App;
  citationIndex: CitationIndex;
  citationLookup: Pick<CitationLookup, "read" | "status">;
  db: Pick<ZoteroReadsService, "state" | "ready" | "acquireRead">;
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
  } satisfies Record<(typeof CITED_BY_PARAMS)[number], CliFlag>;
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
  } satisfies Record<(typeof REFERENCES_PARAMS)[number], CliFlag>;
}

export function registerCitationsCli(
  plugin: Plugin,
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
    index: {
      waitUntilSettled: (timeoutMs) =>
        deps.citationIndex.waitUntilSettled(timeoutMs),
      readLookup: (request) => deps.citationLookup.read(request),
      citationKeys: () => deps.citationIndex.citationKeys(),
      getCitedBy: (indexedKey, lookup) =>
        deps.citationIndex.getCitedBy(indexedKey, lookup),
      resolution: () =>
        deps.citationLookup.status === "pending"
          ? null
          : deps.citationLookup.status,
      syntaxes: () => deps.citationIndex.syntaxes(),
      documentOmittedSyntaxes: (path) => documentOmittedSyntaxes(deps, path),
      citedByOmittedSyntaxes: (indexedKey, lookup) =>
        deps.citationIndex.citedByOmittedSyntaxes(indexedKey, lookup),
    },
    lookupItem: (indexedKey) => lookupItem(deps.db, indexedKey),
    readDocument: (path) => readDocument(deps, path),
  });

  plugin.registerCliHandler(
    CITED_BY_COMMAND,
    "List the notes that cite one Zotero item, with the position of every citation",
    citedByFlags(),
    handlers[CITED_BY_COMMAND],
  );
  plugin.registerCliHandler(
    REFERENCES_COMMAND,
    "List what one note cites, with the position of every citation",
    referencesFlags(),
    handlers[REFERENCES_COMMAND],
  );
  plugin.registerCliHandler(
    CITATIONS_GUIDE_COMMAND,
    "Print the ZotLit citations CLI guide",
    null,
    handlers[CITATIONS_GUIDE_COMMAND],
  );
}

/** Any Markdown note answers: a document need not be a Literature Note to cite
 *  works. A path the vault holds no note at names no document to read. */
async function readDocument(
  deps: CitationsCliRegistrationDeps,
  path: string,
): Promise<DocumentReferences | null> {
  const file = deps.app.vault.getFileByPath(path);
  if (!file || file.extension !== "md") return null;
  const { citations, errors, lookup } =
    await deps.citationIndex.getDocumentCitationSet(file);
  const { sources, database } = await readReferenceSources(deps.db, citations);
  return { citations, errors, sources, database, lookup };
}

/** Any Markdown note answers, as {@link readDocument} does; a path the vault
 *  holds no note at holds no occurrence to omit. */
async function documentOmittedSyntaxes(
  deps: CitationsCliRegistrationDeps,
  path: string,
): Promise<CitationSyntax[]> {
  const file = deps.app.vault.getFileByPath(path);
  if (!file || file.extension !== "md") return [];
  return deps.citationIndex.documentOmittedSyntaxes(file);
}

/** A well-formed Zotero key names an Item only when the connected library
 *  holds one; a read that fails leaves the verdict `"unreadable"` rather than
 *  reporting every Item as missing. The same read renders the Item's summary,
 *  so one answer carries both. */
async function lookupItem(
  db: CitationsCliRegistrationDeps["db"],
  indexedKey: string,
): Promise<ItemLookup> {
  if (db.state === "degraded") return { presence: "unreadable", summary: null };
  try {
    const { reads } = await db.ready;
    const item = (
      await Effect.runPromise(
        reads.ItemsByIndexedKeys({ indexedKeys: [indexedKey] }),
      )
    ).get(indexedKey);
    if (!item) return { presence: "absent", summary: null };
    // A note or an attachment carries no work fields, so the source holds it
    // and renders no summary for it, as the reference list reads it too.
    const { fields } = item;
    const summary = isChildItemFields(fields)
      ? null
      : itemSummary(item, fields).formatted;
    return { presence: "present", summary };
  } catch (error) {
    logger.warn("Cannot look up the selected item", { indexedKey, error });
    return { presence: "unreadable", summary: null };
  }
}
