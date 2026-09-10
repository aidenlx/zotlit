// The per-render metadata-cache facade: the engine's app, with the link maps augmented for one render call.

import type { App, MetadataCache } from "obsidian";

import type { GraphCitationAdditions, LinkMap } from "./adapter";

/** The engine member one facaded render swaps; `install.ts` verified it present. */
export interface FacadeEngine {
  app: App;
}

/**
 * Runs the engine's own `render` with `engine.app` swapped for a facade whose
 * metadata cache carries `additions` on top of the real link maps. The engine
 * reads its app once at the top of `render`, so the swap reaches the scan,
 * the local narrowing, the orphan sweep, and "Existing files only" alike, and
 * nothing outside this one synchronous call observes the facade.
 *
 * @param render the engine's native `render`, called on the engine.
 * @returns whatever the native `render` returns.
 * @throws whatever the native `render` throws; the real app is restored first.
 * @see apps/obsidian/docs/adr/0029-graph-citations-extend-obsidian-graph-through-a-per-render-metadata-facade.md
 */
export function renderWithFacade(
  engine: FacadeEngine,
  render: () => unknown,
  additions: GraphCitationAdditions,
): unknown {
  const app = engine.app;
  engine.app = facadeApp(app, additions);
  try {
    return render.call(engine);
  } finally {
    engine.app = app;
  }
}

/**
 * The real app, with `metadataCache` alone replaced. Every other read, and
 * every method the scan calls on the cache, forwards to the real object, so
 * the facade needs no knowledge of the cache beyond its two link maps and its
 * file list.
 */
export function facadeApp(app: App, additions: GraphCitationAdditions): App {
  const metadataCache = facadeMetadataCache(app.metadataCache, additions);
  return new Proxy(app, {
    get(target, key, receiver) {
      if (key === "metadataCache") return metadataCache;
      return forward(target, key, receiver);
    },
  });
}

function facadeMetadataCache(
  cache: MetadataCache,
  additions: GraphCitationAdditions,
): MetadataCache {
  const resolvedLinks = mergeLinkMaps(
    withoutLinks(cache.resolvedLinks, additions.hiddenLinks),
    additions.resolvedLinks,
  );
  const unresolvedLinks = mergeLinkMaps(
    cache.unresolvedLinks,
    additions.unresolvedLinks,
  );
  const { survivingPaths } = additions;
  // The scan builds a node per cached file, so the narrowed list is what
  // "Citation-connected only" takes away — and the local narrowing and the
  // orphan sweep, which run after it inside the same render, run on what is
  // left. An edge into a file that is gone draws nothing.
  const narrows =
    survivingPaths !== null && typeof cache.getCachedFiles === "function";
  return new Proxy(cache, {
    get(target, key, receiver) {
      if (key === "resolvedLinks") return resolvedLinks;
      if (key === "unresolvedLinks") return unresolvedLinks;
      if (key === "getCachedFiles" && narrows) {
        return () =>
          target.getCachedFiles!().filter((path) => survivingPaths.has(path));
      }
      return forward(target, key, receiver);
    },
  });
}

/**
 * Subtracts the links a citation syntax drew that this render does not,
 * counted per source and target, so a target a source also reaches by an
 * ordinary link keeps its edge.
 *
 * @returns `base` less `hidden`; `base` itself when there is nothing to take
 *   away. Neither input is mutated.
 */
export function withoutLinks(base: LinkMap, hidden: LinkMap): LinkMap {
  const sources = Object.keys(hidden);
  if (sources.length === 0) return base;
  const stripped: LinkMap = { ...base };
  for (const source of sources) {
    const links = base[source];
    if (!links) continue;
    const kept: Record<string, number> = {};
    for (const [target, count] of Object.entries(links)) {
      const remaining = count - (hidden[source]![target] ?? 0);
      if (remaining > 0) kept[target] = remaining;
    }
    stripped[source] = kept;
  }
  return stripped;
}

/**
 * Reads through to the real object, binding methods to it: Obsidian's cache
 * methods reach their own state through `this`, which must be the real cache
 * and not the proxy.
 */
function forward(target: object, key: string | symbol, receiver: unknown) {
  const value = Reflect.get(target, key, receiver);
  return typeof value === "function" ? value.bind(target) : value;
}

/**
 * @returns `base` with every source in `additions` merged in, the base's own
 *   edges first; `base` itself when there is nothing to add. Neither input
 *   is mutated.
 */
export function mergeLinkMaps(base: LinkMap, additions: LinkMap): LinkMap {
  const sources = Object.keys(additions);
  if (sources.length === 0) return base;
  const merged: LinkMap = { ...base };
  for (const source of sources) {
    merged[source] = { ...base[source], ...additions[source] };
  }
  return merged;
}
