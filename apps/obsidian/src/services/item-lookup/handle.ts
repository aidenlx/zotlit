// The Item search for views and legacy code: the ItemLookup tag behind Promises.
import { Scope } from "effect";
import type { Exit } from "effect";

import { valueOr } from "@/lib/effect-bridge";
import type { EffectBridge } from "@/lib/effect-bridge";
import { openScope } from "@/lib/effect-scope";

import type { ItemLookup, SearchHit, SearchOptions } from "./service";

/**
 * The searches of one search surface, such as a picker or the Citation
 * Suggester. A later `search` interrupts the one before; `close` (or dispose)
 * interrupts the pending search, and every later `search` answers empty.
 */
export interface SearchSession extends Disposable {
  search(query: string, opts?: SearchOptions): Promise<SearchHit[]>;
  close(): void;
}

/**
 * {@link ItemLookup} for callers outside Effect: an edge handle
 * (`policies/services.md` → Edge handle). A search the unload interrupts
 * answers empty.
 */
export interface ItemLookupHandle {
  search(query: string, opts?: SearchOptions): Promise<SearchHit[]>;
  openSession(): SearchSession;
}

const released = (exit: Exit.Exit<SearchHit[]>) => valueOr(exit, []);

export function bindItemLookup(
  bridge: Pick<EffectBridge, "runSync" | "runPromiseExit">,
  lookup: ItemLookup["Service"],
): ItemLookupHandle {
  return {
    search: (query, opts) =>
      bridge.runPromiseExit(lookup.search(query, opts)).then(released),
    openSession: () => {
      const { scope, close } = openScope();
      const session = bridge.runSync(Scope.provide(lookup.openSession, scope));
      const end = () => void close();
      return {
        search: (query, opts) =>
          bridge.runPromiseExit(session.search(query, opts)).then(released),
        close: end,
        [Symbol.dispose]: end,
      };
    },
  };
}
