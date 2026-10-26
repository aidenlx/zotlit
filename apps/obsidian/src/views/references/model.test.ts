import { it } from "@effect/vitest";
import { Effect } from "effect";
import { expect, vi } from "vitest";

import { lookupAnswer } from "@/services/citation-index/__fixtures__/lookup";
import type {
  DocumentCitationSet,
  ReferenceSource,
} from "@/services/citation-index/service";
import { bibliographyRevisionsAtom } from "@/services/pandoc/atoms";
import type {
  BibliographyRenderOutcome,
  BibliographyRenderResult,
} from "@/services/pandoc/render-cache";

import { makeReferencesHost } from "./__fixtures__";
import type { ReferencesHost } from "./__fixtures__";
import {
  dismissEngineHintCommand,
  openIndexedKeyCommand,
  openReferenceLinkCommand,
  revealReferenceOccurrenceCommand,
} from "./atoms";
import { advanceOccurrence } from "./model";

type Session = ReturnType<ReferencesHost["openSession"]>;
const source: ReferenceSource = {
  csl: { id: "ref-book", type: "book", title: "Book" },
  summary: "Rivers (2020): Book",
  citationSummary: "Rivers (2020)",
  itemKey: "BOOK0001",
  itemID: 1,
  groupID: null,
  citekey: "rivers2020",
  linkpath: "notes/BOOK0001",
  attachments: [],
};
const set: DocumentCitationSet = {
  sources: new Map([["BOOK0001", source]]),
  presentKeys: new Set(["BOOK0001"]),
  database: "ready",
  syntaxes: {
    citekey: "included",
    wikilink: "excluded",
    annotation: "included",
  },
  omittedSyntaxes: [],
  coverage: "complete",
  lookup: lookupAnswer(),
  occurrences: [],
  errors: [],
  citations: [
    {
      indexedKey: "BOOK0001",
      linkpath: source.linkpath,
      refNumber: 1,
      occurrences: [],
      outcome: { kind: "resolved", source },
    },
  ],
};
const renderValue: BibliographyRenderResult = {
  entries: [
    { id: "ref-book", marker: undefined, content: [{ t: "Str", c: "Book" }] },
  ],
  hasEntryMarkers: false,
};
const outcome: BibliographyRenderOutcome = {
  kind: "held",
  key: "book-render",
  record: {
    status: "fresh",
    value: renderValue,
    settled: Promise.resolve(renderValue),
  },
};
const hostEffect = () =>
  Effect.acquireRelease(
    Effect.promise(() => makeReferencesHost()),
    (host) => Effect.promise(() => host.close()),
  );
const open = (host: ReferencesHost) =>
  Effect.acquireDisposable(Effect.sync(() => host.openSession()));
const waitFor = (assertion: () => void) =>
  Effect.promise(() => vi.waitFor(assertion));
async function finishScan(host: ReferencesHost, session: Session) {
  await vi.waitFor(() => expect(host.scans.length).toBeGreaterThan(0));
  host.scans.at(-1)!.resolve(set);
  await vi.waitFor(() =>
    expect(host.registry.get(session.model.scanned).waiting).toBe(false),
  );
}
async function finishRender(
  host: ReferencesHost,
  session: Session,
  result: BibliographyRenderOutcome = outcome,
) {
  await vi.waitFor(() => expect(host.renders.length).toBeGreaterThan(0));
  host.renders.at(-1)!.resolve(result);
  await vi.waitFor(() =>
    expect(host.registry.get(session.model.loaded).waiting).toBe(false),
  );
}
const ready = (host: ReferencesHost, session: Session) =>
  Effect.promise(async () => {
    await finishScan(host, session);
    await finishRender(host, session);
  });

it.effect("interrupts a document read when its leaf closes", () =>
  Effect.gen(function* () {
    const host = yield* hostEffect();
    host.follow("draft.md");
    const session = host.openSession();
    yield* waitFor(() => expect(host.scans.length).toBeGreaterThan(0));
    session[Symbol.dispose]();
    yield* waitFor(() => expect(host.cancelled).toContain("draft.md"));
    host.scans.at(-1)!.resolve(set);
    expect(host.renders).toHaveLength(0);
  }),
);

it.effect("interrupts a render when its leaf closes", () =>
  Effect.gen(function* () {
    const host = yield* hostEffect();
    host.follow("draft.md");
    const session = host.openSession();
    yield* Effect.promise(() => finishScan(host, session));
    yield* waitFor(() => expect(host.renders).toHaveLength(1));
    session[Symbol.dispose]();
    yield* waitFor(() => expect(host.cancelledRenders).toContain(1));
  }),
);

it.effect("interrupts the old note's scan when the active note changes", () =>
  Effect.gen(function* () {
    const host = yield* hostEffect();
    host.follow("first.md");
    const session = yield* open(host);
    yield* waitFor(() => expect(host.scans.at(-1)?.file.path).toBe("first.md"));
    host.follow("second.md");
    yield* waitFor(() => {
      expect(host.scans.at(-1)?.file.path).toBe("second.md");
      expect(host.cancelled).toContain("first.md");
    });
    host.scans[0]!.resolve({ ...set, citations: [] });
    yield* ready(host, session);
    expect(session.state().copy).toMatchObject({
      kind: "ready",
      target: { path: "second.md" },
    });
  }),
);

it.effect(
  "keeps the rendered list and copy target when an unrelated edit rescans equal citations",
  () =>
    Effect.gen(function* () {
      const host = yield* hostEffect();
      host.follow("draft.md");
      const session = yield* open(host);
      yield* ready(host, session);
      const copy = session.state().copy;
      const scan = host.scans.at(-1);
      host.metadataCache.change(host.vault.add("other.md"), {});
      yield* waitFor(() => expect(host.scans.at(-1)).not.toBe(scan));
      yield* Effect.promise(() => finishScan(host, session));
      expect(host.renders).toHaveLength(1);
      expect(session.state().copy).toEqual(copy);
    }),
);

it.effect(
  "reloads on a Zotero change and keeps formatted entries while the read runs",
  () =>
    Effect.gen(function* () {
      const host = yield* hostEffect();
      host.follow("draft.md");
      const session = yield* open(host);
      yield* ready(host, session);
      host.changeZotero();
      yield* waitFor(() => expect(host.renders).toHaveLength(2));
      expect(session.state().entries[0]?.kind).toBe("rendered");
      expect(session.state().copy).toEqual({
        kind: "blocked",
        reason: "pending",
      });
      yield* Effect.promise(() => finishRender(host, session));
      expect(session.state().copy.kind).toBe("ready");
    }),
);

it.effect("keeps the last render's failure banner while its retry runs", () =>
  Effect.gen(function* () {
    const host = yield* hostEffect();
    host.follow("draft.md");
    const session = yield* open(host);
    yield* Effect.promise(() => finishScan(host, session));
    yield* Effect.promise(() =>
      finishRender(host, session, {
        ...outcome,
        record: { ...outcome.record, status: "failed" },
      }),
    );
    expect(session.state().formattingFailed).toBe(true);
    host.invalidate();
    yield* waitFor(() => expect(host.renders).toHaveLength(2));
    expect(session.state().formattingFailed).toBe(true);
    expect(session.state().copy).toEqual({
      kind: "blocked",
      reason: "pending",
    });
    yield* Effect.promise(() => finishRender(host, session));
    expect(session.state().formattingFailed).toBe(false);
  }),
);

it.effect("reloads only for its held render key", () =>
  Effect.gen(function* () {
    const host = yield* hostEffect();
    host.follow("draft.md");
    const session = yield* open(host);
    yield* ready(host, session);
    host.bibliography.emit({ _tag: "changed", key: "other-render" });
    yield* waitFor(() =>
      expect(host.registry.get(bibliographyRevisionsAtom)["other-render"]).toBe(
        1,
      ),
    );
    expect(host.renders).toHaveLength(1);
    host.bibliography.emit({ _tag: "changed", key: "book-render" });
    yield* waitFor(() => expect(host.renders).toHaveLength(2));
    yield* Effect.promise(() => finishRender(host, session));
    host.bibliography.emit({ _tag: "settled", key: "book-render", held: null });
    yield* waitFor(() => expect(host.renders).toHaveLength(3));
    yield* Effect.promise(() => finishRender(host, session));
  }),
);

it.effect("updates entry serials from the followed note's citation text", () =>
  Effect.gen(function* () {
    const host = yield* hostEffect();
    host.follow("draft.md");
    const session = yield* open(host);
    yield* ready(host, session);
    yield* waitFor(() => expect(host.text.subscribers).toBeGreaterThan(0));
    host.setCitationText("draft.md", {
      lookup: set.lookup,
      entrySerials: true,
      formatted: new Map(),
      summaries: new Map(),
      literalWorks: new Map(),
    });
    yield* waitFor(() =>
      expect(session.state().listMode).toEqual({
        kind: "bibliography",
        hasEntryMarkers: false,
        entrySerials: true,
      }),
    );
    expect(host.renders).toHaveLength(1);
  }),
);

it.effect(
  "closing one leaf interrupts its read and leaves the other leaf reading",
  () =>
    Effect.gen(function* () {
      const host = yield* hostEffect();
      host.follow("draft.md");
      const first = host.openSession();
      const second = yield* open(host);
      yield* waitFor(() => expect(host.scans).toHaveLength(2));
      expect(host.index.subscribers).toBe(1);
      expect(host.bibliography.subscribers).toBe(1);
      first[Symbol.dispose]();
      yield* waitFor(() => expect(host.cancelled).toHaveLength(1));
      yield* ready(host, second);
      expect(second.state().copy.kind).toBe("ready");
    }),
);

it.effect("runs service gestures while their commands are held", () =>
  Effect.gen(function* () {
    const opened: string[] = [];
    const declined: boolean[] = [];
    const host = yield* Effect.acquireRelease(
      Effect.promise(() =>
        makeReferencesHost({
          openIndexedKey: (key) =>
            Effect.sync(() => {
              opened.push(key);
            }),
          decline: Effect.sync(() => {
            declined.push(true);
          }),
        }),
      ),
      (host) => Effect.promise(() => host.close()),
    );
    for (const command of [
      openIndexedKeyCommand,
      openReferenceLinkCommand,
      dismissEngineHintCommand,
      revealReferenceOccurrenceCommand,
    ]) {
      yield* Effect.acquireRelease(
        Effect.sync(() => host.registry.mount(command)),
        (release) => Effect.sync(() => release()),
      );
    }
    host.registry.set(openIndexedKeyCommand, "BOOK0001");
    yield* waitFor(() => expect(opened).toEqual(["BOOK0001"]));
    host.registry.set(openReferenceLinkCommand, {
      linkpath: "notes/BOOK0001",
      sourcePath: "draft.md",
    });
    yield* waitFor(() =>
      expect(host.workspace.opened).toMatchObject([
        { linktext: "notes/BOOK0001", sourcePath: "draft.md", newLeaf: false },
      ]),
    );
    host.registry.set(dismissEngineHintCommand, undefined);
    yield* waitFor(() => expect(declined).toEqual([true]));
    const view = host.workspace.openMarkdownEditor("draft.md");
    const flash = vi.fn<typeof view.setEphemeralState>();
    view.setEphemeralState = flash;
    const occurrence = {
      kind: "citekey" as const,
      raw: "rivers2020",
      position: {
        start: { line: 0, col: 0, offset: 0 },
        end: { line: 0, col: 11, offset: 11 },
      },
    };
    host.registry.set(revealReferenceOccurrenceCommand, {
      sourcePath: "draft.md",
      occurrence,
    });
    yield* waitFor(() => {
      expect(host.workspace.activated).toContain(view.leaf);
      expect(flash).toHaveBeenCalledWith({
        startLoc: occurrence.position.start,
        endLoc: occurrence.position.end,
        line: 0,
      });
    });
  }),
);

it.effect(
  "keeps an occurrence cursor per leaf and wraps at the last occurrence",
  () =>
    Effect.gen(function* () {
      const host = yield* hostEffect();
      const first = yield* open(host);
      const second = yield* open(host);
      const { registry } = host;
      registry.update(first.model.cursors, advanceOccurrence("BOOK0001", 2));
      registry.update(first.model.cursors, advanceOccurrence("BOOK0001", 2));
      expect(registry.get(first.model.cursors)["BOOK0001"]).toBe(1);
      expect(registry.get(second.model.cursors)).toEqual({});
      registry.update(first.model.cursors, advanceOccurrence("BOOK0001", 2));
      expect(registry.get(first.model.cursors)["BOOK0001"]).toBe(0);
      const unchanged = registry.get(first.model.cursors);
      expect(advanceOccurrence("BOOK0001", 0)(unchanged)).toBe(unchanged);
    }),
);
