// @vitest-environment happy-dom
import { Effect } from "effect";
import type { HoverParent, MetadataCache, Workspace } from "obsidian";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { testEvents } from "@/lib/__fixtures__/event-stream";
import { MemoryVault } from "@/lib/__fixtures__/obsidian-vault";
import { stubService } from "@/lib/__fixtures__/service-stub";
import { effectBridge } from "@/lib/effect-bridge";
import * as m from "@/lib/i18n/generated/messages";
import { lookupAnswer } from "@/services/citation-index/__fixtures__/lookup";
import { NO_ADDITIONS } from "@/services/graph-citations/adapter";
import { wrapNodeHover } from "@/services/graph-citations/hover";
import type { GraphLeafMembers } from "@/services/graph-citations/install";
import type {
  BibliographyRenderOutcome,
  BibliographyRenderResult,
} from "@/services/pandoc/render-cache";
import { profileReader } from "@/services/profile/__fixtures__/reader";
import { defaults } from "@/services/settings/schema";
import type { PluginSettings } from "@/services/settings/service";
import {
  inProcessReadsService,
  memoryOpener,
  seedWorksSql,
  withState,
} from "@/services/zotero-reads/test-utils";

import { citationPopoverFixture } from "./__fixtures__";
import type { WorkHoverRequest } from "./service";

/** Every reads stand-in a test opened, disposed after it. */
const opened: AsyncDisposable[] = [];
afterEach(async () => {
  for (const reads of opened.splice(0)) await reads[Symbol.asyncDispose]();
});

/** The works a hover can show, as Zotero holds them. */
const WORKS_SQL = seedWorksSql([
  { itemID: 1, key: "ABCD2345", title: "Alpha" },
  { itemID: 2, key: "BCDE3456", title: "Beta" },
]);

/** ZoteroReads on the in-process adapter over the seeded works. */
function reads() {
  const service = inProcessReadsService(memoryOpener(() => WORKS_SQL).open);
  opened.push(service);
  return withState(service, "ready");
}

function harness() {
  const parent: HoverParent = { hoverPopover: null };
  const targets = document.body.appendChild(document.createElement("div"));
  const first = targets.appendChild(document.createElement("span"));
  const second = targets.appendChild(document.createElement("span"));
  const events = testEvents<Record<string, () => void>>([
    "changed",
    "status-changed",
    "invalidated",
  ]);

  const render = vi.fn<() => Promise<BibliographyRenderOutcome>>(async () => ({
    kind: "unavailable",
    reason: "engine-absent",
  }));
  const readBibliography = vi.fn<
    (
      items: unknown,
      options: { signal: AbortSignal },
    ) => Promise<BibliographyRenderResult | null>
  >(async () => null);
  const open = vi.fn();
  /** The signal of every document-text read a visit started, in order. */
  const textReads: AbortSignal[] = [];
  const db = reads();
  const popover = citationPopoverFixture({
    host: {
      vault: MemoryVault.with({ getFileByPath: (path: string) => ({ path }) }),
    },
    db,
    citationLookup: {
      read: async ({ citekeys = [] }: { citekeys?: readonly string[] }) =>
        lookupAnswer(
          Object.fromEntries(citekeys.map((key) => [key, { kind: "missing" }])),
        ),
      status: "fresh",
      ...events.streams,
    },
    citationIndex: {
      getDocumentCitationSet: async (
        _file: unknown,
        { include }: { include?: { citekeys?: readonly string[] } },
      ) => ({
        lookup: lookupAnswer(
          Object.fromEntries(
            (include?.citekeys ?? []).map((key) => [key, { kind: "missing" }]),
          ),
        ),
        occurrences: [],
        citations: [],
        errors: [],
      }),
    },
    citationText: {
      // One read that never settles on its own, so a visit that ends while it
      // runs is what releases the wait.
      read: (_path: string, { signal }: { signal: AbortSignal }) => {
        textReads.push(signal);
        return new Promise<never>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason));
        });
      },
    },
    libraryScope: { current: [] },
    profile: profileReader(),
    bibliographyRender: {
      ...events.streams,
      render,
      readBibliography,
      vaultPresentation: { styleId: null, locale: null },
    },
  });
  const { service, runtime } = popover;
  const bridge = effectBridge(runtime);
  return {
    parent,
    first,
    second,
    targets,
    service,
    bridge,
    render,
    readBibliography,
    open,
    events,
    textReads,
    async show(
      work: string | WorkHoverRequest["work"],
      targetEl = first,
      owner = parent,
    ) {
      await db.ready;
      await act(async () => {
        await runtime.runPromise(
          service.showWork({
            event: new MouseEvent("mouseover"),
            hoverParent: owner,
            targetEl,
            work:
              typeof work === "string"
                ? { kind: "citekey", citekey: work }
                : work,
            open,
          }),
        );
      });
    },
    showDocument(request: Parameters<typeof service.show>[0]): void {
      bridge.runSync(service.show(request));
    },
    hide(parent: HoverParent, targetEl?: HTMLElement): void {
      bridge.runSync(service.hide(parent, targetEl));
    },
    async close(): Promise<void> {
      await popover[Symbol.asyncDispose]();
    },
    async [Symbol.asyncDispose]() {
      await act(async () => {
        await popover[Symbol.asyncDispose]();
      });
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
    await run.close();
    await vi.advanceTimersByTimeAsync(1000);
    expect(run.parent.hoverPopover).toBeNull();
    expect(document.querySelector(".zt-citation-popover")).toBeNull();
    expect(run.events.subscribers("invalidated")).toBe(0);
    expect(run.events.subscribers("changed")).toBe(0);
  });

  it("releases the previous document's subscriptions when showing a graph work", async () => {
    await using run = harness();
    run.showDocument({
      event: new MouseEvent("mouseover"),
      hoverParent: run.parent,
      targetEl: run.first,
      sourcePath: "Draft.md",
      works: [{ citekey: "alpha" }],
      open: run.open,
    });
    await run.show("beta", run.second);
    await vi.advanceTimersByTimeAsync(300);
    expect(run.parent.hoverPopover!.hoverEl.textContent).toBe(
      m.references_citekey_unresolved({ citekey: "beta" }),
    );
    expect(run.events.subscribers("invalidated")).toBe(1);
    await run.show({ kind: "item", indexedKey: "ABCD2345" });
    expect(run.events.subscribers("changed")).toBe(0);
    expect(run.events.subscribers("status-changed")).toBe(0);
  });

  it("keeps the newest work and actions when earlier formatting finishes last", async () => {
    await using run = harness();
    const old = Promise.withResolvers<BibliographyRenderResult | null>();
    const next = Promise.withResolvers<BibliographyRenderResult | null>();
    await run.show({ kind: "item", indexedKey: "ABCD2345" });
    await vi.advanceTimersByTimeAsync(300);
    const card = run.parent.hoverPopover!.hoverEl;
    expect(card.textContent).toContain("Alpha");

    run.readBibliography.mockReturnValueOnce(old.promise);
    run.events.emit("invalidated");
    // The redraw's database read settles on the runtime's clock; the stale
    // formatting is in flight once it does.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(run.readBibliography).toHaveBeenCalledTimes(2);
    run.readBibliography.mockReturnValueOnce(next.promise);
    const showing = run.show(
      { kind: "item", indexedKey: "BCDE3456" },
      run.second,
    );
    await vi.waitFor(() => expect(card.textContent).not.toContain("Alpha"));
    expect(card.textContent).not.toContain("Alpha");
    expect(card.querySelector('[role="button"]')).toBeNull();
    await act(async () => {
      next.resolve(null);
    });
    await showing;
    await act(async () => {
      old.reject(new Error("Stale render failed"));
    });
    // The newest work's database read settles on the runtime's clock.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(run.parent.hoverPopover!.hoverEl).toBe(card);
    expect(card.textContent).toContain("Beta");
    expect(card.textContent).not.toContain("Alpha");
    const openNote = card.querySelector<HTMLElement>(
      '[data-citation-popover-actions] [role="button"]',
    )!;
    await act(() => openNote.click());
    // The action reads the Item again first, so it lands once that read does.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(run.open).toHaveBeenCalledWith("BCDE3456", false);
    expect(run.parent.hoverPopover).toBeNull();
  });

  it("interrupts the read in flight when a redraw starts the next read", async () => {
    await using run = harness();
    await act(() =>
      run.showDocument({
        event: new MouseEvent("mouseover"),
        hoverParent: run.parent,
        targetEl: run.first,
        sourcePath: "Draft.md",
        works: [{ citekey: "alpha" }],
        open: run.open,
      }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(run.textReads).toHaveLength(1);

    await act(async () => {
      run.events.emit("invalidated");
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(run.textReads).toHaveLength(2);
    expect(run.textReads[0]!.aborted).toBe(true);
    expect(run.textReads[1]!.aborted).toBe(false);
    // The interrupted read draws nothing, not even a failure.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(run.parent.hoverPopover!.hoverEl.textContent).toBe("");
  });

  it("interrupts the read of a work when its popover hides", async () => {
    await using run = harness();
    const signals: AbortSignal[] = [];
    run.readBibliography.mockImplementationOnce(
      (_items, { signal }) =>
        new Promise((_resolve, reject) => {
          signals.push(signal);
          signal.addEventListener("abort", () => reject(signal.reason));
        }),
    );
    const showing = run.show({ kind: "item", indexedKey: "ABCD2345" });
    await vi.waitFor(() => expect(signals).toHaveLength(1));
    expect(signals[0]!.aborted).toBe(false);

    await act(async () => {
      run.hide(run.parent);
    });
    await showing;

    expect(signals[0]!.aborted).toBe(true);
    // The interrupted read draws nothing: no card opens again.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(run.parent.hoverPopover).toBeNull();
    expect(document.querySelector(".zt-citation-popover")).toBeNull();
  });

  it("interrupts the read of a document citation when its popover hides", async () => {
    await using run = harness();
    await act(() =>
      run.showDocument({
        event: new MouseEvent("mouseover"),
        hoverParent: run.parent,
        targetEl: run.first,
        sourcePath: "Draft.md",
        works: [{ citekey: "alpha" }],
        open: run.open,
      }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(run.textReads).toHaveLength(1);

    await act(async () => {
      run.hide(run.parent);
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(run.textReads[0]!.aborted).toBe(true);
    // The interrupted read draws nothing: no card opens again.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(run.parent.hoverPopover).toBeNull();
    expect(document.querySelector(".zt-citation-popover")).toBeNull();
  });

  it.each(["retarget", "hide", "unload"] as const)(
    "releases a pending document-text wait on %s",
    async (action) => {
      await using run = harness();
      await act(() =>
        run.showDocument({
          event: new MouseEvent("mouseover"),
          hoverParent: run.parent,
          targetEl: run.first,
          sourcePath: "Draft.md",
          works: [{ citekey: "alpha" }],
          open: run.open,
        }),
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(run.textReads).toHaveLength(1);
      expect(run.textReads[0]!.aborted).toBe(false);

      await act(async () => {
        if (action === "retarget") await run.show("beta", run.second);
        else if (action === "hide") run.hide(run.parent);
        else await run.close();
      });

      await vi.advanceTimersByTimeAsync(0);
      expect(run.textReads[0]!.aborted).toBe(true);
    },
  );

  // A visit closed before its delay never showed a card; a later close has one to detach.
  it.each([
    ["close", 0, false],
    ["close", 300, true],
    ["remove", 0, false],
    ["remove", 300, true],
    ["disable", 0, false],
    ["disable", 300, true],
  ] as const)(
    "closes a graph visit on %s after %i ms",
    async (action, wait, shown) => {
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
        Object.assign(stubService<GraphLeafMembers>("GraphLeafMembers", {}), {
          engine,
          renderer,
          viewType: "graph",
        }),
        {
          workspace: stubService<Pick<Workspace, "trigger">>("Workspace", {}),
          metadataCache: stubService<Pick<MetadataCache, "getCache">>(
            "MetadataCache",
            {},
          ),
          settings: stubService<Pick<PluginSettings["Service"], "current">>(
            "PluginSettings",
            {
              current: Effect.succeed({
                ...defaults,
                "citation.hover-action": "popover",
              }),
            },
          ),
          citationPopover: run.service,
          bridge: run.bridge,
          open: run.open,
        },
        () => ({
          ...NO_ADDITIONS,
          citedWorkNodes: new Map([["alpha", "alpha"]]),
        }),
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
      expect(card !== undefined).toBe(shown);

      if (action === "close") installed[Symbol.dispose]();
      else {
        if (action === "disable")
          engine.options["zotlit-citation-popover"] = false;
        renderer.setData({
          nodes: action === "remove" ? {} : { alpha: { type: "unresolved" } },
          links: {},
        });
      }

      expect(card?.isConnected ?? false).toBe(false);
      expect(engine.hoverPopover).toBeNull();
      await vi.advanceTimersByTimeAsync(1000);
      expect(document.querySelector(".zt-citation-popover")).toBeNull();
    },
  );
});
