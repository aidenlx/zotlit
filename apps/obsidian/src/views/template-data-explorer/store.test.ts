import type { WorkspaceLeaf } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SAMPLE_ANNOTATIONS } from "@zotlit/workbench/render";
import { annotationSamples } from "@zotlit/workbench/ui";

import { loadTemplateData } from "@/services/template-workbench/data";
import type {
  TemplateDataDeps,
  TemplateDataLoadResult,
} from "@/services/template-workbench/data";
import {
  getSampleItem,
  SAMPLE_ITEM_CHOICES,
} from "@/views/profile-editor/selection-data";
import type { ProfileAuthoringContext } from "@/views/profile-editor/view";

import { NativeExplorerSession } from "./store";

vi.mock("@/services/template-workbench/data", () => ({
  loadTemplateData: vi.fn(),
}));

const deps = {} as TemplateDataDeps;
const paper = { id: "sample:conference-paper", title: null };
const real = { id: "MAIN2345", title: "Real paper" };

beforeEach(() => vi.resetAllMocks());

describe("native Explorer sample data", () => {
  it.each(SAMPLE_ITEM_CHOICES)(
    "restores $id note and filename roots without database access",
    async (item) => {
      using session = new NativeExplorerSession(deps);
      for (const root of ["note", "filename"] as const) {
        session.setTarget(item, root);
        await session.ready;
        expect(session.state.getState()).toMatchObject({
          item,
          root,
          status: "ready",
          data: { title: item.title },
        });
      }
      expect(loadTemplateData).not.toHaveBeenCalled();
    },
  );

  it.each(SAMPLE_ANNOTATIONS)(
    "restores $id with its own parent and no note Item",
    async (sample) => {
      using session = new NativeExplorerSession(deps);
      session.setTarget(null, "annotation", sample.id);
      await session.ready;
      expect(session.state.getState()).toMatchObject({
        item: null,
        status: "ready",
        annotationId: sample.id,
        annotations: [],
        data: {
          type: sample.root.type,
          parentItem: { title: "Designing reproducible research interfaces" },
        },
      });
      const data = session.state.getState().data!;
      const parent = data.parentItem as {
        noteLink: () => string | null;
        toString: () => string;
      };
      expect(String(parent)).toBe("Designing reproducible research interfaces");
      expect(parent.noteLink()).toBeNull();
      expect(data.dateAdded).toBeInstanceOf(Temporal.Instant);
      expect(loadTemplateData).not.toHaveBeenCalled();
    },
  );

  it("keeps the annotation's parent while separately loading real Item choices", async () => {
    const pending = Promise.withResolvers<TemplateDataLoadResult>();
    vi.mocked(loadTemplateData).mockReturnValue(pending.promise);
    using session = new NativeExplorerSession(deps);
    session.setTarget(real, "annotation", "example:highlight");
    expect(session.state.getState().status).toBe("ready");
    pending.resolve({
      kind: "data",
      data: {
        title: "Real paper",
        annotations: [{ key: "ANNA2345", text: "Real evidence" }],
      },
    });
    await session.ready;
    expect(session.state.getState().data?.parentItem).toMatchObject({
      title: "Designing reproducible research interfaces",
    });
    expect(session.state.getState().annotations).toEqual([
      { id: "ANNA2345", root: { key: "ANNA2345", text: "Real evidence" } },
    ]);
    expect(loadTemplateData).toHaveBeenCalledExactlyOnceWith(
      deps,
      "MAIN2345",
      "note",
    );
  });

  it("keeps the built-in ready when the selected real Item is unavailable", async () => {
    vi.mocked(loadTemplateData).mockRejectedValue(
      new Error("Database offline"),
    );
    using session = new NativeExplorerSession(deps);
    session.setTarget(real, "annotation", "example:underline");
    await session.ready;
    expect(session.state.getState()).toMatchObject({
      status: "ready",
      error: null,
      data: { text: "Report the assumptions behind each result." },
    });
  });

  it("restores a sample Item's annotation from canonical and saved bare-key selections", async () => {
    const snapshot = getSampleItem(paper.id)!;
    const id = '["sample:conference-paper","CNPAN26A"]';
    expect(annotationSamples(snapshot, null).current[0]?.id).toBe(id);
    using session = new NativeExplorerSession(deps);
    for (const annotationId of [id, "CNPAN26A"]) {
      session.setTarget(paper, "annotation", annotationId);
      await session.ready;
      expect(session.state.getState()).toMatchObject({
        item: paper,
        annotationId,
        status: "ready",
        data: {
          text: "A reproducible interface makes its inputs and outputs inspectable.",
        },
      });
      expect(session.state.getState().annotations?.[0]?.id).toBe(id);
    }
    expect(loadTemplateData).not.toHaveBeenCalled();
  });

  it("keeps empty, missing sample, and missing annotation selections distinct", async () => {
    using session = new NativeExplorerSession(deps);
    session.setTarget(null, "note");
    await session.ready;
    expect(session.state.getState()).toMatchObject({
      status: "no-item",
      data: null,
    });
    session.setTarget({ id: "sample:removed", title: null }, "note");
    await session.ready;
    expect(session.state.getState()).toMatchObject({
      status: "error",
      data: null,
    });
    session.setTarget(paper, "annotation");
    await session.ready;
    expect(session.state.getState()).toMatchObject({
      status: "empty",
      data: null,
    });
    session.setTarget(paper, "annotation", "MISS2345");
    await session.ready;
    expect(session.state.getState()).toMatchObject({
      status: "error",
      data: null,
    });
    expect(loadTemplateData).not.toHaveBeenCalled();
  });

  it.each(["resolve", "reject"] as const)(
    "discards an older real load that later %ss",
    async (outcome) => {
      const pending = Promise.withResolvers<TemplateDataLoadResult>();
      vi.mocked(loadTemplateData).mockReturnValue(pending.promise);
      using session = new NativeExplorerSession(deps);
      session.setTarget(real, "annotation", "ANNA2345");
      const firstRead = session.ready;
      session.setTarget(paper, "annotation", "example:note");
      await session.ready;
      if (outcome === "resolve")
        pending.resolve({
          kind: "data",
          data: { title: "Old paper", annotations: [{ key: "OLD23456" }] },
        });
      else pending.reject(new Error("Old read failed"));
      await firstRead;
      expect(session.state.getState()).toMatchObject({
        item: paper,
        annotationId: "example:note",
        status: "ready",
        error: null,
        data: { type: "note" },
      });
      expect(session.state.getState().annotations?.map(({ id }) => id)).toEqual(
        ['["sample:conference-paper","CNPAN26A"]'],
      );
    },
  );

  it("follows annotation selection while preserving independently browsed roots", async () => {
    const context: ProfileAuthoringContext = {
      leaf: {} as WorkspaceLeaf,
      path: "profiles/paper.md",
      item: paper,
      root: "note",
      tab: "note",
      advanced: false,
      annotationId: null,
    };
    using annotation = new NativeExplorerSession(deps);
    using note = new NativeExplorerSession(deps);
    annotation.setContext(context);
    note.setContext(context);
    await Promise.all([annotation.ready, note.ready]);
    annotation.setTarget(paper, "annotation", "example:highlight");
    await annotation.ready;
    const next = { ...context, annotationId: "example:underline" };
    annotation.setContext(next);
    note.setContext(next);
    await Promise.all([annotation.ready, note.ready]);
    expect(annotation.state.getState()).toMatchObject({
      root: "annotation",
      annotationId: "example:underline",
      data: { type: "underline" },
    });
    expect(note.state.getState()).toMatchObject({
      root: "note",
      annotationId: null,
      data: { title: "Designing reproducible research interfaces" },
    });
    annotation.setContext({ ...next, advanced: true });
    expect(annotation.state.getState().root).toBe("annotation");
  });
});
