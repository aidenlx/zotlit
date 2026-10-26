import { expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as Atom from "effect/reactivity/Atom";

import { AbortError } from "@/lib/abort-error";
import { CapabilityNotices } from "@/services/annotation-repository/notices";
import type { AnnotationCitation } from "@/services/note-feature/annotation-citation";
import type { AnnotationInsertRequest } from "@/services/note-feature/citations-handle";
import type { AnnotationInsert } from "@/services/note-feature/insert-annotation";
import { annotation } from "@/services/pdf-annotation-editor/__fixtures__";
import { readsAnswering } from "@/services/zotero-reads/__fixtures__";

import { makeAnnotHost } from "./__fixtures__/host";
import {
  annotationWriteCommand,
  makeExcerptRequestCommand,
  makeLibraryTagNamesCommand,
  editingCapabilityCommand,
  copyCitationCommand,
  makePrepareInsertCommand,
  makeTargetRead,
} from "./atoms";
import { observeRead } from "./model";
import { resolveLoadTarget } from "./resolve-target";

it.effect("interrupts an attachment read when its leaf closes", () =>
  Effect.gen(function* () {
    const started = Promise.withResolvers<void>();
    const cancelled = Promise.withResolvers<void>();
    const host = yield* Effect.acquireDisposable(
      Effect.sync(() =>
        makeAnnotHost({
          reads: {
            reads: readsAnswering({
              AnnotViewAttachments: () =>
                Effect.promise((signal) => {
                  signal.addEventListener("abort", () => cancelled.resolve());
                  started.resolve();
                  return new Promise<never>(() => {});
                }),
            }),
          },
        }),
      ),
    );
    const target = resolveLoadTarget({
      mode: "pinned",
      pinnedItemKey: "ITEMAAAA",
      libraries: [],
    })!;
    const read = observeRead(
      host.registry,
      makeTargetRead(target, "active-tab"),
    );
    yield* Effect.promise(() => started.promise);
    read[Symbol.dispose]();
    yield* Effect.promise(() => cancelled.promise);
    expect(yield* Effect.promise(() => read.promise)).toBeNull();
  }),
);

it.effect(
  "runs writes from two cards at the same time and keeps both outcomes",
  () =>
    Effect.gen(function* () {
      const first = Promise.withResolvers<void>();
      const second = Promise.withResolvers<void>();
      const started: string[] = [];
      const host = yield* Effect.acquireDisposable(
        Effect.sync(() =>
          makeAnnotHost({
            annotations: {
              patchColor: (key) =>
                Effect.promise((_signal) => {
                  started.push(key);
                  return (
                    key === "FIRSTAAA" ? first.promise : second.promise
                  ).then(() => ({ kind: "idle" as const }));
                }),
            },
          }),
        ),
      );
      const a = Promise.withResolvers<unknown>();
      const b = Promise.withResolvers<unknown>();
      host.registry.set(annotationWriteCommand, {
        kind: "color",
        keys: ["FIRSTAAA"],
        color: "#ffd400",
        complete: a.resolve,
      });
      host.registry.set(annotationWriteCommand, {
        kind: "color",
        keys: ["SECNDBBB"],
        color: "#ff6666",
        complete: b.resolve,
      });
      expect(started).toEqual(["FIRSTAAA", "SECNDBBB"]);
      second.resolve();
      expect(yield* Effect.promise(() => b.promise)).toEqual([
        { kind: "idle" },
      ]);
      first.resolve();
      expect(yield* Effect.promise(() => a.promise)).toEqual([
        { kind: "idle" },
      ]);
    }),
);

it.effect("resolves two card image requests at the same time", () =>
  Effect.gen(function* () {
    const first = Promise.withResolvers<never[]>();
    const second = Promise.withResolvers<never[]>();
    let count = 0;
    const started: number[] = [];
    const host = yield* Effect.acquireDisposable(
      Effect.sync(() =>
        makeAnnotHost({
          reads: {
            snapshot: Effect.succeed(
              readsAnswering({
                DatabaseIdentity: () =>
                  Effect.succeed({
                    userID: 1,
                    localUserKey: "LOCALKEY",
                    serverID: null,
                  }),
                AttachmentSources: () =>
                  Effect.promise((_signal) => {
                    const at = count++;
                    started.push(at);
                    return (at === 0 ? first.promise : second.promise).then(
                      (attachments) => ({
                        attachments,
                        parentItems: [],
                        annotations: [],
                        tagsByItemID: new Map(),
                        username: null,
                      }),
                    );
                  }),
              }),
            ),
          },
        }),
      ),
    );
    const command = makeExcerptRequestCommand();
    const release = host.registry.mount(command);
    yield* Effect.addFinalizer(() => Effect.sync(release));
    const a = Promise.withResolvers<unknown>();
    const b = Promise.withResolvers<unknown>();
    const source = {
      kind: "zotero-db" as const,
      database: { userID: 1, localUserKey: "LOCALKEY", serverID: null },
      libraryID: 1,
      libraryRevision: 0,
    };
    const target = {
      annotation: annotation("FIRSTAAA", "image", {
        pageIndex: 0,
        rect: [0, 0, 10, 10],
      }),
      source,
      sourceScope: "/zotero",
    };
    host.registry.set(command, {
      ...target,
      complete: a.resolve,
    });
    host.registry.set(command, {
      ...target,
      complete: b.resolve,
    });
    expect(started).toEqual([0, 1]);
    second.resolve([]);
    expect(yield* Effect.promise(() => b.promise)).toBeNull();
    first.resolve([]);
    expect(yield* Effect.promise(() => a.promise)).toBeNull();
  }),
);

it.effect("runs capability gestures from two panes at the same time", () =>
  Effect.gen(function* () {
    const first = Promise.withResolvers<void>();
    const second = Promise.withResolvers<void>();
    const completed = Promise.withResolvers<void>();
    const started: string[] = [];
    const ended: string[] = [];
    const run = (key: string, promise: Promise<void>) =>
      Effect.promise((_signal) => {
        started.push(key);
        return promise.then(() => {
          ended.push(key);
          if (ended.length === 2) completed.resolve();
        });
      });
    const host = yield* Effect.acquireDisposable(
      Effect.sync(() =>
        makeAnnotHost({
          services: Layer.mock(CapabilityNotices, {
            allowEditing: run("allow", first.promise),
            reportBlockedGesture: (key) => run(key, second.promise),
          }),
        }),
      ),
    );
    const release = host.registry.mount(editingCapabilityCommand);
    yield* Effect.addFinalizer(() => Effect.sync(release));
    host.registry.set(editingCapabilityCommand, { kind: "allow" });
    host.registry.set(editingCapabilityCommand, {
      kind: "blocked",
      key: "PDFAAAAA",
    });
    expect(started).toEqual(["allow", "PDFAAAAA"]);
    second.resolve();
    first.resolve();
    yield* Effect.promise(() => completed.promise);
    expect(ended).toEqual(["PDFAAAAA", "allow"]);
  }),
);

it.effect("resolves suggestions for two tag editors at the same time", () =>
  Effect.gen(function* () {
    const first = Promise.withResolvers<string[]>();
    const second = Promise.withResolvers<string[]>();
    let started = 0;
    const bothStarted = Promise.withResolvers<void>();
    const reads = readsAnswering({
      Libraries: () => Effect.succeed([]),
      TagNames: () =>
        Effect.promise((_signal) => {
          started += 1;
          if (started === 2) bothStarted.resolve();
          return started === 1 ? first.promise : second.promise;
        }),
    });
    const host = yield* Effect.acquireDisposable(
      Effect.sync(() =>
        makeAnnotHost({ reads: { snapshot: Effect.succeed(reads) } }),
      ),
    );
    const command = makeLibraryTagNamesCommand();
    const release = host.registry.mount(command);
    yield* Effect.addFinalizer(() => Effect.sync(release));
    const a = Promise.withResolvers<readonly string[]>();
    const b = Promise.withResolvers<readonly string[]>();
    host.registry.set(command, { key: "FIRSTAAA", complete: a.resolve });
    host.registry.set(command, { key: "SECNDBBB", complete: b.resolve });
    yield* Effect.promise(() => bothStarted.promise);
    expect(started).toBe(2);
    second.resolve(["second"]);
    expect(yield* Effect.promise(() => b.promise)).toEqual(["second"]);
    first.resolve(["first"]);
    expect(yield* Effect.promise(() => a.promise)).toEqual(["first"]);
  }),
);

it.effect("copies two card citations at the same time", () =>
  Effect.gen(function* () {
    const first = Promise.withResolvers<AnnotationCitation>();
    const second = Promise.withResolvers<AnnotationCitation>();
    const started: string[] = [];
    const host = yield* Effect.acquireDisposable(
      Effect.sync(() =>
        makeAnnotHost({
          notes: {
            citation: (key) =>
              Effect.promise((_signal) => {
                started.push(key);
                return key === "FIRSTAAA" ? first.promise : second.promise;
              }),
          },
        }),
      ),
    );
    const a = Promise.withResolvers<AnnotationCitation>();
    const b = Promise.withResolvers<AnnotationCitation>();
    host.registry.set(copyCitationCommand, {
      key: "FIRSTAAA",
      resolve: a.resolve,
      reject: a.reject,
    });
    host.registry.set(copyCitationCommand, {
      key: "SECNDBBB",
      resolve: b.resolve,
      reject: b.reject,
    });
    expect(started).toEqual(["FIRSTAAA", "SECNDBBB"]);
    second.resolve({ kind: "citation", text: "second" });
    expect(yield* Effect.promise(() => b.promise)).toEqual({
      kind: "citation",
      text: "second",
    });
    first.resolve({ kind: "citation", text: "first" });
    expect(yield* Effect.promise(() => a.promise)).toEqual({
      kind: "citation",
      text: "first",
    });
  }),
);

it.effect(
  "ends a pending citation with AbortError when the plugin unloads",
  () =>
    Effect.gen(function* () {
      const started = Promise.withResolvers<void>();
      const host = yield* Effect.acquireDisposable(
        Effect.sync(() =>
          makeAnnotHost({
            notes: {
              citation: () =>
                Effect.gen(function* () {
                  started.resolve();
                  return yield* Effect.never;
                }),
            },
          }),
        ),
      );
      const answer = Promise.withResolvers<AnnotationCitation>();
      const aborted = answer.promise.catch(AbortError.test);
      host.registry.set(copyCitationCommand, {
        key: "FIRSTAAA",
        resolve: answer.resolve,
        reject: answer.reject,
      });
      yield* Effect.promise(() => started.promise);
      host.registry.dispose();
      expect(yield* Effect.promise(() => aborted)).toBe(true);
    }),
);

it.effect("prepares two captured inserts at the same time", () =>
  Effect.gen(function* () {
    const first = Promise.withResolvers<null>();
    const second = Promise.withResolvers<null>();
    const started: string[] = [];
    const host = yield* Effect.acquireDisposable(
      Effect.sync(() =>
        makeAnnotHost({
          notes: {
            prepare: ({ annotation }) =>
              Effect.promise((_signal) => {
                started.push(annotation.key);
                return annotation.key === "FIRSTAAA"
                  ? first.promise
                  : second.promise;
              }),
          },
        }),
      ),
    );
    const command = makePrepareInsertCommand();
    const release = host.registry.mount(command);
    yield* Effect.addFinalizer(() => Effect.sync(release));
    const signal = yield* Effect.abortSignal;
    const input = insertInput("FIRSTAAA", signal);
    const a = Promise.withResolvers<AnnotationInsert | null>();
    const b = Promise.withResolvers<AnnotationInsert | null>();
    host.registry.set(command, { input, resolve: a.resolve, reject: a.reject });
    host.registry.set(command, {
      input: insertInput("SECNDBBB", signal),
      resolve: b.resolve,
      reject: b.reject,
    });
    expect(started).toEqual(["FIRSTAAA", "SECNDBBB"]);
    second.resolve(null);
    expect(yield* Effect.promise(() => b.promise)).toBeNull();
    first.resolve(null);
    expect(yield* Effect.promise(() => a.promise)).toBeNull();
  }),
);

it.effect("interrupts an insert when its leaf releases the command", () =>
  Effect.gen(function* () {
    const started = Promise.withResolvers<void>();
    const cancelled = Promise.withResolvers<void>();
    const host = yield* Effect.acquireDisposable(
      Effect.sync(() =>
        makeAnnotHost({
          notes: {
            prepare: () =>
              Effect.promise((signal) => {
                signal.addEventListener("abort", () => cancelled.resolve());
                started.resolve();
                return new Promise<never>(() => {});
              }),
          },
        }),
      ),
    );
    const command = makePrepareInsertCommand();
    const release = host.registry.mount(command);
    const answer = Promise.withResolvers<AnnotationInsert | null>();
    const result = answer.promise.catch(AbortError.test);
    const signal = yield* Effect.abortSignal;
    host.registry.set(command, {
      input: insertInput("FIRSTAAA", signal),
      resolve: answer.resolve,
      reject: answer.reject,
    });
    yield* Effect.promise(() => started.promise);
    release();
    yield* Effect.promise(() => cancelled.promise);
    expect(yield* Effect.promise(() => result)).toBe(true);
  }),
);

function insertInput(
  key: string,
  signal: AbortSignal,
): AnnotationInsertRequest {
  return {
    annotation: annotation(key, "highlight", { pageIndex: 0, rects: [] }),
    source: {
      kind: "zotero-db",
      database: { userID: 1, localUserKey: "LOCALKEY", serverID: null },
      libraryID: 1,
      libraryRevision: 0,
    },
    sourceScope: "/zotero",
    notePath: "note.md",
    valid: () => !signal.aborted,
    signal,
  };
}

it.effect("finishes a submitted card write after the last leaf closes", () =>
  Effect.gen(function* () {
    const sent = Promise.withResolvers<void>();
    const saved = Promise.withResolvers<void>();
    const expired = Promise.withResolvers<void>();
    const host = yield* Effect.acquireDisposable(
      Effect.sync(() =>
        makeAnnotHost({
          holdCommands: false,
          annotations: {
            patchColor: () =>
              Effect.promise((_signal) => {
                sent.resolve();
                return saved.promise.then(() => ({ kind: "idle" as const }));
              }),
          },
        }),
      ),
    );
    const release = host.registry.mount(annotationWriteCommand);
    const answer =
      Promise.withResolvers<
        readonly import("@/services/annotation-repository/service").MutationState[]
      >();
    host.registry.set(annotationWriteCommand, {
      kind: "color",
      keys: ["FIRSTAAA"],
      color: "#ffd400",
      complete: answer.resolve,
    });
    yield* Effect.promise(() => sent.promise);
    release();
    const sentinel = Atom.make(null);
    host.registry.onNodeRemoved = (node) => {
      if (node.atom === sentinel) expired.resolve();
    };
    host.registry.get(sentinel);
    yield* Effect.promise(() => expired.promise);
    saved.resolve();
    expect(yield* Effect.promise(() => answer.promise)).toEqual([
      { kind: "idle" },
    ]);
  }),
);
