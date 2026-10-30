// Choosing an Annotation Suggester result whose insert does not land: the
// Annotation is gone, or an edit took the trigger text while it rendered.
// Where the text goes and how it is spaced is `captureInsertion`'s, tested in
// `views/annot-view/async-insert.test.ts`; a landed insert and its Use are
// proven in the running app by `packages/e2e/src/annotation-links.e2e.ts`.
// The insert is one fiber on the plugin's runner: a cancelled destination or
// an unload interrupts it.
import type { EditorView } from "@codemirror/view";
// @vitest-environment happy-dom
import { it } from "@effect/vitest";
import { Effect, FiberSet, Scope } from "effect";
import { TFile } from "obsidian";
import type { App, Editor, MarkdownFileInfo } from "obsidian";
import { describe, expect, vi } from "vitest";

import type { HostSources } from "@/lib/__fixtures__/obsidian-host-app";
import { MemoryWorkspace } from "@/lib/__fixtures__/obsidian-workspace";
import { stubService } from "@/lib/__fixtures__/service-stub";
import { openScope } from "@/lib/effect-scope";
import { answerOf } from "@/lib/view-runner";
import { setup as repositorySetup } from "@/services/annotation-repository/__fixtures__";
import { annotationAction } from "@/services/note-feature/__fixtures__/annotation-actions";
import type { AnnotationInsert } from "@/services/note-feature/insert-annotation";
import { buildUseLedger, ledgerHost } from "@/services/use-ledger/__fixtures__";
import { UseLedger } from "@/services/use-ledger/service";
import { stateEditor } from "@/views/annot-view/__fixtures__/editor";
import type { InsertRunner } from "@/views/annot-view/insert-run";

import { insertAnnotation } from "./annotation-insert";
import type { AnnotationHit } from "./annotation-search";

/** The Fixture's highlight on the Rougier PDF, as the search finds it. */
const hit: AnnotationHit = {
  key: "PUPR5FG5",
  attachmentKey: "RGRPDF24",
  itemKey: "RUGIER24",
  type: "highlight",
  text: "Identify Your Message",
  comment: null,
  color: "#2ea8e5",
  pageLabel: "1",
  title: "Ten Simple Rules for Better Figures",
  citationKey: "rougier2014",
};

/**
 * Obsidian's workspace and per-vault storage, the host the insert runs in: the
 * Use Ledger reads the sources, the insert the app's workspace events.
 */
function host(): { sources: HostSources; app: App } {
  const workspace = new MemoryWorkspace();
  const sources = ledgerHost({ workspace });
  const app = stubService<App>("App", {
    workspace: stubService<App["workspace"]>("Workspace", {
      on: (name: string, callback: (...data: never[]) => unknown) =>
        workspace.on(name, (...data: unknown[]) =>
          Reflect.apply(callback, undefined, data),
        ),
      offref: (ref) => workspace.offref(ref),
    }),
  });
  return { sources, app };
}

/**
 * The insert over the real Annotation repository of the Fixture's Rougier
 * Annotations and a real Use Ledger. The template render stands in for the
 * Literature Note Profile's: `whileRendering` is an edit the researcher makes
 * while it runs.
 */
async function harness(
  stack: AsyncDisposableStack,
  doc: string,
  { whileRendering }: { whileRendering?: (cm: EditorView) => void } = {},
) {
  const { service: repository } = await repositorySetup(stack);
  const { sources, app } = host();
  const useLedger = buildUseLedger(sources, stack);
  const cm = stateEditor({ doc });
  stack.defer(() => cm.destroy());
  const editor = stubService<Editor>("Editor", {
    cm,
    getValue: () => cm.state.doc.toString(),
  });
  const file = new TFile();
  file.path = "Draft.md";
  const info = stubService<MarkdownFileInfo>("MarkdownFileInfo", {
    editor,
    file,
  });
  const prepare = vi.fn<(signal: AbortSignal) => Promise<AnnotationInsert>>(
    async () => {
      whileRendering?.(cm);
      return {
        text: "quote",
        summary: {
          zotero: 0,
          unchecked: 0,
          unavailable: 0,
        },
      };
    },
  );
  // The plugin's runner: its fibers sit on a Scope that unload closes.
  const { scope, close } = openScope();
  stack.defer(close);
  const runner: InsertRunner<never> = {
    execute: (request) =>
      annotationAction(
        request,
        Effect.tryPromise((signal) => {
          signal.throwIfAborted();
          return prepare(signal);
        }),
        {
          repository,
          serverID: "A8sf5Zsz8ySw",
          ledger: useLedger.runtime.runSync(UseLedger),
        },
      ),
    run: Effect.runSync(
      FiberSet.make().pipe(
        Effect.flatMap((fibers) => FiberSet.runtime(fibers)<never>()),
        Scope.provide(scope),
      ),
    ),
  };
  const notify = vi.fn<(message: string | DocumentFragment) => void>();
  const start = (target: AnnotationHit, from: number, to: number) => {
    const fiber = insertAnnotation(
      { app, workspace: app.workspace, runner, notify },
      { hit: target, info, isCurrent: () => true, range: { from, to } },
    );
    if (!fiber) throw new Error("The insert did not start.");
    return fiber;
  };
  /** The outcome of the insert, or `undefined` where it was interrupted. */
  const insert = (target: AnnotationHit, from: number, to: number) =>
    answerOf(start(target, from, to), undefined);
  return {
    insert,
    start,
    cm,
    unload: close,
    notify,
    prepare,
    useLedger,
    text: () => cm.state.doc.toString(),
  };
}

describe("insertAnnotation", () => {
  it.effect(
    "records no Use when an edit over the trigger text drops the insert",
    () =>
      Effect.promise(async () => {
        await using stack = new AsyncDisposableStack();
        const h = await harness(stack, "As shown [>message] here", {
          whileRendering: (cm) =>
            cm.dispatch({ changes: { from: 9, to: 19, insert: "typed" } }),
        });

        expect(await h.insert(hit, 9, 19)).toBeUndefined();

        expect(h.prepare).toHaveBeenCalledOnce();
        expect(h.notify).not.toHaveBeenCalled();
        expect(h.text()).toBe("As shown typed here");
        expect(h.useLedger.runtime.runSync(h.useLedger.current)).toEqual({});
      }),
  );

  it.effect(
    "answers unavailable and leaves the trigger text when the annotation is gone",
    () =>
      Effect.promise(async () => {
        await using stack = new AsyncDisposableStack();
        const h = await harness(stack, "[>message]");

        expect(await h.insert({ ...hit, key: "GONE2345" }, 0, 10)).toEqual({
          kind: "unavailable",
        });

        expect(h.notify).toHaveBeenCalledOnce();
        expect(h.text()).toBe("[>message]");
        expect(h.prepare).not.toHaveBeenCalled();
        expect(h.useLedger.runtime.runSync(h.useLedger.current)).toEqual({});
      }),
  );

  it.effect("interrupts the render when an edit cancels the destination", () =>
    Effect.promise(async () => {
      await using stack = new AsyncDisposableStack();
      const h = await harness(stack, "As shown [>message] here");
      const rendering = Promise.withResolvers<AbortSignal>();
      h.prepare.mockImplementation((signal) => {
        rendering.resolve(signal);
        return new Promise<AnnotationInsert>(() => {});
      });
      const answer = answerOf(h.start(hit, 9, 19), undefined);

      const signal = await rendering.promise;
      expect(signal.aborted).toBe(false);
      h.cm.dispatch({ changes: { from: 9, to: 19, insert: "typed" } });

      expect(await answer).toBeUndefined();
      expect(signal.aborted).toBe(true);
      expect(h.text()).toBe("As shown typed here");
      expect(h.notify).not.toHaveBeenCalled();
    }),
  );

  it.effect("interrupts the render when the plugin unloads", () =>
    Effect.promise(async () => {
      await using stack = new AsyncDisposableStack();
      const h = await harness(stack, "As shown [>message] here");
      const rendering = Promise.withResolvers<AbortSignal>();
      h.prepare.mockImplementation((signal) => {
        rendering.resolve(signal);
        return new Promise<AnnotationInsert>(() => {});
      });
      const answer = answerOf(h.start(hit, 9, 19), undefined);

      const signal = await rendering.promise;
      await h.unload();

      expect(await answer).toBeUndefined();
      expect(signal.aborted).toBe(true);
      expect(h.text()).toBe("As shown [>message] here");
      expect(h.notify).not.toHaveBeenCalled();
    }),
  );
});

it.effect("#1835 records a Use only after the selected annotation lands", () =>
  Effect.promise(async () => {
    await using stack = new AsyncDisposableStack();
    const h = await harness(stack, "[>message]");
    expect(await h.insert(hit, 0, 10)).toEqual({
      kind: "inserted",
      summary: { zotero: 0, unchecked: 0, unavailable: 0 },
    });
    expect(h.text()).toBe("quote ");
    expect(
      h.useLedger.runtime.runSync(h.useLedger.current)[hit.itemKey]?.kind,
    ).toBe("cited");
  }),
);
