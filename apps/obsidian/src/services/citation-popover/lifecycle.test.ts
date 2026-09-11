// @vitest-environment happy-dom
import type { HoverParent, TFile } from "obsidian";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getItemsByKey } from "@zotlit/db";
import { makeItem } from "@zotlit/item-lookup/fixtures";

import * as m from "@/lib/i18n/generated/messages";
import { wrapNodeHover } from "@/services/graph-citations/hover";
import type { GraphLeafMembers } from "@/services/graph-citations/install";
import type { BibliographyRenderOutcome } from "@/services/pandoc/render-cache";
import { profileReader } from "@/services/profile/__fixtures__/reader";

import { CitationPopover } from "./service";
import type { WorkHoverRequest } from "./service";

vi.mock("@zotlit/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@zotlit/db")>()),
  getZoteroIdentity: () => ({
    userID: null,
    localUserKey: null,
    username: null,
  }),
  getItemsByKey: vi.fn(() => []),
  getAttachmentsByParents: () => [],
}));

function harness() {
  const parent: HoverParent = { hoverPopover: null };
  const targets = document.body.appendChild(document.createElement("div"));
  const first = targets.appendChild(document.createElement("span"));
  const second = targets.appendChild(document.createElement("span"));
  const listeners = new Map<string, Set<() => void>>();
  const on = (event: string, listener: () => void) => {
    const group = listeners.get(event) ?? new Set();
    listeners.set(event, group);
    group.add(listener);
    return () => {
      group.delete(listener);
    };
  };
  const metadata = new Map<string, Set<(file: TFile) => void>>();
  const render = vi.fn<() => Promise<BibliographyRenderOutcome>>(async () => ({
    kind: "unavailable",
    reason: "engine-absent",
  }));
  const open = vi.fn();
  const service = new CitationPopover({
    app: {
      vault: { getFileByPath: (path: string) => ({ path }) },
      metadataCache: {
        getFileCache: () => null,
        on(event: string, listener: (file: TFile) => void) {
          const group = metadata.get(event) ?? new Set();
          metadata.set(event, group);
          group.add(listener);
          return { e: { offref: () => group.delete(listener) } };
        },
      },
    },
    db: { state: "ready", client: {} },
    citationIndex: {
      resolveCitekey: () => ({ kind: "missing" }),
      on,
      getDocumentCitationSet: async () => ({
        occurrences: [],
        citations: [],
        errors: [],
      }),
    },
    citationText: {
      peek: () => null,
      on: (event: string, listener: () => void) =>
        on(`text-${event}`, listener),
    },
    libraryScope: { current: [] },
    profile: profileReader(),
    bibliographyRender: {
      on,
      render,
      vaultPresentation: { styleId: null, locale: null },
    },
  } as never);
  return {
    parent,
    first,
    second,
    targets,
    service,
    render,
    open,
    listeners,
    metadata,
    async show(
      work: string | WorkHoverRequest["work"],
      targetEl = first,
      owner = parent,
    ) {
      await act(async () => {
        service.showWork({
          event: new MouseEvent("mouseover"),
          hoverParent: owner,
          targetEl,
          work:
            typeof work === "string"
              ? { kind: "citekey", citekey: work }
              : work,
          open,
        });
      });
    },
    async [Symbol.asyncDispose]() {
      await act(() => service[Symbol.asyncDispose]());
      targets.remove();
    },
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.runAllTimers();
  vi.useRealTimers();
});

describe("Citation Popover visits", () => {
  it("keeps the visible card mounted when the hovered work changes", async () => {
    await using run = harness();
    await run.show("alpha");
    await vi.advanceTimersByTimeAsync(300);
    const card = run.parent.hoverPopover!.hoverEl;

    await run.show("beta", run.second);

    expect(run.parent.hoverPopover!.hoverEl).toBe(card);
    expect(card.isConnected).toBe(true);
    expect(card.textContent).toBe(
      m.references_citekey_unresolved({ citekey: "beta" }),
    );
    await vi.advanceTimersByTimeAsync(300);
    expect(run.parent.hoverPopover!.hoverEl).toBe(card);
    expect(document.querySelectorAll(".zt-citation-popover")).toHaveLength(1);
  });

  it("keeps the first opening deadline while switching pending targets", async () => {
    await using run = harness();
    await run.show("alpha");
    await vi.advanceTimersByTimeAsync(200);
    await run.show("beta", run.second);
    await vi.advanceTimersByTimeAsync(100);
    const card = run.parent.hoverPopover!.hoverEl;
    expect(card.textContent).toBe(
      m.references_citekey_unresolved({ citekey: "beta" }),
    );
    await vi.advanceTimersByTimeAsync(300);
    expect(run.parent.hoverPopover!.hoverEl).toBe(card);
  });

  it("keeps the card open through a pending close and entry into its content", async () => {
    await using run = harness();
    await run.show("alpha");
    await vi.advanceTimersByTimeAsync(300);
    const card = run.parent.hoverPopover!.hoverEl;
    run.first.dispatchEvent(new MouseEvent("mouseout"));
    await vi.advanceTimersByTimeAsync(200);
    await run.show("beta", run.second);
    run.second.dispatchEvent(
      new MouseEvent("mouseout", { relatedTarget: card }),
    );
    card.dispatchEvent(
      new MouseEvent("mouseover", { relatedTarget: run.second }),
    );
    await vi.advanceTimersByTimeAsync(400);
    expect(card.isConnected).toBe(true);
    card.dispatchEvent(new MouseEvent("mouseout"));
    await vi.advanceTimersByTimeAsync(300);
    expect(run.parent.hoverPopover).toBeNull();
    expect(card.isConnected).toBe(false);
  });

  it("isolates owners and replaces a visit after its target moves to another window", async () => {
    await using run = harness();
    const other: HoverParent = { hoverPopover: null };
    await run.show("alpha");
    await run.show("beta", run.second, other);
    await vi.advanceTimersByTimeAsync(300);
    const firstCard = run.parent.hoverPopover!.hoverEl;
    const otherCard = other.hoverPopover!.hoverEl;
    expect(otherCard).not.toBe(firstCard);

    // Simulate the same DOM target being adopted into a different owner window.
    Object.defineProperty(run.first, "win", { value: {}, configurable: true });
    await run.show("gamma");
    expect(firstCard.isConnected).toBe(false);
    expect(otherCard.isConnected).toBe(true);
    await vi.advanceTimersByTimeAsync(300);
    expect(run.parent.hoverPopover!.hoverEl).not.toBe(firstCard);
    expect(run.parent.hoverPopover!.hoverEl.textContent).toBe(
      m.references_citekey_unresolved({ citekey: "gamma" }),
    );
  });

  it("cancels pending cards and subscriptions on service unload", async () => {
    await using run = harness();
    await run.show("alpha");
    await run.service[Symbol.asyncDispose]();
    await vi.advanceTimersByTimeAsync(1000);
    expect(run.parent.hoverPopover).toBeNull();
    expect(document.querySelector(".zt-citation-popover")).toBeNull();
    expect(run.listeners.get("invalidated")?.size).toBe(0);
    expect(run.listeners.get("resolution-changed")?.size).toBe(0);
  });

  it("releases the previous document's subscriptions when showing a graph work", async () => {
    await using run = harness();
    run.service.show({
      event: new MouseEvent("mouseover"),
      hoverParent: run.parent,
      targetEl: run.first,
      sourcePath: "Draft.md",
      works: [{ citekey: "alpha" }],
      open: run.open,
    });
    await run.show("beta", run.second);
    await vi.advanceTimersByTimeAsync(300);
    for (const listener of run.metadata.get("deleted") ?? [])
      listener({ path: "Draft.md" } as TFile);
    expect(run.parent.hoverPopover!.hoverEl.textContent).toBe(
      m.references_citekey_unresolved({ citekey: "beta" }),
    );
    expect(run.metadata.get("deleted")?.size).toBe(0);
    expect(run.metadata.get("changed")?.size).toBe(0);
    expect(run.listeners.get("invalidated")?.size).toBe(1);
    await run.show({ kind: "item", indexedKey: "ABCD2345" });
    expect(run.listeners.get("resolution-changed")?.size).toBe(0);
  });

  it("keeps the newest work and actions when earlier formatting finishes last", async () => {
    await using run = harness();
    const old = Promise.withResolvers<BibliographyRenderOutcome>();
    const next = Promise.withResolvers<BibliographyRenderOutcome>();
    vi.mocked(getItemsByKey).mockReturnValue([
      makeItem({ key: "ABCD2345", title: "Alpha" }),
    ]);
    await run.show({ kind: "item", indexedKey: "ABCD2345" });
    await vi.advanceTimersByTimeAsync(300);
    const card = run.parent.hoverPopover!.hoverEl;
    expect(card.textContent).toContain("Alpha");

    run.render.mockReturnValueOnce(old.promise);
    for (const listener of run.listeners.get("invalidated") ?? []) listener();
    await act(async () => {});
    run.render.mockReturnValueOnce(next.promise);
    vi.mocked(getItemsByKey).mockReturnValue([
      makeItem({ key: "BCDE3456", title: "Beta" }),
    ]);
    await run.show({ kind: "item", indexedKey: "BCDE3456" }, run.second);
    expect(card.textContent).not.toContain("Alpha");
    expect(card.querySelector('[role="button"]')).toBeNull();
    await act(async () => {
      next.resolve({ kind: "unavailable", reason: "engine-absent" });
    });
    await act(async () => {
      old.reject(new Error("Stale render failed"));
    });
    expect(run.parent.hoverPopover!.hoverEl).toBe(card);
    expect(card.textContent).toContain("Beta");
    expect(card.textContent).not.toContain("Alpha");
    const openNote = card.querySelector<HTMLElement>(
      '[data-citation-popover-actions] [role="button"]',
    )!;
    await act(() => openNote.click());
    expect(run.open).toHaveBeenCalledWith("BCDE3456", false);
    expect(run.parent.hoverPopover).toBeNull();
  });

  it.each(["retarget", "hide", "unload"] as const)(
    "releases a pending document-text wait on %s",
    async (action) => {
      await using run = harness();
      await act(() =>
        run.service.show({
          event: new MouseEvent("mouseover"),
          hoverParent: run.parent,
          targetEl: run.first,
          sourcePath: "Draft.md",
          works: [{ citekey: "alpha" }],
          open: run.open,
        }),
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(run.listeners.get("text-changed")?.size).toBe(1);

      await act(async () => {
        if (action === "retarget") await run.show("beta", run.second);
        else if (action === "hide") run.service.hide(run.parent);
        else await run.service[Symbol.asyncDispose]();
      });

      await vi.advanceTimersByTimeAsync(0);
      expect(run.listeners.get("text-changed")?.size).toBe(0);
      expect(run.listeners.get("text-invalidated")?.size).toBe(0);
      expect(run.listeners.get("text-settled")?.size).toBe(0);
    },
  );

  it.each([
    ["close", 0],
    ["close", 300],
    ["remove", 0],
    ["remove", 300],
    ["disable", 0],
    ["disable", 300],
  ] as const)(
    "closes a graph visit on %s after %i ms",
    async (action, wait) => {
      await using run = harness();
      const engine = Object.assign(run.parent, {
        options: { "zotlit-citation-popover": true },
      });
      const renderer = {
        containerEl: run.targets,
        nodeLookup: { alpha: { x: 20, y: 30 } },
        scale: 1,
        panX: 0,
        panY: 0,
        onNodeHover: (_event: MouseEvent, _id: string, _type: string) => {},
        onNodeUnhover: () => {},
        setData: (_data: unknown) => {},
      };
      using installed = wrapNodeHover(
        { engine, renderer } as unknown as GraphLeafMembers,
        {
          app: {} as never,
          settings: {
            current: { "citation.hover-action": "popover" },
          } as never,
          citationPopover: run.service,
          open: run.open,
        },
        () => ({ citedWorkNodes: new Map([["alpha", "alpha"]]) }) as never,
      );
      await act(() =>
        renderer.onNodeHover(
          new MouseEvent("mouseover"),
          "alpha",
          "unresolved",
        ),
      );
      await vi.advanceTimersByTimeAsync(wait);
      const card = engine.hoverPopover?.hoverEl;

      if (action === "close") installed[Symbol.dispose]();
      else {
        if (action === "disable")
          engine.options["zotlit-citation-popover"] = false;
        renderer.setData({
          nodes: action === "remove" ? {} : { alpha: { type: "unresolved" } },
          links: {},
        });
      }

      if (card) expect(card.isConnected).toBe(false);
      expect(engine.hoverPopover).toBeNull();
      await vi.advanceTimersByTimeAsync(1000);
      expect(document.querySelector(".zt-citation-popover")).toBeNull();
    },
  );
});
