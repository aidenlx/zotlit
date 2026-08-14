// @vitest-environment happy-dom
import { TFile } from "obsidian";
import type { App, EventRef, WorkspaceLeaf } from "obsidian";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DocumentCitationSet } from "@/services/citation-index/service";
import type { Inline, Inlines } from "@/services/pandoc/ast";
import type { AstBibliographyEntry } from "@/services/pandoc/engine";
import type { BibliographyRenderOutcome } from "@/services/pandoc/render-cache";

import { ReferencesView } from "./view";

type RenderedBibliography = BibliographyRenderOutcome<AstBibliographyEntry>;

vi.mock("zustand", () => import("../__fixtures__/zustand"));

vi.mock("@/components/obsidian/icon-button", async () => {
  const { createElement } = await import("react");
  return {
    IconButton: ({ icon, ...props }: { icon: string }) =>
      createElement("button", { ...props, "data-icon": icon }),
  };
});

vi.mock("@zotlit/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@zotlit/db")>()),
  getZoteroIdentity: () => ({ userID: 1, localUserKey: "local" }),
  resolveIndexedKeyLibrary: () => ({ libraryID: 1, key: "BOOK0001" }),
  getItemsByKey: () => [
    {
      key: "BOOK0001",
      itemID: 1,
      groupID: null,
      creators: [],
      primaryCreatorType: null,
      fields: { title: "Field notes" },
    },
  ],
  getAttachmentsByParents: () => [],
  isChildItemFields: () => false,
  itemToCsl: () => ({ id: "ref-book", type: "book", title: "Field notes" }),
}));

class TestReferencesView extends ReferencesView {
  open(): Promise<void> {
    return this.onOpen();
  }

  close(): Promise<void> {
    return this.onClose();
  }
}

const citationSet: DocumentCitationSet = {
  occurrences: [],
  citations: [
    {
      indexedKey: "BOOK0001",
      refNumber: 1,
      linkpath: "notes/BOOK0001",
      occurrences: [
        {
          kind: "citekey",
          raw: "rivers2020",
          position: {
            start: { line: 0, col: 0, offset: 0 },
            end: { line: 0, col: 11, offset: 11 },
          },
        },
      ],
    },
  ],
  errors: [],
};

/** One flow of plain words, the way pandoc splits text into Str and Space. */
function words(text: string): Inlines {
  return text
    .split(" ")
    .flatMap<Inline>((word, index) =>
      index === 0
        ? [{ t: "Str", c: word }]
        : [{ t: "Space" }, { t: "Str", c: word }],
    );
}

function renderedOutcome(): RenderedBibliography {
  return {
    kind: "rendered",
    entries: [
      {
        id: "ref-book",
        marker: words("[1]"),
        content: words("Rivers, A. (2020). Field notes. Harbour Press."),
      },
    ],
    hasEntryMarkers: true,
  };
}

let view: TestReferencesView | undefined;
let renders: PromiseWithResolvers<RenderedBibliography>[] = [];
let scans: PromiseWithResolvers<DocumentCitationSet>[] = [];
let activeFile: TFile;
let otherFile: TFile;
let onDbChanged: (() => void) | undefined;
let onInvalidated: (() => void) | undefined;
let onActiveLeafChange: (() => void) | undefined;

function markdownFile(basename: string): TFile {
  const file = new TFile();
  file.basename = basename;
  file.extension = "md";
  file.name = `${basename}.md`;
  file.path = `notes/${file.name}`;
  return file;
}

function copyAction(): HTMLElement {
  return view!.contentEl.querySelector<HTMLElement>(
    "[data-references-copy-bibliography]",
  )!;
}

/** Let the pending render settle into the store and the pane re-render. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function finishRender(): Promise<void> {
  renders.at(-1)!.resolve(renderedOutcome());
  await settle();
}

/** Answer the citation-set read the newest rescan is waiting on. */
async function finishScan(): Promise<void> {
  scans.at(-1)!.resolve(citationSet);
  await settle();
}

/** Follow another note, which the pane learns of before its rescan answers. */
async function followOtherNote(): Promise<void> {
  activeFile = otherFile;
  await act(() => onActiveLeafChange!());
}

beforeEach(async () => {
  renders = [];
  scans = [];
  activeFile = markdownFile("tidal");
  otherFile = markdownFile("estuary");
  const app = {
    workspace: {
      getActiveFile: () => activeFile,
      on: (event: string, callback: () => void) => {
        if (event === "active-leaf-change") onActiveLeafChange = callback;
        return {} as EventRef;
      },
    },
    metadataCache: { on: () => ({}) as EventRef },
  } as unknown as App;

  view = new TestReferencesView(
    {} as WorkspaceLeaf,
    {
      app,
      db: {
        state: "ready",
        client: {},
        ready: Promise.resolve(),
        on: (event: string, callback: () => void) => {
          if (event === "changed") onDbChanged = callback;
          return () => undefined;
        },
      },
      citationIndex: {
        getDocumentCitationSet: () => {
          const deferred = Promise.withResolvers<DocumentCitationSet>();
          scans.push(deferred);
          return deferred.promise;
        },
        on: () => () => undefined,
      },
      citekeyEditor: { openCitekey: () => Promise.resolve() },
      pandocEngine: {
        getStatus: () => ({ kind: "installed", version: "test" }),
        subscribe: () => () => undefined,
        decline: () => undefined,
      },
      bibliographyRender: {
        renderAst: () => {
          const deferred = Promise.withResolvers<RenderedBibliography>();
          renders.push(deferred);
          return deferred.promise;
        },
        on: (event: string, callback: () => void) => {
          if (event === "invalidated") onInvalidated = callback;
          return () => undefined;
        },
      },
      openSettings: () => undefined,
      openStyleSettings: () => undefined,
    } as unknown as ConstructorParameters<typeof TestReferencesView>[1],
  );

  document.body.append(view.contentEl);
  await act(() => view!.open());
  await finishScan();
});

afterEach(async () => {
  await act(() => view?.close());
  view = undefined;
  onDbChanged = undefined;
  onInvalidated = undefined;
  onActiveLeafChange = undefined;
  document.body.replaceChildren();
});

describe("ReferencesView copy readiness", () => {
  it("offers the copy action once the current render completes", async () => {
    expect(copyAction().hasAttribute("disabled")).toBe(true);

    await finishRender();

    expect(copyAction().getAttribute("aria-label")).toBe("Copy bibliography");
    expect(copyAction().hasAttribute("disabled")).toBe(false);
  });

  it("takes copy back while the retained entries stay on screen", async () => {
    await finishRender();

    await act(() => onDbChanged?.());

    expect(view!.contentEl.textContent).toContain("Rivers, A. (2020).");
    expect(copyAction().getAttribute("aria-label")).toBe(
      "Wait for the references to finish formatting",
    );
    expect(copyAction().hasAttribute("disabled")).toBe(true);

    await finishRender();

    expect(copyAction().hasAttribute("disabled")).toBe(false);
  });

  it("takes copy back when the held renders go stale", async () => {
    await finishRender();

    await act(() => onInvalidated?.());

    expect(view!.contentEl.textContent).not.toContain("Rivers, A. (2020).");
    expect(copyAction().hasAttribute("disabled")).toBe(true);
  });

  it("takes copy back the moment the pane follows another note", async () => {
    await finishRender();
    expect(copyAction().hasAttribute("disabled")).toBe(false);

    await followOtherNote();

    expect(copyAction().getAttribute("aria-label")).toBe(
      "Wait for the references to finish formatting",
    );
    expect(copyAction().hasAttribute("disabled")).toBe(true);
  });

  it("offers the new note its own copy once its rescan and render land", async () => {
    await finishRender();
    await followOtherNote();

    // The note cites the same works, which leaves the list on screen as it is
    // and still hands copy over to the note that now owns it.
    await finishScan();
    expect(copyAction().hasAttribute("disabled")).toBe(true);

    await finishRender();

    expect(copyAction().hasAttribute("disabled")).toBe(false);
  });

  it("keeps copy out of reach when the previous note's render lands", async () => {
    await followOtherNote();

    await finishRender();

    expect(copyAction().hasAttribute("disabled")).toBe(true);
  });
});
