// Registers the citation commands with Obsidian's CLI.
//
// Flag and command help text is localized: it is UI text a user reads while
// discovering the commands. Diagnostic prose inside a response stays literal
// English, since `code` is the machine surface agent scripts read.

import type {
  App,
  CliFlag,
  CliFlags,
  FileSystemAdapter,
  Plugin,
} from "obsidian";

import { getItemsByKey, resolveIndexedKeyLibrary } from "@zotlit/db";

import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import type { CitationIndex } from "@/services/citation-index/service";
import type { DatabaseService } from "@/services/database/service";
import type { ZoteroPrefService } from "@/services/zotero-pref/service";

import { CITED_BY_COMMAND, createCitationsCliHandlers } from "./commands";
import type { ItemPresence } from "./commands";
import type { CITED_BY_PARAMS } from "./request";

const logger = getLogger(["citation-index", "cli"]);

interface CitationsCliRegistrationDeps {
  app: App;
  citationIndex: CitationIndex;
  db: Pick<DatabaseService, "state" | "client">;
  zoteroPref: Pick<ZoteroPrefService, "ready" | "sourceId" | "databasePath">;
}

/** Flags are built per registration, so their help text resolves against the
 *  active Language Pack rather than the one loaded when this module was
 *  imported. Neither selector is `required`: the command takes exactly one. */
function citedByFlags(): CliFlags {
  return {
    key: {
      value: "<zotero-key>",
      description: m.cli_flag_cited_by_key_desc(),
    },
    citekey: {
      value: "<citation-key>",
      description: m.cli_flag_cited_by_citekey_desc(),
    },
    "expect-source": {
      value: "<source-id>",
      description: m.cli_flag_expect_source_desc(),
    },
  } satisfies Record<(typeof CITED_BY_PARAMS)[number], CliFlag>;
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
      resolveCitekey: (citekey) => deps.citationIndex.resolveCitekey(citekey),
      citekeyOf: (indexedKey) => deps.citationIndex.citekeyOf(indexedKey),
      getCitedBy: (indexedKey) => deps.citationIndex.getCitedBy(indexedKey),
    },
    lookupItem: (indexedKey) => lookupItem(deps.db, indexedKey),
  });

  plugin.registerCliHandler(
    CITED_BY_COMMAND,
    m.cli_cited_by_desc(),
    citedByFlags(),
    handlers[CITED_BY_COMMAND],
  );
}

/** A well-formed Zotero key names an Item only when the connected library
 *  holds one; a read that fails leaves the verdict `"unreadable"` rather than
 *  reporting every Item as missing. */
function lookupItem(
  db: CitationsCliRegistrationDeps["db"],
  indexedKey: string,
): ItemPresence {
  if (db.state !== "ready") return "unreadable";
  try {
    const selector = resolveIndexedKeyLibrary(db.client, indexedKey);
    if (!selector) return "absent";
    const [item] = getItemsByKey(db.client, selector.libraryID, [selector.key]);
    return item ? "present" : "absent";
  } catch (error) {
    logger.warn("Cannot look up the selected item", { indexedKey, error });
    return "unreadable";
  }
}
