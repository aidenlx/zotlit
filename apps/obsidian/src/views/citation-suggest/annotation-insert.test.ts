// @vitest-environment happy-dom
// Choosing an Annotation Suggester result whose insert does not land: the
// Annotation is gone, or an edit took the trigger text while it rendered.
// Where the text goes and how it is spaced is `captureInsertion`'s, tested in
// `views/annot-view/async-insert.test.ts`; a landed insert and its Use are
// proven in the running app by `packages/e2e/src/annotation-links.e2e.ts`.
import type { EditorView } from "@codemirror/view";
import { TFile } from "obsidian";
import type { App, Editor, MarkdownFileInfo } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import type { HostSources } from "@/lib/__fixtures__/obsidian-host-app";
import { MemoryWorkspace } from "@/lib/__fixtures__/obsidian-workspace";
import { stubService } from "@/lib/__fixtures__/service-stub";
import { setup as repositorySetup } from "@/services/annotation-repository/__fixtures__";
import type { NoteFeatureHandle } from "@/services/note-feature";
import { buildUseLedger, ledgerHost } from "@/services/use-ledger/__fixtures__";
import { stateEditor } from "@/views/annot-view/__fixtures__/editor";

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
  const { service: repository, bridge } = await repositorySetup(stack);
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
  const prepare = vi.fn<NoteFeatureHandle["prepareAnnotationInsert"]>(
    async () => {
      whileRendering?.(cm);
      return {
        text: "quote",
        summary: {
          zotero: 0,
          unchecked: 0,
          unavailable: 0,
          written: 0,
          reused: 0,
        },
      };
    },
  );
  const insert = (target: AnnotationHit, from: number, to: number) =>
    insertAnnotation(
      {
        app,
        annotations: repository,
        bridge,
        noteFeature: { prepareAnnotationInsert: prepare },
        zoteroPref: { dataDir: "/zotero" },
        useLedger,
        notify: () => {},
      },
      { hit: target, info, isCurrent: () => true, range: { from, to } },
    );
  return {
    insert,
    prepare,
    useLedger,
    text: () => cm.state.doc.toString(),
  };
}

describe("insertAnnotation", () => {
  it("records no Use when an edit over the trigger text drops the insert", async () => {
    await using stack = new AsyncDisposableStack();
    const h = await harness(stack, "As shown [>message] here", {
      whileRendering: (cm) =>
        cm.dispatch({ changes: { from: 9, to: 19, insert: "typed" } }),
    });

    expect(await h.insert(hit, 9, 19)).toEqual({ kind: "settled" });

    expect(h.prepare).toHaveBeenCalledOnce();
    expect(h.text()).toBe("As shown typed here");
    expect(h.useLedger.current).toEqual({});
  });

  it("answers unavailable and leaves the trigger text when the annotation is gone", async () => {
    await using stack = new AsyncDisposableStack();
    const h = await harness(stack, "[>message]");

    expect(await h.insert({ ...hit, key: "GONE2345" }, 0, 10)).toEqual({
      kind: "unavailable",
    });

    expect(h.text()).toBe("[>message]");
    expect(h.prepare).not.toHaveBeenCalled();
    expect(h.useLedger.current).toEqual({});
  });
});
