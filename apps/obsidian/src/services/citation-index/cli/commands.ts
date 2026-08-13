// The citation commands and their response boundaries.

import type { CliData, CliHandler } from "obsidian";

import type {
  CitationSettleOutcome,
  CitedBySnapshot,
  SnapshotItem,
} from "@/services/citation-index/service";

import {
  citekeyNotFoundDiagnostic,
  diagnostic,
  envelope,
  keyNotFoundDiagnostic,
  notSettledDiagnostic,
} from "./envelope";
import type {
  CitationsCommand,
  CitationsIdentity,
  CitedItem,
  Diagnostic,
} from "./envelope";
import { parseCitedByRequest, targetMismatch } from "./request";
import type { CitedBySelector } from "./request";

export type { CitationsIdentity } from "./envelope";

export const CITED_BY_COMMAND =
  "zotlit:cited-by" as const satisfies CitationsCommand;

const DEFAULT_SETTLE_TIMEOUT_MS = 5_000;

/** Whether the connected Zotero source holds an Item for a well-formed Zotero
 *  key. `"unreadable"` is a degraded database, which the payload reports as a
 *  resolution state rather than as a missing Item. */
export type ItemPresence = "present" | "absent" | "unreadable";

interface CitationsCliDeps {
  getIdentity: () => CitationsIdentity | Promise<CitationsIdentity>;
  /** @default 5000 */
  settleTimeoutMs?: number;
  index: {
    waitUntilSettled: (timeoutMs: number) => Promise<CitationSettleOutcome>;
    /** The Item a citation key names, through the Citekey Resolution Snapshot. */
    resolveCitekey: (citekey: string) => SnapshotItem | null;
    citekeyOf: (indexedKey: string) => string | null;
    getCitedBy: (indexedKey: string) => CitedBySnapshot;
  };
  lookupItem: (indexedKey: string) => ItemPresence;
}

export type CitationsCliHandlers = Record<typeof CITED_BY_COMMAND, CliHandler>;

export function createCitationsCliHandlers(
  deps: CitationsCliDeps,
): CitationsCliHandlers {
  const settleTimeoutMs = deps.settleTimeoutMs ?? DEFAULT_SETTLE_TIMEOUT_MS;

  return {
    [CITED_BY_COMMAND]: async (params: CliData): Promise<string> => {
      const request = parseCitedByRequest(params);
      if (request.kind === "invalid") {
        return envelope(CITED_BY_COMMAND, {
          ok: false,
          diagnostic: diagnostic("INVALID_SELECTOR", request.message, {
            parameter: request.parameter,
          }),
        });
      }

      // Asserted before the index is read, so a call aimed at another Zotero
      // source costs no data load at all.
      const identity = await deps.getIdentity();
      const echoed = { request: request.value, identity };
      const mismatch = targetMismatch(params, identity);
      if (mismatch) {
        return envelope(CITED_BY_COMMAND, {
          ok: false,
          ...echoed,
          diagnostic: mismatch,
        });
      }

      const outcome = await deps.index.waitUntilSettled(settleTimeoutMs);
      if (outcome !== "settled") {
        return envelope(CITED_BY_COMMAND, {
          ok: false,
          ...echoed,
          diagnostic: notSettledDiagnostic(settleTimeoutMs),
        });
      }

      const item = resolveItem(deps, request.value);
      if (item === null) {
        return envelope(CITED_BY_COMMAND, {
          ok: false,
          ...echoed,
          diagnostic: selectorNotFound(request.value),
        });
      }

      const snapshot = deps.index.getCitedBy(item.key);
      return envelope(CITED_BY_COMMAND, {
        ok: true,
        ...echoed,
        item,
        groups: snapshot.groups,
        coverage: snapshot.coverage,
        resolution: snapshot.resolution,
      });
    },
  };
}

/**
 * The Item a selector names, in the identities the payload reports.
 *
 * @returns `null` when the connected source names no such Item. A database
 *   that cannot be read answers the Item as selected instead: the payload's
 *   `resolution` state is what reports the degradation, so an unreadable
 *   library never masquerades as a missing Item.
 */
function resolveItem(
  deps: CitationsCliDeps,
  selector: CitedBySelector,
): CitedItem | null {
  if ("citekey" in selector) {
    const { citekey } = selector;
    const resolved = deps.index.resolveCitekey(citekey);
    return resolved === null ? null : { key: resolved.indexedKey, citekey };
  }
  const { key } = selector;
  if (deps.lookupItem(key) === "absent") return null;
  return { key, citekey: deps.index.citekeyOf(key) };
}

function selectorNotFound(selector: CitedBySelector): Diagnostic {
  return "citekey" in selector
    ? citekeyNotFoundDiagnostic(selector.citekey)
    : keyNotFoundDiagnostic(selector.key);
}
