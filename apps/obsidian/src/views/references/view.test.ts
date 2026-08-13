// @vitest-environment happy-dom
import { TFile } from "obsidian";
import type { App, EventRef, WorkspaceLeaf } from "obsidian";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DocumentCitationSet } from "@/services/citation-index/service";
import type { BibliographyRenderOutcome } from "@/services/pandoc/render-cache";

import { ReferencesView } from "./view";

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

function renderedOutcome(): BibliographyRenderOutcome {
  const content = document.createDocumentFragment();
  content.append("Rivers, A. (2020). Field notes. Harbour Press.");
  return {
    kind: "rendered",
    entries: [{ id: "ref-book", marker: "[1]", content }],
    hasEntryMarkers: true,
  };
}

let view: TestReferencesView | undefined;
let renders: PromiseWithResolvers<BibliographyRenderOutcome>[] = [];
let onDbChanged: (() => void) | undefined;
let onInvalidated: (() => void) | undefined;

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

beforeEach(async () => {
  renders = [];
  const file = new TFile();
  file.path = "notes/tidal.md";
  file.name = "tidal.md";
  file.basename = "tidal";
  file.extension = "md";
  const app = {
    workspace: {
      getActiveFile: () => file,
      on: () => ({}) as EventRef,
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
        getDocumentCitationSet: () => Promise.resolve(citationSet),
        on: () => () => undefined,
      },
      citekeyEditor: { openCitekey: () => Promise.resolve() },
      pandocEngine: {
        getStatus: () => ({ kind: "installed", version: "test" }),
        subscribe: () => () => undefined,
        decline: () => undefined,
      },
      bibliographyRender: {
        render: () => {
          const deferred = Promise.withResolvers<BibliographyRenderOutcome>();
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
  await settle();
});

afterEach(async () => {
  await act(() => view?.close());
  view = undefined;
  onDbChanged = undefined;
  onInvalidated = undefined;
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
});
