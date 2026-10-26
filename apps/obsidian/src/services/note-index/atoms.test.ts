import { it } from "@effect/vitest";
import { Effect, Layer, Stream } from "effect";
import type * as Atom from "effect/reactivity/Atom";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { expect } from "vitest";

import { layerHost } from "@/lib/__fixtures__/obsidian-host-app";
import { MemoryMetadataCache } from "@/lib/__fixtures__/obsidian-metadata-cache";
import { MemoryVault } from "@/lib/__fixtures__/obsidian-vault";
import { MemoryWorkspace } from "@/lib/__fixtures__/obsidian-workspace";
import { layerUnreadViewServices } from "@/lib/__fixtures__/view-atoms";
import { makeViewRegistry } from "@/lib/view-atoms";

import { activeNoteAtom } from "./atoms";
import type { ActiveNote } from "./atoms";

function host() {
  const vault = new MemoryVault();
  const metadataCache = new MemoryMetadataCache();
  const workspace = new MemoryWorkspace({ layoutReady: true });
  return {
    vault,
    metadataCache,
    workspace,
    registry: Effect.map(
      Layer.build(
        Layer.merge(
          layerUnreadViewServices,
          layerHost({ vault, metadataCache, workspace }),
        ),
      ),
      (context) => makeViewRegistry(context, { idleTTL: 0 }),
    ),
  };
}

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

const note = (path: string | null, key: string | null) => (value: ActiveNote) =>
  value.path === path && value.key === key;

it.effect("follows the active note and the key in its frontmatter", () =>
  Effect.gen(function* () {
    const { vault, metadataCache, workspace, registry: make } = host();
    const registry = yield* make;
    registry.mount(activeNoteAtom);
    expect(registry.get(activeNoteAtom)).toEqual({ path: null, key: null });

    const paper = vault.add("paper.md");
    paper.extension = "md";
    metadataCache.setCache("paper.md", {
      frontmatter: { "zotero-key": "ABCD2345" },
    });
    workspace.open(paper);
    yield* until(registry, activeNoteAtom, note("paper.md", "ABCD2345"));

    metadataCache.change(paper, {
      frontmatter: { "zotero-key": "ZZZ99999g7" },
    });
    yield* until(registry, activeNoteAtom, note("paper.md", "ZZZ99999g7"));

    // Obsidian moves the cache entry with the file.
    metadataCache.setCache("moved.md", {
      frontmatter: { "zotero-key": "ZZZ99999g7" },
    });
    vault.rename(paper, "moved.md");
    yield* until(registry, activeNoteAtom, note("moved.md", "ZZZ99999g7"));

    const pdf = vault.add("paper.pdf");
    pdf.extension = "pdf";
    workspace.open(pdf);
    yield* until(registry, activeNoteAtom, note("paper.pdf", null));
    registry.dispose();
  }).pipe(Effect.scoped),
);

it.effect("a deleted active note leaves no note to follow", () =>
  Effect.gen(function* () {
    const { vault, metadataCache, workspace, registry: make } = host();
    const registry = yield* make;
    registry.mount(activeNoteAtom);
    const paper = vault.add("paper.md");
    paper.extension = "md";
    metadataCache.setCache("paper.md", {
      frontmatter: { "zotero-key": "ABCD2345" },
    });
    workspace.open(paper);
    yield* until(registry, activeNoteAtom, note("paper.md", "ABCD2345"));

    // Obsidian keeps the file active until its leaf closes.
    vault.remove("paper.md");
    yield* until(registry, activeNoteAtom, note(null, null));
    registry.dispose();
  }).pipe(Effect.scoped),
);
