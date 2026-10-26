// @vitest-environment happy-dom
import type { TFile } from "obsidian";
import type { App, WorkspaceLeaf } from "obsidian";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { stubService } from "@/lib/__fixtures__/service-stub";
import { FIELD_CITATION_STYLE } from "@/lib/constants";
import * as m from "@/lib/i18n/generated/messages";
import { lookupAnswer } from "@/services/citation-index/__fixtures__/lookup";
import { citationOutcome } from "@/services/citation-index/outcome";
import type {
  CitationKeyResolution,
  DocumentCitationSet,
} from "@/services/citation-index/service";
import { readReferenceSources } from "@/services/citation-index/sources";
import type { Inline, Inlines } from "@/services/pandoc/ast";
import type { BibliographyRenderOutcome } from "@/services/pandoc/render-cache";
import type { BibliographyRenderResult } from "@/services/pandoc/render-cache";
import type { TestReads } from "@/services/zotero-reads/__fixtures__";
import {
  inProcessReadsService,
  memoryOpener,
} from "@/services/zotero-reads/test-utils";

import { makeReferencesHost } from "./__fixtures__";
import type { ReferencesHost } from "./__fixtures__";
import { ReferencesView } from "./view";

type RenderedBibliography = Extract<
  BibliographyRenderOutcome,
  { kind: "held" }
>;

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
  sources: new Map(),
  presentKeys: new Set(),
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

let view: TestReferencesView | undefined;
let renders: PromiseWithResolvers<BibliographyRenderOutcome>[] = [];
/** The render requests a test has answered. */
let answered = new Set<PromiseWithResolvers<BibliographyRenderOutcome>>();
let scans: PromiseWithResolvers<DocumentCitationSet>[] = [];
let activeFile: TFile;
let otherFile: TFile;
let reads: TestReads | undefined;
let citekeyResolution: CitationKeyResolution;
let frontmatter: Record<string, unknown> | undefined;
let host: ReferencesHost;
const onDbChanged = () => host.changeZotero();
const onInvalidated = () => host.invalidate();
const onCitedByInvalidated = () =>
  host.setLookup(citekeyResolution ?? "pending");
const onActiveLeafChange = () => {
  host.workspace.open(activeFile);
};
const onMetadataChanged = () =>
  host.metadataCache.change(activeFile, { frontmatter });

function copyAction(): HTMLElement {
  return view!.contentEl.querySelector<HTMLElement>(
    "[data-references-copy-bibliography]",
  )!;
}

/** The newest render request, once it arrived and is still unanswered. */
async function pendingRender(): Promise<
  PromiseWithResolvers<BibliographyRenderOutcome>
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
    await render.promise;
    await vi.waitFor(() =>
      expect(host.registry.get(view!.model.loaded).waiting).toBe(false),
    );
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
    const joined = await readReferenceSources(reads!, set.citations);
    scans.at(-1)!.resolve({
      ...set,
      ...joined,
      citations: set.citations.map((c) => ({
        ...c,
        outcome: citationOutcome(c, joined),
      })),
    });
    await vi.waitFor(() => {
      if (renders.length === before)
        throw new Error("The rescan has not reloaded the list");
    });
  });
}

/** Follow another note, which the pane learns of before its rescan answers. */
async function followOtherNote(): Promise<void> {
  activeFile = otherFile;
  const previous = scans.at(-1);
  await act(() => onActiveLeafChange());
  await vi.waitFor(() => expect(scans.at(-1)).not.toBe(previous));
}

beforeEach(async () => {
  answered = new Set();
  frontmatter = undefined;
  citekeyResolution = "fresh";
  host = await makeReferencesHost();
  renders = host.renders;
  scans = host.scans;
  activeFile = host.follow("notes/tidal.md")!;
  otherFile = host.vault.add("notes/estuary.md");
  otherFile.extension = "md";
  reads = inProcessReadsService(memoryOpener(() => SEED).open);
  const app = stubService<App>("App", {
    scope: stubService<App["scope"]>("Scope", {}),
    workspace: stubService<App["workspace"]>("Workspace", {
      getActiveFile: () => host.workspace.getActiveFile(),
    }),
  });
  const leaf = stubService<WorkspaceLeaf>("WorkspaceLeaf", {
    updateHeader: vi.fn(),
  });
  Object.defineProperty(leaf, "app", { value: app });
  view = new TestReferencesView(leaf, {
    app,
    registry: host.registry,
    openSettings: () => undefined,
    openStyleSettings: () => undefined,
  });
  document.body.append(view.contentEl);
  await act(async () => {
    await view!.open();
  });
  await vi.waitFor(() => expect(scans.length).toBeGreaterThan(0));
  await finishScan();
});

afterEach(async () => {
  await act(() => view?.close());
  view = undefined;
  await host?.close();
  await reads?.[Symbol.asyncDispose]();
  reads = undefined;
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

    await act(() => onDbChanged());
    await pendingRender();

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

    await act(() => onInvalidated());
    await pendingRender();

    // Stale entries stay on screen while the fresh render replaces them, so
    // a Zotero refresh that changes nothing never flashes the minimal list.
    expect(view!.contentEl.textContent).toContain("Rivers, A. (2020).");
    expect(copyAction().hasAttribute("disabled")).toBe(true);

    await finishRender();

    expect(copyAction().hasAttribute("disabled")).toBe(false);
  });

  it("keeps held entries visible when their replacement fails", async () => {
    await finishRender();

    await act(() => onDbChanged());
    await pendingRender();
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

    const previous = scans.at(-1);
    await act(() => onMetadataChanged());
    await vi.waitFor(() => expect(scans.at(-1)).not.toBe(previous));
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

describe("ReferencesView citekey resolution", () => {
  /** One citation whose key the resolution snapshot answers nothing for. */
  const unresolvedSet: DocumentCitationSet = {
    sources: new Map(),
    presentKeys: new Set(),
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
    await vi.waitFor(() => expect(scans.at(-1)).not.toBe(failedScan));
    await act(async () => {
      scans.at(-1)!.resolve({ ...citationSet, citations: [] });
    });
    await vi.waitFor(() =>
      expect(view!.contentEl.textContent).not.toContain("Field notes"),
    );
    expect(view!.contentEl.textContent).not.toContain("Field notes");
  });

  it("returns the pending label to a verdict when a rebuild settles unchanged", async () => {
    const previous = scans.at(-1);
    await act(() => host.index.emit({ type: "membership-changed" }));
    await vi.waitFor(() => expect(scans.at(-1)).not.toBe(previous));
    await finishScan(unresolvedSet);

    // No snapshot has settled before this reload reads it.
    citekeyResolution = null;
    host.setLookup("pending");
    await act(() => onDbChanged());
    await pendingRender();
    expect(view!.contentEl.textContent).toContain(
      m.references_citekey_pending({ citekey: "ghost2024" }),
    );

    // The rebuild settles with the maps unchanged, so no resolution-changed
    // event follows — only the state flip the settle announces.
    citekeyResolution = "fresh";
    await act(() => onCitedByInvalidated());
    await vi.waitFor(() =>
      expect(view!.contentEl.textContent).toContain(
        m.references_citekey_unresolved({ citekey: "ghost2024" }),
      ),
    );

    expect(view!.contentEl.textContent).toContain(
      m.references_citekey_unresolved({ citekey: "ghost2024" }),
    );
    expect(view!.contentEl.textContent).not.toContain(
      m.references_citekey_pending({ citekey: "ghost2024" }),
    );
  });
});
