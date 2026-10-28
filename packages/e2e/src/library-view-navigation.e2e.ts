import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { WorkspaceLeaf, MarkdownView, FileView } from "obsidian";
import { describe, expect, it } from "vitest";

import {
  ATTACHMENTS,
  COLLECTIONS,
  ITEMS,
  LIBRARIES,
  LIBRARY_SCOPE_SETTING_KEY,
} from "@zotlit/scripts/fixture";
import type { FixtureItem } from "@zotlit/scripts/fixture";

import type { AnnotationView as AnnotView } from "@/views/annot-view/view";
import type { LibraryView } from "@/views/library/view";
import type { QueryFileView } from "@/views/query-view/file-view";

import { reachable } from "./e2e-run-fixture.ts";
import {
  MY_LIBRARY_DOCUMENT,
  annotationAttachment,
  annotationItem,
  booksProfile,
  booksProfileTargetItem,
  e2eFixture,
  positionDocumentItem,
  readingState,
  workspaceRoot,
} from "./e2e-run-fixture.ts";
import { activeTab, pdfOpened, unreadOf } from "./e2e-run-helpers.ts";
import type { ActiveTab } from "./e2e-run-helpers.ts";
import { registerEndToEndRunHooks, run } from "./e2e-run-lifecycle.ts";
import {
  pressPromptKey,
  selectItemSuggestion,
  selectSuggestion,
} from "./e2e-run-note-helpers.ts";
import * as suite from "./e2e-run-suite-helpers.ts";
import { obRun, obRunUntil } from "./obsidian-cli.ts";
import { clearNotices, cli, readUntil, waitFor } from "./obsidian-cli.ts";
import type {
  LibraryTabs,
  LibraryWorkerMessage,
} from "./page-library-types.ts";
import type {} from "./page-library-types.ts";

describe.skipIf(!reachable)("End-to-end Run", () => {
  registerEndToEndRunHooks();

  it("swaps the Reading Card from one paper to the next in one step, by the arrow keys and by a click, beside a wide list and over a narrow one, with its Annotations closed and open, whether ZotLit Query answers at once or late, with Zotero closed", async () => {
    const snapshot = await obRun(
      run.vaultId,
      async ({ app, zotlit }) => {
        return JSON.stringify({
          layout: app.workspace.getLayout(),
          document:
            zotlit.services.bridge.runSync(zotlit.services.settings.current)[
              "library.document"
            ] ?? null,
        });
      },
      undefined,
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obRun(
        run.vaultId,
        async ({ app, zotlit, page }, { snapshot }) => {
          delete page.scratch.zotlitE2EBeside;
          const saved = JSON.parse(snapshot);
          const { settings, bridge } = zotlit.services;
          bridge.runSync(
            settings.update({ "library.document": saved.document }),
          );
          await bridge.runPromise(settings.flush);
          await app.workspace.changeLayout(saved.layout);
        },
        { snapshot: snapshot },
      );
    });
    await suite.wideWindow(cleanup);
    await obRun(
      run.vaultId,
      async ({ app, zotlit, page }, { myLibraryDocument }) => {
        const { until } = page;
        (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        ).forEach((leaf) => leaf.detach());
        const { settings, bridge } = zotlit.services;
        bridge.runSync(
          settings.update({ "library.document": myLibraryDocument }),
        );
        await bridge.runPromise(settings.flush);
        app.commands.executeCommandById("zotlit:open-library-view");
        await until(
          "library",
          () =>
            (
              app.workspace.getLeavesOfType(
                "zotlit-library",
              ) as (WorkspaceLeaf & { view: LibraryView })[]
            )[0],
          10000,
        );
      },
      { myLibraryDocument: MY_LIBRARY_DOCUMENT },
    );

    interface Frame {
      /** The title's text; `null` with no title element. */
      title: string | null;
      /** The top of the Open PDF button, from the card's top; `null` with no button. */
      top: number | null;
      /** The keys of the Annotation Cards drawn. */
      cards: string[];
      /** Whether the card shows at all. */
      shown: boolean;
    }
    interface Switch {
      from: string;
      to: string;
      /** The card just before the switch, then as each animation frame draws it. */
      frames: Frame[];
      /** The title's text after each batch of mutations of the card. */
      mutations: (string | null)[];
      /** Card item reads sent after the worker delay elapsed. */
      delayedCards: number;
    }
    /**
     * Select the row `from`, or none for `null`, wait for its card, then move
     * the selection to the row `to` by `how`: the arrow key, a click, or the selection set
     * as "Show in Library" sets it, with each ZotLit Query worker request held
     * `delay` ms first. This reaches both native card reads and the embedded
     * Query View. Read each frame the window draws until half a second after
     * that.
     */
    const switchCard = async (
      how: "key" | "click" | "show",
      [from, to]: readonly [string | null, string],
      delay: number,
    ) => {
      const step = (await obRun(
        run.vaultId,
        async (
          { app, page },
          { toInput, fromInput, condition, delay, how },
        ) => {
          const { press, until } = page;
          const leaf = (
            app.workspace.getLeavesOfType(
              "zotlit-library",
            ) as (WorkspaceLeaf & { view: LibraryView })[]
          )[0];
          const view = leaf!.view;
          await app.workspace.revealLeaf(leaf!);
          app.workspace.setActiveLeaf(leaf!, { focus: true });
          await view.query.settled;
          const el = view.contentEl;
          const card = el.querySelector<HTMLElement>("[data-library-card]");
          const row = (key: string) =>
            el.querySelector<HTMLElement>(`[data-query-item-row="${key}"]`);
          const frame = () => new Promise((r) => requestAnimationFrame(r));
          const title = () =>
            card!.querySelector<HTMLElement>("[data-library-card-title]");
          await until("rows", () => row(toInput), 10000);
          if (condition) {
            view.card.registry.set(view.model.selection, {
              key: null,
              card: false,
            });
            await until("no card", () => !card!.checkVisibility(), 10000);
            await view.card.settled;
            await frame();
            await frame();
          } else {
            view.card.registry.set(view.model.selection, {
              key: fromInput,
              card: true,
            });
            await until(
              "card",
              () => card!.checkVisibility() && title()?.textContent,
              10000,
            );
            await view.card.settled;
            await frame();
            await frame();
            row(fromInput!)!.focus({ preventScroll: true });
          }
          const sample = () => {
            const button = card!.querySelector<HTMLElement>(
              '[data-library-card-action="pdf"]',
            );
            const box = card!.getBoundingClientRect();
            return {
              title: title() ? title()!.textContent : null,
              top:
                button && card!.checkVisibility()
                  ? Math.round(button.getBoundingClientRect().top - box.top)
                  : null,
              cards: [
                ...card!.querySelectorAll<HTMLElement>(
                  ".zt-annot-card[data-zotero-annotation-key]",
                ),
              ].map((n) => n.getAttribute("data-zotero-annotation-key")!),
              shown: card!.checkVisibility(),
            };
          };
          const mutations: Switch["mutations"] = [];
          const observer = new MutationObserver(() =>
            mutations.push(title() ? title()!.textContent : null),
          );
          observer.observe(card!, {
            childList: true,
            subtree: true,
            characterData: true,
          });
          const frames = [sample()];
          // oxlint-disable-next-line typescript/unbound-method -- Restored unchanged and called with the original worker receiver.
          const post = Worker.prototype.postMessage;
          const pending = new Map<ReturnType<typeof setTimeout>, () => void>();
          let delayedCards = 0;
          if (delay > 0)
            Worker.prototype.postMessage = new Proxy(post, {
              apply: (
                postTarget,
                receiver: Worker,
                args: Parameters<Worker["postMessage"]>,
              ) => {
                const request = (args[0] as LibraryWorkerMessage)?.[1];
                const query =
                  request?.tag === "ItemQuery" && "view" in request.payload.job
                    ? request.payload.job.view
                    : null;
                const target = toInput;
                if (
                  !query ||
                  !(
                    (query.from === "items" &&
                      query.limit === 1 &&
                      query.filter ===
                        `${JSON.stringify([target])}.contains(indexedKey)`) ||
                    (query.from === "annotations" &&
                      query.context?.item === target)
                  )
                )
                  return Reflect.apply(postTarget, receiver, args);
                const worker = receiver;
                const send = () => Reflect.apply(postTarget, worker, args);
                const timer = setTimeout(() => {
                  pending.delete(timer);
                  if (query.from === "items" && query.limit === 1)
                    delayedCards++;
                  send();
                }, delay);
                pending.set(timer, send);
              },
            });
          try {
            if (how === "key") {
              activeDocument.activeElement!.dispatchEvent(
                new KeyboardEvent("keydown", {
                  key: "ArrowDown",
                  bubbles: true,
                  cancelable: true,
                }),
              );
            }
            if (how === "click") {
              press(row(toInput), "row");
            }
            if (how === "show") {
              view.card.registry.set(view.model.selection, {
                key: toInput,
                card: true,
              });
            }
            const start = performance.now();
            while (performance.now() - start < delay + 600) {
              await frame();
              frames.push(sample());
            }
            await view.card.settled;
            await frame();
            frames.push(sample());
          } finally {
            Worker.prototype.postMessage = post;
            for (const [timer, send] of pending) {
              clearTimeout(timer);
              send();
            }
            observer.disconnect();
          }
          return {
            from: frames[0]!.title,
            to: frames.at(-1)!.title,
            frames,
            mutations,
            delayedCards,
          };
        },
        {
          toInput: to,
          fromInput: from,
          condition: from === null,
          delay: delay,
          how: how,
        },
      )) as Switch;
      expect(
        step.delayedCards > 0,
        "the Reading Card item read crosses the delayed worker boundary when requested",
      ).toBe(delay > 0);
      return step;
    };

    /**
     * The card goes from the first paper to the second in one step: its
     * title is never gone or empty and reads the old title, then the new
     * one; its buttons move once, and not at all between headers of one
     * height; and the Annotation Cards of one paper never show under the
     * other's title.
     */
    const oneStep = (what: string, step: Switch) => {
      const titles = [step.from, step.to];
      expect.soft(step.from, what).toBeTruthy();
      expect.soft(step.to, what).toBeTruthy();
      expect.soft(step.from, what).not.toBe(step.to);
      // Over a narrow list a click puts the card away while it waits out a
      // double click: the frames it is away count for nothing.
      const frames = step.frames.filter(({ shown }) => shown);
      expect
        .soft(
          frames.filter(({ title }) => !title),
          what,
        )
        .toEqual([]);
      expect
        .soft(
          step.mutations.filter((title) => !title),
          what,
        )
        .toEqual([]);
      const seen = <T>(list: T[]) =>
        list.filter((value, at) => at === 0 || value !== list[at - 1]);
      expect.soft(seen(frames.map(({ title }) => title)), what).toEqual(titles);
      expect
        .soft(seen(step.mutations), what)
        .toEqual(seen(step.mutations)[0] === step.from ? titles : [step.to]);
      const top = frames[0]!.top;
      const settled = frames.at(-1)!.top;
      expect
        .soft(seen(frames.map(({ top }) => top)), what)
        .toEqual(top === settled ? [top] : [top, settled]);
      // The old paper's Annotation Cards stay until its title goes, and
      // only the new paper's come under its title, once read.
      const under = (title: string | null) =>
        frames.filter((frame) => frame.title === title);
      expect
        .soft(
          under(step.from).filter(
            ({ cards }) => cards.join() !== frames[0]!.cards.join(),
          ),
          `${what}: Annotation Cards under ${step.from}`,
        )
        .toEqual([]);
      const last = frames.at(-1)!.cards;
      expect
        .soft(
          under(step.to).filter(
            ({ cards }, at, list) =>
              cards.some((key) => !last.includes(key)) ||
              (at > 0 && cards.length < list[at - 1]!.cards.length),
          ),
          `${what}: Annotation Cards under ${step.to}`,
        )
        .toEqual([]);
    };

    /**
     * The card opens on the paper whole: no frame shows it without its
     * title, and its buttons stay where its header puts them.
     */
    const opens = (what: string, step: Switch) => {
      const frames = step.frames.filter(({ shown }) => shown);
      expect.soft(step.to, what).toBeTruthy();
      expect.soft(step.frames[0]!.shown, what).toBe(false);
      expect
        .soft(
          frames.filter(({ title }) => !title),
          what,
        )
        .toEqual([]);
      const seen = <T>(list: T[]) =>
        list.filter((value, at) => at === 0 || value !== list[at - 1]);
      expect
        .soft(seen(frames.map(({ title }) => title)), what)
        .toEqual([step.to]);
      expect.soft(seen(frames.map(({ top }) => top)), what).toHaveLength(1);
    };

    /** The keys of the first rows of the list, and the row of the paper with Annotations. */
    const { rows, listed } = (await obRun(
      run.vaultId,
      async ({ app, page }, { annotationItemKey }) => {
        const { until } = page;
        const view = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]!.view;
        await view.query.settled;
        const el = view.contentEl;
        await until(
          "rows",
          () =>
            el.querySelectorAll<HTMLElement>("[data-query-item-row]").length >
            6,
          10000,
        );
        const keys = [
          ...el.querySelectorAll<HTMLElement>("[data-query-item-row]"),
        ].map((n) => n.getAttribute("data-query-item-row")!);
        return {
          rows: keys.slice(0, 7),
          listed: keys.find((k) => k!.endsWith(annotationItemKey)) ?? null,
        };
      },
      { annotationItemKey: annotationItem.key },
    )) as { rows: string[]; listed: string | null };
    expect(listed).not.toBeNull();

    const switches = async (where: string, narrow: boolean) => {
      for (const delay of [0, 400]) {
        const pace = delay === 0 ? "fast read" : "slow read";
        // From no selection, the card opens on the paper.
        opens(
          `${where}, opens on 3, ${pace}`,
          await switchCard(narrow ? "show" : "click", [null, rows[3]!], delay),
        );
        // Down the first rows by the arrow keys, then by a click; over a
        // narrow list those put the card away, so the selection moves as
        // "Show in Library" moves it.
        if (!narrow)
          for (let at = 0; at + 1 < 5; at++)
            oneStep(
              `${where}, ↓ ${at}, ${pace}`,
              await switchCard("key", [rows[at]!, rows[at + 1]!], delay),
            );
        for (const [a, b] of [
          [4, 1],
          [1, 2],
          [2, 6],
        ] as const)
          oneStep(
            `${where}, ${narrow ? "show" : "click"} ${a} → ${b}, ${pace}`,
            await switchCard(
              narrow ? "show" : "click",
              [rows[a]!, rows[b]!],
              delay,
            ),
          );
      }
    };

    // Beside a wide list, with the Annotations closed.
    await switches("wide", false);

    // With the Annotations open, to and from the paper that has some.
    const other = rows.find((key) => key !== listed)!;

    await obRun(
      run.vaultId,
      async ({ app }, { enabled }) => {
        (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]?.view.card.disclose("annotations", enabled);
      },
      { enabled: true },
    );
    cleanup.defer(async () => {
      await obRun(
        run.vaultId,
        async ({ app }, { enabled }) => {
          (
            app.workspace.getLeavesOfType(
              "zotlit-library",
            ) as (WorkspaceLeaf & { view: LibraryView })[]
          )[0]?.view.card.disclose("annotations", enabled);
        },
        { enabled: false },
      );
    });
    for (const delay of [0, 400]) {
      const pace = delay === 0 ? "fast read" : "slow read";
      const there = await switchCard("click", [other, listed!], delay);
      oneStep(`Annotations open, to the paper, ${pace}`, there);
      expect.soft(there.frames.at(-1)!.cards.length, pace).toBeGreaterThan(0);
      oneStep(
        `Annotations open, from the paper, ${pace}`,
        await switchCard("click", [listed!, other], delay),
      );
    }
    await obRun(
      run.vaultId,
      async ({ app }, { enabled }) => {
        (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]?.view.card.disclose("annotations", enabled);
      },
      { enabled: false },
    );

    // Over a narrow list.
    await obRun(
      run.vaultId,
      async ({ app, page }, { value }) => {
        const { until } = page;
        const leaf = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0];
        const beside = (page.scratch.zotlitE2EBeside ??=
          app.workspace.createLeafBySplit(leaf!, "vertical"));
        (leaf!.parent as LibraryTabs).setDimension(30);
        (beside.parent as LibraryTabs).setDimension(70);
        const card = leaf!.view.contentEl.querySelector<HTMLElement>(
          "[data-library-card]",
        );
        leaf!.view.card.registry.set(leaf!.view.model.selection, {
          key: value!,
          card: true,
        });
        await until(
          "card over the list",
          () =>
            card!.checkVisibility() &&
            getComputedStyle(card!).position === "absolute",
          5000,
        );
      },
      { value: rows[0] },
    );
    await switches("narrow", true);
  }, 240000);

  it("swaps the sidebar Annotation View from one Item to the next in one step, as it follows the active tab from one Literature Note to another and as the Item picker pins another Item, whether ZotLit Query answers at once or late, with Zotero closed", async () => {
    const layout = await obRun(
      run.vaultId,
      async ({ app }) => {
        return JSON.stringify(app.workspace.getLayout());
      },
      undefined,
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obRun(
        run.vaultId,
        async ({ app }, { layout }) => {
          const view = (
            app.workspace.getLeavesOfType(
              "zotero-annotation-view",
            ) as (WorkspaceLeaf & { view: AnnotView })[]
          )[0]?.view;
          if (view?.getState().followMode === "pinned")
            app.commands.executeCommandById("zotlit:annot-view-unpin");
          app.commands.executeCommandById(
            "zotlit:annot-view-follow-active-tab",
          );
          await app.workspace.changeLayout(JSON.parse(layout));
        },
        { layout: layout },
      );
    });
    await suite.wideWindow(cleanup);
    // Two Literature Notes of Items whose Annotations differ.
    const items = [annotationItem, positionDocumentItem];
    const notes = items.map(
      (item) => `literatures/${item.literatureNoteName ?? item.key}.md`,
    );
    await obRun(
      run.vaultId,
      async ({ app }, { value }) => {
        const leaf = app.workspace.getLeaf("tab");
        await leaf.openFile(app.vault.getFileByPath(value!)!);
        app.workspace.setActiveLeaf(leaf, { focus: true });
        app.commands.executeCommandById("zotlit:open-annot-view");
        app.commands.executeCommandById("zotlit:annot-view-follow-active-tab");
        app.workspace.rightSplit.expand();
      },
      { value: notes[0] },
    );

    interface Frame {
      /** The Item the header names, `null` while it names none. */
      title: string | null;
      /** The keys of the cards drawn. */
      cards: string[];
      /** Whether the body says it is loading. */
      loading: boolean;
      /** Milliseconds since the step began; none for the settled view before it. */
      at?: number;
    }
    interface Step {
      /** The view settled before the step, then as each animation frame draws it. */
      frames: Frame[];
      /** The view after each batch of mutations of it. */
      mutations: Frame[];
      delayedReads: number;
    }

    /**
     * Settle the view after `prepare`, then run `trigger`, with each ZotLit
     * Query run held `delay` ms first, and read each frame the window draws
     * until 600 ms after that and the view settles.
     */
    const step = async ({
      mode,
      from,
      to,
      title,
      delay,
    }: {
      mode: "active-tab" | "pinned";
      from: string;
      to: string;
      title: string | null;
      delay: number;
    }) =>
      (await obRun(
        run.vaultId,
        async ({ app, page }, { mode, from, titleInput, to, delay }) => {
          const { until } = page;
          const view = (
            app.workspace.getLeavesOfType(
              "zotero-annotation-view",
            ) as (WorkspaceLeaf & { view: AnnotView })[]
          )[0]!.view;
          if (mode === "active-tab") {
            if (view.getState().followMode !== "active-tab") {
              app.commands.executeCommandById("zotlit:annot-view-unpin");
              app.commands.executeCommandById(
                "zotlit:annot-view-follow-active-tab",
              );
              await until(
                "active tab",
                () => view.getState().followMode === "active-tab",
              );
            }
            const leaf = app.workspace.getMostRecentLeaf(
              app.workspace.rootSplit,
            );
            if ((leaf!.view as FileView).file?.path !== from)
              await leaf!.openFile(app.vault.getFileByPath(from)!);
          } else {
            view.pinItem(from);
            await until("pinned", () => view.getState().pinnedItemKey === from);
            app.commands.executeCommandById("zotlit:annot-view-pin-item");
            const input = await until(
              "picker",
              () =>
                activeDocument.querySelector<HTMLElement>(
                  ".prompt .prompt-input",
                ),
              5000,
            );
            (input as HTMLInputElement).value = titleInput!;
            input.dispatchEvent(new Event("input", { bubbles: true }));
          }
          const choice =
            mode === "pinned"
              ? await until(
                  "suggestion",
                  () =>
                    [
                      ...activeDocument.querySelectorAll<HTMLElement>(
                        ".prompt .suggestion-item",
                      ),
                    ].find(
                      (n) =>
                        !n.closest<HTMLElement>("[aria-busy]") &&
                        n.dataset.indexedKey === to,
                    ),
                  10000,
                )
              : null;
          await until(
            "cards",
            () => view.contentEl.querySelector<HTMLElement>(".zt-annot-card"),
            10000,
          );
          await view.read;
          const frame = () => new Promise((r) => requestAnimationFrame(r));
          await frame();
          await frame();
          const el = view.contentEl;
          const cards = () =>
            [
              ...el.querySelectorAll<HTMLElement>(
                ".zt-annot-card[data-zotero-annotation-key]",
              ),
            ].map((n) => n.getAttribute("data-zotero-annotation-key")!);
          const sample = () => ({
            title:
              el.querySelector<HTMLElement>("[data-annot-header-title]")
                ?.textContent ?? null,
            cards: cards(),
            loading: !!el.querySelector<HTMLElement>(
              "[data-annot-view-loading]",
            ),
          });
          const mutations: Step["mutations"] = [];
          let start = performance.now();
          const observer = new MutationObserver(() =>
            mutations.push({
              ...sample(),
              at: Math.round(performance.now() - start),
            }),
          );
          observer.observe(el, { childList: true, subtree: true });
          const frames: Step["frames"] = [sample()];
          // oxlint-disable-next-line typescript/unbound-method -- Restored unchanged and called with the original worker receiver.
          const post = Worker.prototype.postMessage;
          const pending = new Map<ReturnType<typeof setTimeout>, () => void>();
          let delayedReads = 0;
          if (delay > 0)
            Worker.prototype.postMessage = new Proxy(post, {
              apply: (
                postTarget,
                receiver: Worker,
                args: Parameters<Worker["postMessage"]>,
              ) => {
                const request = (args[0] as LibraryWorkerMessage)?.[1];
                if (
                  request?.tag !== "ItemQuery" ||
                  !("view" in request.payload.job) ||
                  request.payload.job.view.from !== "annotations"
                )
                  return Reflect.apply(postTarget, receiver, args);
                delayedReads++;
                const send = () => Reflect.apply(postTarget, receiver, args);
                const timer = setTimeout(() => {
                  pending.delete(timer);
                  send();
                }, delay);
                pending.set(timer, send);
              },
            });
          try {
            start = performance.now();
            if (mode === "active-tab")
              void app.workspace
                .getMostRecentLeaf(app.workspace.rootSplit)!
                .openFile(app.vault.getFileByPath(to)!);
            else choice!.click();
            const first = frames[0]!.cards.join();
            const moved = () => {
              const now = frames.at(-1);
              return now!.cards.length > 0 && now!.cards.join() !== first;
            };
            while (
              performance.now() - start < delay + 600 ||
              (!moved() && performance.now() - start < 5000)
            ) {
              await frame();
              frames.push({
                ...sample(),
                at: Math.round(performance.now() - start),
              });
            }
            await view.read;
            await frame();
            frames.push({
              ...sample(),
              at: Math.round(performance.now() - start),
            });
          } finally {
            Worker.prototype.postMessage = post;
            for (const [timer, send] of pending) {
              clearTimeout(timer);
              send();
            }
            observer.disconnect();
          }
          return { frames, mutations, delayedReads };
        },
        { mode: mode, from: from, titleInput: title, to: to, delay: delay },
      )) as Step;

    /**
     * The view goes from one Item to the next in one step: the last Item's
     * cards stay until the next Item's are read, and never show under the
     * next one's name; the next one's show whole. A read that takes longer
     * than 150 ms may show the next Item's name over a loading body first.
     */
    const oneStep = (
      what: string,
      { frames, mutations, delayedReads }: Step,
      { named, slow }: { named: boolean; slow: boolean },
    ) => {
      expect(
        delayedReads > 0,
        `${what}: the query crosses the delayed worker boundary`,
      ).toBe(slow);
      const before = frames[0]!;
      const after = frames.at(-1)!;
      // A read held past 150 ms shows the next Item over its cards loading.
      expect
        .soft(
          !slow ||
            frames.some(
              ({ loading, title }) =>
                loading && (!named || title === after.title),
            ),
          `${what}: the next Item loading`,
        )
        .toBe(true);
      expect.soft(before.cards.length, what).toBeGreaterThan(0);
      expect.soft(after.cards.length, what).toBeGreaterThan(0);
      expect.soft(after.cards.join(), what).not.toBe(before.cards.join());
      const seen = <T>(list: T[]) =>
        list.filter((value, at) => at === 0 || value !== list[at - 1]);
      const shown = (cards: string[]) =>
        cards.length === 0
          ? "none"
          : cards.join() === before.cards.join()
            ? "last"
            : cards.join() === after.cards.join()
              ? "next"
              : `other: ${cards.join()}`;
      for (const [kind, samples] of [
        ["frames", frames],
        ["mutations", mutations],
      ] as const) {
        const where = `${what}, ${kind}`;
        // The cards go from the last Item's to the next Item's, with at
        // most a loading body between, once the read has taken 150 ms.
        expect
          .soft(
            [
              ["last", "next"],
              ["last", "none", "next"],
            ],
            where,
          )
          .toContainEqual(
            seen([before, ...samples].map(({ cards }) => shown(cards))),
          );
        expect
          .soft(
            samples.filter(
              ({ cards, loading, at }) =>
                cards.length === 0 && (!loading || (at ?? 0) < 150),
            ),
            `${where}: no cards before 150 ms, or with no loading body`,
          )
          .toEqual([]);
        if (!named) continue;
        // The header names one Item at a time, never goes blank, and never
        // names one Item over the other's cards.
        expect
          .soft(
            samples.filter(({ title }) => !title),
            where,
          )
          .toEqual([]);
        expect
          .soft(seen([before, ...samples].map(({ title }) => title)), where)
          .toEqual([before.title, after.title]);
        expect
          .soft(
            samples.filter(
              ({ title, cards }) =>
                (title === before.title && shown(cards) !== "last") ||
                (title === after.title && shown(cards) === "last"),
            ),
            `${where}: cards under another Item's name`,
          )
          .toEqual([]);
      }
      if (!named) return;
      expect.soft(before.title, what).toBeTruthy();
      expect.soft(before.title, what).not.toBe(after.title);
    };

    for (const delay of [0, 400]) {
      const pace = delay === 0 ? "fast read" : "slow read";
      // Following the active tab from one Literature Note to the other.
      for (const [from, to] of [
        [notes[0]!, notes[1]!],
        [notes[1]!, notes[0]!],
      ] as const)
        oneStep(
          `active tab, ${from} → ${to}, ${pace}`,
          await step({
            mode: "active-tab",
            from: from,
            to: to,
            title: null,
            delay: delay,
          }),
          { named: false, slow: delay > 0 },
        );
      // Pinned, the Item picker pins the other Item. The click must land on a
      // row of the typed query's answer, which the picker shows once its
      // results stop being aria-busy; it drops a click on an earlier row. The
      // row is found by Indexed Key: another Item shares the title. This is
      // selectItemSuggestion's rule, inside the one eval the step times.
      for (const [from, to] of [
        [items[0]!, items[1]!],
        [items[1]!, items[0]!],
      ] as const)
        oneStep(
          `pinned, picker ${from.key} → ${to.key}, ${pace}`,
          await step({
            mode: "pinned",
            from: from.key,
            to: to.key,
            title: to.title,
            delay: delay,
          }),
          { named: true, slow: delay > 0 },
        );
    }
  }, 240000);

  it("opens a Library View Document an earlier build stored with the Table on Papers, and saves its Collection from the toolbar as a Query File whose tab lists the same papers with every control, with Zotero closed", async () => {
    const savedPath = "query-files/Saved library.zotquery";
    const snapshot = await obRun(
      run.vaultId,
      async ({ app, zotlit }, { libraryScopeSettingKey }) => {
        return JSON.stringify({
          layout: app.workspace.getLayout(),
          document:
            zotlit.services.bridge.runSync(zotlit.services.settings.current)[
              "library.document"
            ] ?? null,
          scope:
            zotlit.services.bridge.runSync(zotlit.services.settings.current)[
              libraryScopeSettingKey
            ] ?? null,
        });
      },
      { libraryScopeSettingKey: LIBRARY_SCOPE_SETTING_KEY },
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obRun(
        run.vaultId,
        async (
          { app, zotlit },
          { snapshot, libraryScopeSettingKey, savedpath },
        ) => {
          const saved = JSON.parse(snapshot);
          const { settings, bridge } = zotlit.services;
          bridge.runSync(
            settings.update({
              "library.document": saved.document,
              [libraryScopeSettingKey]: saved.scope,
            }),
          );
          await bridge.runPromise(settings.flush);
          await app.workspace.changeLayout(saved.layout);
          const file = app.vault.getFileByPath(savedpath);
          if (file) await app.vault.delete(file);
        },
        {
          snapshot: snapshot,
          libraryScopeSettingKey: LIBRARY_SCOPE_SETTING_KEY,
          savedpath: savedPath,
        },
      );
    });

    // The seed's "Shared key" Collection of My Library. A Collection of that
    // name holds Items in other Libraries too, which the Library Scope
    // reads, so the saved file has to keep to My Library.
    const personal = LIBRARIES.find(({ type }) => type === "user")!;
    const sharedKey = COLLECTIONS.find(
      (entry) =>
        entry.libraryID === personal.libraryID && entry.key === "SHAREDCL",
    )!;
    const filedIn = (collectionIDs: Set<number>) =>
      ITEMS.filter((item) =>
        item.collectionIDs.some((id) => collectionIDs.has(id)),
      );
    const subtree = (collectionID: number): number[] => [
      collectionID,
      ...COLLECTIONS.filter(
        (entry) => entry.parentCollectionID === collectionID,
      ).flatMap((child) => subtree(child.collectionID)),
    ];
    const expected = filedIn(new Set(subtree(sharedKey.collectionID)))
      .map(({ key }) => key)
      .toSorted();
    expect(expected.length).toBeGreaterThan(0);
    const namesakes = COLLECTIONS.filter(
      (entry) =>
        entry.name === sharedKey.name && entry.libraryID !== personal.libraryID,
    );
    expect(
      filedIn(new Set(namesakes.map(({ collectionID }) => collectionID)))
        .length,
      "another Library files Items in a Collection of the same name",
    ).toBeGreaterThan(0);

    // The document as an earlier build stored it, with the Table and its
    // Visible Properties, which this build ignores.
    await obRun(
      run.vaultId,
      async ({ app, zotlit }, { sharedKeyName, libraryScopeSettingKey }) => {
        (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        ).forEach((leaf) => leaf.detach());
        const { settings, bridge } = zotlit.services;
        bridge.runSync(
          settings.update({
            "library.document": {
              node: {
                kind: "collection",
                library: { type: "personal" },
                path: [sharedKeyName],
              },
              facets: [],
              search: "",
              sort: [{ property: "dateModified", direction: "DESC" }],
              layout: "table",
              order: ["title"],
            },
            [libraryScopeSettingKey]: { mode: "all" },
          }),
        );
        await bridge.runPromise(settings.flush);
        app.commands.executeCommandById("zotlit:open-library-view");
      },
      {
        sharedKeyName: sharedKey.name,
        libraryScopeSettingKey: LIBRARY_SCOPE_SETTING_KEY,
      },
    );

    /** What a view shows once its query settled: its Layout, rows and toolbar. */

    interface Rows {
      type: string;
      file: string | null;
      phase: string;
      layout: string | null;
      count: string | null;
      rows: string[];
      /** The toolbar's controls, by their hook. */
      toolbar: (string | null)[];
    }

    const library = "Library View";
    const drawn = (layout: string) => (rows: Rows) =>
      rows.phase === "ready" &&
      rows.layout === layout &&
      rows.count !== null &&
      rows.rows.length === Number(rows.count);
    const papers = await obRunUntil(
      run.vaultId,
      async ({ app }) => {
        const view = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]?.view;
        if (!view?.query) return null;
        await view.query.settled;
        const el = view.contentEl;
        return {
          type: view.getViewType(),
          file: null,
          phase: view.query.state.getState().phase,
          layout:
            el
              .querySelector<HTMLElement>("[data-query-layout]")
              ?.getAttribute("data-query-layout") ??
            (el.querySelector<HTMLElement>("[data-query-table]")
              ? "table"
              : null),
          count:
            el
              .querySelector<HTMLElement>("[data-query-count]")
              ?.getAttribute("data-query-count") ?? null,
          rows: [
            ...el.querySelectorAll<HTMLElement>(
              '[data-query-papers-row], tr[data-query-table-row="item"]',
            ),
          ].map(
            (n) =>
              n.getAttribute("data-query-papers-row")! ??
              n.getAttribute("data-query-key")!,
          ),
          toolbar: [
            ...el.querySelectorAll<HTMLElement>(
              '[role="toolbar"] > button, [role="toolbar"] [data-query-view-menu], [role="toolbar"] [data-query-properties]',
            ),
          ].map(
            (n) =>
              n.getAttribute("data-query-toolbar") ??
              [...n.attributes]
                .map((a) => a.name)
                .find((a) => a.startsWith("data-query-")) ??
              null,
          ),
        };
      },
      undefined,
      {
        what: library,
        tries: 120,
        ready: (value) => value !== null && drawn("papers")(value),
      },
    );
    expect(papers!.rows.toSorted()).toEqual(expected);

    // "Save as query file" sits in the heading beside Sort, and asks the
    // name and the folder only.
    expect(papers!.toolbar).toEqual(["sort", "data-query-save-as"]);
    await obRun(
      run.vaultId,
      async ({ app, page }) => {
        const { press } = page;
        const leaf = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0];
        await app.workspace.revealLeaf(leaf!);
        app.workspace.setActiveLeaf(leaf!, { focus: true });
        press(
          leaf!.view.contentEl.querySelector<HTMLElement>(
            "[data-query-save-as]",
          ),
          "Save as query file",
        );
      },
      undefined,
    );

    await obRunUntil(
      run.vaultId,
      async () => {
        const modal = document.querySelector<HTMLElement>(
          ".modal.zt-save-query-file-modal",
        );
        return modal
          ? {
              title:
                modal.querySelector<HTMLElement>(".modal-title")?.textContent ??
                null,
              fields: [
                ...modal.querySelectorAll<HTMLElement>("[data-save-field]"),
              ].map((n) => n.getAttribute("data-save-field")),
              records: modal.querySelectorAll<HTMLElement>(
                "[data-save-records]",
              ).length,
            }
          : null;
      },
      undefined,
      {
        ready: (value) =>
          isDeepStrictEqual(value, {
            title: run.m.annot_view_save_title(),
            fields: ["name", "folder"],
            records: 0,
          }),
        what: "the save Query File modal to open with name and folder fields",
      },
    );
    await obRun(
      run.vaultId,
      async ({ page }) => {
        const { press } = page;
        const modal = document.querySelector<HTMLElement>(
          ".modal.zt-save-query-file-modal",
        );
        const set = (field: string, value: string) => {
          const input = modal!.querySelector<HTMLElement>(
            `[data-save-field="${field}"]`,
          );
          (input as HTMLInputElement).value = value;
          input!.dispatchEvent(new Event("input", { bubbles: true }));
        };
        set("name", "Saved library");
        set("folder", "query-files");
        press(
          modal!.querySelector<HTMLElement>(
            ".modal-button-container button.mod-cta",
          ),
          "Save",
        );
      },
      undefined,
    );

    // The file opens in a tab that lists the Library View's papers, in its
    // order, and only those of My Library.
    const tab = "saved Query File";
    const saved = await obRunUntil(
      run.vaultId,
      async ({ app }, { savedpath }) => {
        const view = (() => {
          const view = app.workspace.getMostRecentLeaf()?.view;
          return view?.getViewType() === "zotlit-query-file" &&
            (view as FileView).file?.path === savedpath
            ? view
            : null;
        })();
        if (!(view as QueryFileView)?.query) return null;
        await (view as QueryFileView).query.settled;
        const el = (view! as QueryFileView).contentEl;
        return {
          type: view!.getViewType(),
          file: (view as FileView).file?.path ?? null,
          phase: (view as QueryFileView).query.state.getState().phase,
          layout:
            el
              .querySelector<HTMLElement>("[data-query-layout]")
              ?.getAttribute("data-query-layout") ??
            (el.querySelector<HTMLElement>("[data-query-table]")
              ? "table"
              : null),
          count:
            el
              .querySelector<HTMLElement>("[data-query-count]")
              ?.getAttribute("data-query-count") ?? null,
          rows: [
            ...el.querySelectorAll<HTMLElement>(
              '[data-query-papers-row], tr[data-query-table-row="item"]',
            ),
          ].map(
            (n) =>
              n.getAttribute("data-query-papers-row")! ??
              n.getAttribute("data-query-key")!,
          ),
          toolbar: [
            ...el.querySelectorAll<HTMLElement>(
              '[role="toolbar"] > button, [role="toolbar"] [data-query-view-menu], [role="toolbar"] [data-query-properties]',
            ),
          ].map(
            (n) =>
              n.getAttribute("data-query-toolbar") ??
              [...n.attributes]
                .map((a) => a.name)
                .find((a) => a.startsWith("data-query-")) ??
              null,
          ),
        };
      },
      { savedpath: savedPath },
      {
        what: tab,
        tries: 120,
        ready: (value) => value !== null && drawn("papers")(value),
      },
    );
    expect(saved!.rows).toEqual(papers!.rows);
    // The Query File keeps every control the Library View leaves out.
    expect(saved!.toolbar).toEqual(
      expect.arrayContaining([
        "data-query-view-menu",
        "group",
        "filter",
        "data-query-properties",
      ]),
    );
    const text = await obRun(
      run.vaultId,
      async ({ app }, { savedpath }) => {
        return await app.vault.read(app.vault.getFileByPath(savedpath)!);
      },
      { savedpath: savedPath },
    );
    expect(text).toContain('library == "personal"');
    expect(text).toContain(
      `collections.within(${JSON.stringify(sharedKey.name)})`,
    );
  }, 180000);

  it("narrows the Library View by each Reading State facet to the seed's Items, with a Collection, counts the unread papers after the vault's pass, and keeps the facets across a plugin reload", async () => {
    const snapshot = await obRun(
      run.vaultId,
      async ({ app, zotlit }) => {
        return JSON.stringify({
          layout: app.workspace.getLayout(),
          document:
            zotlit.services.bridge.runSync(zotlit.services.settings.current)[
              "library.document"
            ] ?? null,
        });
      },
      undefined,
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obRun(
        run.vaultId,
        async ({ app, zotlit }, { snapshot }) => {
          const saved = JSON.parse(snapshot);
          const { settings, bridge } = zotlit.services;
          bridge.runSync(
            settings.update({ "library.document": saved.document }),
          );
          await bridge.runPromise(settings.flush);
          await app.workspace.changeLayout(saved.layout);
        },
        { snapshot: snapshot },
      );
    });
    // A Library View on My Library, with no facet.
    await obRun(
      run.vaultId,
      async ({ app, zotlit }, { myLibraryDocument }) => {
        (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        ).forEach((leaf) => leaf.detach());
        const { settings, bridge } = zotlit.services;
        bridge.runSync(
          settings.update({ "library.document": myLibraryDocument }),
        );
        await bridge.runPromise(settings.flush);
      },
      { myLibraryDocument: MY_LIBRARY_DOCUMENT },
    );

    const personal = ITEMS.filter(({ libraryID }) => libraryID === 1);
    const sharedKey = COLLECTIONS.find(
      (entry) => entry.libraryID === 1 && entry.key === "SHAREDCL",
    )!;
    const filed = personal.filter(({ collectionIDs }) =>
      collectionIDs.includes(sharedKey.collectionID),
    );
    const keys = (items: readonly FixtureItem[]) =>
      items.map(({ key }) => key).toSorted();
    const sharedNode = JSON.stringify(["personal", sharedKey.name]);

    interface Shown {
      phase: string;
      header: string | null;
      facets: Record<string, boolean>;
      selected: string | null;
      search: string;
      count: string | null;
      rows: string[];
    }

    /** What the view shows once it lists every row it counts with `facets` on. */
    const shownWith = async (
      facets: readonly string[],
      ready: (shown: Shown) => boolean = () => true,
    ) => {
      let shown: Shown | null = null;
      const settled = await waitFor(async () => {
        shown = JSON.parse(
          await obRun(
            run.vaultId,
            async ({ app }) => {
              const view = (
                app.workspace.getLeavesOfType(
                  "zotlit-library",
                ) as (WorkspaceLeaf & { view: LibraryView })[]
              )[0]?.view;
              if (!view?.tree) return "null";
              await view.searched;
              await view.query.settled;
              await view.tree.settled;
              const el = view.contentEl;
              return JSON.stringify({
                phase: view.query.state.getState().phase,
                header: ((h: Element | null) =>
                  h
                    ? ["[data-library-header]", "[data-library-header-count]"]
                        .map((s) => h.querySelector(s)?.textContent ?? "")
                        .filter((t) => t !== "")
                        .join(" | ")
                    : null)(el.querySelector("[data-library-heading]")),
                facets: Object.fromEntries(
                  [
                    ...el.querySelectorAll<HTMLElement>("[data-library-facet]"),
                  ].map((n) => [
                    n.getAttribute("data-library-facet"),
                    n.getAttribute("aria-pressed") === "true",
                  ]),
                ),
                selected:
                  el
                    .querySelector<HTMLElement>(
                      '[data-library-node][aria-selected="true"]',
                    )
                    ?.getAttribute("data-library-node") ?? null,
                search: (
                  el.querySelector<HTMLElement>(
                    "[data-library-search] input",
                  ) as HTMLInputElement
                ).value,
                count:
                  el
                    .querySelector<HTMLElement>("[data-query-count]")
                    ?.getAttribute("data-query-count") ?? null,
                rows: [
                  ...el.querySelectorAll<HTMLElement>(
                    "[data-query-papers-row]",
                  ),
                ].map((n) => n.getAttribute("data-query-papers-row")!),
              });
            },
            undefined,
          ),
        ) as Shown | null;
        return (
          shown !== null &&
          shown.phase === "ready" &&
          shown.count !== null &&
          shown.rows.length === Number(shown.count) &&
          Object.entries(shown.facets).every(
            ([id, on]) => on === facets.includes(id),
          ) &&
          ready(shown)
        );
      }, 120);
      if (!settled) throw new Error(`Library View: ${JSON.stringify(shown)}`);
      return shown!;
    };
    /**
     * Press the element `target` finds in the tree pane. A narrow pane keeps
     * the tree behind its button, so the press opens it first.
     */

    await obRun(
      run.vaultId,
      async ({ app }) => {
        app.commands.executeCommandById("zotlit:open-library-view");
      },
      undefined,
    );
    const opened = await shownWith([]);
    expect(opened.rows.toSorted()).toEqual(keys(personal));

    // Each facet narrows My Library to the Items the seed gives it.
    const oracle: Record<string, (item: FixtureItem) => boolean> = {
      unread: (item) => unreadOf([item]).length === 1,
      annotated: readingState.annotated,
      "has-note": readingState.noted,
      pdf: readingState.pdf,
    };
    for (const [id, keeps] of Object.entries(oracle)) {
      await obRun(
        run.vaultId,
        async ({ app, page }, { id, value }) => {
          const { press, until } = page;
          const el = (
            app.workspace.getLeavesOfType(
              "zotlit-library",
            ) as (WorkspaceLeaf & { view: LibraryView })[]
          )[0]!.view.contentEl;
          const pane = el.querySelector<HTMLElement>("[data-library-tree]");
          if (getComputedStyle(pane!).display === "none") {
            press(
              el.querySelector<HTMLElement>("[data-library-tree-toggle]"),
              "Library Tree button",
            );
            await until(
              "Library Tree",
              () => getComputedStyle(pane!).display !== "none",
            );
          }
          press(
            pane!.querySelector<HTMLElement>(`[data-library-facet="${id}"]`),
            value,
          );
        },
        { id: id, value: `${id} facet` },
      );
      const narrowed = await shownWith([id]);
      expect(narrowed.rows.toSorted(), id).toEqual(
        keys(personal.filter(keeps)),
      );
      await obRun(
        run.vaultId,
        async ({ app, page }, { id, value }) => {
          const { press, until } = page;
          const el = (
            app.workspace.getLeavesOfType(
              "zotlit-library",
            ) as (WorkspaceLeaf & { view: LibraryView })[]
          )[0]!.view.contentEl;
          const pane = el.querySelector<HTMLElement>("[data-library-tree]");
          if (getComputedStyle(pane!).display === "none") {
            press(
              el.querySelector<HTMLElement>("[data-library-tree-toggle]"),
              "Library Tree button",
            );
            await until(
              "Library Tree",
              () => getComputedStyle(pane!).display !== "none",
            );
          }
          press(
            pane!.querySelector<HTMLElement>(`[data-library-facet="${id}"]`),
            value,
          );
        },
        { id: id, value: `${id} facet` },
      );
      await shownWith([]);
    }

    // Facets combine with the Collection selected and with each other.
    await obRun(
      run.vaultId,
      async ({ app, page }, { sharednode, collection }) => {
        const { press, until } = page;
        const el = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]!.view.contentEl;
        const pane = el.querySelector<HTMLElement>("[data-library-tree]");
        if (getComputedStyle(pane!).display === "none") {
          press(
            el.querySelector<HTMLElement>("[data-library-tree-toggle]"),
            "Library Tree button",
          );
          await until(
            "Library Tree",
            () => getComputedStyle(pane!).display !== "none",
          );
        }
        press(
          [...pane!.querySelectorAll<HTMLElement>("[data-library-node]")].find(
            (n) => n.getAttribute("data-library-node")! === sharednode,
          ),
          collection,
        );
      },
      { sharednode: sharedNode, collection: "Collection" },
    );
    await shownWith([], (shown) => shown.selected === sharedNode);
    await obRun(
      run.vaultId,
      async ({ app, page }, { value }) => {
        const { press, until } = page;
        const el = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]!.view.contentEl;
        const pane = el.querySelector<HTMLElement>("[data-library-tree]");
        if (getComputedStyle(pane!).display === "none") {
          press(
            el.querySelector<HTMLElement>("[data-library-tree-toggle]"),
            "Library Tree button",
          );
          await until(
            "Library Tree",
            () => getComputedStyle(pane!).display !== "none",
          );
        }
        press(
          pane!.querySelector<HTMLElement>('[data-library-facet="annotated"]'),
          value,
        );
      },
      { value: `${"annotated"} facet` },
    );
    const annotated = filed.filter(readingState.annotated);
    expect(annotated.length).toBeGreaterThan(0);
    expect((await shownWith(["annotated"])).rows.toSorted()).toEqual(
      keys(annotated),
    );
    await obRun(
      run.vaultId,
      async ({ app, page }, { value }) => {
        const { press, until } = page;
        const el = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]!.view.contentEl;
        const pane = el.querySelector<HTMLElement>("[data-library-tree]");
        if (getComputedStyle(pane!).display === "none") {
          press(
            el.querySelector<HTMLElement>("[data-library-tree-toggle]"),
            "Library Tree button",
          );
          await until(
            "Library Tree",
            () => getComputedStyle(pane!).display !== "none",
          );
        }
        press(
          pane!.querySelector<HTMLElement>('[data-library-facet="pdf"]'),
          value,
        );
      },
      { value: `${"pdf"} facet` },
    );
    const both = annotated.filter(readingState.pdf);
    expect(both.length).toBeGreaterThan(0);
    expect((await shownWith(["annotated", "pdf"])).rows.toSorted()).toEqual(
      keys(both),
    );
    await obRun(
      run.vaultId,
      async ({ app, page }, { value }) => {
        const { press, until } = page;
        const el = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]!.view.contentEl;
        const pane = el.querySelector<HTMLElement>("[data-library-tree]");
        if (getComputedStyle(pane!).display === "none") {
          press(
            el.querySelector<HTMLElement>("[data-library-tree-toggle]"),
            "Library Tree button",
          );
          await until(
            "Library Tree",
            () => getComputedStyle(pane!).display !== "none",
          );
        }
        press(
          pane!.querySelector<HTMLElement>('[data-library-facet="annotated"]'),
          value,
        );
      },
      { value: `${"annotated"} facet` },
    );
    await obRun(
      run.vaultId,
      async ({ app, page }, { value }) => {
        const { press, until } = page;
        const el = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]!.view.contentEl;
        const pane = el.querySelector<HTMLElement>("[data-library-tree]");
        if (getComputedStyle(pane!).display === "none") {
          press(
            el.querySelector<HTMLElement>("[data-library-tree-toggle]"),
            "Library Tree button",
          );
          await until(
            "Library Tree",
            () => getComputedStyle(pane!).display !== "none",
          );
        }
        press(
          pane!.querySelector<HTMLElement>('[data-library-facet="pdf"]'),
          value,
        );
      },
      { value: `${"pdf"} facet` },
    );
    await shownWith([]);

    // The vault loses the Literature Note of an Item with no Annotation: the
    // Item becomes unread, in the list and in the header's count.
    const reader = filed.find(
      (item) =>
        !readingState.read(item) &&
        !readingState.annotated(item) &&
        readingState.noted(item),
    )!;
    const notePath = await obRun(
      run.vaultId,
      async ({ zotlit }, { readerKey }) => {
        return (
          zotlit.services.bridge.runSync(
            zotlit.services.noteIndex.getNotesByItemKey(readerKey),
          )[0]?.path ?? ""
        );
      },
      { readerKey: reader.key },
    );
    expect(notePath).not.toBe("");

    // A paper already read in Zotero stays out of Unread after its note is removed.
    const readPaper = filed.find(
      (item) => readingState.read(item) && !readingState.annotated(item),
    )!;
    expect(readPaper.key).toBe("IANNP5A2");
    const readNotePath = await obRun(
      run.vaultId,
      async ({ zotlit }, { readPaperKey }) => {
        return (
          zotlit.services.bridge.runSync(
            zotlit.services.noteIndex.getNotesByItemKey(readPaperKey),
          )[0]?.path ?? ""
        );
      },
      { readPaperKey: readPaper.key },
    );
    expect(readNotePath).not.toBe("");
    await obRun(
      run.vaultId,
      async ({ app }, { readnotepath, value }) => {
        await app.vault.rename(
          app.vault.getAbstractFileByPath(readnotepath)!,
          value,
        );
      },
      { readnotepath: readNotePath, value: `${readNotePath}.away` },
    );
    cleanup.defer(async () => {
      await obRun(
        run.vaultId,
        async ({ app }, { value, readnotepath }) => {
          await app.vault.rename(
            app.vault.getAbstractFileByPath(value)!,
            readnotepath,
          );
        },
        { value: `${readNotePath}.away`, readnotepath: readNotePath },
      );
    });
    const away = `${notePath}.away`;
    await obRun(
      run.vaultId,
      async ({ app }, { notepath, away }) => {
        await app.vault.rename(
          app.vault.getAbstractFileByPath(notepath)!,
          away,
        );
      },
      { notepath: notePath, away: away },
    );
    cleanup.defer(async () => {
      await obRun(
        run.vaultId,
        async ({ app }, { away, notepath }) => {
          await app.vault.rename(
            app.vault.getAbstractFileByPath(away)!,
            notepath,
          );
        },
        { away: away, notepath: notePath },
      );
    });
    const noted = (item: FixtureItem) =>
      item !== reader && readingState.noted(item);
    await obRun(
      run.vaultId,
      async ({ app, page }, { value }) => {
        const { press, until } = page;
        const el = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]!.view.contentEl;
        const pane = el.querySelector<HTMLElement>("[data-library-tree]");
        if (getComputedStyle(pane!).display === "none") {
          press(
            el.querySelector<HTMLElement>("[data-library-tree-toggle]"),
            "Library Tree button",
          );
          await until(
            "Library Tree",
            () => getComputedStyle(pane!).display !== "none",
          );
        }
        press(
          pane!.querySelector<HTMLElement>('[data-library-facet="unread"]'),
          value,
        );
      },
      { value: `${"unread"} facet` },
    );
    const unread = await shownWith(
      ["unread"],
      (shown) =>
        shown.header ===
        suite.libraryHeader(sharedKey.name, filed, {
          noted,
          shown: unreadOf(filed, noted).length,
        }),
    );
    expect(unread.rows.toSorted()).toEqual(keys(unreadOf(filed, noted)));
    expect(unread.rows).toContain(reader.key);

    // A search keeps to the facets: in the Collection, then in every
    // Library, each in the quick switcher's rank.
    const lookup = async (query: string, everywhere: boolean) =>
      (await obRun(
        run.vaultId,
        async ({ zotlit }, { everywhere, query }) => {
          const s = zotlit.services;
          const libraries = everywhere
            ? s.bridge.runSync(s.libraryScope.current)!.available
            : s.bridge
                .runSync(s.libraryScope.libraries)
                .filter((l) => l.selector.type === "personal");
          return (
            await s.itemLookup.search(query, { limit: 500, libraries })
          ).map((h) => h.item.indexedKey);
        },
        { everywhere: everywhere, query: query },
      )) as string[];
    /**
     * Type `text` into the search box as a researcher does: the press into
     * the box, on its part the tree leaves uncovered, puts away the tree a
     * facet press left open over a narrow list.
     */

    const indexedKey = (item: FixtureItem) => {
      const { groupID } = LIBRARIES.find(
        (entry) => entry.libraryID === item.libraryID,
      )!;
      return groupID === null ? item.key : `${item.key}g${groupID}`;
    };
    const unreadHere = new Set(unreadOf(filed, noted).map(indexedKey));
    const unreadAnywhere = new Set(unreadOf(ITEMS, noted).map(indexedKey));
    await obRun(
      run.vaultId,
      async ({ app, page }, { readerTitle }) => {
        const { until } = page;
        const view = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]!.view;
        const input = view.contentEl.querySelector<HTMLElement>(
          "[data-library-search] input",
        );
        input!.dispatchEvent(
          new PointerEvent("pointerdown", { bubbles: true }),
        );
        input!.focus();
        await until("Library Tree put away", () => !view.tree.state.open);
        (input as HTMLInputElement).value = readerTitle;
        input!.dispatchEvent(new Event("input", { bubbles: true }));
      },
      { readerTitle: reader.title },
    );
    const here = (await lookup(reader.title, false)).filter((key) =>
      unreadHere.has(key),
    );
    expect(here).toContain(reader.key);
    expect(
      (
        await shownWith(
          ["unread"],
          (shown) =>
            shown.search === reader.title && shown.rows.length === here.length,
        )
      ).rows,
    ).toEqual(here);
    await obRun(
      run.vaultId,
      async ({ app, page }) => {
        const { press } = page;
        press(
          (
            app.workspace.getLeavesOfType(
              "zotlit-library",
            ) as (WorkspaceLeaf & { view: LibraryView })[]
          )[0]!.view.contentEl.querySelector<HTMLElement>(
            "[data-library-search-all]",
          ),
          "Search all libraries",
        );
      },
      undefined,
    );
    const anywhere = (await lookup(reader.title, true)).filter((key) =>
      unreadAnywhere.has(key),
    );
    expect(
      (
        await shownWith(
          ["unread"],
          (shown) =>
            shown.header ===
            run.m.library_view_heading_search({
              count: anywhere.length,
              query: reader.title,
            }),
        )
      ).rows,
    ).toEqual(anywhere);
    await obRun(
      run.vaultId,
      async ({ app, page }, { text }) => {
        const { until } = page;
        const view = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]!.view;
        const input = view.contentEl.querySelector<HTMLElement>(
          "[data-library-search] input",
        );
        input!.dispatchEvent(
          new PointerEvent("pointerdown", { bubbles: true }),
        );
        input!.focus();
        await until("Library Tree put away", () => !view.tree.state.open);
        (input as HTMLInputElement).value = text;
        input!.dispatchEvent(new Event("input", { bubbles: true }));
      },
      { text: "" },
    );
    await shownWith(
      ["unread"],
      (shown) =>
        shown.search === "" &&
        shown.header ===
          suite.libraryHeader(sharedKey.name, filed, {
            noted,
            shown: unreadOf(filed, noted).length,
          }),
    );

    // A plugin reload comes back on the Collection with the facet on.
    await obRunUntil(
      run.vaultId,
      async ({ app }) => {
        return await app.plugins
          .disablePlugin("zotlit")
          .then(function () {
            return app.plugins.enablePlugin("zotlit");
          })
          .then(function () {
            return true;
          });
      },
      undefined,
      {
        tries: 20,
        what: "the zotlit plugin to finish its disable and enable reload",
      },
    );
    const reloaded = await shownWith(
      ["unread"],
      (shown) =>
        shown.selected === sharedNode &&
        shown.header ===
          suite.libraryHeader(sharedKey.name, filed, {
            noted,
            shown: unreadOf(filed, noted).length,
          }),
    );
    expect(reloaded.rows.toSorted()).toEqual(unread.rows.toSorted());
  }, 180000);

  it("narrows the Library View by the tags selected in the Tag Selector to the seed's Items with every one, filters the tag names alone, deselects them all, and keeps them across a plugin reload", async () => {
    const snapshot = await obRun(
      run.vaultId,
      async ({ app, zotlit }) => {
        return JSON.stringify({
          layout: app.workspace.getLayout(),
          document:
            zotlit.services.bridge.runSync(zotlit.services.settings.current)[
              "library.document"
            ] ?? null,
        });
      },
      undefined,
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obRun(
        run.vaultId,
        async ({ app, zotlit }, { snapshot }) => {
          const saved = JSON.parse(snapshot);
          const { settings, bridge } = zotlit.services;
          bridge.runSync(
            settings.update({ "library.document": saved.document }),
          );
          await bridge.runPromise(settings.flush);
          await app.workspace.changeLayout(saved.layout);
        },
        { snapshot: snapshot },
      );
    });
    // A Library View on My Library, with no tag selected: a document of an
    // earlier build, which stored none.
    await obRun(
      run.vaultId,
      async ({ app, zotlit }, { myLibraryDocument }) => {
        (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        ).forEach((leaf) => leaf.detach());
        const { settings, bridge } = zotlit.services;
        bridge.runSync(
          settings.update({ "library.document": myLibraryDocument }),
        );
        await bridge.runPromise(settings.flush);
      },
      { myLibraryDocument: MY_LIBRARY_DOCUMENT },
    );

    const personal = ITEMS.filter(({ libraryID }) => libraryID === 1);
    const tagsOf = (item: FixtureItem) =>
      (item.tags ?? []).map(({ name }) => name);
    const withEvery = (tags: readonly string[]) =>
      personal.filter((item) =>
        tags.every((tag) => tagsOf(item).includes(tag)),
      );
    const namesOf = (items: readonly FixtureItem[]) =>
      [...new Set(items.flatMap(tagsOf))].toSorted();
    const keys = (items: readonly FixtureItem[]) =>
      items.map(({ key }) => key).toSorted();

    interface Shown {
      phase: string;
      header: string | null;
      tags: string[];
      pressed: string[];
      /** The filter chips under the heading, by their hook. */
      chips: string[];
      count: string | null;
      rows: string[];
    }

    /** What the view shows once it lists every row it counts with `pressed` selected. */
    const shownWith = async (
      pressed: readonly string[],
      ready: (shown: Shown) => boolean = () => true,
    ) => {
      let shown: Shown | null = null;
      const settled = await waitFor(async () => {
        shown = JSON.parse(
          await obRun(
            run.vaultId,
            async ({ app }) => {
              const view = (
                app.workspace.getLeavesOfType(
                  "zotlit-library",
                ) as (WorkspaceLeaf & { view: LibraryView })[]
              )[0]?.view;
              if (!view?.tree) return "null";
              await view.searched;
              await view.query.settled;
              await view.tree.settled;
              const el = view.contentEl;
              const tags = [
                ...el.querySelectorAll<HTMLElement>("[data-library-tag]"),
              ];
              return JSON.stringify({
                phase: view.query.state.getState().phase,
                header: ((h: Element | null) =>
                  h
                    ? ["[data-library-header]", "[data-library-header-count]"]
                        .map((s) => h.querySelector(s)?.textContent ?? "")
                        .filter((t) => t !== "")
                        .join(" | ")
                    : null)(el.querySelector("[data-library-heading]")),
                tags: tags.map((n) => n.getAttribute("data-library-tag")),
                chips: [
                  ...el.querySelectorAll<HTMLElement>("[data-library-filter]"),
                ].map((n) => n.getAttribute("data-library-filter")),
                pressed: tags
                  .filter((n) => n.getAttribute("aria-pressed") === "true")
                  .map((n) => n.getAttribute("data-library-tag")),
                count:
                  el
                    .querySelector<HTMLElement>("[data-query-count]")
                    ?.getAttribute("data-query-count") ?? null,
                rows: [
                  ...el.querySelectorAll<HTMLElement>(
                    "[data-query-papers-row]",
                  ),
                ].map((n) => n.getAttribute("data-query-papers-row")!),
              });
            },
            undefined,
          ),
        ) as Shown | null;
        return (
          shown !== null &&
          shown.phase === "ready" &&
          shown.count !== null &&
          shown.rows.length === Number(shown.count) &&
          JSON.stringify(shown.pressed) === JSON.stringify(pressed) &&
          ready(shown)
        );
      }, 120);
      if (!settled) throw new Error(`Library View: ${JSON.stringify(shown)}`);
      return shown!;
    };
    /** Press `target` in the tree pane, opening the tree first on a narrow pane. */

    /** The chips under the heading while `tags` are selected. */
    const tagged = (tags: readonly string[]) => tags.map((tag) => `tag:${tag}`);

    await obRun(
      run.vaultId,
      async ({ app }) => {
        app.commands.executeCommandById("zotlit:open-library-view");
      },
      undefined,
    );
    // The Tag Selector lists the tags of My Library's Items.
    const opened = await shownWith([], (shown) => shown.tags.length > 0);
    expect(opened.rows.toSorted()).toEqual(keys(personal));
    expect(opened.tags.toSorted()).toEqual(namesOf(personal));

    // A tag narrows the list to its Items, and the tags to theirs.
    const first = "fixture-core";
    await obRun(
      run.vaultId,
      async ({ app, page }, { first, value }) => {
        const { press, until } = page;
        const el = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]!.view.contentEl;
        const pane = el.querySelector<HTMLElement>("[data-library-tree]");
        if (getComputedStyle(pane!).display === "none") {
          press(
            el.querySelector<HTMLElement>("[data-library-tree-toggle]"),
            "Library Tree button",
          );
          await until(
            "Library Tree",
            () => getComputedStyle(pane!).display !== "none",
          );
        }
        press(
          [...pane!.querySelectorAll<HTMLElement>("[data-library-tag]")].find(
            (n) => n.getAttribute("data-library-tag") === first,
          ),
          value,
        );
      },
      { first: first, value: `${first} tag` },
    );
    const one = await shownWith([first]);
    expect(withEvery([first]).length).toBeGreaterThan(0);
    expect(one.rows.toSorted()).toEqual(keys(withEvery([first])));
    expect(one.tags.toSorted()).toEqual(namesOf(withEvery([first])));

    // A second tag narrows to the Items with both, the heading counts them
    // of all My Library holds, and a chip under it names each tag.
    const second = one.tags.find((name) => name !== first)!;
    expect(second).toBeDefined();
    await obRun(
      run.vaultId,
      async ({ app, page }, { second, value }) => {
        const { press, until } = page;
        const el = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]!.view.contentEl;
        const pane = el.querySelector<HTMLElement>("[data-library-tree]");
        if (getComputedStyle(pane!).display === "none") {
          press(
            el.querySelector<HTMLElement>("[data-library-tree-toggle]"),
            "Library Tree button",
          );
          await until(
            "Library Tree",
            () => getComputedStyle(pane!).display !== "none",
          );
        }
        press(
          [...pane!.querySelectorAll<HTMLElement>("[data-library-tag]")].find(
            (n) => n.getAttribute("data-library-tag") === second,
          ),
          value,
        );
      },
      { second: second, value: `${second} tag` },
    );
    const both = [first, second].toSorted();
    const two = await shownWith(
      both,
      (shown) => JSON.stringify(shown.chips) === JSON.stringify(tagged(both)),
    );
    expect(two.header).toContain(
      run.m.library_view_heading_papers_of({
        count: withEvery(both).length,
        total: personal.length,
      }),
    );
    expect(withEvery(both).length).toBeGreaterThan(0);
    expect(two.rows.toSorted()).toEqual(keys(withEvery(both)));

    // The "Filter tags" box narrows the names it shows, never the papers.
    await obRun(
      run.vaultId,
      async ({ app }) => {
        const input = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]!.view.contentEl.querySelector<HTMLElement>(
          "[data-library-tags-filter]",
        );
        (input as HTMLInputElement).value = "zzz-no-tag";
        input!.dispatchEvent(new Event("input", { bubbles: true }));
      },
      undefined,
    );
    const filtered = await shownWith(
      both,
      (shown) => shown.tags.length === both.length,
    );
    expect(filtered.tags).toEqual(both);
    expect(filtered.rows).toEqual(two.rows);

    // A plugin reload comes back with the tags selected.
    await obRunUntil(
      run.vaultId,
      async ({ app }) => {
        return await app.plugins
          .disablePlugin("zotlit")
          .then(function () {
            return app.plugins.enablePlugin("zotlit");
          })
          .then(function () {
            return true;
          });
      },
      undefined,
      {
        tries: 20,
        what: "the zotlit plugin to finish its disable and enable reload",
      },
    );
    const reloaded = await shownWith(both);
    expect(reloaded.rows).toEqual(two.rows);

    // Deselect all lists every Item of My Library again.
    await obRun(
      run.vaultId,
      async ({ app, page }, { deselectAll }) => {
        const { press, until } = page;
        const el = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]!.view.contentEl;
        const pane = el.querySelector<HTMLElement>("[data-library-tree]");
        if (getComputedStyle(pane!).display === "none") {
          press(
            el.querySelector<HTMLElement>("[data-library-tree-toggle]"),
            "Library Tree button",
          );
          await until(
            "Library Tree",
            () => getComputedStyle(pane!).display !== "none",
          );
        }
        press(
          pane!.querySelector<HTMLElement>("[data-library-tags-clear]"),
          deselectAll,
        );
      },
      { deselectAll: "Deselect all" },
    );
    const cleared = await shownWith(
      [],
      (shown) => shown.rows.length === personal.length,
    );
    expect(cleared.rows.toSorted()).toEqual(keys(personal));
    expect(
      await obRun(
        run.vaultId,
        async ({ zotlit }) => {
          return JSON.stringify(
            zotlit.services.bridge.runSync(zotlit.services.settings.current)[
              "library.document"
            ]!.tags,
          );
        },
        undefined,
      ),
    ).toBe("[]");
  }, 180000);

  it("searches the Library View as the quick switcher ranks, inside the tree node, with tag:, Search all libraries and Escape", async () => {
    const snapshot = await obRun(
      run.vaultId,
      async ({ app, zotlit }, { libraryScopeSettingKey }) => {
        return JSON.stringify({
          layout: app.workspace.getLayout(),
          document:
            zotlit.services.bridge.runSync(zotlit.services.settings.current)[
              "library.document"
            ] ?? null,
          scope:
            zotlit.services.bridge.runSync(zotlit.services.settings.current)[
              libraryScopeSettingKey
            ] ?? null,
        });
      },
      { libraryScopeSettingKey: LIBRARY_SCOPE_SETTING_KEY },
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obRun(
        run.vaultId,
        async ({ app, zotlit }, { snapshot, libraryScopeSettingKey }) => {
          const saved = JSON.parse(snapshot);
          const { settings, bridge } = zotlit.services;
          bridge.runSync(
            settings.update({
              "library.document": saved.document,
              [libraryScopeSettingKey]: saved.scope,
            }),
          );
          await bridge.runPromise(settings.flush);
          await app.workspace.changeLayout(saved.layout);
        },
        {
          snapshot: snapshot,
          libraryScopeSettingKey: LIBRARY_SCOPE_SETTING_KEY,
        },
      );
    });
    // Every Library is in the Library Scope; the tab opens on My Library.
    await obRun(
      run.vaultId,
      async (
        { app, zotlit },
        { myLibraryDocument, libraryScopeSettingKey },
      ) => {
        (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        ).forEach((leaf) => leaf.detach());
        const { settings, bridge } = zotlit.services;
        bridge.runSync(
          settings.update({
            "library.document": myLibraryDocument,
            [libraryScopeSettingKey]: { mode: "all" },
          }),
        );
        await bridge.runPromise(settings.flush);
      },
      {
        myLibraryDocument: MY_LIBRARY_DOCUMENT,
        libraryScopeSettingKey: LIBRARY_SCOPE_SETTING_KEY,
      },
    );

    // The seed's oracle.
    const personal = LIBRARIES.find((entry) => entry.type === "user")!;
    const indexedKey = (item: FixtureItem) => {
      const { groupID } = LIBRARIES.find(
        (entry) => entry.libraryID === item.libraryID,
      )!;
      return groupID === null ? item.key : `${item.key}g${groupID}`;
    };
    const inPersonal = ITEMS.filter(
      (item) => item.libraryID === personal.libraryID,
    );
    const subtree = (collectionID: number): number[] => [
      collectionID,
      ...COLLECTIONS.filter(
        (entry) => entry.parentCollectionID === collectionID,
      ).flatMap((child) => subtree(child.collectionID)),
    ];
    const sharedKey = COLLECTIONS.find(
      (entry) =>
        entry.libraryID === personal.libraryID && entry.key === "SHAREDCL",
    )!;
    const inSharedKey = new Set(
      inPersonal
        .filter(({ collectionIDs }) =>
          collectionIDs.some((id) =>
            subtree(sharedKey.collectionID).includes(id),
          ),
        )
        .map(indexedKey),
    );
    /** The Indexed Keys the quick switcher's search answers, best first. */
    const lookup = async (query: string, everywhere: boolean) =>
      (await obRun(
        run.vaultId,
        async ({ zotlit }, { everywhere, query }) => {
          const s = zotlit.services;
          const libraries = everywhere
            ? s.bridge.runSync(s.libraryScope.current)!.available
            : s.bridge
                .runSync(s.libraryScope.libraries)
                .filter((l) => l.selector.type === "personal");
          return (
            await s.itemLookup.search(query, { limit: 500, libraries })
          ).map((h) => h.item.indexedKey);
        },
        { everywhere: everywhere, query: query },
      )) as string[];

    interface Shown {
      phase: string;
      header: string | null;
      value: string;
      focused: boolean;
      /** The offer beside the header to search all libraries, while it shows. */
      searchAll: string | null;
      rows: string[];
    }

    /** Type `text` into the search box, as the keyboard sets an input's value. */

    const header = (shown: Shown) => shown.header;

    await obRun(
      run.vaultId,
      async ({ app }) => {
        app.commands.executeCommandById("zotlit:open-library-view");
      },
      undefined,
    );
    // The search box has the cursor; the list shows My Library.
    const opened = await obRunUntil(
      run.vaultId,
      async ({ app }) => {
        const view = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]?.view;
        if (!view?.search) return null;
        await view.searched;
        await view.query.settled;
        const el = view.contentEl;
        const input = el.querySelector<HTMLElement>(
          "[data-library-search] input",
        );
        return {
          phase: view.query.state.getState().phase,
          header: ((h: Element | null) =>
            h
              ? ["[data-library-header]", "[data-library-header-count]"]
                  .map((s) => h.querySelector(s)?.textContent ?? "")
                  .filter((t) => t !== "")
                  .join(" | ")
              : null)(el.querySelector("[data-library-heading]")),
          value: (input as HTMLInputElement).value,
          focused: document.activeElement === input,
          searchAll:
            el.querySelector<HTMLElement>("[data-library-search-all]")
              ?.textContent ?? null,
          rows: [
            ...el.querySelectorAll<HTMLElement>(
              'tr[data-query-table-row="item"], [data-query-papers-row]',
            ),
          ].map(
            (n) =>
              n.getAttribute("data-query-key")! ??
              n.getAttribute("data-query-papers-row")!,
          ),
        };
      },
      undefined,
      {
        what: "Library View",
        tries: 120,
        ready: (value) =>
          value !== null &&
          ((shown) =>
            shown.phase === "ready" &&
            ((shown) => shown.rows.length === inPersonal.length)(shown))(value),
      },
    );
    expect(opened!.focused).toBe(true);
    expect(opened!.rows.toSorted()).toEqual(
      inPersonal.map(indexedKey).toSorted(),
    );

    // A seeded title ranks its Item first, and the rows keep the order of
    // the quick switcher's search.
    const title = "Communicating with Slip Boxes";
    const wanted = inPersonal.find((item) => item.title.startsWith(title))!;
    await obRun(
      run.vaultId,
      async ({ app }, { title }) => {
        const input = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]!.view.contentEl.querySelector<HTMLElement>(
          "[data-library-search] input",
        );
        (input as HTMLInputElement).value = title;
        input!.dispatchEvent(new Event("input", { bubbles: true }));
      },
      { title: title },
    );
    const ranked = await obRunUntil(
      run.vaultId,
      async ({ app }) => {
        const view = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]?.view;
        if (!view?.search) return null;
        await view.searched;
        await view.query.settled;
        const el = view.contentEl;
        const input = el.querySelector<HTMLElement>(
          "[data-library-search] input",
        );
        return {
          phase: view.query.state.getState().phase,
          header: ((h: Element | null) =>
            h
              ? ["[data-library-header]", "[data-library-header-count]"]
                  .map((s) => h.querySelector(s)?.textContent ?? "")
                  .filter((t) => t !== "")
                  .join(" | ")
              : null)(el.querySelector("[data-library-heading]")),
          value: (input as HTMLInputElement).value,
          focused: document.activeElement === input,
          searchAll:
            el.querySelector<HTMLElement>("[data-library-search-all]")
              ?.textContent ?? null,
          rows: [
            ...el.querySelectorAll<HTMLElement>(
              'tr[data-query-table-row="item"], [data-query-papers-row]',
            ),
          ].map(
            (n) =>
              n.getAttribute("data-query-key")! ??
              n.getAttribute("data-query-papers-row")!,
          ),
        };
      },
      undefined,
      {
        what: "Library View",
        tries: 120,
        ready: (value) =>
          value !== null &&
          ((shown) =>
            shown.phase === "ready" &&
            ((shown) => shown.value === title)(shown))(value),
      },
    );
    expect(ranked!.rows[0]).toBe(indexedKey(wanted));
    expect(ranked!.rows).toEqual(await lookup(title, false));

    // The search keeps to the selected Collection; Search all libraries
    // widens it past the Collection, to every Library.
    await obRun(
      run.vaultId,
      async ({ app }, { duplicate }) => {
        const input = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]!.view.contentEl.querySelector<HTMLElement>(
          "[data-library-search] input",
        );
        (input as HTMLInputElement).value = duplicate;
        input!.dispatchEvent(new Event("input", { bubbles: true }));
      },
      { duplicate: "duplicate" },
    );
    const library = await obRunUntil(
      run.vaultId,
      async ({ app }) => {
        const view = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]?.view;
        if (!view?.search) return null;
        await view.searched;
        await view.query.settled;
        const el = view.contentEl;
        const input = el.querySelector<HTMLElement>(
          "[data-library-search] input",
        );
        return {
          phase: view.query.state.getState().phase,
          header: ((h: Element | null) =>
            h
              ? ["[data-library-header]", "[data-library-header-count]"]
                  .map((s) => h.querySelector(s)?.textContent ?? "")
                  .filter((t) => t !== "")
                  .join(" | ")
              : null)(el.querySelector("[data-library-heading]")),
          value: (input as HTMLInputElement).value,
          focused: document.activeElement === input,
          searchAll:
            el.querySelector<HTMLElement>("[data-library-search-all]")
              ?.textContent ?? null,
          rows: [
            ...el.querySelectorAll<HTMLElement>(
              'tr[data-query-table-row="item"], [data-query-papers-row]',
            ),
          ].map(
            (n) =>
              n.getAttribute("data-query-key")! ??
              n.getAttribute("data-query-papers-row")!,
          ),
        };
      },
      undefined,
      {
        what: "Library View",
        tries: 120,
        ready: (value) =>
          value !== null &&
          ((shown) =>
            shown.phase === "ready" &&
            ((shown) => shown.value === "duplicate")(shown))(value),
      },
    );
    expect(library!.rows).toEqual(await lookup("duplicate", false));
    await obRun(
      run.vaultId,
      async ({ app, page }, { JSONStringifyResult }) => {
        const { press } = page;
        const el = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]!.view.contentEl;
        const pane = el.querySelector<HTMLElement>("[data-library-tree]");
        const row = [
          ...pane!.querySelectorAll<HTMLElement>("[data-library-node]"),
        ].find(
          (n) => n.getAttribute("data-library-node")! === JSONStringifyResult,
        );
        if (getComputedStyle(pane!).display === "none")
          press(
            el.querySelector<HTMLElement>("[data-library-tree-toggle]"),
            "Library Tree button",
          );
        press(row, "Collection");
      },
      { JSONStringifyResult: JSON.stringify(["personal", sharedKey.name]) },
    );
    const filed = (await lookup("duplicate", false)).filter((key) =>
      inSharedKey.has(key),
    );
    const collection = await obRunUntil(
      run.vaultId,
      async ({ app }) => {
        const view = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]?.view;
        if (!view?.search) return null;
        await view.searched;
        await view.query.settled;
        const el = view.contentEl;
        const input = el.querySelector<HTMLElement>(
          "[data-library-search] input",
        );
        return {
          phase: view.query.state.getState().phase,
          header: ((h: Element | null) =>
            h
              ? ["[data-library-header]", "[data-library-header-count]"]
                  .map((s) => h.querySelector(s)?.textContent ?? "")
                  .filter((t) => t !== "")
                  .join(" | ")
              : null)(el.querySelector("[data-library-heading]")),
          value: (input as HTMLInputElement).value,
          focused: document.activeElement === input,
          searchAll:
            el.querySelector<HTMLElement>("[data-library-search-all]")
              ?.textContent ?? null,
          rows: [
            ...el.querySelectorAll<HTMLElement>(
              'tr[data-query-table-row="item"], [data-query-papers-row]',
            ),
          ].map(
            (n) =>
              n.getAttribute("data-query-key")! ??
              n.getAttribute("data-query-papers-row")!,
          ),
        };
      },
      undefined,
      {
        what: "Library View",
        tries: 120,
        ready: (value) =>
          value !== null &&
          ((shown) =>
            shown.phase === "ready" &&
            ((shown) =>
              shown.rows.length === filed.length &&
              header(shown) ===
                `${run.m.library_view_heading_search({ count: filed.length, query: "duplicate" })} | ${run.m.library_view_search_everywhere()}` &&
              shown.searchAll === run.m.library_view_search_everywhere())(
              shown,
            ))(value),
      },
    );
    expect(collection!.rows).toEqual(filed);
    await obRun(
      run.vaultId,
      async ({ app, page }) => {
        const { press } = page;
        press(
          (
            app.workspace.getLeavesOfType(
              "zotlit-library",
            ) as (WorkspaceLeaf & { view: LibraryView })[]
          )[0]!.view.contentEl.querySelector<HTMLElement>(
            "[data-library-search-all]",
          ),
          "Search all libraries",
        );
      },
      undefined,
    );
    const everywhere = await lookup("duplicate", true);
    expect(
      everywhere.some((key) => !inPersonal.map(indexedKey).includes(key)),
    ).toBe(true);
    const widened = await obRunUntil(
      run.vaultId,
      async ({ app }) => {
        const view = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]?.view;
        if (!view?.search) return null;
        await view.searched;
        await view.query.settled;
        const el = view.contentEl;
        const input = el.querySelector<HTMLElement>(
          "[data-library-search] input",
        );
        return {
          phase: view.query.state.getState().phase,
          header: ((h: Element | null) =>
            h
              ? ["[data-library-header]", "[data-library-header-count]"]
                  .map((s) => h.querySelector(s)?.textContent ?? "")
                  .filter((t) => t !== "")
                  .join(" | ")
              : null)(el.querySelector("[data-library-heading]")),
          value: (input as HTMLInputElement).value,
          focused: document.activeElement === input,
          searchAll:
            el.querySelector<HTMLElement>("[data-library-search-all]")
              ?.textContent ?? null,
          rows: [
            ...el.querySelectorAll<HTMLElement>(
              'tr[data-query-table-row="item"], [data-query-papers-row]',
            ),
          ].map(
            (n) =>
              n.getAttribute("data-query-key")! ??
              n.getAttribute("data-query-papers-row")!,
          ),
        };
      },
      undefined,
      {
        what: "Library View",
        tries: 120,
        ready: (value) =>
          value !== null &&
          ((shown) =>
            shown.phase === "ready" &&
            ((shown) =>
              header(shown) ===
              run.m.library_view_heading_search({
                count: everywhere.length,
                query: "duplicate",
              }))(shown))(value),
      },
    );
    expect(widened!.rows).toEqual(everywhere);

    // A tag: token narrows to the seeded Items with that tag.
    await obRun(
      run.vaultId,
      async ({ app, page }, { JSONStringifyResult }) => {
        const { press } = page;
        const el = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]!.view.contentEl;
        const pane = el.querySelector<HTMLElement>("[data-library-tree]");
        const row = [
          ...pane!.querySelectorAll<HTMLElement>("[data-library-node]"),
        ].find(
          (n) => n.getAttribute("data-library-node")! === JSONStringifyResult,
        );
        if (getComputedStyle(pane!).display === "none")
          press(
            el.querySelector<HTMLElement>("[data-library-tree-toggle]"),
            "Library Tree button",
          );
        press(row, "My Library");
      },
      { JSONStringifyResult: JSON.stringify(["personal"]) },
    );
    await obRun(
      run.vaultId,
      async ({ app }, { text }) => {
        const input = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]!.view.contentEl.querySelector<HTMLElement>(
          "[data-library-search] input",
        );
        (input as HTMLInputElement).value = text;
        input!.dispatchEvent(new Event("input", { bubbles: true }));
      },
      { text: "tag:fixture-core" },
    );
    const tagged = inPersonal
      .filter((item) => item.tags?.some(({ name }) => name === "fixture-core"))
      .map(indexedKey);
    expect(tagged.length).toBeGreaterThan(0);
    const byTag = await obRunUntil(
      run.vaultId,
      async ({ app }) => {
        const view = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]?.view;
        if (!view?.search) return null;
        await view.searched;
        await view.query.settled;
        const el = view.contentEl;
        const input = el.querySelector<HTMLElement>(
          "[data-library-search] input",
        );
        return {
          phase: view.query.state.getState().phase,
          header: ((h: Element | null) =>
            h
              ? ["[data-library-header]", "[data-library-header-count]"]
                  .map((s) => h.querySelector(s)?.textContent ?? "")
                  .filter((t) => t !== "")
                  .join(" | ")
              : null)(el.querySelector("[data-library-heading]")),
          value: (input as HTMLInputElement).value,
          focused: document.activeElement === input,
          searchAll:
            el.querySelector<HTMLElement>("[data-library-search-all]")
              ?.textContent ?? null,
          rows: [
            ...el.querySelectorAll<HTMLElement>(
              'tr[data-query-table-row="item"], [data-query-papers-row]',
            ),
          ].map(
            (n) =>
              n.getAttribute("data-query-key")! ??
              n.getAttribute("data-query-papers-row")!,
          ),
        };
      },
      undefined,
      {
        what: "Library View",
        tries: 120,
        ready: (value) =>
          value !== null &&
          ((shown) =>
            shown.phase === "ready" &&
            ((shown) =>
              shown.value === "tag:fixture-core" &&
              shown.rows.length === tagged.length)(shown))(value),
      },
    );
    expect(byTag!.rows.toSorted()).toEqual(tagged.toSorted());

    // Escape clears the search, and the list shows My Library again.
    await obRun(
      run.vaultId,
      async ({ app }) => {
        const input = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]!.view.contentEl.querySelector<HTMLElement>(
          "[data-library-search] input",
        );
        input!.focus();
        input!.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Escape",
            bubbles: true,
            cancelable: true,
          }),
        );
      },
      undefined,
    );
    const cleared = await obRunUntil(
      run.vaultId,
      async ({ app }) => {
        const view = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]?.view;
        if (!view?.search) return null;
        await view.searched;
        await view.query.settled;
        const el = view.contentEl;
        const input = el.querySelector<HTMLElement>(
          "[data-library-search] input",
        );
        return {
          phase: view.query.state.getState().phase,
          header: ((h: Element | null) =>
            h
              ? ["[data-library-header]", "[data-library-header-count]"]
                  .map((s) => h.querySelector(s)?.textContent ?? "")
                  .filter((t) => t !== "")
                  .join(" | ")
              : null)(el.querySelector("[data-library-heading]")),
          value: (input as HTMLInputElement).value,
          focused: document.activeElement === input,
          searchAll:
            el.querySelector<HTMLElement>("[data-library-search-all]")
              ?.textContent ?? null,
          rows: [
            ...el.querySelectorAll<HTMLElement>(
              'tr[data-query-table-row="item"], [data-query-papers-row]',
            ),
          ].map(
            (n) =>
              n.getAttribute("data-query-key")! ??
              n.getAttribute("data-query-papers-row")!,
          ),
        };
      },
      undefined,
      {
        what: "Library View",
        tries: 120,
        ready: (value) =>
          value !== null &&
          ((shown) =>
            shown.phase === "ready" &&
            ((shown) =>
              shown.value === "" && shown.rows.length === inPersonal.length)(
              shown,
            ))(value),
      },
    );
    expect(cleared!.rows).toEqual(opened!.rows);
    expect(cleared!.header).toBe(
      suite.libraryHeader(run.m.settings_library_scope_personal(), inPersonal),
    );
  });

  it("answers the quick switcher's keys on a Library View row, lists its actions in a menu other plugins add to, inserts its citation by menu and by drag, and shows it in the Library View from the quick switcher, with Zotero closed", async () => {
    const snapshot = await obRun(
      run.vaultId,
      async ({ app, zotlit }) => {
        return JSON.stringify({
          layout: app.workspace.getLayout(),
          document:
            zotlit.services.bridge.runSync(zotlit.services.settings.current)[
              "library.document"
            ] ?? null,
        });
      },
      undefined,
    );
    const notePath = "Library row citations.md";
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obRun(
        run.vaultId,
        async ({ app, zotlit }, { snapshot, notepath }) => {
          const saved = JSON.parse(snapshot);
          const { settings, bridge } = zotlit.services;
          bridge.runSync(
            settings.update({ "library.document": saved.document }),
          );
          await bridge.runPromise(settings.flush);
          const file = app.vault.getFileByPath(notepath);
          if (file) await app.vault.delete(file);
          await app.workspace.changeLayout(saved.layout);
        },
        { snapshot: snapshot, notepath: notePath },
      );
    });

    // The seed's oracle: an Item with its Literature Note and one PDF, an
    // Item with no Literature Note that two Profiles fit, and an Item filed
    // in one subcollection.
    const reading = annotationItem;
    const readingPdf = ATTACHMENTS.filter(
      ({ parentItemID }) => parentItemID === reading.itemID,
    );
    expect(readingPdf.map(({ key }) => key)).toEqual([
      annotationAttachment.key,
    ]);
    const unwritten = booksProfileTargetItem;
    const unwrittenGroup = LIBRARIES.find(
      ({ libraryID }) => libraryID === unwritten.libraryID,
    )!.groupID!;
    const unwrittenKey = `${unwritten.key}g${unwrittenGroup}`;
    // The Literature Note that Enter writes below goes when the test ends,
    // whichever step fails first, and the test fails while one stays: by the
    // Note Index or by its frontmatter.
    cleanup.defer(async () => {
      await obRun(
        run.vaultId,
        async ({ app, zotlit, page }, { unwrittenkey }) => {
          const { until } = page;
          const key = unwrittenkey;
          const written = () => [
            ...new Set([
              ...zotlit.services.bridge.runSync(
                zotlit.services.noteIndex.getNotesByItemKey(key),
              ),
              ...app.vault
                .getMarkdownFiles()
                .filter(
                  (file) =>
                    app.metadataCache.getFileCache(file)?.frontmatter?.[
                      "zotero-key"
                    ] === key,
                ),
            ]),
          ];
          for (const file of written()) await app.vault.delete(file);
          await until(
            `no Literature Note of ${key} left`,
            () => written().length === 0,
            10000,
          );
        },
        { unwrittenkey: unwrittenKey },
      );
    });
    const child = COLLECTIONS.find(({ key }) => key === "PERSCHLD")!;
    const parent = COLLECTIONS.find(
      ({ collectionID }) => collectionID === child.parentCollectionID,
    )!;
    const filed = ITEMS.find(
      (item) =>
        item.libraryID === child.libraryID &&
        item.collectionIDs.length === 1 &&
        item.collectionIDs[0] === child.collectionID,
    )!;

    // The Library View on My Library, and beside it a note to cite into, in
    // a window wide enough that the Reading Card, which shows over a
    // narrow list, leaves the start of each row in reach.
    await suite.wideWindow(cleanup);
    await obRun(
      run.vaultId,
      async ({ app, zotlit, page }, { notepath }) => {
        const { until } = page;
        (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        ).forEach((leaf) => leaf.detach());
        const { settings, bridge } = zotlit.services;
        bridge.runSync(settings.update({ "library.document": null }));
        await bridge.runPromise(settings.flush);
        const file =
          app.vault.getFileByPath(notepath) ??
          (await app.vault.create(notepath, "LEFT RIGHT"));
        app.commands.executeCommandById("zotlit:open-library-view");
        await until(
          "library",
          () =>
            (
              app.workspace.getLeavesOfType(
                "zotlit-library",
              ) as (WorkspaceLeaf & { view: LibraryView })[]
            )[0],
        );
        await app.workspace.getLeaf("split").openFile(file);
      },
      { notepath: notePath },
    );
    /**
     * Run `script` with the Library View's tab active and `el` its content.
     * `pressRow` presses a row near its start, where a reader clicks while
     * the Reading Card over a narrow list covers the row's far end: it
     * presses what stands at that point, inside the row, through `press`.
     */

    const active = () => activeTab(run.vaultId);
    const activeWhen = (ready: (shown: ActiveTab) => boolean) =>
      readUntil(active, ready, { what: "Active tab", tries: 60 });
    /** The selected row's key, waiting until a row of the list is drawn. */
    const selected = () =>
      obRun(
        run.vaultId,
        async ({ app, page }) => {
          const { until } = page;
          const leaf = (
            app.workspace.getLeavesOfType(
              "zotlit-library",
            ) as (WorkspaceLeaf & { view: LibraryView })[]
          )[0];
          await app.workspace.revealLeaf(leaf!);
          app.workspace.setActiveLeaf(leaf!, { focus: true });
          await leaf!.view.query.settled;
          const el = leaf!.view.contentEl;

          await until(
            "rows",
            () => el.querySelector<HTMLElement>("[data-query-item-row]"),
            10000,
          );
          return (
            el
              .querySelector<HTMLElement>(
                "[data-query-item-row][data-selected]",
              )
              ?.getAttribute("data-query-item-row") ?? "none"
          );
        },
        undefined,
      );

    // A click selects a row and opens nothing; ↓ moves the selection to the
    // next row on screen.
    const { next } = (await obRun(
      run.vaultId,
      async ({ app, page }, { readingKey }) => {
        const { press, until } = page;
        const leaf = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0];
        await app.workspace.revealLeaf(leaf!);
        app.workspace.setActiveLeaf(leaf!, { focus: true });
        await leaf!.view.query.settled;
        const el = leaf!.view.contentEl;
        const row = (key: string) =>
          el.querySelector<HTMLElement>(`[data-query-item-row="${key}"]`);
        const keydown = (target: Element, init: KeyboardEventInit) =>
          target.dispatchEvent(
            new KeyboardEvent("keydown", {
              bubbles: true,
              cancelable: true,
              ...init,
            }),
          );
        const pressRow = (el: HTMLElement | null, what: string) => {
          if (!el) throw new Error(`Missing: ${what}`);
          el.scrollIntoView({ block: "center", behavior: "instant" });
          const r = el.getBoundingClientRect();
          const hit = el.ownerDocument.elementFromPoint(
            r.left + 24,
            r.top + r.height / 2,
          );
          if (!hit || !el.contains(hit))
            throw new Error(
              `Covered: ${what} (by ${hit ? hit.outerHTML.slice(0, 80) : "nothing"})`,
            );
          press(hit as HTMLElement, what);
          return el;
        };
        await until("rows", () => row(readingKey), 10000);
        pressRow(row(readingKey), "reading row");
        const keys = [
          ...el.querySelectorAll<HTMLElement>("[data-query-item-row]"),
        ].map((n) => n.getAttribute("data-query-item-row")!);
        keydown(row(readingKey)!, { key: "ArrowDown" });
        return { next: keys[keys.indexOf(readingKey) + 1] };
      },
      { readingKey: reading.key },
    )) as { next: string };
    // A row drawn moments before takes the selection to its markup a frame
    // later.
    expect(
      await readUntil(selected, (key) => key === next, {
        what: "Selected row",
      }),
    ).toBe(next);
    expect((await active()).type).toBe("zotlit-library");

    // Enter opens the Item's Literature Note; Shift+Enter its PDF in
    // Obsidian.
    await obRun(
      run.vaultId,
      async ({ app, page }, { readingKey }) => {
        const { press } = page;
        const leaf = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0];
        await app.workspace.revealLeaf(leaf!);
        app.workspace.setActiveLeaf(leaf!, { focus: true });
        await leaf!.view.query.settled;
        const el = leaf!.view.contentEl;
        const row = (key: string) =>
          el.querySelector<HTMLElement>(`[data-query-item-row="${key}"]`);
        const keydown = (target: Element, init: KeyboardEventInit) =>
          target.dispatchEvent(
            new KeyboardEvent("keydown", {
              bubbles: true,
              cancelable: true,
              ...init,
            }),
          );
        const pressRow = (el: HTMLElement | null, what: string) => {
          if (!el) throw new Error(`Missing: ${what}`);
          el.scrollIntoView({ block: "center", behavior: "instant" });
          const r = el.getBoundingClientRect();
          const hit = el.ownerDocument.elementFromPoint(
            r.left + 24,
            r.top + r.height / 2,
          );
          if (!hit || !el.contains(hit))
            throw new Error(
              `Covered: ${what} (by ${hit ? hit.outerHTML.slice(0, 80) : "nothing"})`,
            );
          press(hit as HTMLElement, what);
          return el;
        };
        pressRow(row(readingKey), "reading row");
        keydown(row(readingKey)!, { key: "Enter" });
      },
      { readingKey: reading.key },
    );
    // Shift+Enter opens the PDF in the tab the note opened in, once that
    // open is done.
    expect(
      await activeWhen((shown) => shown.type === "markdown" && !shown.opening),
    ).toMatchObject({ key: reading.key });
    await obRun(
      run.vaultId,
      async ({ app, page }, { readingKey }) => {
        const { press } = page;
        const leaf = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0];
        await app.workspace.revealLeaf(leaf!);
        app.workspace.setActiveLeaf(leaf!, { focus: true });
        await leaf!.view.query.settled;
        const el = leaf!.view.contentEl;
        const row = (key: string) =>
          el.querySelector<HTMLElement>(`[data-query-item-row="${key}"]`);
        const keydown = (target: Element, init: KeyboardEventInit) =>
          target.dispatchEvent(
            new KeyboardEvent("keydown", {
              bubbles: true,
              cancelable: true,
              ...init,
            }),
          );
        const pressRow = (el: HTMLElement | null, what: string) => {
          if (!el) throw new Error(`Missing: ${what}`);
          el.scrollIntoView({ block: "center", behavior: "instant" });
          const r = el.getBoundingClientRect();
          const hit = el.ownerDocument.elementFromPoint(
            r.left + 24,
            r.top + r.height / 2,
          );
          if (!hit || !el.contains(hit))
            throw new Error(
              `Covered: ${what} (by ${hit ? hit.outerHTML.slice(0, 80) : "nothing"})`,
            );
          press(hit as HTMLElement, what);
          return el;
        };
        pressRow(row(readingKey), "reading row");
        keydown(row(readingKey)!, { key: "Enter", shiftKey: true });
      },
      { readingKey: reading.key },
    );
    await pdfOpened(run.vaultId, annotationAttachment.path!);

    // On an Item with no Literature Note, Enter writes one through the
    // Profile selection, as the quick switcher does.
    await obRun(
      run.vaultId,
      async ({ app, page }, { JSONStringifyResult, unwrittenkey }) => {
        const { press, until } = page;
        const leaf = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0];
        await app.workspace.revealLeaf(leaf!);
        app.workspace.setActiveLeaf(leaf!, { focus: true });
        await leaf!.view.query.settled;
        const el = leaf!.view.contentEl;
        const row = (key: string) =>
          el.querySelector<HTMLElement>(`[data-query-item-row="${key}"]`);
        const keydown = (target: Element, init: KeyboardEventInit) =>
          target.dispatchEvent(
            new KeyboardEvent("keydown", {
              bubbles: true,
              cancelable: true,
              ...init,
            }),
          );
        const pressRow = (el: HTMLElement | null, what: string) => {
          if (!el) throw new Error(`Missing: ${what}`);
          el.scrollIntoView({ block: "center", behavior: "instant" });
          const r = el.getBoundingClientRect();
          const hit = el.ownerDocument.elementFromPoint(
            r.left + 24,
            r.top + r.height / 2,
          );
          if (!hit || !el.contains(hit))
            throw new Error(
              `Covered: ${what} (by ${hit ? hit.outerHTML.slice(0, 80) : "nothing"})`,
            );
          press(hit as HTMLElement, what);
          return el;
        };
        const groupNode = [
          ...el.querySelectorAll<HTMLElement>("[data-library-node]"),
        ].find(
          (n) => n.getAttribute("data-library-node")! === JSONStringifyResult,
        );
        if (!groupNode!.checkVisibility())
          press(
            el.querySelector<HTMLElement>("[data-library-tree-toggle]"),
            "tree toggle",
          );
        press(groupNode, "group library");
        await until(
          "group rows",
          () =>
            groupNode!.getAttribute("aria-selected") === "true" &&
            leaf!.view.query.state.getState().phase === "ready" &&
            row(unwrittenkey),
          10000,
        );
        pressRow(row(unwrittenkey), "unwritten row");
        keydown(row(unwrittenkey)!, { key: "Enter" });
      },
      {
        JSONStringifyResult: JSON.stringify([`group:${unwrittenGroup}`]),
        unwrittenkey: unwrittenKey,
      },
    );
    // The picker reads every Profile's preview before it shows.
    await obRunUntil(
      run.vaultId,
      async (_context, { booksProfileLabel }) => {
        return Array.from(
          activeDocument.querySelectorAll<HTMLElement>(
            ".prompt .suggestion-item",
          ),
        ).some((el) => el.textContent.includes(booksProfileLabel));
      },
      { booksProfileLabel: booksProfile.label },
      {
        tries: 120,
        what: "the profile picker to list the Books profile suggestion",
      },
    );
    expect(await selectSuggestion(run.vaultId, booksProfile.label)).toContain(
      booksProfile.label,
    );
    await pressPromptKey(run.vaultId, "Enter");
    const written = await activeWhen(
      (shown) => shown.type === "markdown" && shown.key === unwrittenKey,
    );
    expect(written.path).toMatch(/^books\//);

    // The row menu lists every action of the Item, and an entry another
    // plugin adds through `zotlit:item-menu`. This Item holds no PDF, so the
    // menu offers no Open PDF. The note to cite into is the
    // one active last; the notes and the PDF opened above took the tab
    // beside the view, so it opens again.
    await obRun(
      run.vaultId,
      async ({ app }, { notepath }) => {
        const leaf = app.workspace.getLeaf("split");
        await leaf.openFile(app.vault.getFileByPath(notepath)!);
        app.workspace.setActiveLeaf(leaf, { focus: true });
        (leaf.view as MarkdownView).editor.setCursor({
          line: 0,
          ch: "LEFT ".length,
        });
      },
      { notepath: notePath },
    );
    const menu = (await obRun(
      run.vaultId,
      async ({ app, page }, { unwrittenkey }) => {
        const { until } = page;
        const leaf = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0];
        await app.workspace.revealLeaf(leaf!);
        app.workspace.setActiveLeaf(leaf!, { focus: true });
        await leaf!.view.query.settled;
        const el = leaf!.view.contentEl;
        const row = (key: string) =>
          el.querySelector<HTMLElement>(`[data-query-item-row="${key}"]`);

        const ref = app.workspace.on("zotlit:item-menu", (menu, info) =>
          menu.addItem((item) =>
            item
              .setTitle(`Listener: ${info.source} ${info.indexedKey}`)
              .setIcon("star"),
          ),
        );
        try {
          const target = row(unwrittenkey);
          const r = target!.getBoundingClientRect();
          target!.dispatchEvent(
            new MouseEvent("contextmenu", {
              bubbles: true,
              cancelable: true,
              clientX: r.left + 20,
              clientY: r.top + 10,
            }),
          );
          const menu = await until("row menu", () =>
            activeDocument.querySelector<HTMLElement>(".menu"),
          );
          return [...menu.querySelectorAll<HTMLElement>(".menu-item")].map(
            (item) => item.textContent,
          );
        } finally {
          app.workspace.offref(ref);
        }
      },
      { unwrittenkey: unwrittenKey },
    )) as string[];
    expect(menu).toEqual([
      run.m.library_view_menu_open_note(),
      run.m.library_view_menu_insert_citation(),
      run.m.graph_citations_menu_copy_citekey(),
      run.m.library_view_menu_show_in_zotero(),
      `Listener: library-view ${unwrittenKey}`,
    ]);

    // Insert citation puts the Item's citation into the note last active.
    await obRun(
      run.vaultId,
      async ({ app, page }, { libraryViewMenuInsertCitationLabel }) => {
        const { press } = page;
        const leaf = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0];
        await app.workspace.revealLeaf(leaf!);
        app.workspace.setActiveLeaf(leaf!, { focus: true });
        await leaf!.view.query.settled;

        press(
          [
            ...activeDocument.querySelectorAll<HTMLElement>(".menu .menu-item"),
          ].find(
            (item) => item.textContent === libraryViewMenuInsertCitationLabel,
          ),
          "Insert citation",
        );
      },
      {
        libraryViewMenuInsertCitationLabel:
          run.m.library_view_menu_insert_citation(),
      },
    );

    const cited = (text: string) =>
      text.split(`@${unwritten.citationKey}`).length - 1;
    expect(
      await waitFor(
        async () =>
          cited(
            await obRun(
              run.vaultId,
              async ({ app }, { notepath }) => {
                return (
                  app.workspace.getLeavesOfType(
                    "markdown",
                  ) as (WorkspaceLeaf & { view: MarkdownView })[]
                )
                  .find((leaf) => leaf.view.file?.path === notepath)!
                  .view.editor.getValue();
              },
              { notepath: notePath },
            ),
          ) === 1,
      ),
    ).toBe(true);
    // At the cursor, between the words.
    expect(
      await obRun(
        run.vaultId,
        async ({ app }, { notepath }) => {
          return (
            app.workspace.getLeavesOfType("markdown") as (WorkspaceLeaf & {
              view: MarkdownView;
            })[]
          )
            .find((leaf) => leaf.view.file?.path === notepath)!
            .view.editor.getValue();
        },
        { notepath: notePath },
      ),
    ).toMatch(/^LEFT .+RIGHT$/);

    // A row dragged over the view is refused; dropped into the note, it
    // inserts its citation where it lands.
    const drag = (await obRun(
      run.vaultId,
      async ({ app }, { notepath, unwrittenkey }) => {
        const leaf = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0];
        await app.workspace.revealLeaf(leaf!);
        app.workspace.setActiveLeaf(leaf!, { focus: true });
        await leaf!.view.query.settled;
        const el = leaf!.view.contentEl;
        const row = (key: string) =>
          el.querySelector<HTMLElement>(`[data-query-item-row="${key}"]`);

        const note = (
          app.workspace.getLeavesOfType("markdown") as (WorkspaceLeaf & {
            view: MarkdownView;
          })[]
        ).find((leaf) => leaf.view.file?.path === notepath);
        const cm = note!.view.editor.cm;
        const transfer = new DataTransfer();
        const source = row(unwrittenkey);
        source!.dispatchEvent(
          new DragEvent("dragstart", {
            bubbles: true,
            cancelable: true,
            dataTransfer: transfer,
          }),
        );
        const over = new DragEvent("dragover", {
          bubbles: true,
          cancelable: true,
          dataTransfer: transfer,
        });
        el.querySelector<HTMLElement>("[data-library-node]")!.dispatchEvent(
          over,
        );
        const refused = over.defaultPrevented && transfer.dropEffect === "none";
        const at = cm.coordsAtPos(0);
        cm.contentDOM.dispatchEvent(
          new DragEvent("drop", {
            bubbles: true,
            cancelable: true,
            dataTransfer: transfer,
            clientX: Math.floor(at!.left + 1),
            clientY: Math.floor((at!.top + at!.bottom) / 2),
          }),
        );
        source!.dispatchEvent(new DragEvent("dragend", { bubbles: true }));
        return { refused, types: [...transfer.types] };
      },
      { notepath: notePath, unwrittenkey: unwrittenKey },
    )) as { refused: boolean; types: string[] };
    expect(drag).toEqual({
      refused: true,
      types: ["text/plain", "application/x-zotlit-item"],
    });
    expect(
      await waitFor(
        async () =>
          cited(
            await obRun(
              run.vaultId,
              async ({ app }, { notepath }) => {
                return (
                  app.workspace.getLeavesOfType(
                    "markdown",
                  ) as (WorkspaceLeaf & { view: MarkdownView })[]
                )
                  .find((leaf) => leaf.view.file?.path === notepath)!
                  .view.editor.getValue();
              },
              { notepath: notePath },
            ),
          ) === 2,
      ),
    ).toBe(true);
    // At the start, where it landed.
    expect(
      await obRun(
        run.vaultId,
        async ({ app }, { notepath }) => {
          return (
            app.workspace.getLeavesOfType("markdown") as (WorkspaceLeaf & {
              view: MarkdownView;
            })[]
          )
            .find((leaf) => leaf.view.file?.path === notepath)!
            .view.editor.getValue();
        },
        { notepath: notePath },
      ),
    ).not.toMatch(/^LEFT/);

    // "Show in Library" in the quick switcher opens the view on the Item's
    // Collection, with its row selected.
    await obRun(
      run.vaultId,
      async ({ app }, { notepath }) => {
        const leaf = (
          app.workspace.getLeavesOfType("markdown") as (WorkspaceLeaf & {
            view: MarkdownView;
          })[]
        ).find((leaf) => leaf.view.file?.path === notepath);
        await app.workspace.revealLeaf(leaf!);
        app.workspace.setActiveLeaf(leaf!, { focus: true });
        app.commands.executeCommandById("zotlit:note-quick-switcher");
      },
      { notepath: notePath },
    );
    await obRunUntil(
      run.vaultId,
      async () => {
        return !!activeDocument.querySelector<HTMLElement>(".prompt input");
      },
      undefined,
      { what: "the quick switcher prompt input to appear" },
    );
    await selectItemSuggestion(run.vaultId, filed.title, filed.key);
    await pressPromptKey(run.vaultId, "Enter", { altKey: true });
    await obRunUntil(
      run.vaultId,
      async ({ app }) => {
        const view = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]?.view;
        if (app.workspace.activeLeaf?.view !== view) return "not active";
        await view!.query.settled;
        const el = view!.contentEl;
        return {
          node: el
            .querySelector<HTMLElement>(
              "[data-library-node][aria-selected=true]",
            )
            ?.getAttribute("data-library-node"),
          row: el
            .querySelector<HTMLElement>("[data-query-item-row][data-selected]")
            ?.getAttribute("data-query-item-row"),
        };
      },
      undefined,
      {
        ready: (value) =>
          isDeepStrictEqual(value, {
            node: JSON.stringify(["personal", parent.name, child.name]),
            row: filed.key,
          }),
        what: "the Library View to select the filed paper row and its collection node",
      },
    );
  }, 180000);

  it("opens the Library View once on a fresh install, shows the Welcome View banner above it until dismissed, whose Search your library focuses the Library View's search box, and says where Zotero's data folder is missing until it is set", async () => {
    const snapshot = await obRun(
      run.vaultId,
      async ({ app, zotlit }) => {
        return JSON.stringify({
          layout: app.workspace.getLayout(),
          data: await app.vault.adapter.read(
            `${app.vault.configDir}/plugins/zotlit/data.json`,
          ),
          dataDir: zotlit.services.bridge.runSync(
            zotlit.services.zoteroPref.current,
          ).dataDirOverride,
        });
      },
      undefined,
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obRun(
        run.vaultId,
        async ({ app, zotlit }, { snapshot }) => {
          const saved = JSON.parse(snapshot);
          zotlit.services.bridge.runSync(
            zotlit.services.zoteroPref.setDataDir(saved.dataDir),
          );
          await zotlit.services.bridge.runPromise(
            zotlit.services.settings.flush,
          );
          await app.plugins.disablePlugin("zotlit");
          await app.vault.adapter.write(
            `${app.vault.configDir}/plugins/zotlit/data.json`,
            saved.data,
          );
          await app.plugins.enablePlugin("zotlit");
          await app.workspace.changeLayout(saved.layout);
        },
        { snapshot: snapshot },
      );
    });

    /** Reload the plugin and wait for its release check to open what it opens. */

    // A fresh install has no plugin data: the release check opens the
    // Library View, once.
    await obRun(
      run.vaultId,
      async ({ app, zotlit }) => {
        (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        ).forEach((leaf) => leaf.detach());
        await zotlit.services.bridge.runPromise(zotlit.services.settings.flush);
        await app.plugins.disablePlugin("zotlit");
        await app.vault.adapter.remove(
          `${app.vault.configDir}/plugins/zotlit/data.json`,
        );
      },
      undefined,
    );
    await obRunUntil(
      run.vaultId,
      async ({ app }) => {
        await app.plugins
          .disablePlugin("zotlit")
          .then(function () {
            return app.plugins.enablePlugin("zotlit");
          })
          .then(function () {
            return true;
          });
        return true;
      },
      undefined,
      {
        tries: 20,
        what: "the zotlit plugin to finish its disable and enable reload",
      },
    );
    await obRunUntil(
      run.vaultId,
      async ({ app }) => {
        return (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        ).length;
      },
      undefined,
      {
        ready: (value) => value === 1,
        what: "the Library View tab to open",
      },
    );
    // The release check recorded this launch in plugin data, which the next
    // launch reads.
    await obRun(
      run.vaultId,
      async ({ app, zotlit }) => {
        (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        ).forEach((leaf) => leaf.detach());
        await zotlit.services.bridge.runPromise(zotlit.services.settings.flush);
      },
      undefined,
    );
    await obRun(
      run.vaultId,
      async ({ app, zotlit }) => {
        await app.plugins
          .disablePlugin("zotlit")
          .then(function () {
            return app.plugins.enablePlugin("zotlit");
          })
          .then(function () {
            return true;
          });
        await zotlit.services.bridge.runPromise(
          zotlit.services.release.checked,
        );
      },
      undefined,
    );
    expect(
      await obRun(
        run.vaultId,
        async ({ app }) => {
          return (
            app.workspace.getLeavesOfType(
              "zotlit-library",
            ) as (WorkspaceLeaf & { view: LibraryView })[]
          ).length;
        },
        undefined,
      ),
    ).toBe(0);

    // Setup is incomplete while the literature-notes folder is missing: the
    // banner shows the checklist and the Help Links above the Library View,
    // and names no Companion.
    await obRun(
      run.vaultId,
      async ({ app, zotlit }) => {
        zotlit.services.bridge.runSync(
          zotlit.services.settings.updateDefaultLiteratureNoteProfileBindings({
            "note.literature-folder": "Not yet created",
          }),
        );
        app.commands.executeCommandById("zotlit:open-library-view");
      },
      undefined,
    );

    await obRunUntil(
      run.vaultId,
      async ({ app }) => {
        const el = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]!.view.contentEl.querySelector<HTMLElement>(
          "[data-welcome-banner]",
        );
        if (!el) return "null";
        return {
          steps: [
            ...el.querySelectorAll<HTMLElement>(
              '[role=heading][aria-level="3"]',
            ),
          ].map((n) => n.textContent),
          open: el.querySelector<HTMLElement>(
            "[data-welcome-step][data-open] [role=heading]",
          )?.textContent,
          help: [
            ...el.querySelectorAll<HTMLElement>("[data-welcome-help] a"),
          ].map((a) => a.getAttribute("href")),
          companion: el.textContent.includes("Companion"),
        };
      },
      undefined,
      {
        ready: (value) =>
          isDeepStrictEqual(value, {
            steps: [
              run.m.welcome_step_connect_title(),
              run.m.welcome_step_folder_title(),
              run.m.welcome_step_library_title(),
              run.m.welcome_step_companion_title(),
            ],
            // Zotero reads, so the folder is the one step still open.
            open: run.m.welcome_step_folder_title(),
            // The Help Links show beside the checklist.
            help: [
              "https://zotlit.aidenlx.site/docs",
              "https://zotlit.aidenlx.site/community",
              "https://github.com/aidenlx/zotlit",
              "https://zotlit.aidenlx.site/docs/reference/templates",
              "https://zotlit.aidenlx.site/docs/how-to/insert-citations",
              "https://zotlit.aidenlx.site/blog",
              "https://zotlit.aidenlx.site/changelog",
              "https://github.com/sponsors/aidenlx",
              "https://zotlit.aidenlx.site/docs/how-to/migrate-from-v1",
            ],
            // ZotLit Companion is the optional last step.
            companion: true,
          }),
        what: "the Welcome banner in the Library View to show its four setup steps",
      },
    );
    // Search your library puts the cursor in the Library View's own search
    // box, just under the banner.
    expect(
      await obRun(
        run.vaultId,
        async ({ app, page }, { welcomeActionSearchLabel }) => {
          const { press, until } = page;
          const el = (
            app.workspace.getLeavesOfType(
              "zotlit-library",
            ) as (WorkspaceLeaf & { view: LibraryView })[]
          )[0]!.view.contentEl;
          press(
            [
              ...(
                app.workspace.getLeavesOfType(
                  "zotlit-library",
                ) as (WorkspaceLeaf & { view: LibraryView })[]
              )[0]!.view.contentEl
                .querySelector<HTMLElement>("[data-welcome-banner]")!
                .querySelectorAll<HTMLElement>("button")!,
            ].find((n) => n.textContent === welcomeActionSearchLabel),
            "Search your library",
          );
          const input = el.querySelector<HTMLElement>(
            "[data-library-search] input",
          );
          await until(
            "search box focused",
            () => input!.ownerDocument.activeElement === input,
          );
          return !activeDocument.querySelector<HTMLElement>(".modal-container");
        },
        { welcomeActionSearchLabel: run.m.welcome_action_search() },
      ),
    ).toBe(true);
    // A notice over the tab's corner would cover the dismiss control.
    await clearNotices(run.vaultId);
    await obRun(
      run.vaultId,
      async ({ app, page }) => {
        const { press, until } = page;
        press(
          (
            app.workspace.getLeavesOfType(
              "zotlit-library",
            ) as (WorkspaceLeaf & { view: LibraryView })[]
          )[0]!.view.contentEl
            .querySelector<HTMLElement>("[data-welcome-banner]")!
            .querySelector<HTMLElement>("[data-welcome-dismiss]"),
          "Dismiss the welcome banner",
        );
        await until(
          "banner gone",
          () =>
            !(
              app.workspace.getLeavesOfType(
                "zotlit-library",
              ) as (WorkspaceLeaf & { view: LibraryView })[]
            )[0]!.view.contentEl.querySelector<HTMLElement>(
              "[data-welcome-banner]",
            ),
        );
      },
      undefined,
    );
    expect(
      await obRun(
        run.vaultId,
        async ({ zotlit }) => {
          return zotlit.services.bridge.runSync(
            zotlit.services.settings.current,
          )["welcome.dismissed"];
        },
        undefined,
      ),
    ).toBe(true);
    // The Welcome command shows it again.
    await obRun(
      run.vaultId,
      async ({ app }) => {
        app.commands.executeCommandById("zotlit:open-welcome-view");
      },
      undefined,
    );
    await obRunUntil(
      run.vaultId,
      async ({ app }) => {
        return !!(
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]!.view.contentEl.querySelector<HTMLElement>(
          "[data-welcome-banner]",
        );
      },
      undefined,
      { what: "the Welcome banner in the Library View to render" },
    );
    // So does the Welcome & help view action in the tab header, with the
    // setup steps, and focus moves to the banner; the action reads as
    // pressed while the banner shows, and a second press dismisses it.
    await obRun(
      run.vaultId,
      async ({ app, page }) => {
        const { press, until } = page;
        press(
          (
            app.workspace.getLeavesOfType(
              "zotlit-library",
            ) as (WorkspaceLeaf & { view: LibraryView })[]
          )[0]!.view.contentEl
            .querySelector<HTMLElement>("[data-welcome-banner]")!
            .querySelector<HTMLElement>("[data-welcome-dismiss]"),
          "Dismiss the welcome banner",
        );
        await until(
          "banner gone",
          () =>
            !(
              app.workspace.getLeavesOfType(
                "zotlit-library",
              ) as (WorkspaceLeaf & { view: LibraryView })[]
            )[0]!.view.contentEl.querySelector<HTMLElement>(
              "[data-welcome-banner]",
            ),
        );
      },
      undefined,
    );

    expect(
      await obRun(
        run.vaultId,
        async (
          { app, zotlit, page },
          { value, libraryViewHelpActionLabel },
        ) => {
          const { press, until } = page;
          const view = (
            app.workspace.getLeavesOfType(
              "zotlit-library",
            ) as (WorkspaceLeaf & { view: LibraryView })[]
          )[0]!.view;
          const before = {
            active: (
              app.workspace.getLeavesOfType(
                "zotlit-library",
              ) as (WorkspaceLeaf & { view: LibraryView })[]
            )[0]!.view.containerEl
              .querySelector<HTMLElement>(value)!
              .classList.contains("is-active"),
            pressed: (
              app.workspace.getLeavesOfType(
                "zotlit-library",
              ) as (WorkspaceLeaf & { view: LibraryView })[]
            )[0]!.view.containerEl
              .querySelector<HTMLElement>(value)!
              .getAttribute("aria-pressed"),
          };
          press(
            (
              app.workspace.getLeavesOfType(
                "zotlit-library",
              ) as (WorkspaceLeaf & { view: LibraryView })[]
            )[0]!.view.containerEl.querySelector<HTMLElement>(value),
            libraryViewHelpActionLabel,
          );
          const el = await until("banner back", () =>
            (
              app.workspace.getLeavesOfType(
                "zotlit-library",
              ) as (WorkspaceLeaf & { view: LibraryView })[]
            )[0]!.view.contentEl.querySelector<HTMLElement>(
              "[data-welcome-banner]",
            ),
          );
          await until(
            "banner focused",
            () => el.ownerDocument.activeElement === el,
          );
          const action = (
            app.workspace.getLeavesOfType(
              "zotlit-library",
            ) as (WorkspaceLeaf & { view: LibraryView })[]
          )[0]!.view.containerEl.querySelector<HTMLElement>(value);
          const pressed = {
            active: action!.classList.contains("is-active"),
            pressed: action!.getAttribute("aria-pressed"),
          };
          return JSON.stringify({
            before,
            dismissed: zotlit.services.bridge.runSync(
              zotlit.services.settings.current,
            )["welcome.dismissed"],
            steps: el.querySelectorAll<HTMLElement>("[data-welcome-step]")
              .length,
            rows: view.contentEl.querySelectorAll<HTMLElement>(
              "[data-welcome-help-row]",
            ).length,
            ...pressed,
          });
        },
        {
          value: `.view-actions .view-action[aria-label="${run.m.library_view_help_action()}"]`,
          libraryViewHelpActionLabel: run.m.library_view_help_action(),
        },
      ),
    ).toBe(
      JSON.stringify({
        before: { active: false, pressed: "false" },
        dismissed: false,
        steps: 4,
        rows: 0,
        active: true,
        pressed: "true",
      }),
    );
    expect(
      await obRun(
        run.vaultId,
        async (
          { app, zotlit, page },
          { value, libraryViewHelpActionLabel },
        ) => {
          const { press, until } = page;
          press(
            (
              app.workspace.getLeavesOfType(
                "zotlit-library",
              ) as (WorkspaceLeaf & { view: LibraryView })[]
            )[0]!.view.containerEl.querySelector<HTMLElement>(value),
            libraryViewHelpActionLabel,
          );
          await until(
            "banner gone",
            () =>
              !(
                app.workspace.getLeavesOfType(
                  "zotlit-library",
                ) as (WorkspaceLeaf & { view: LibraryView })[]
              )[0]!.view.contentEl.querySelector<HTMLElement>(
                "[data-welcome-banner]",
              ),
          );
          await zotlit.services.bridge.runPromise(
            zotlit.services.settings.flush,
          );
          const saved = JSON.parse(
            await app.vault.adapter.read(
              `${app.vault.configDir}/plugins/zotlit/data.json`,
            ),
          )["welcome.dismissed"];
          const action = (
            app.workspace.getLeavesOfType(
              "zotlit-library",
            ) as (WorkspaceLeaf & { view: LibraryView })[]
          )[0]!.view.containerEl.querySelector<HTMLElement>(value);
          const pressed = {
            active: action!.classList.contains("is-active"),
            pressed: action!.getAttribute("aria-pressed"),
          };
          return JSON.stringify({
            dismissed: zotlit.services.bridge.runSync(
              zotlit.services.settings.current,
            )["welcome.dismissed"],
            saved,
            ...pressed,
          });
        },
        {
          value: `.view-actions .view-action[aria-label="${run.m.library_view_help_action()}"]`,
          libraryViewHelpActionLabel: run.m.library_view_help_action(),
        },
      ),
    ).toBe(
      JSON.stringify({
        dismissed: true,
        saved: true,
        active: false,
        pressed: "false",
      }),
    );

    // ZotLit reads a folder without Zotero's database: the tree and the
    // list say so and offer to locate it, in place of the papers. A narrow
    // pane keeps the tree out of view, and the list says it alone.

    const listed = (await obRun(
      run.vaultId,
      async ({ app }) => {
        const view = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]!.view;
        await view.query.settled;
        const el = view.contentEl;
        return {
          missing:
            el.querySelector<HTMLElement>("[data-zotero-missing]") !== null,
          rows: [
            ...el.querySelectorAll<HTMLElement>(
              'tr[data-query-table-row="item"], [data-query-papers-row]',
            ),
          ].map(
            (n) =>
              n.getAttribute("data-query-key")! ??
              n.getAttribute("data-query-papers-row")!,
          ),
        };
      },
      undefined,
    )) as {
      rows: string[];
    };
    expect(listed.rows.length).toBeGreaterThan(0);
    const emptyDir = join(e2eFixture.root, "library-not-found");
    await mkdir(emptyDir, { recursive: true });
    cleanup.defer(() => rm(emptyDir, { recursive: true, force: true }));
    await obRun(
      run.vaultId,
      async ({ zotlit }, { emptydir }) => {
        zotlit.services.bridge.runSync(
          zotlit.services.zoteroPref.setDataDir(emptydir),
        );
      },
      { emptydir: emptyDir },
    );

    await obRunUntil(
      run.vaultId,
      async ({ app }) => {
        const el = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]!.view.contentEl;
        const shown = (n: Element | null) => !!n && n.checkVisibility();
        const part = (name: string) =>
          el.querySelector<HTMLElement>(`[data-library-not-found="${name}"]`);
        const pane = el.querySelector<HTMLElement>("[data-library-tree]");
        return {
          tree:
            shown(part("tree")) || getComputedStyle(pane!).display === "none"
              ? part("tree")!.textContent
              : null,
          list: shown(part("list"))
            ? [...part("list")!.querySelectorAll<HTMLElement>("button")].map(
                (b) => b.textContent,
              )
            : null,
          papers: [
            ...el.querySelectorAll<HTMLElement>(
              "[data-query-table], [data-query-layout]",
            ),
          ].some(shown),
          search: shown(el.querySelector<HTMLElement>("[data-library-search]")),
          nodes: [
            ...el.querySelectorAll<HTMLElement>("[data-library-node]"),
          ].some(shown),
          facets: [
            ...el.querySelectorAll<HTMLElement>("[data-library-facet]"),
          ].some(shown),
        };
      },
      undefined,
      {
        ready: (value) =>
          isDeepStrictEqual(value, {
            tree: run.m.library_view_not_found(),
            list: [
              run.m.library_view_locate(),
              run.m.welcome_action_open_settings(),
            ],
            papers: false,
            search: false,
            nodes: false,
            facets: false,
          }),
        tries: 120,
        what: "the Library View to show the not-found tree message and hide the papers",
      },
    );

    // "Locate data folder" saves the folder the system dialog returns; the
    // case sets the same folder, since no reader can press a native dialog.
    await obRun(
      run.vaultId,
      async ({ zotlit }, { dataDir }) => {
        zotlit.services.bridge.runSync(
          zotlit.services.zoteroPref.setDataDir(dataDir),
        );
      },
      { dataDir: JSON.parse(snapshot).dataDir },
    );
    // The papers the Library View listed before come back.
    await obRunUntil(
      run.vaultId,
      async ({ app }) => {
        const view = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]!.view;
        await view.query.settled;
        const el = view.contentEl;
        return {
          missing:
            el.querySelector<HTMLElement>("[data-zotero-missing]") !== null,
          rows: [
            ...el.querySelectorAll<HTMLElement>(
              'tr[data-query-table-row="item"], [data-query-papers-row]',
            ),
          ].map(
            (n) =>
              n.getAttribute("data-query-key")! ??
              n.getAttribute("data-query-papers-row")!,
          ),
        };
      },
      undefined,
      {
        ready: (value) =>
          isDeepStrictEqual(value, { missing: false, rows: listed.rows }),
        tries: 120,
        what: "the Library View to list the papers it showed before the reload",
      },
    );
  });

  it("leaves the search box unfocused on a fresh install's first screen, under the Welcome View banner", async () => {
    const aside = "zotlit-e2e-literature-aside";
    /** Start ZotLit as a fresh install, with no plugin data. */

    const snapshot = await obRun(
      run.vaultId,
      async ({ app }) => {
        return JSON.stringify({
          layout: app.workspace.getLayout(),
          data: await app.vault.adapter.read(
            `${app.vault.configDir}/plugins/zotlit/data.json`,
          ),
        });
      },
      undefined,
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obRun(
        run.vaultId,
        async ({ app, zotlit }, { snapshot, aside }) => {
          const saved = JSON.parse(snapshot);
          await zotlit.services.bridge.runPromise(
            zotlit.services.settings.flush,
          );
          const folder = zotlit.services.bridge.runSync(
            zotlit.services.settings.current,
          )["note.default-profile"].bindings["note.literature-folder"];
          await app.plugins.disablePlugin("zotlit");
          if (await app.vault.adapter.exists(aside))
            await app.vault.adapter.rename(aside, folder);
          await app.vault.adapter.write(
            `${app.vault.configDir}/plugins/zotlit/data.json`,
            saved.data,
          );
          await app.plugins.enablePlugin("zotlit");
          await app.workspace.changeLayout(saved.layout);
        },
        { snapshot: snapshot, aside: aside },
      );
    });
    // A fresh install whose literature-notes folder is missing: setup is
    // incomplete, and the release check opens the Library View with the
    // Welcome View banner above it.
    await obRun(
      run.vaultId,
      async ({ app, zotlit }) => {
        (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        ).forEach((leaf) => leaf.detach());
        await zotlit.services.bridge.runPromise(zotlit.services.settings.flush);

        await app.plugins.disablePlugin("zotlit");
        await app.vault.adapter.remove(
          `${app.vault.configDir}/plugins/zotlit/data.json`,
        );
        await app.plugins.enablePlugin("zotlit");
        await zotlit.services.bridge.runPromise(
          zotlit.services.release.checked,
        );
      },
      undefined,
    );
    await obRun(
      run.vaultId,
      async ({ app, zotlit }, { aside }) => {
        (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        ).forEach((leaf) => leaf.detach());
        await zotlit.services.bridge.runPromise(zotlit.services.settings.flush);
        const folder = zotlit.services.bridge.runSync(
          zotlit.services.settings.current,
        )["note.default-profile"].bindings["note.literature-folder"];
        await app.plugins.disablePlugin("zotlit");
        await app.vault.adapter.remove(
          `${app.vault.configDir}/plugins/zotlit/data.json`,
        );
        if (folder && (await app.vault.adapter.exists(folder)))
          await app.vault.adapter.rename(folder, aside);
        await app.plugins.enablePlugin("zotlit");
        await zotlit.services.bridge.runPromise(
          zotlit.services.release.checked,
        );
      },
      { aside: aside },
    );
    // Once the banner settles, the cursor is not in the box right under it.
    expect(
      await obRun(
        run.vaultId,
        async ({ app, page }) => {
          const { until } = page;
          const view = await until(
            "the Library View",
            () =>
              (
                app.workspace.getLeavesOfType(
                  "zotlit-library",
                ) as (WorkspaceLeaf & { view: LibraryView })[]
              )[0]?.view.search &&
              (
                app.workspace.getLeavesOfType(
                  "zotlit-library",
                ) as (WorkspaceLeaf & { view: LibraryView })[]
              )[0]!.view,
            10000,
          );
          await until(
            "banner",
            () =>
              view.contentEl.querySelector<HTMLElement>(
                "[data-welcome-banner]",
              ),
            10000,
          );
          await view.welcome.settled;
          await view.arrived;
          await view.searched;
          await new Promise((r) =>
            requestAnimationFrame(() => requestAnimationFrame(r)),
          );
          const input = view.contentEl.querySelector<HTMLElement>(
            "[data-library-search] input",
          );
          return {
            banner: view.welcome.shown,
            focused: input!.ownerDocument.activeElement === input,
          };
        },
        undefined,
      ),
    ).toEqual({ banner: true, focused: false });
  });

  it("opens the Library View after an update of ZotLit in its own tab beside the open note, with no notice, and announces the update in the banner beside the Help Links until What's new acknowledges it", async () => {
    const snapshot = await obRun(
      run.vaultId,
      async ({ app, zotlit }) => {
        await zotlit.services.bridge.runPromise(zotlit.services.settings.flush);
        return JSON.stringify({
          layout: app.workspace.getLayout(),
          data: await app.vault.adapter.read(
            `${app.vault.configDir}/plugins/zotlit/data.json`,
          ),
        });
      },
      undefined,
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obRun(
        run.vaultId,
        async ({ app, zotlit }, { snapshot }) => {
          const saved = JSON.parse(snapshot);
          await zotlit.services.bridge.runPromise(
            zotlit.services.settings.flush,
          );
          await app.plugins.disablePlugin("zotlit");
          await app.vault.adapter.write(
            `${app.vault.configDir}/plugins/zotlit/data.json`,
            saved.data,
          );
          await app.plugins.enablePlugin("zotlit");
          await app.workspace.changeLayout(saved.layout);
        },
        { snapshot: snapshot },
      );
    });
    /** Reload the plugin and wait for its release check to open what it opens. */

    // The plugin data of a set-up vault that last ran an older release and
    // put the banner away after setup.
    const seeded = {
      ...(JSON.parse(JSON.parse(snapshot).data) as Record<string, unknown>),
      "release.previous-version": "2.1.0",
      "release.notices-enabled": true,
      "welcome.dismissed": true,
    };
    // The researcher has a note open in the active leaf.
    const note = (await obRun(
      run.vaultId,
      async ({ app }) => {
        (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        ).forEach((leaf) => leaf.detach());
        const file = app.vault.getMarkdownFiles()[0];
        const leaf = app.workspace.getLeaf(false);
        await leaf.openFile(file!);
        app.workspace.setActiveLeaf(leaf);
        return { id: leaf.id, path: file!.path };
      },
      undefined,
    )) as { id: string; path: string };
    await clearNotices(run.vaultId);
    await obRun(
      run.vaultId,
      async ({ app, zotlit }, { JSONStringifyResult }) => {
        (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        ).forEach((leaf) => leaf.detach());
        await zotlit.services.bridge.runPromise(zotlit.services.settings.flush);
        await app.plugins.disablePlugin("zotlit");
        await app.vault.adapter.write(
          `${app.vault.configDir}/plugins/zotlit/data.json`,
          JSONStringifyResult,
        );
        await app.plugins.enablePlugin("zotlit");
        await zotlit.services.bridge.runPromise(
          zotlit.services.release.checked,
        );
      },
      { JSONStringifyResult: JSON.stringify(seeded) },
    );
    // The Library View opens in its own tab: the note's leaf keeps its note.
    expect(
      await obRun(
        run.vaultId,
        async ({ app }, { noteId }) => {
          return JSON.stringify({
            note: (app.workspace.getLeafById(noteId)!.view as FileView).file
              ?.path,
            library: (
              app.workspace.getLeavesOfType(
                "zotlit-library",
              ) as (WorkspaceLeaf & { view: LibraryView })[]
            ).map((leaf) => leaf.id !== noteId),
          });
        },
        { noteId: note.id },
      ),
    ).toBe(JSON.stringify({ note: note.path, library: [true] }));

    const version = await obRun(
      run.vaultId,
      async ({ zotlit }) => {
        return zotlit.services.release.version;
      },
      undefined,
    );
    await obRunUntil(
      run.vaultId,
      async ({ app }) => {
        const el = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]!.view.contentEl.querySelector<HTMLElement>(
          "[data-welcome-banner]",
        );
        return {
          library: (
            app.workspace.getLeavesOfType(
              "zotlit-library",
            ) as (WorkspaceLeaf & { view: LibraryView })[]
          ).length,
          banner: !!el && {
            badge: el.querySelector<HTMLElement>("[data-welcome-badge]")
              ?.textContent,
            headings: [
              ...el.querySelectorAll<HTMLElement>(
                '[role=heading][aria-level="3"]',
              ),
            ].map((n) => n.textContent),
            buttons: [...el.querySelectorAll<HTMLElement>("button")]
              .map((n) => n.textContent)
              .filter(Boolean),
            help: el.querySelectorAll<HTMLElement>("[data-welcome-help] a")
              .length,
          },
          notices:
            activeDocument.querySelectorAll<HTMLElement>(".notice").length,
        };
      },
      undefined,
      {
        ready: (value) =>
          isDeepStrictEqual(value, {
            library: 1,
            banner: {
              badge: run.m.welcome_badge_updated(),
              // The update alone: setup is done.
              headings: [run.m.welcome_update_title({ version })],
              buttons: [run.m.welcome_update_action()],
              help: 9,
            },
            // The banner says it in place of the update notice.
            notices: 0,
          }),
        what: "the Welcome banner to announce the ZotLit update in the Library View",
      },
    );
    expect(
      await obRun(
        run.vaultId,
        async ({ zotlit }) => {
          return zotlit.services.bridge.runSync(
            zotlit.services.settings.current,
          )["release.update-pending"];
        },
        undefined,
      ),
    ).toBe(true);

    // "What's new" opens the Release Note and acknowledges the update.
    expect(
      await obRun(
        run.vaultId,
        async ({ app, zotlit, page }, { welcomeUpdateActionLabel }) => {
          const { press, until } = page;
          const opened: string[] = [];
          const open = window.open;
          window.open = (url) => {
            opened.push(String(url));
            return null;
          };
          const before = new Set(app.workspace.getLeavesOfType("webviewer"));
          try {
            press(
              [
                ...(
                  app.workspace.getLeavesOfType(
                    "zotlit-library",
                  ) as (WorkspaceLeaf & { view: LibraryView })[]
                )[0]!.view.contentEl
                  .querySelector<HTMLElement>("[data-welcome-banner]")!
                  .querySelectorAll<HTMLElement>("button")!,
              ].find((n) => n.textContent === welcomeUpdateActionLabel),
              "What's new",
            );
            await until(
              "banner gone",
              () =>
                !(
                  app.workspace.getLeavesOfType(
                    "zotlit-library",
                  ) as (WorkspaceLeaf & { view: LibraryView })[]
                )[0]!.view.contentEl.querySelector<HTMLElement>(
                  "[data-welcome-banner]",
                ),
            );
          } finally {
            window.open = open;
          }
          const leaves = app.workspace
            .getLeavesOfType("webviewer")
            .filter((leaf) => !before.has(leaf));
          const urls = [
            ...opened,
            ...leaves.map((leaf) => leaf.view.getState().url),
          ];
          leaves.forEach((leaf) => leaf.detach());
          return JSON.stringify({
            urls,
            pending: zotlit.services.bridge.runSync(
              zotlit.services.settings.current,
            )["release.update-pending"],
          });
        },
        { welcomeUpdateActionLabel: run.m.welcome_update_action() },
      ),
    ).toBe(
      JSON.stringify({
        urls: [`https://zotlit.aidenlx.site/changelog/${version}`],
        pending: false,
      }),
    );

    // The next launch announces nothing: no Library View opens, and the one
    // the command opens shows no banner.
    await obRun(
      run.vaultId,
      async ({ app, zotlit }) => {
        (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        ).forEach((leaf) => leaf.detach());
        await zotlit.services.bridge.runPromise(zotlit.services.settings.flush);
        await app.plugins.disablePlugin("zotlit");
        await app.plugins.enablePlugin("zotlit");
        await zotlit.services.bridge.runPromise(
          zotlit.services.release.checked,
        );
      },
      undefined,
    );
    expect(
      await obRun(
        run.vaultId,
        async ({ app, page }) => {
          const opened = (
            app.workspace.getLeavesOfType(
              "zotlit-library",
            ) as (WorkspaceLeaf & { view: LibraryView })[]
          ).length;
          app.commands.executeCommandById("zotlit:open-library-view");
          const { until } = page;
          await until(
            "library view",
            () =>
              (
                app.workspace.getLeavesOfType(
                  "zotlit-library",
                ) as (WorkspaceLeaf & { view: LibraryView })[]
              )[0]!.view.contentEl,
          );
          await new Promise((r) => setTimeout(r, 500));
          return JSON.stringify({
            opened,
            banner: !!(
              app.workspace.getLeavesOfType(
                "zotlit-library",
              ) as (WorkspaceLeaf & { view: LibraryView })[]
            )[0]!.view.contentEl.querySelector<HTMLElement>(
              "[data-welcome-banner]",
            ),
          });
        },
        undefined,
      ),
    ).toBe(JSON.stringify({ opened: 0, banner: false }));

    // An update beside the template conversion: the badge still says
    // Updated, the done steps fold into one line, and the conversion's long
    // explanation waits behind How it works. The vault holds converted
    // templates, so the load clears a saved offer; the offer is armed after
    // it, as the template service does.
    await obRun(
      run.vaultId,
      async ({ app, zotlit }, { JSONStringifyResult }) => {
        (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        ).forEach((leaf) => leaf.detach());
        await zotlit.services.bridge.runPromise(zotlit.services.settings.flush);
        await app.plugins.disablePlugin("zotlit");
        await app.vault.adapter.write(
          `${app.vault.configDir}/plugins/zotlit/data.json`,
          JSONStringifyResult,
        );
        await app.plugins.enablePlugin("zotlit");
        await zotlit.services.bridge.runPromise(
          zotlit.services.release.checked,
        );
      },
      {
        JSONStringifyResult: JSON.stringify({
          ...seeded,
          "welcome.dismissed": false,
        }),
      },
    );
    await obRun(
      run.vaultId,
      async ({ zotlit }) => {
        return (
          zotlit.services.bridge.runSync(
            zotlit.services.settings.update({
              "note.template-conversion-pending": true,
            }),
          ),
          true
        );
      },
      undefined,
    );
    await obRunUntil(
      run.vaultId,
      async ({ app }) => {
        const el = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]!.view.contentEl.querySelector<HTMLElement>(
          "[data-welcome-banner]",
        );
        return (
          !!el && {
            badge: el.querySelector<HTMLElement>("[data-welcome-badge]")
              ?.textContent,
            headings: [
              ...el.querySelectorAll<HTMLElement>(
                '[role=heading][aria-level="3"]',
              ),
            ].map((n) => n.textContent),
            folded: !!el.querySelector<HTMLElement>(
              "[data-welcome-setup-done]",
            ),
            how: [...el.querySelectorAll<HTMLDetailsElement>("details")].map(
              (d) =>
                `${d.open}:${d.querySelector<HTMLElement>("summary")!.textContent}`,
            ),
          }
        );
      },
      undefined,
      {
        ready: (value) =>
          isDeepStrictEqual(value, {
            badge: run.m.welcome_badge_updated(),
            headings: [
              run.m.welcome_update_title({ version }),
              run.m.welcome_template_conversion_title(),
            ],
            folded: true,
            how: [`false:${run.m.welcome_how_it_works()}`],
          }),
        what: "the Welcome banner to fold setup and list the update headings",
      },
    );

    // The dismiss button puts every combination away, and it stays away
    // after a reload, until a later update.
    await obRun(
      run.vaultId,
      async ({ app, page }) => {
        const { press, until } = page;
        press(
          (
            app.workspace.getLeavesOfType(
              "zotlit-library",
            ) as (WorkspaceLeaf & { view: LibraryView })[]
          )[0]!.view.contentEl
            .querySelector<HTMLElement>("[data-welcome-banner]")!
            .querySelector<HTMLElement>("[data-welcome-dismiss]"),
          "Dismiss the welcome banner",
        );
        await until(
          "banner gone",
          () =>
            !(
              app.workspace.getLeavesOfType(
                "zotlit-library",
              ) as (WorkspaceLeaf & { view: LibraryView })[]
            )[0]!.view.contentEl.querySelector<HTMLElement>(
              "[data-welcome-banner]",
            ),
        );
      },
      undefined,
    );
    await obRun(
      run.vaultId,
      async ({ app, zotlit }) => {
        (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        ).forEach((leaf) => leaf.detach());
        await zotlit.services.bridge.runPromise(zotlit.services.settings.flush);
        await app.plugins.disablePlugin("zotlit");
        await app.plugins.enablePlugin("zotlit");
        await zotlit.services.bridge.runPromise(
          zotlit.services.release.checked,
        );
      },
      undefined,
    );
    expect(
      await obRun(
        run.vaultId,
        async ({ app, zotlit, page }) => {
          app.commands.executeCommandById("zotlit:open-library-view");
          const { until } = page;
          await until(
            "library view",
            () =>
              (
                app.workspace.getLeavesOfType(
                  "zotlit-library",
                ) as (WorkspaceLeaf & { view: LibraryView })[]
              )[0]!.view.contentEl,
          );
          await new Promise((r) => setTimeout(r, 500));
          return JSON.stringify({
            banner: !!(
              app.workspace.getLeavesOfType(
                "zotlit-library",
              ) as (WorkspaceLeaf & { view: LibraryView })[]
            )[0]!.view.contentEl.querySelector<HTMLElement>(
              "[data-welcome-banner]",
            ),
            dismissed: zotlit.services.bridge.runSync(
              zotlit.services.settings.current,
            )["welcome.dismissed"],
            update: zotlit.services.bridge.runSync(
              zotlit.services.settings.current,
            )["release.update-pending"],
          });
        },
        undefined,
      ),
    ).toBe(JSON.stringify({ banner: false, dismissed: true, update: false }));
  });

  it("lays the Welcome View banner out on one start edge, in a column centered beside Help Links pinned to the pane's end, with the first section and the Help Links on one top line, at a wide, a medium and a narrow pane, for an incomplete setup and for an update beside the folded Setup done line", async () => {
    const keys = [
      "welcome.dismissed",
      "welcome.requested",
      "welcome.steps-shown",
      "release.update-pending",
      "release.notices-enabled",
      "note.template-conversion-pending",
    ] as const;
    const snapshot = await obRun(
      run.vaultId,
      async ({ app, zotlit }, { keys }) => {
        return JSON.stringify({
          layout: app.workspace.getLayout(),
          size: require("@electron/remote").getCurrentWindow().getSize(),
          folder: zotlit.services.bridge.runSync(
            zotlit.services.settings.current,
          )["note.default-profile"].bindings["note.literature-folder"],
          settings: Object.fromEntries(
            keys.map((k) => [
              k,
              zotlit.services.bridge.runSync(zotlit.services.settings.current)[
                k
              ],
            ]),
          ),
        });
      },
      { keys: keys },
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obRun(
        run.vaultId,
        async ({ app, zotlit }, { snapshot }) => {
          const saved = JSON.parse(snapshot);
          const { settings, bridge } = zotlit.services;
          bridge.runSync(settings.update(saved.settings));
          bridge.runSync(
            settings.updateDefaultLiteratureNoteProfileBindings({
              "note.literature-folder": saved.folder,
            }),
          );
          await bridge.runPromise(settings.flush);
          require("@electron/remote")
            .getCurrentWindow()
            .setSize(...saved.size);
          await app.workspace.changeLayout(saved.layout);
        },
        { snapshot: snapshot },
      );
    });
    const { folder } = JSON.parse(snapshot) as { folder: string };
    const created = await obRun(
      run.vaultId,
      async ({ app }, { folder }) => {
        if (app.vault.getFolderByPath(folder)) return "false";
        await app.vault.createFolder(folder);
        return "true";
      },
      { folder: folder },
    );
    if (created === "true")
      cleanup.defer(async () => {
        await obRun(
          run.vaultId,
          async ({ app }, { folder }) => {
            const f = app.vault.getFolderByPath(folder);
            if (f) await app.vault.delete(f, true);
          },
          { folder: folder },
        );
      });
    await obRun(
      run.vaultId,
      async ({ app }) => {
        app.workspace.leftSplit.collapse();
        app.workspace.rightSplit.collapse();
        (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        ).forEach((leaf) => leaf.detach());
        app.commands.executeCommandById("zotlit:open-library-view");
        const leaf = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0];
        await app.workspace.revealLeaf(leaf!);
        app.workspace.setActiveLeaf(leaf!, { focus: true });
      },
      undefined,
    );

    /** The rects that carry the banner's edges, in CSS pixels. */
    interface Box {
      l: number;
      r: number;
      t: number;
      b: number;
    }
    interface Layout {
      banner: Box;
      contentStart: number;
      contentEnd: number;
      gap: number;
      lockup: Box;
      marks: Box[];
      notices: Box[];
      surfaces: Box[];
      header: Box;
      column: Box;
      first: Box;
      help: Box;
      tiles: Box[];
      dismiss: Box;
      glyph: Box;
    }
    /** The sections each case's banner renders, which the measure waits for. */

    /**
     * Measure the banner once the window is `width` wide, the banner's
     * connection readout has landed and it renders `sections`.
     */

    const shots = join(workspaceRoot, ".scratch/e2e-screenshots");
    await mkdir(shots, { recursive: true });
    const cases = {
      // Setup is incomplete: the literature-notes folder is missing, so its
      // step opens on the accent surface.
      setup: {
        settings: {
          "welcome.dismissed": false,
          "welcome.requested": true,
          "welcome.steps-shown": false,
          "release.update-pending": false,
          "note.template-conversion-pending": false,
        },
        sections: { open: 1, done: 0, callouts: 0 },
      },
      // An update beside the template conversion, with the done steps
      // folded into Setup done.
      update: {
        settings: {
          "welcome.dismissed": false,
          "welcome.requested": false,
          "welcome.steps-shown": false,
          "release.update-pending": true,
          "release.notices-enabled": true,
          "note.template-conversion-pending": true,
        },
        sections: { open: 0, done: 1, callouts: 2 },
      },
    };
    const widths = { wide: 1750, medium: 1050, narrow: 740 };
    const results: Record<string, Layout> = {};
    for (const [name, { settings, sections }] of Object.entries(cases)) {
      await obRun(
        run.vaultId,
        async ({ zotlit }, { choice, settingsInput }) => {
          const { settings, bridge } = zotlit.services;
          bridge.runSync(
            settings.updateDefaultLiteratureNoteProfileBindings({
              "note.literature-folder": choice,
            }),
          );
          bridge.runSync(settings.update(settingsInput));
          await bridge.runPromise(settings.flush);
        },
        {
          choice:
            name === "setup" ? "Banner alignment, not yet created" : folder,
          settingsInput: settings,
        },
      );
      for (const [size, width] of Object.entries(widths)) {
        await obRun(
          run.vaultId,
          async (_context, { width }) => {
            require("@electron/remote").getCurrentWindow().setSize(width, 900);
          },
          { width: width },
        );
        const label = `${name}-${size}`;
        results[label] = (await obRun(
          run.vaultId,
          async (
            { app, page },
            { width, sectionsOpen, sectionsDone, sectionsCallouts },
          ) => {
            const { until } = page;
            const view = (
              app.workspace.getLeavesOfType(
                "zotlit-library",
              ) as (WorkspaceLeaf & { view: LibraryView })[]
            )[0]?.view;
            await until(
              `the window at ${width}px`,
              () => activeWindow.outerWidth === width,
              5000,
            );
            await view!.welcome.decided;
            await view!.welcome.settled;
            const el = view!.contentEl;
            const b = await until(
              "the banner sections",
              () => {
                const b = el.querySelector<HTMLElement>(
                  "[data-welcome-banner]",
                );
                return (
                  b &&
                  b.querySelectorAll<HTMLElement>(
                    "[data-welcome-step][data-open]",
                  ).length === sectionsOpen &&
                  b.querySelectorAll<HTMLElement>("[data-welcome-setup-done]")
                    .length === sectionsDone &&
                  b.querySelectorAll<HTMLElement>("[data-welcome-callout]")
                    .length === sectionsCallouts &&
                  b
                );
              },
              5000,
            );
            await new Promise((r) =>
              requestAnimationFrame(() => requestAnimationFrame(r)),
            );
            const R = (n: Element | null) => {
              const r = n!.getBoundingClientRect();
              return { l: r.left, r: r.right, t: r.top, b: r.bottom };
            };
            const all = (...s: string[]) => {
              for (const q of s) {
                const n = [...b.querySelectorAll<HTMLElement>(q)];
                if (n.length) return n;
              }
              return [];
            };
            const cs = getComputedStyle(b);
            const help = b.querySelector<HTMLElement>("[data-welcome-help]");
            const column =
              b.querySelector<HTMLElement>("[data-welcome-column]") ??
              help!.parentElement!.firstElementChild;
            const grid = help!.parentElement;
            const notices = [
              ...b.querySelectorAll<HTMLElement>(
                '[role=heading][aria-level="3"]',
              ),
            ].filter((n) => !n.closest<HTMLElement>("[data-welcome-step]"));
            const banner = R(b);
            return {
              banner,
              contentStart: banner.l + Number.parseFloat(cs.paddingLeft),
              contentEnd: banner.r - Number.parseFloat(cs.paddingRight),
              gap: Number.parseFloat(getComputedStyle(grid!).columnGap) || 0,
              lockup: R(
                b.querySelector<HTMLElement>("[data-welcome-lockup]") ??
                  b.querySelector<HTMLElement>(
                    '[role=heading][aria-level="2"]',
                  ),
              ),
              marks: all(
                "[data-welcome-mark]",
                "[data-welcome-step] > div > span:first-child, [data-welcome-setup-done] > span:first-child",
              ).map(R),
              notices: notices.map(R),
              surfaces: [
                ...b.querySelectorAll<HTMLElement>(
                  "[data-welcome-step][data-open]",
                ),
                ...notices.map(
                  (n) =>
                    n.closest<HTMLElement>("[data-welcome-callout]") ??
                    n.parentElement!.parentElement,
                ),
              ].map(R),
              header: R(b.querySelector<HTMLElement>("header")),
              column: R(column),
              first: R(column!.firstElementChild),
              help: R(help),
              tiles: all(
                "[data-welcome-help-tile]",
                "[data-welcome-help] > div > a",
              ).map(R),
              dismiss: R(
                b.querySelector<HTMLElement>("[data-welcome-dismiss]"),
              ),
              glyph: R(
                b.querySelector<HTMLElement>("[data-welcome-dismiss] svg"),
              ),
            };
          },
          {
            width: width,
            sectionsOpen: sections.open,
            sectionsDone: sections.done,
            sectionsCallouts: sections.callouts,
          },
        )) as Layout;
        await cli([
          `vault=${run.vaultId}`,
          "dev:screenshot",
          `path=${join(shots, `banner-${label}.png`)}`,
        ]);
      }
    }
    console.log(`banner layout: ${JSON.stringify(results)}`);

    const near = (a: number, b: number) => Math.abs(a - b) <= 1;
    const overlaps = (a: Box, b: Box) =>
      a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
    for (const [label, at] of Object.entries(results)) {
      const stacked = at.help.t >= at.column.b;
      const edges = [at.lockup, ...at.marks, ...at.notices].map((n) => n.l);
      const check = {
        label,
        // The banner keeps one inline margin at both of the pane's edges.
        margins: near(
          at.contentStart - at.banner.l,
          at.banner.r - at.contentEnd,
        ),
        // The lockup, the step marks and the notices' text share one start
        // edge, the centered column's.
        edge: edges.every((x) => near(x, at.column.l)),
        // Each tinted surface hangs outside that edge, inside the banner and
        // clear of the Help Links.
        hang: at.surfaces.every(
          (s) =>
            s.l < at.column.l &&
            s.l >= at.banner.l &&
            (stacked ? s.r <= at.banner.r : s.r <= at.help.l),
        ),
        // The Help Links end at the banner's content end.
        helpEnd: near(at.help.r, at.contentEnd),
        // Beside each other, the column is centered in the space before the
        // Help Links, and the first section starts on their top line;
        // stacked, the column takes the full width.
        column: stacked
          ? near(at.column.l, at.contentStart) &&
            near(at.column.r, at.contentEnd)
          : near(
              at.column.l - at.contentStart,
              at.help.l - at.gap - at.column.r,
            ),
        top: stacked || near(at.first.t, at.help.t),
        // The dismiss button sits on the title's line, its glyph ending on
        // the banner's content end, clear of every tile.
        dismiss:
          near(
            (at.glyph.t + at.glyph.b) / 2,
            (at.lockup.t + at.lockup.b) / 2,
          ) &&
          near(at.glyph.r, at.contentEnd) &&
          at.tiles.every((tile) => !overlaps(at.dismiss, tile)),
      };
      expect(check).toEqual({
        label,
        margins: true,
        edge: true,
        hang: true,
        helpEnd: true,
        column: true,
        top: true,
        dismiss: true,
      });
    }
    // The narrow pane stacks the column, and the wide ones do not.
    expect(
      Object.entries(results).map(([label, at]) => [
        label,
        at.help.t >= at.column.b,
      ]),
    ).toEqual(
      Object.keys(results).map((label) => [label, label.endsWith("narrow")]),
    );
  });
});
