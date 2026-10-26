import { it } from "@effect/vitest";
import { Effect, Layer, Queue, Stream } from "effect";
import type * as Atom from "effect/reactivity/Atom";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { expect } from "vitest";

import { layerHost } from "@/lib/__fixtures__/obsidian-host-app";
import { MemoryMetadataCache } from "@/lib/__fixtures__/obsidian-metadata-cache";
import { MemoryVault } from "@/lib/__fixtures__/obsidian-vault";
import { MemoryWorkspace } from "@/lib/__fixtures__/obsidian-workspace";
import { layerUnreadViewServices } from "@/lib/__fixtures__/view-atoms";
import { makeViewRegistry } from "@/lib/view-atoms";

import { activeCitedByAtom, citedByAtom } from "./atoms";
import { CitationIndex } from "./service";
import type { CitedBySnapshot } from "./service";

const snapshot = (coverage: CitedBySnapshot["coverage"]): CitedBySnapshot => ({
  groups: [],
  coverage,
  resolution: null,
});

/** A host whose Citation Index records each observer it starts and stops. */
const host = Effect.gen(function* () {
  const vault = new MemoryVault();
  const metadataCache = new MemoryMetadataCache();
  const workspace = new MemoryWorkspace({ layoutReady: true });
  const started: string[] = [];
  const publish = new Map<string, (snapshot: CitedBySnapshot) => void>();
  const starts = yield* Queue.unbounded<string>();
  const stopped = yield* Queue.unbounded<string>();
  const context = yield* Layer.build(
    Layer.mergeAll(
      layerUnreadViewServices,
      layerHost({ vault, metadataCache, workspace }),
      Layer.mock(CitationIndex, {
        citedBy: (key) =>
          Stream.callback<CitedBySnapshot>((queue) =>
            Effect.acquireRelease(
              Effect.sync(() => {
                started.push(key);
                Queue.offerUnsafe(starts, key);
                publish.set(key, (snapshot) => {
                  Queue.offerUnsafe(queue, snapshot);
                });
              }),
              () =>
                Effect.sync(() => {
                  publish.delete(key);
                  Queue.offerUnsafe(stopped, key);
                }),
            ),
          ),
      }),
    ),
  );
  const registry = makeViewRegistry(context, { idleTTL: 0 });
  /** Opens `path` as a note of `key`. */
  const openNote = (path: string, key: string) => {
    const file = vault.add(path);
    file.extension = "md";
    metadataCache.setCache(path, { frontmatter: { "zotero-key": key } });
    workspace.open(file);
    return file;
  };
  return {
    vault,
    workspace,
    registry,
    started,
    starts,
    publish,
    stopped,
    openNote,
  };
});

/** Waits until `atom` holds a value `accept` takes. */
const until = <A>(
  registry: AtomRegistry.AtomRegistry,
  atom: Atom.Atom<A>,
  accept: (value: A) => boolean,
) =>
  AtomRegistry.toStream(registry, atom).pipe(
    Stream.filter((value) => accept(value)),
    Stream.runHead,
  );

it.effect("leaves that read one key share one observer", () =>
  Effect.gen(function* () {
    const { registry, started, publish } = yield* host;
    registry.mount(citedByAtom("ABCD2345"));
    registry.mount(citedByAtom("ABCD2345"));
    expect(registry.get(citedByAtom("ABCD2345"))).toBeNull();
    expect(started).toEqual(["ABCD2345"]);

    const complete = snapshot("complete");
    publish.get("ABCD2345")?.(complete);
    yield* until(
      registry,
      citedByAtom("ABCD2345"),
      (value) => value === complete,
    );
    registry.dispose();
  }).pipe(Effect.scoped),
);

it.effect(
  "the active Cited By observes a new key only when the key changes",
  () =>
    Effect.gen(function* () {
      const host_ = yield* host;
      const { vault, workspace, registry, started, publish, stopped } = host_;
      const { starts, openNote } = host_;
      registry.mount(activeCitedByAtom);
      expect(registry.get(activeCitedByAtom)).toBeNull();

      const paper = openNote("paper.md", "ABCD2345");
      expect(yield* Queue.take(starts)).toBe("ABCD2345");
      const first = snapshot("complete");
      publish.get("ABCD2345")?.(first);
      yield* until(registry, activeCitedByAtom, (value) => value === first);

      // A rename and a duplicate note of the same Item keep the observer.
      vault.rename(paper, "moved.md");
      openNote("duplicate.md", "ABCD2345");
      yield* Effect.yieldNow;
      expect(started).toEqual(["ABCD2345"]);

      openNote("second.md", "ZZZ99999g7");
      expect(yield* Queue.take(stopped)).toBe("ABCD2345");
      expect(started).toEqual(["ABCD2345", "ZZZ99999g7"]);

      const plain = vault.add("plain.md");
      plain.extension = "md";
      workspace.open(plain);
      expect(yield* Queue.take(stopped)).toBe("ZZZ99999g7");
      expect(registry.get(activeCitedByAtom)).toBeNull();
      registry.dispose();
    }).pipe(Effect.scoped),
);
