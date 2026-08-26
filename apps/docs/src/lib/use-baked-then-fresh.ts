// The bake-then-refresh behaviour behind every GitHub fact the site shows.
//
// The pages that show a fact prerender, so the value in their HTML — and in
// the first client render — is the one their build saw. This hook fetches the
// fact's endpoint after mount and swaps in the latest; until the response
// lands, and when the lookup fails, the baked value stands. A caller never
// sees a loading or an error state.

import { useEffect, useState } from "react";

/** The latest fact over the baked one. */
export function useBakedThenFresh<T>(endpoint: string, baked: T): T;
/** A null baked value means the page carries no such fact: nothing is fetched. */
export function useBakedThenFresh<T>(
  endpoint: string,
  baked: T | null,
): T | null;
export function useBakedThenFresh<T>(
  endpoint: string,
  baked: T | null,
): T | null {
  const [fresh, setFresh] = useState<T | null>(null);
  const carriesFact = baked !== null;

  useEffect(() => {
    if (!carriesFact) return;
    const controller = new AbortController();
    fetch(endpoint, { signal: controller.signal })
      .then((response) =>
        response.ok ? (response.json() as Promise<T>) : null,
      )
      .then((latest) => {
        if (latest) setFresh(latest);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [endpoint, carriesFact]);

  return fresh ?? baked;
}
