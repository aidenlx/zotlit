import type { WorkspaceLeaf } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SAMPLE_ANNOTATIONS } from "@zotlit/workbench/render";
import { annotationSamples } from "@zotlit/workbench/ui";

import { stubService } from "@/lib/__fixtures__/service-stub";
import type {
  CitationDataLoadResult,
  TemplateDataLoadResult,
} from "@/services/template-workbench/data";
import {
  getSampleItem,
  SAMPLE_ITEM_CHOICES,
} from "@/views/template-workbench/selection-data";
import type { TemplateAuthoringContext } from "@/views/template-workbench/view";

import { makeExplorerHost, waitFor } from "./__fixtures__";
import type { ExplorerHost, ExplorerReads } from "./__fixtures__";
import {
  setCollapsedSections,
  setFilter,
  setNavigation,
  toggleNode,
} from "./model";

const read = vi.fn<NonNullable<ExplorerReads["read"]>>();
const readCitation = vi.fn<NonNullable<ExplorerReads["readCitation"]>>();
const paper = { id: "sample:conference-paper", title: null };
const real = { id: "MAIN2345", title: "Real paper" };

let host: ExplorerHost;

beforeEach(async () => {
  vi.resetAllMocks();
  host = await makeExplorerHost({ read, readCitation });
});

afterEach(() => host.close());

describe("native Explorer sample data", () => {
  it.each(
    SAMPLE_ITEM_CHOICES.filter((item) => item.id === "sample:conference-paper"),
  )(
    "restores $id note and filename roots without database access",
    async (item) => {
      using session = host.openSession();
      for (const root of ["note", "filename"] as const) {
        session.setTarget(item, root);
        await session.ready();
        expect(session.state()).toMatchObject({
          item,
          root,
          status: "ready",
          data: { title: item.title },
        });
      }
      expect(read).not.toHaveBeenCalled();
    },
  );

  it.each(
    SAMPLE_ANNOTATIONS.filter(
      (sample) =>
        sample.id === "example:highlight" || sample.id === "example:ink",
    ),
  )("restores $id with its own parent and no note Item", async (sample) => {
    using session = host.openSession();
    session.setTarget(null, "annotation", sample.id);
    await session.ready();
    expect(session.state()).toMatchObject({
      item: null,
      status: "ready",
      annotationId: sample.id,
      annotations: [],
      data: {
        type: sample.root.type,
        parentItem: { title: "Designing reproducible research interfaces" },
      },
    });
    const data = session.state().data!;
    const parent = data.parentItem as {
      noteLink: () => string | null;
      toString: () => string;
    };
    expect(String(parent)).toBe("Designing reproducible research interfaces");
    expect(parent.noteLink()).toBeNull();
    expect(data.dateAdded).toBeInstanceOf(Temporal.Instant);
    expect(read).not.toHaveBeenCalled();
  });

  it("keeps the annotation's parent while separately loading real Item choices", async () => {
    const pending = Promise.withResolvers<TemplateDataLoadResult>();
    read.mockReturnValue(pending.promise);
    using session = host.openSession();
    session.setTarget(real, "annotation", "example:highlight");
    expect(session.state().status).toBe("ready");
    pending.resolve({
      kind: "data",
      data: {
        title: "Real paper",
        annotations: [{ key: "ANNA2345", text: "Real evidence" }],
      },
    });
    await session.ready();
    expect(session.state().data?.parentItem).toMatchObject({
      title: "Designing reproducible research interfaces",
    });
    expect(session.state().annotations).toEqual([
      { id: "ANNA2345", root: { key: "ANNA2345", text: "Real evidence" } },
    ]);
    expect(read).toHaveBeenCalledExactlyOnceWith("MAIN2345", "note");
  });

  it("keeps the built-in ready when the selected real Item is unavailable", async () => {
    read.mockRejectedValue(new Error("Database offline"));
    using session = host.openSession();
    session.setTarget(real, "annotation", "example:underline");
    await session.ready();
    expect(session.state()).toMatchObject({
      status: "ready",
      error: null,
      data: { text: "Report the assumptions behind each result." },
    });
  });

  it("restores a sample Item's annotation from canonical and saved bare-key selections", async () => {
    const snapshot = getSampleItem(paper.id)!;
    const id = '["sample:conference-paper","CNPAN26A"]';
    expect(annotationSamples(snapshot, null).current[0]?.id).toBe(id);
    using session = host.openSession();
    for (const annotationId of [id, "CNPAN26A"]) {
      session.setTarget(paper, "annotation", annotationId);
      await session.ready();
      expect(session.state()).toMatchObject({
        item: paper,
        annotationId,
        status: "ready",
        data: {
          text: "A reproducible interface makes its inputs and outputs inspectable.",
        },
      });
      expect(session.state().annotations?.[0]?.id).toBe(id);
    }
    expect(read).not.toHaveBeenCalled();
  });

  it("keeps empty, missing sample, and missing annotation selections distinct", async () => {
    using session = host.openSession();
    session.setTarget(null, "note");
    await session.ready();
    expect(session.state()).toMatchObject({
      status: "no-item",
      data: null,
    });
    session.setTarget({ id: "sample:removed", title: null }, "note");
    await session.ready();
    expect(session.state()).toMatchObject({
      status: "error",
      data: null,
    });
    session.setTarget(paper, "annotation");
    await session.ready();
    expect(session.state()).toMatchObject({
      status: "empty",
      data: null,
    });
    session.setTarget(paper, "annotation", "MISS2345");
    await session.ready();
    expect(session.state()).toMatchObject({
      status: "error",
      data: null,
    });
    expect(read).not.toHaveBeenCalled();
  });

  it.each(["resolve", "reject"] as const)(
    "discards an older real load that later %ss",
    async (outcome) => {
      const pending = Promise.withResolvers<TemplateDataLoadResult>();
      read.mockReturnValue(pending.promise);
      using session = host.openSession();
      session.setTarget(real, "annotation", "ANNA2345");
      await waitFor(() => expect(read).toHaveBeenCalledOnce());
      session.setTarget(paper, "annotation", "example:note");
      await session.ready();
      if (outcome === "resolve")
        pending.resolve({
          kind: "data",
          data: { title: "Old paper", annotations: [{ key: "OLD23456" }] },
        });
      else pending.reject(new Error("Old read failed"));
      await session.ready();
      expect(session.state()).toMatchObject({
        item: paper,
        annotationId: "example:note",
        status: "ready",
        error: null,
        data: { type: "note" },
      });
      // The conference-paper sample's own two Annotations, and nothing the
      // discarded read carried.
      expect(session.state().annotations?.map(({ id }) => id)).toEqual([
        '["sample:conference-paper","CNPAN26A"]',
        '["sample:conference-paper","CNPVL26A"]',
      ]);
    },
  );

  it("follows annotation selection while preserving independently browsed roots", async () => {
    const context: TemplateAuthoringContext = {
      leaf: stubService<WorkspaceLeaf>("WorkspaceLeaf", {}),
      path: "profiles/paper.md",
      kind: "profile",
      item: paper,
      root: "note",
      tab: "note",
      advanced: false,
      annotationId: null,
      citation: null,
      partial: null,
    };
    using annotation = host.openSession();
    using note = host.openSession();
    annotation.setContext(context);
    note.setContext(context);
    await Promise.all([annotation.ready(), note.ready()]);
    annotation.setTarget(paper, "annotation", "example:highlight");
    await annotation.ready();
    const next = { ...context, annotationId: "example:underline" };
    annotation.setContext(next);
    note.setContext(next);
    await Promise.all([annotation.ready(), note.ready()]);
    expect(annotation.state()).toMatchObject({
      root: "annotation",
      annotationId: "example:underline",
      data: { type: "underline" },
    });
    expect(note.state()).toMatchObject({
      root: "note",
      annotationId: null,
      data: { title: "Designing reproducible research interfaces" },
    });
    annotation.setContext({ ...next, advanced: true });
    expect(annotation.state().root).toBe("annotation");
  });
});

describe("the citation root", () => {
  it("lists the built-in example set while no Item is chosen", async () => {
    using session = host.openSession();
    session.setTarget(null, "citation");
    await session.ready();

    const state = session.state();
    expect(state.status).toBe("ready");
    // The Citation root's own three fields, which the Explorer's Common
    // section shows; the cited item's fields sit under `citations` and `items`.
    expect(Object.keys(state.data!)).toEqual(["variant", "items", "citations"]);
    expect(state.data!["variant"]).toBe("main");
    expect(read).not.toHaveBeenCalled();
  });

  it("reads a chosen Item's own one-item set from the database", async () => {
    readCitation.mockResolvedValue({
      kind: "data",
      data: { variant: "main", items: [], citations: [] },
    } as CitationDataLoadResult);
    using session = host.openSession();
    session.setTarget(real, "citation");
    await session.ready();

    expect(readCitation).toHaveBeenCalledWith({ key: real.id }, "main");
    expect(session.state().status).toBe("ready");
  });

  it("lists the example set and Variant the editor's preview renders", async () => {
    const context: TemplateAuthoringContext = {
      leaf: stubService<WorkspaceLeaf>("WorkspaceLeaf", {}),
      path: "templates/zotlit-citation.md",
      kind: "citation",
      item: null,
      root: "citation",
      tab: "citation",
      advanced: false,
      annotationId: null,
      citation: { variant: "main", example: "one-item" },
      partial: null,
    };
    using session = host.openSession();
    session.setContext(context);
    await session.ready();
    expect(session.state().data).toMatchObject({
      variant: "main",
      citations: [expect.anything()],
    });

    session.setContext({
      ...context,
      citation: { variant: "alt", example: "two-items" },
      partial: null,
    });
    await session.ready();
    // Two citations under the alternate Variant: the set and the gesture the
    // preview renders, not the one the Explorer opened on.
    const state = session.state();
    expect(state.data).toMatchObject({ variant: "alt" });
    expect((state.data!["citations"] as unknown[]).length).toBe(2);
    expect(readCitation).not.toHaveBeenCalled();
  });

  it("follows the caller a Shared Partial is previewed as called from", async () => {
    read.mockResolvedValue({
      kind: "data",
      data: { text: "Read me", type: "highlight" },
    } as TemplateDataLoadResult);
    const context: TemplateAuthoringContext = {
      leaf: stubService<WorkspaceLeaf>("WorkspaceLeaf", {}),
      path: "templates/zotlit-partial.authors.md",
      kind: "partial",
      item: real,
      root: "note",
      tab: "partial",
      advanced: false,
      annotationId: null,
      citation: null,
      partial: { name: "authors", context: "note", profile: null },
    };
    using session = host.openSession();
    session.setContext(context);
    await session.ready();
    expect(read).toHaveBeenLastCalledWith(real.id, "note");

    session.setContext({
      ...context,
      root: "annotation",
      annotationId: "example:highlight",
      partial: { name: "authors", context: "annotation", profile: null },
    });
    await session.ready();

    expect(session.state()).toMatchObject({
      root: "annotation",
      annotationId: "example:highlight",
      data: { type: "highlight" },
    });
  });

  it("reads a chosen Item's set under the Variant the preview renders", async () => {
    readCitation.mockResolvedValue({
      kind: "data",
      data: { variant: "alt", items: [], citations: [] },
    } as CitationDataLoadResult);
    using session = host.openSession();
    session.setContext({
      leaf: stubService<WorkspaceLeaf>("WorkspaceLeaf", {}),
      path: "templates/zotlit-citation.md",
      kind: "citation",
      item: real,
      root: "citation",
      tab: "citation",
      advanced: false,
      annotationId: null,
      citation: { variant: "alt", example: null },
      partial: null,
    });
    await session.ready();

    expect(readCitation).toHaveBeenCalledWith({ key: real.id }, "alt");
  });
});

describe("when the Explorer reads its data again", () => {
  it("keeps its data through navigation, filter, toggle, and section changes", async () => {
    read.mockResolvedValue({
      kind: "data",
      data: { title: "Real paper", tags: ["methods"] },
    });
    using session = host.openSession();
    session.setTarget(real, "note");
    await session.ready();
    expect(read).toHaveBeenCalledExactlyOnceWith(real.id, "note");
    session.apply(toggleNode("tags"));
    session.apply(setFilter("methods"));
    session.apply(setNavigation(session.state().navigation));
    session.apply(setCollapsedSections(new Set(["record"])));
    await session.ready();
    expect(read).toHaveBeenCalledOnce();
    expect(session.state()).toMatchObject({
      status: "ready",
      data: { title: "Real paper" },
    });
    expect(session.state().navigation.filterQuery).toBe("methods");
  });

  it("reads the current target again when Zotero changes", async () => {
    read.mockResolvedValueOnce({ kind: "data", data: { title: "Before" } });
    read.mockResolvedValueOnce({ kind: "data", data: { title: "After" } });
    using session = host.openSession();
    session.setTarget(real, "note");
    await session.ready();
    expect(session.state().data?.title).toBe("Before");
    host.changeZotero();
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    await session.ready();
    expect(read).toHaveBeenLastCalledWith(real.id, "note");
    expect(session.state()).toMatchObject({
      item: real,
      status: "ready",
      data: { title: "After" },
    });
  });
});
