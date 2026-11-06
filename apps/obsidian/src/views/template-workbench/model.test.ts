// The Workbench's state seam and service dependencies.
import { expect, it } from "@effect/vitest";
import { Deferred, Effect, Queue, Stream, SubscriptionRef } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { TFile } from "obsidian";
import type { App } from "obsidian";
import { vi } from "vitest";

import { SAMPLE_ITEMS } from "@zotlit/workbench/render";
import type { ItemSnapshot } from "@zotlit/workbench/snapshot";
import {
  chooseItem,
  INITIAL_VIEW,
  setAdvanced,
  setTab,
} from "@zotlit/workbench/ui";

import { stubService } from "@/lib/__fixtures__/service-stub";
import * as m from "@/lib/i18n/generated/messages";
import type { MetadataEvent } from "@/lib/obsidian-metadata-cache";
import { fileProfileAtom } from "@/services/profile/atoms";
import { defaultBindingsAtom } from "@/services/settings/atoms";
import { defaults } from "@/services/settings/schema";
import {
  partialDocumentsAtom,
  templateRevisionAtom,
} from "@/services/template/atoms";
import { waitFor } from "@/views/template-data-explorer/__fixtures__";

import { makeWorkbenchHost } from "./__fixtures__";
import type { WorkbenchHostDeps } from "./__fixtures__";
import {
  INITIAL_PICKS,
  chooseAnnotation,
  holdTemplateWorkbenchModel,
  makeTemplateWorkbenchModel,
  readEphemeralWorkbench,
  readSavedWorkbench,
  savedWorkbench,
} from "./model";

const FIRST = "FIRST234";
const LATER = "LATER234";
const SNAPSHOT: ItemSnapshot = SAMPLE_ITEMS[0]!;

/**
 * A Workbench host whose Item reads the test drives. Each check of a chosen
 * Item offers its key to `started`; a held check waits until an interrupt
 * stops it, which completes the key's `interrupted` signal.
 */
const itemHost = Effect.fn(function* (
  answer: "held" | "paper" | "child" | "missing" = "held",
) {
  const started = yield* Queue.unbounded<string>();
  const interrupted = new Map<string, Deferred.Deferred<void>>();
  const snapshots: string[] = [];
  const stopped = (key: string) => {
    let signal = interrupted.get(key);
    if (!signal) interrupted.set(key, (signal = Deferred.makeUnsafe<void>()));
    return signal;
  };
  const itemOf = (key: string, itemType: string) =>
    new Map([
      [
        key,
        {
          key,
          creators: [],
          primaryCreatorType: null,
          fields: { itemType, title: key },
        },
      ],
    ]) as never;
  const zoteroReads = stubService<WorkbenchHostDeps["zoteroReads"]>(
    "ZoteroReads",
    {
      state: "ready",
      reads: stubService<WorkbenchHostDeps["zoteroReads"]["reads"]>(
        "ZoteroReadsApi",
        {
          ItemsByIndexedKeys: ({ indexedKeys }) => {
            const key = indexedKeys[0]!;
            Queue.offerUnsafe(started, key);
            if (answer === "held")
              return Effect.callback<never>(() =>
                Deferred.succeed(stopped(key), undefined),
              );
            return Effect.succeed(
              answer === "missing"
                ? (new Map() as never)
                : itemOf(key, answer === "child" ? "attachment" : "book"),
            );
          },
        },
      ),
      acquireRead: () =>
        Promise.resolve(
          stubService<
            Awaited<ReturnType<WorkbenchHostDeps["zoteroReads"]["acquireRead"]>>
          >("ZoteroReadLease", {
            reads: stubService<WorkbenchHostDeps["zoteroReads"]["reads"]>(
              "ZoteroReadsApi",
              {
                ItemSnapshot: (({
                  selection,
                }: {
                  selection: { key: string };
                }) =>
                  Effect.sync(() => {
                    snapshots.push(selection.key);
                    return SNAPSHOT;
                  })) as never,
              },
            ),
            [Symbol.asyncDispose]: () => Promise.resolve(),
          }),
        ),
    },
  );
  const host = makeWorkbenchHost({ zoteroReads });
  const model = makeTemplateWorkbenchModel();
  const choose = (id: string) =>
    host.registry.update(model.view, chooseItem({ id, title: null }));
  /** Holds the leaf's model, as the view does from its constructor to its close. */
  const hold = (): Disposable => ({
    [Symbol.dispose]: holdTemplateWorkbenchModel(host.registry, model),
  });
  /** The chosen Item's read, once it settles. */
  const settled = Effect.exit(
    AtomRegistry.getResult(host.registry, model.chosen, {
      suspendOnWaiting: true,
    }),
  );
  const interruptedOf = (key: string) => Deferred.await(stopped(key));
  return {
    ...host,
    model,
    hold,
    choose,
    started,
    interruptedOf,
    snapshots,
    settled,
  };
});

it.effect("interrupts the older Item read when a newer choice is made", () =>
  Effect.gen(function* () {
    const host = yield* itemHost();
    using _held = host.hold();
    host.choose(FIRST);
    expect(yield* Queue.take(host.started)).toBe(FIRST);
    host.choose(LATER);
    expect(yield* Queue.take(host.started)).toBe(LATER);
    yield* host.interruptedOf(FIRST);
    expect(host.registry.get(host.model.read).status).toBe("loading");
  }),
);

it.effect("reads the chosen Item once for every surface that shows it", () =>
  Effect.gen(function* () {
    const host = yield* itemHost("paper");
    using _held = host.hold();
    host.choose(FIRST);
    yield* host.settled;
    expect(host.registry.get(host.model.read)).toMatchObject({
      status: "ready",
      snapshot: SNAPSHOT,
    });
    expect(host.registry.get(host.model.title)).toBe(FIRST);
    // The annotation choice and the tab change the surfaces, not the read.
    host.registry.update(host.model.picks, chooseAnnotation("other"));
    host.registry.update(host.model.view, setTab("annotation"));
    expect(host.registry.get(host.model.choices).annotation).not.toBeNull();
    expect(yield* Queue.takeAll(host.started)).toEqual([FIRST]);
    expect(host.snapshots).toEqual([FIRST]);
  }),
);

it.effect.each(["child", "missing"] as const)(
  "fails the read of a chosen Item that is a %s Item",
  (answer) =>
    Effect.gen(function* () {
      const host = yield* itemHost(answer);
      using _held = host.hold();
      host.choose(FIRST);
      yield* host.settled;
      expect(host.registry.get(host.model.read)).toMatchObject({
        status: "error",
        error: m.workbench_example_missing_item(),
        snapshot: null,
      });
      expect(host.snapshots).toEqual([]);
    }),
);

it.effect(
  "interrupts the Item read and the open chooser when the leaf closes",
  () =>
    Effect.gen(function* () {
      const host = yield* itemHost();
      const closed = Deferred.makeUnsafe<void>();
      const held = host.hold();
      host.choose(FIRST);
      host.registry.set(
        host.model.chooseItem,
        Effect.never.pipe(
          Effect.onInterrupt(() => Deferred.succeed(closed, undefined)),
        ),
      );
      expect(yield* Queue.take(host.started)).toBe(FIRST);
      held[Symbol.dispose]();
      yield* host.interruptedOf(FIRST);
      yield* Deferred.await(closed);
    }),
);

it("round-trips the saved and ephemeral state through Schema", () => {
  const view = {
    ...INITIAL_VIEW,
    tab: "properties" as const,
    root: "annotation" as const,
    advanced: true,
    item: { id: FIRST, title: "First" },
  };
  const saved = JSON.parse(
    JSON.stringify(
      savedWorkbench({
        defaultDraft: false,
        view,
        picks: {
          ...INITIAL_PICKS,
          annotationId: "note-1",
          variant: "alt",
          citationExample: null,
        },
        panels: {
          fields: { shown: false, width: 400 },
          preview: { shown: true, width: 520 },
        },
        preview: {
          mode: "update",
          live: false,
          showMarkdown: true,
          showManaged: false,
        },
        partial: { context: "citation", profile: "books" },
      }),
    ),
  ) as unknown;
  expect(readSavedWorkbench(saved)).toEqual({
    defaultDraft: false,
    tab: "properties",
    root: null,
    advanced: true,
    itemIndexedKey: FIRST,
    annotationId: "note-1",
    partialContext: "citation",
    partialProfile: "books",
    panels: {
      fields: { shown: false, width: 400 },
      preview: { shown: true, width: 520 },
    },
    preview: {
      mode: "update",
      live: false,
      showMarkdown: true,
      showManaged: false,
    },
    citation: { variant: "alt", citationExample: null },
  });
  // A Citation pick the state does not name, or names badly, is left out.
  expect(
    readSavedWorkbench({ variant: "sideways", citationExample: "two-items" })
      ?.citation,
  ).toEqual({ citationExample: "two-items" });
  // A bad setting leaves the others.
  expect(
    readSavedWorkbench({ preview: { mode: "draft", live: false } })?.preview,
  ).toEqual({ live: false });
  // A bad side leaves the other, and a width outside the limits is held to them.
  expect(
    readSavedWorkbench({
      panels: {
        fields: { shown: "yes", width: 300 },
        preview: { shown: true, width: 5000 },
      },
    })?.panels,
  ).toEqual({ preview: { shown: true, width: 960 } });
  // A bad field leaves the others; a cleared Item stays cleared.
  expect(
    readSavedWorkbench({
      tab: "nowhere",
      advanced: "yes",
      itemIndexedKey: null,
    }),
  ).toMatchObject({ tab: null, advanced: null, itemIndexedKey: null });
  expect(readSavedWorkbench({})?.itemIndexedKey).toBeUndefined();
  const ephemeral = {
    zotlitTemplateWorkbench: {
      context: '["a.md",null]',
      selection: { slice: "note", range: { from: 1, to: 4 } },
      selected: 2,
      field: "title",
      scroll: { note: { top: 10, left: -5 }, bad: { top: "x" } },
    },
    focus: true,
  };
  expect(readEphemeralWorkbench(JSON.parse(JSON.stringify(ephemeral)))).toEqual(
    {
      context: '["a.md",null]',
      focus: true,
      selection: { slice: "note", range: { from: 1, to: 4 } },
      selected: 2,
      field: "title",
      scroll: { note: { top: 10, left: 0 } },
    },
  );
  expect(readEphemeralWorkbench({ zotlitTemplateWorkbench: {} })).toBeNull();
});

it.effect(
  "reloads partial names on compilation and leaves them held on local presentation changes",
  () =>
    Effect.gen(function* () {
      const revision = yield* SubscriptionRef.make(0);
      const read = vi.fn(() => []);
      const host = makeWorkbenchHost({
        templates: stubService<WorkbenchHostDeps["templates"]>("Template", {
          loaded: true,
          getPartialDocuments: read,
          "compile-status-changed": Stream.map(
            Stream.drop(SubscriptionRef.changes(revision), 1),
            () => undefined,
          ),
        }),
      });
      const release = host.registry.mount(partialDocumentsAtom);
      const ready = () =>
        waitFor(() => {
          const result = host.registry.get(partialDocumentsAtom);
          expect(AsyncResult.isSuccess(result) && !result.waiting).toBe(true);
        });
      yield* Effect.promise(() => ready());
      const count = read.mock.calls.length;
      const model = makeTemplateWorkbenchModel();
      const releaseModel = holdTemplateWorkbenchModel(host.registry, model);
      host.registry.update(model.view, setAdvanced(true));
      expect(read).toHaveBeenCalledTimes(count);
      const before = host.registry.get(templateRevisionAtom);
      yield* SubscriptionRef.set(revision, 1);
      yield* Effect.promise(() =>
        waitFor(() =>
          expect(host.registry.get(templateRevisionAtom)).toBe(before + 1),
        ),
      );
      yield* Effect.promise(() => ready());
      expect(read).toHaveBeenCalledTimes(count + 1);
      releaseModel();
      release();
    }),
);

it.effect("keeps default bindings stable when another setting changes", () =>
  Effect.gen(function* () {
    const settings = yield* SubscriptionRef.make(defaults);
    const host = makeWorkbenchHost({
      settings: {
        current: SubscriptionRef.get(settings),
        changes: SubscriptionRef.changes(settings),
      },
    });
    const values: unknown[] = [];
    const release = host.registry.subscribe(
      defaultBindingsAtom,
      (value) => values.push(value),
      { immediate: true },
    );
    const before = host.registry.get(defaultBindingsAtom);
    yield* SubscriptionRef.set(settings, {
      ...defaults,
      "template.folder": "other-templates",
    });
    // The folder read is the completion signal for the same settings event.
    const { templateFolderAtom } = yield* Effect.promise(
      () => import("@/services/settings/atoms"),
    );
    const releaseFolder = host.registry.mount(templateFolderAtom);
    yield* Effect.promise(() =>
      waitFor(() =>
        expect(host.registry.get(templateFolderAtom)).toBe("other-templates"),
      ),
    );
    expect(host.registry.get(defaultBindingsAtom)).toBe(before);
    expect(values).toEqual([before]);
    releaseFolder();
    release();
  }),
);

it.effect("reads a note's Profile again when its metadata changes", () =>
  Effect.gen(function* () {
    const file = Object.assign(new TFile(), { path: "notes/paper.md" });
    const events = yield* SubscriptionRef.make<MetadataEvent>({
      _tag: "resolved",
    });
    const profileOf = vi.fn<
      NonNullable<WorkbenchHostDeps["profile"]>["profileOf"]
    >(() =>
      Effect.succeed({ ok: false, stamped: { stamp: "old", id: undefined } }),
    );
    const host = makeWorkbenchHost(
      {
        profile: stubService<NonNullable<WorkbenchHostDeps["profile"]>>(
          "Profile",
          { profileOf },
        ),
        app: stubService<NonNullable<WorkbenchHostDeps["app"]>>("App", {
          vault: stubService<App["vault"]>("Vault", {
            getFileByPath: () => file,
          }),
        }),
      },
      { metadata: SubscriptionRef.changes(events) },
    );
    const atom = fileProfileAtom(file.path);
    const release = host.registry.mount(atom);
    yield* Effect.promise(() =>
      waitFor(() =>
        expect(AsyncResult.isSuccess(host.registry.get(atom))).toBe(true),
      ),
    );
    const count = profileOf.mock.calls.length;
    yield* SubscriptionRef.set(events, {
      _tag: "changed",
      file,
      data: "",
      cache: {},
    });
    yield* Effect.promise(() =>
      waitFor(() => expect(profileOf).toHaveBeenCalledTimes(count + 1)),
    );
    release();
  }),
);
