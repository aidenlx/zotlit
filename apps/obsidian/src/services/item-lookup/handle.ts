// The Item search for views and legacy code: the ItemLookup tag behind Promises.
import { Exit, Scope } from "effect";

import { valueOr } from "@/lib/effect-bridge";
import type { EffectBridge } from "@/lib/effect-bridge";

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

/** {@link ItemLookup} for callers outside Effect. A search the unload interrupts answers empty. */
export interface ItemLookupHandle {
  search(query: string, opts?: SearchOptions): Promise<SearchHit[]>;
  openSession(): SearchSession;
}

const released = (exit: Exit.Exit<SearchHit[]>) => valueOr(exit, []);

export function bindItemLookup(
  bridge: Pick<EffectBridge, "runSync" | "runPromise" | "runPromiseExit">,
  lookup: ItemLookup["Service"],
): ItemLookupHandle {
  return {
    search: (query, opts) =>
      bridge.runPromiseExit(lookup.search(query, opts)).then(released),
    openSession: () => {
      const scope = Scope.makeUnsafe();
      const session = bridge.runSync(Scope.provide(lookup.openSession, scope));
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        void bridge.runPromise(Scope.close(scope, Exit.void));
      };
      return {
        search: (query, opts) =>
          closed
            ? Promise.resolve([])
            : bridge.runPromiseExit(session.search(query, opts)).then(released),
        close,
        [Symbol.dispose]: close,
      };
    },
  };
}
