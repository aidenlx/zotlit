// @vitest-environment happy-dom
import { TFile } from "obsidian";
import type { App, EventRef, WorkspaceLeaf } from "obsidian";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FIELD_CITATION_STYLE } from "@/lib/constants";
import * as m from "@/lib/i18n/generated/messages";
import {
  lookupAnswer,
  lookupForWorks,
} from "@/services/citation-index/__fixtures__/lookup";
import type {
  CitationKeyResolution,
  DocumentCitationSet,
} from "@/services/citation-index/service";
import type { DocumentCitations } from "@/services/citation-text/present";
import type { Inline, Inlines } from "@/services/pandoc/ast";
import type { BibliographyRenderOutcome } from "@/services/pandoc/render-cache";
import type { BibliographyRenderResult } from "@/services/pandoc/render-cache";
import { profileReader } from "@/services/profile/__fixtures__/reader";
import type { Held } from "@/services/query-client/service";
import { defaults } from "@/services/settings/schema";
import type { ZoteroReadsService } from "@/services/zotero-reads/service";
import {
  inProcessReadsService,
  memoryOpener,
} from "@/services/zotero-reads/test-utils";

import { ReferencesView } from "./view";

type RenderedBibliography = Extract<
  BibliographyRenderOutcome,
  { kind: "held" }
>;

vi.mock("zustand", () => import("../__fixtures__/zustand"));

vi.mock("@/components/obsidian/icon-button", async () => {
  const { createElement } = await import("react");
  return {
    IconButton: ({ icon, ...props }: { icon: string }) =>
      createElement("button", { ...props, "data-icon": icon }),
  };
});

/** The one cited work: a book in My Library, signed in as user 1. */
const SEED = `
  insert into libraries (libraryID, type, version, clientVersion)
    values (1, 'user', 1, 1);
  insert into settings (setting, key, value) values ('account', 'userID', 1);
  insert into itemTypes (itemTypeID, typeName) values (1, 'book');
  insert into fieldsCombined (fieldID, fieldName, custom) values (1, 'title', 0);
  insert into items (itemID, itemTypeID, dateAdded, dateModified, libraryID, key)
    values (1, 1, '2024-01-01 00:00:00', '2024-01-01 00:00:00', 1, 'BKRV2345');
  insert into itemDataValues (valueID, value) values (1, 'Field notes');
  insert into itemData (itemID, fieldID, valueID) values (1, 1, 1);
`;

/** The CSL id the book's citation data carries. */
const BOOK_CSL_ID = "http://zotero.org/users/1/items/BKRV2345";

class TestReferencesView extends ReferencesView {
  open(): Promise<void> {
    return this.onOpen();
  }

  close(): Promise<void> {
    return this.onClose();
  }
}

const citationSet: DocumentCitationSet = {
  lookup: lookupAnswer(),
  occurrences: [],
  citations: [
    {
      indexedKey: "BKRV2345",
      refNumber: 1,
      linkpath: "notes/BKRV2345",
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
  const value: BibliographyRenderResult = {
    entries: [
      {
        id: BOOK_CSL_ID,
        marker: words("[1]"),
        content: words("Rivers, A. (2020). Field notes. Harbour Press."),
      },
    ],
    hasEntryMarkers: true,
  };
  return {
    kind: "held",
    key: "test-render",
    record: {
      value,
      status: "fresh",
      settled: Promise.resolve(value),
    },
  };
}

function failedHeldOutcome(): RenderedBibliography {
  const outcome = renderedOutcome();
  return {
    ...outcome,
    record: { ...outcome.record, status: "failed" },
  };
}

/** What a style that writes no Entry Marker renders, which leaves the gutter free. */
function unmarkedOutcome(): RenderedBibliography {
  const value: BibliographyRenderResult = {
    entries: [
      {
        id: BOOK_CSL_ID,
        marker: undefined,
        content: words("Rivers, A. (2020). Field notes. Harbour Press."),
      },
    ],
    hasEntryMarkers: false,
  };
  return {
    kind: "held",
    key: "test-render-unmarked",
    record: {
      value,
      status: "fresh",
      settled: Promise.resolve(value),
    },
  };
}

/** What the citation text service holds for one note. */
function heldText(entrySerials: boolean): DocumentCitations {
  return {
    formatted: new Map(),
    entrySerials,
    summaries: new Map(),
    lookup: lookupForWorks(new Map()),
    literalWorks: new Map(),
  };
}

let view: TestReferencesView | undefined;
let renders: PromiseWithResolvers<RenderedBibliography>[] = [];
/** The render requests a test has answered. */
let answered = new Set<PromiseWithResolvers<RenderedBibliography>>();
let scans: PromiseWithResolvers<DocumentCitationSet>[] = [];
let activeFile: TFile;
let otherFile: TFile;
let onDbChanged: (() => void) | undefined;
let reads: ZoteroReadsService | undefined;
let onCitationsChanged: ((path: string) => void) | undefined;
let onCitedByInvalidated: (() => void) | undefined;
/** What the Citation Index reports its resolution snapshot as. */
let citekeyResolution: CitationKeyResolution;
/** What the citation text service holds for the note on screen. */
let heldCitations: DocumentCitations | null;
let onInvalidated: (() => void) | undefined;
let onActiveLeafChange: (() => void) | undefined;
let onMetadataChanged: (() => void) | undefined;
let frontmatter: Record<string, unknown> | undefined;

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

/** The newest render request, once it arrived and is still unanswered. */
async function pendingRender(): Promise<
  PromiseWithResolvers<RenderedBibliography>
> {
  // A reload reads the database before it asks for the render, and the test
  // cannot name when that read lands.
  return await vi.waitFor(() => {
    const render = renders.at(-1);
    if (!render || answered.has(render))
      throw new Error("No render request is waiting");
    return render;
  });
}

/** Answer the newest render request and let the pane paint its answer. */
async function finishRender(
  outcome: RenderedBibliography = renderedOutcome(),
): Promise<void> {
  const render = await pendingRender();
  answered.add(render);
  await act(async () => {
    render.resolve(outcome);
    // The view awaited this promise first, so it has painted by the time this
    // await returns.
    await render.promise;
  });
}

/**
 * Answer the citation-set read the newest rescan is waiting on. A new set
 * reloads the list, which ends in a render request; that request is the
 * completion signal.
 */
async function finishScan(
  set: DocumentCitationSet = citationSet,
): Promise<void> {
  const before = renders.length;
  await act(async () => {
    scans.at(-1)!.resolve(set);
    await vi.waitFor(() => {
      if (renders.length === before)
        throw new Error("The rescan has not reloaded the list");
    });
  });
}

/** Follow another note, which the pane learns of before its rescan answers. */
async function followOtherNote(): Promise<void> {
  activeFile = otherFile;
  await act(() => onActiveLeafChange!());
}

beforeEach(async () => {
  renders = [];
  answered = new Set();
  scans = [];
  heldCitations = null;
  frontmatter = undefined;
  citekeyResolution = "fresh";
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
    metadataCache: {
      on: (event: string, callback: () => void) => {
        if (event === "changed") onMetadataChanged = callback;
        return {} as EventRef;
      },
      // No note here declares a style of its own, so every list is rendered
      // under the vault Citation Presentation.
      getFileCache: () => (frontmatter ? { frontmatter } : null),
    },
  } as unknown as App;

  const profileReady = Promise.withResolvers<void>();
  const profile = {
    ...profileReader(defaults, app.metadataCache),
    loaded: false,
    ready: profileReady.promise,
  };
  reads = inProcessReadsService(memoryOpener(() => SEED).open);
  view = new TestReferencesView(
    {} as WorkspaceLeaf,
    {
      app,
      db: {
        state: "ready",
        get ready() {
          return reads!.ready;
        },
        acquireRead: () => reads!.acquireRead(),
        on: (event: string, callback: () => void) => {
          if (event === "changed") onDbChanged = callback;
          return () => undefined;
        },
      },
      citationLookup: {
        get status() {
          return citekeyResolution ?? "pending";
        },
        on: (event: string, callback: () => void) => {
          if (event === "status-changed") onCitedByInvalidated = callback;
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
      citationText: {
        peek: (): Held<DocumentCitations> | null =>
          heldCitations === null
            ? null
            : {
                value: heldCitations,
                status: "fresh",
                settled: Promise.resolve(heldCitations),
              },
        on: (event: string, callback: (path: string) => void) => {
          if (event === "changed") onCitationsChanged = callback;
          return () => undefined;
        },
      },
      citekeyEditor: { openCitekey: () => Promise.resolve() },
      pandocEngine: {
        getStatus: () => ({ kind: "installed", version: "test" }),
        subscribe: () => () => undefined,
        decline: () => undefined,
      },
      bibliographyRender: {
        vaultPresentation: { styleId: null, locale: null },
        render: () => {
          const deferred = Promise.withResolvers<RenderedBibliography>();
          renders.push(deferred);
          return deferred.promise;
        },
        on: (event: string, callback: () => void) => {
          if (event === "invalidated") onInvalidated = callback;
          return () => undefined;
        },
      },
      profile,
      openSettings: () => undefined,
      openStyleSettings: () => undefined,
    } as unknown as ConstructorParameters<typeof TestReferencesView>[1],
  );

  document.body.append(view.contentEl);
  await act(async () => {
    const opening = view!.open();
    await Promise.resolve();
    expect(scans).toHaveLength(0);
    profile.loaded = true;
    profileReady.resolve();
    await opening;
  });
  await finishScan();
});

afterEach(async () => {
  await act(() => view?.close());
  view = undefined;
  await reads?.[Symbol.asyncDispose]();
  reads = undefined;
  onDbChanged = undefined;
  onCitationsChanged = undefined;
  onCitedByInvalidated = undefined;
  onInvalidated = undefined;
  onActiveLeafChange = undefined;
  onMetadataChanged = undefined;
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

  it("takes copy back but keeps the entries when the held renders go stale", async () => {
    await finishRender();

    await act(() => onInvalidated?.());

    // Stale entries stay on screen while the fresh render replaces them, so
    // a Zotero refresh that changes nothing never flashes the minimal list.
    expect(view!.contentEl.textContent).toContain("Rivers, A. (2020).");
    expect(copyAction().hasAttribute("disabled")).toBe(true);

    await finishRender();

    expect(copyAction().hasAttribute("disabled")).toBe(false);
  });

  it("keeps held entries visible when their replacement fails", async () => {
    await finishRender();

    await act(() => onDbChanged?.());
    await finishRender(failedHeldOutcome());

    expect(view!.contentEl.textContent).toContain("Rivers, A. (2020).");
    expect(view!.contentEl.textContent).toContain(
      m.references_format_failed_title(),
    );
    expect(copyAction().hasAttribute("disabled")).toBe(true);
  });

  it("clears entries when the document selects another style", async () => {
    await finishRender();
    frontmatter = { [FIELD_CITATION_STYLE]: "new-style" };

    await act(() => onMetadataChanged?.());
    await finishScan();

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

describe("ReferencesView Entry Serials", () => {
  /** The gutter of the one entry the list shows. */
  function gutter(): string | null {
    return view!.contentEl.querySelector("li")!.children[0]!.textContent;
  }

  it("puts the gutter on Entry Serials once the note's citations show them", async () => {
    heldCitations = heldText(true);
    await act(() => onCitationsChanged!(activeFile.path));

    await finishRender(unmarkedOutcome());

    expect(gutter()).toBe("1");
  });

  it("leaves the gutter out where the note's citations show none", async () => {
    heldCitations = heldText(false);
    await act(() => onCitationsChanged!(activeFile.path));

    await finishRender(unmarkedOutcome());

    expect(view!.contentEl.querySelector("ul")!.classList).toContain(
      "zt:grid-cols-[minmax(0,1fr)_max-content]",
    );
  });
});

describe("ReferencesView citekey resolution", () => {
  /** One citation whose key the resolution snapshot answers nothing for. */
  const unresolvedSet: DocumentCitationSet = {
    lookup: lookupAnswer(),
    occurrences: [],
    citations: [
      {
        indexedKey: null,
        linkpath: null,
        refNumber: 1,
        occurrences: [
          {
            kind: "citekey",
            raw: "ghost2024",
            position: {
              start: { line: 0, col: 0, offset: 0 },
              end: { line: 0, col: 10, offset: 10 },
            },
          },
        ],
      },
    ],
    errors: [],
  };

  it("retries the active document after an equal-revision recovery", async () => {
    await finishRender();
    await followOtherNote();
    citekeyResolution = "failed";
    await act(async () => {
      scans.at(-1)!.reject(new Error("lookup unavailable"));
      await Promise.resolve();
    });
    const failedScan = scans.at(-1);
    citekeyResolution = "fresh";
    await act(() => onCitedByInvalidated!());
    expect(scans.at(-1)).not.toBe(failedScan);
    await act(async () => {
      scans.at(-1)!.resolve({ ...citationSet, citations: [] });
    });
    await vi.waitFor(() =>
      expect(view!.contentEl.textContent).not.toContain("Field notes"),
    );
    expect(view!.contentEl.textContent).not.toContain("Field notes");
  });

  it("returns the pending label to a verdict when a rebuild settles unchanged", async () => {
    await act(() => onActiveLeafChange!());
    await finishScan(unresolvedSet);

    // No snapshot has settled before this reload reads it.
    citekeyResolution = null;
    await act(() => onDbChanged?.());
    expect(view!.contentEl.textContent).toContain(
      m.references_citekey_pending({ citekey: "ghost2024" }),
    );

    // The rebuild settles with the maps unchanged, so no resolution-changed
    // event follows — only the state flip the settle announces.
    citekeyResolution = "fresh";
    await act(() => onCitedByInvalidated!());

    expect(view!.contentEl.textContent).toContain(
      m.references_citekey_unresolved({ citekey: "ghost2024" }),
    );
    expect(view!.contentEl.textContent).not.toContain(
      m.references_citekey_pending({ citekey: "ghost2024" }),
    );
  });
});
