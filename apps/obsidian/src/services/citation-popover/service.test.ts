// @vitest-environment happy-dom
import type { TFile } from "obsidian";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Held } from "@/lib/held-reads";
import type { DocumentCitations } from "@/services/citation-text/service";

import type { CitationPopoverContentProps } from "./content";
import { createCitationPopover } from "./service";

const popovers = vi.hoisted(
  () =>
    [] as {
      render: ReturnType<typeof vi.fn>;
      hide: ReturnType<typeof vi.fn>;
    }[],
);

vi.mock("./popover", () => ({
  CitationHoverPopover: class {
    readonly render = vi.fn(() => true);
    readonly hide = vi.fn();

    constructor() {
      popovers.push(this);
    }

    register(): void {}
    registerEvent(): void {}
  },
}));

const NOTE = { path: "note.md" } as TFile;

const emptyText = (): DocumentCitations => ({
  formatted: new Map(),
  entrySerials: false,
  summaries: new Map(),
  literalWorks: new Map(),
});

function harness(initial: Held<DocumentCitations> | null) {
  let held = initial;
  const listeners = {
    changed: new Set<(path: string) => void>(),
    settled: new Set<(path: string) => void>(),
    invalidated: new Set<() => void>(),
  };
  const citationText = {
    peek: vi.fn(() => held),
    on: vi.fn(
      <K extends keyof typeof listeners>(
        event: K,
        listener: (typeof listeners)[K] extends Set<infer T> ? T : never,
      ) => {
        listeners[event].add(listener as never);
        return () => listeners[event].delete(listener as never);
      },
    ),
  };
  const service = createCitationPopover({
    app: {
      vault: { getFileByPath: () => NOTE },
      metadataCache: {
        getFileCache: () => null,
        on: () => ({ e: { offref: () => undefined } }),
      },
    },
    db: { state: "ready", client: {} },
    citationIndex: {
      getDocumentCitationSet: () =>
        Promise.resolve({ occurrences: [], citations: [], errors: [] }),
      resolveCitekey: () => ({ kind: "missing" }),
      resolution: "fresh",
    },
    libraryScope: { current: [] },
    citationText,
    bibliographyRender: {
      vaultPresentation: { styleId: null, locale: null },
      on: () => () => undefined,
      render: () =>
        Promise.resolve({
          kind: "held" as const,
          key: "empty",
          record: {
            value: { entries: [], hasEntryMarkers: false },
            status: "fresh" as const,
            settled: Promise.resolve({ entries: [], hasEntryMarkers: false }),
          },
        }),
    },
  } as never);
  const show = () =>
    service.show({
      event: new MouseEvent("mouseover"),
      hoverParent: { hoverPopover: null },
      sourcePath: NOTE.path,
      targetEl: document.createElement("span"),
      works: [{ citekey: "ghost" }],
      shown: {
        citation: {
          source: "[@ghost]",
          keys: [{ citekey: "ghost", start: 1, end: 7 }],
        },
        at: { kind: "offset", start: 0 },
      },
      open: vi.fn(),
    });
  return {
    citationText,
    emitChanged: () => {
      for (const listener of listeners.changed) listener(NOTE.path);
    },
    emitInvalidated: () => {
      for (const listener of listeners.invalidated) listener();
    },
    hold(value: Held<DocumentCitations>) {
      held = value;
    },
    show,
  };
}

beforeEach(() => {
  popovers.length = 0;
});

describe("Citation Popover citation text", () => {
  it.each([
    [
      "the document changed",
      (run: ReturnType<typeof harness>) => run.emitChanged(),
    ],
    [
      "all documents changed",
      (run: ReturnType<typeof harness>) => run.emitInvalidated(),
    ],
  ])("follows a replaced first read when %s", async (_name, invalidate) => {
    const run = harness(null);
    run.show();
    await vi.waitFor(() =>
      expect(run.citationText.peek).toHaveBeenCalledOnce(),
    );

    invalidate(run);
    await vi.waitFor(() =>
      expect(run.citationText.peek).toHaveBeenCalledTimes(2),
    );

    run.hold({
      value: emptyText(),
      status: "fresh",
      settled: Promise.resolve(emptyText()),
    });
    run.emitChanged();

    await vi.waitFor(() => expect(popovers[0]!.render).toHaveBeenCalledOnce());
  });

  it("uses the held citation text after its replacement read failed", async () => {
    const text: DocumentCitations = {
      ...emptyText(),
      formatted: new Map([
        [
          "[@ghost]",
          [
            {
              start: 0,
              text: {
                content: [
                  {
                    t: "Note",
                    c: [{ t: "Para", c: [{ t: "Str", c: "held note" }] }],
                  },
                ],
                citations: [{ id: "ghost", mode: "normal" }],
              },
              serials: [],
            },
          ],
        ],
      ]),
    };
    const run = harness({
      value: text,
      status: "failed",
      settled: Promise.resolve(null),
    });

    run.show();

    await vi.waitFor(() => expect(popovers[0]!.render).toHaveBeenCalledOnce());
    const content = popovers[0]!.render.mock
      .calls[0]![0] as ReactElement<CitationPopoverContentProps>;
    expect(content.props.note).toEqual([{ t: "Str", c: "held note" }]);
  });
});
