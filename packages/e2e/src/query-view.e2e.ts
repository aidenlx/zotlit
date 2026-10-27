import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { describe, expect, it } from "vitest";

import { reachable } from "./e2e-run-fixture.ts";
import { annotationItem, workspaceRoot } from "./e2e-run-fixture.ts";
import { registerEndToEndRunHooks, run } from "./e2e-run-lifecycle.ts";
import { byItem } from "./e2e-run-query-types.ts";
import type { ItemQueryReport } from "./e2e-run-query-types.ts";
import { readQueryViewUntil, revealQueryView } from "./note-query-view.ts";
import type { NoteQueryView, QueryViewTarget } from "./note-query-view.ts";
import { obRun } from "./obsidian-cli.ts";
import { obRunUntil } from "./obsidian-cli.ts";
import { cliCommand, waitFor } from "./obsidian-cli.ts";
import type { CodeMirrorContent } from "./page-query-types.ts";
import type { QueryPrintModal, PrintedQueryPage } from "./page-query-types.ts";

describe.skipIf(!reachable)("End-to-end Run", () => {
  registerEndToEndRunHooks();

  it("shows a Query File toolbar as icons with tooltips on a narrow pane, and with names on a wide one", async () => {
    const layout = await obRun(
      run.vaultId,
      async ({ app }) => {
        return String(JSON.stringify(app.workspace.getLayout()));
      },
      undefined,
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obRun(
        run.vaultId,
        async ({ app, page: pageHelpers }, { __typedArg0 }) => {
          delete pageHelpers.scratch.zotlitE2EPanes;
          await app.workspace.changeLayout(JSON.parse(__typedArg0));
          return String(true);
        },
        { __typedArg0: layout },
      );
    });
    // The Fixture's Query File in two panes side by side: one wide, one
    // narrow, as a user drags the divider.
    await obRun(
      run.vaultId,
      async ({ app, page: pageHelpers }) => {
        app.workspace.leftSplit.collapse();
        app.workspace.rightSplit.collapse();
        const file = app.vault.getFileByPath(
          "query-files/Reading annotations.zotquery",
        )!;
        const wide = app.workspace.getLeaf("tab");
        await wide.openFile(file!);
        app.workspace.setActiveLeaf(wide, { focus: true });
        const narrow = app.workspace.createLeafBySplit(wide, "vertical");
        await narrow.openFile(file!);
        await Promise.all([
          (wide.view as import("@/views/query-view/file-view").QueryFileView)
            .query.settled,
          (narrow.view as import("@/views/query-view/file-view").QueryFileView)
            .query.settled,
        ]);
        (
          wide.parent as typeof wide.parent & {
            setDimension(percent: number): void;
          }
        ).setDimension(80);
        (
          narrow.parent as typeof narrow.parent & {
            setDimension(percent: number): void;
          }
        ).setDimension(20);
        pageHelpers.scratch.zotlitE2EPanes = { wide, narrow };
        return String(true);
      },
      undefined,
    );
    const names = {
      filter: run.m.query_view_filter(),
      sort: run.m.query_view_sort(),
      group: run.m.query_view_group(),
      properties: run.m.query_view_properties(),
      search: run.m.query_view_search(),
    };
    /** Each toolbar button's tooltip text and whether its name shows beside its icon. */
    // The sidebars fold with an animation; a width the same over three frames
    // is the settled pane.

    interface Pane {
      width: number;
      overflow: boolean;
      buttons: Record<
        string,
        { tooltip: string | null; nameShown: boolean; iconShown: boolean }
      >;
    }
    const each = (nameShown: boolean) =>
      Object.fromEntries(
        Object.entries(names).map(([hook, name]) => [
          hook,
          { tooltip: name, nameShown, iconShown: true },
        ]),
      );

    const narrow = JSON.parse(
      await obRun(
        run.vaultId,
        async ({ page: pageHelpers }, { __typedArg0 }) => {
          const { until } = pageHelpers;
          const bar = (
            pageHelpers.scratch.zotlitE2EPanes!.narrow
              .view as import("obsidian").ItemView
          ).contentEl.querySelector<HTMLElement>('[role="toolbar"]')!;
          let last = -1,
            steady = 0;
          await until("toolbar width settles", async () => {
            await new Promise((r) => requestAnimationFrame(r));
            const width = bar!.clientWidth;
            steady = width > 0 && width === last ? steady + 1 : 0;
            last = width;
            return steady >= 3;
          });
          const button = (hook: string) =>
            hook === "properties"
              ? bar!.querySelector<HTMLElement>("[data-query-properties]")!
              : bar!.querySelector<HTMLElement>(
                  `[data-query-toolbar="${hook}"]`,
                )!;
          const out = {
            width: bar!.clientWidth,
            overflow: bar!.scrollWidth > bar!.clientWidth,
            buttons: {} as Record<
              string,
              { tooltip: string | null; nameShown: boolean; iconShown: boolean }
            >,
          };
          for (const hook of __typedArg0) {
            const el = button(hook);
            const name = [...el!.querySelectorAll<HTMLElement>("span")].find(
              (s) => s.textContent.trim() !== "",
            );
            out.buttons[hook] = {
              tooltip: el!.getAttribute("aria-label"),
              nameShown: !!name && getComputedStyle(name).display !== "none",
              iconShown:
                !!el!.querySelector<SVGSVGElement>("svg")! &&
                el!.querySelector<SVGSVGElement>("svg")!.getBoundingClientRect()
                  .width > 0,
            };
          }
          return String(JSON.stringify(out));
        },
        { __typedArg0: Object.keys(names) },
      ),
    ) as Pane;
    expect(narrow.width).toBeLessThan(400);
    expect(narrow).toMatchObject({ overflow: false, buttons: each(false) });

    const wide = JSON.parse(
      await obRun(
        run.vaultId,
        async ({ page: pageHelpers }, { __typedArg0 }) => {
          const { until } = pageHelpers;
          const bar = (
            pageHelpers.scratch.zotlitE2EPanes!.wide
              .view as import("obsidian").ItemView
          ).contentEl.querySelector<HTMLElement>('[role="toolbar"]')!;
          let last = -1,
            steady = 0;
          await until("toolbar width settles", async () => {
            await new Promise((r) => requestAnimationFrame(r));
            const width = bar!.clientWidth;
            steady = width > 0 && width === last ? steady + 1 : 0;
            last = width;
            return steady >= 3;
          });
          const button = (hook: string) =>
            hook === "properties"
              ? bar!.querySelector<HTMLElement>("[data-query-properties]")!
              : bar!.querySelector<HTMLElement>(
                  `[data-query-toolbar="${hook}"]`,
                )!;
          const out = {
            width: bar!.clientWidth,
            overflow: bar!.scrollWidth > bar!.clientWidth,
            buttons: {} as Record<
              string,
              { tooltip: string | null; nameShown: boolean; iconShown: boolean }
            >,
          };
          for (const hook of __typedArg0) {
            const el = button(hook);
            const name = [...el!.querySelectorAll<HTMLElement>("span")].find(
              (s) => s.textContent.trim() !== "",
            );
            out.buttons[hook] = {
              tooltip: el!.getAttribute("aria-label"),
              nameShown: !!name && getComputedStyle(name).display !== "none",
              iconShown:
                !!el!.querySelector<SVGSVGElement>("svg")! &&
                el!.querySelector<SVGSVGElement>("svg")!.getBoundingClientRect()
                  .width > 0,
            };
          }
          return String(JSON.stringify(out));
        },
        { __typedArg0: Object.keys(names) },
      ),
    ) as Pane;
    expect(wide.width).toBeGreaterThan(700);
    expect(wide).toMatchObject({ overflow: false, buttons: each(true) });

    // A pointer over an icon-only button shows its name as a tooltip.
    const tooltip = await obRun(
      run.vaultId,
      async ({ page: pageHelpers }) => {
        const { until } = pageHelpers;
        const el = (
          pageHelpers.scratch.zotlitE2EPanes!.narrow
            .view as import("obsidian").ItemView
        ).contentEl.querySelector<HTMLElement>('[data-query-toolbar="sort"]')!;
        const r = el!.getBoundingClientRect();
        const at = {
          bubbles: true,
          pointerType: "mouse",
          clientX: r.x + 5,
          clientY: r.y + 5,
        };
        for (let i = 0; i < 3; i++) {
          el!.dispatchEvent(
            new PointerEvent("pointermove", { ...at, clientX: at.clientX + i }),
          );
          el!.dispatchEvent(
            new MouseEvent("mousemove", { ...at, clientX: at.clientX + i }),
          );
        }
        el!.dispatchEvent(new PointerEvent("pointerover", at));
        return String(
          (
            await until(
              "tooltip shows",
              () => activeDocument.querySelector<HTMLElement>(".tooltip")!,
              3000,
            )
          ).textContent,
        );
      },
      undefined,
    );
    expect(tooltip).toBe(names.sort);
  }, 120000);

  it.each(["main", "popout"] as const)(
    "draws what reaches past the edge of the Filter popover and the Properties chooser, as an editor's tooltip does, in the %s window",
    async (host) => {
      const layout = await obRun(
        run.vaultId,
        async ({ app }) => {
          return String(JSON.stringify(app.workspace.getLayout()));
        },
        undefined,
      );
      await using cleanup = new AsyncDisposableStack();
      cleanup.defer(async () => {
        await obRun(
          run.vaultId,
          async ({ app, page: pageHelpers }, { __typedArg0 }) => {
            pageHelpers.scratch.zotlitE2EPastEdge?.detach();
            delete pageHelpers.scratch.zotlitE2EPastEdge;
            await app.workspace.changeLayout(JSON.parse(__typedArg0));
            return String(true);
          },
          { __typedArg0: layout },
        );
      });
      await obRun(
        run.vaultId,
        async ({ app, page: pageHelpers }, { __typedArg0 }) => {
          const { until } = pageHelpers;
          const leaf = app.workspace.getLeaf("tab");
          pageHelpers.scratch.zotlitE2EPastEdge = leaf;
          await leaf.openFile(
            app.vault.getFileByPath("query-files/Reading list.zotquery")!,
          );
          app.workspace.setActiveLeaf(leaf, { focus: true });
          await (
            leaf.view as import("@/views/query-view/file-view").QueryFileView
          ).query.settled;
          if (__typedArg0) {
            app.workspace.moveLeafToPopout(leaf);
            await until(
              "view in the popout",
              () =>
                (leaf.view as import("obsidian").ItemView).contentEl
                  .ownerDocument !== document,
              10000,
            );
          } else {
          }
          return String(true);
        },
        { __typedArg0: host === "popout" },
      );
      // A box hung under the surface's root, past its bottom edge, where an
      // expression editor's tooltip lands: the point under the box's middle
      // shows the box, not the view behind the surface.
      const reachesPast = (selector: string) =>
        obRun(
          run.vaultId,
          async ({ page: pageHelpers }, { __typedArg0 }) => {
            const { until } = pageHelpers;
            using cleanup = new DisposableStack();
            const el = (
              pageHelpers.scratch.zotlitE2EPastEdge!
                .view as import("obsidian").ItemView
            ).contentEl;
            const root = await until("surface", () =>
              el.querySelector<HTMLElement>(__typedArg0)!,
            );
            root.showPopover();
            cleanup.defer(() => root.hidePopover());
            await until(
              "surface shows",
              () =>
                root.matches(":popover-open") &&
                root.getBoundingClientRect().height > 0,
            );
            const box = root.ownerDocument.createElement("div");
            box.style.cssText =
              "position:absolute;top:100%;left:0;width:40px;height:40px;";
            root.append(box);
            cleanup.defer(() => box.remove());
            const edge = root.getBoundingClientRect().bottom;
            const r = box.getBoundingClientRect();
            const hit = root.ownerDocument.elementFromPoint(
              r.left + 20,
              r.top + 20,
            );
            return String(
              JSON.stringify({
                past: r.top >= edge - 1,
                shown: hit === box,
              }),
            );
          },
          { __typedArg0: selector },
        );
      expect(
        JSON.parse(await reachesPast('[data-query-popover="filter"]')),
      ).toEqual({ past: true, shown: true });
      expect(
        JSON.parse(await reachesPast("[data-query-properties-popup]")),
      ).toEqual({ past: true, shown: true });
    },
    120000,
  );

  it.each(["main", "popout"] as const)(
    "shows the Signature Hint of the call at the caret in full above the Filter popover and the Formula page, in the %s window",
    async (host) => {
      const path = `query-files/Signature hint ${host}.zotquery`;
      const layout = await obRun(
        run.vaultId,
        async ({ app }) => {
          return String(JSON.stringify(app.workspace.getLayout()));
        },
        undefined,
      );
      await using cleanup = new AsyncDisposableStack();
      cleanup.defer(async () => {
        await obRun(
          run.vaultId,
          async ({ app, page: pageHelpers }, { __typedArg0, __typedArg1 }) => {
            pageHelpers.scratch.zotlitE2EHint?.detach();
            delete pageHelpers.scratch.zotlitE2EHint;
            await app.workspace.changeLayout(JSON.parse(__typedArg0));
            const file = app.vault.getFileByPath(__typedArg1)!;
            if (file) await app.vault.delete(file);
            return String(true);
          },
          { __typedArg0: layout, __typedArg1: path },
        );
      });
      // A view of Items whose filter is one expression condition.
      await obRun(
        run.vaultId,
        async (
          { app, page: pageHelpers },
          { __typedArg0, __typedArg1, __typedArg2 },
        ) => {
          const { until } = pageHelpers;
          const file = await app.vault.create(__typedArg0, __typedArg1);
          const leaf = app.workspace.getLeaf("tab");
          pageHelpers.scratch.zotlitE2EHint = leaf;
          await leaf.openFile(file);
          app.workspace.setActiveLeaf(leaf, { focus: true });
          await (
            leaf.view as import("@/views/query-view/file-view").QueryFileView
          ).query.settled;
          if (__typedArg2) {
            app.workspace.moveLeafToPopout(leaf);
            await until(
              "view in the popout",
              () =>
                (leaf.view as import("obsidian").ItemView).contentEl
                  .ownerDocument !== document,
              10000,
            );
            (leaf.view as import("obsidian").ItemView).contentEl.win.focus();
            await until(
              "the popout holding the focus",
              () =>
                (
                  leaf.view as import("obsidian").ItemView
                ).contentEl.ownerDocument.hasFocus(),
              5000,
            );
          } else {
          }
          return String(true);
        },
        {
          __typedArg0: path,
          __typedArg1: [
            "views:",
            "  - type: table",
            "    name: Hint",
            "    from: items",
            '    filters: title.slice(0, 1) != ""',
            "    order:",
            "      - title",
            "    limit: 10",
            "",
          ].join("\n"),
          __typedArg2: host === "popout",
        },
      );
      interface Hint {
        caret: number;
        domCaret: number | null;
        marked: string | null;
        text: string;
        inSurface: boolean;
        inWindow: boolean;
        shown: boolean;
        closed: boolean;
      }
      /**
       * Puts the caret of the expression field under `surface` at `caret`,
       * after its text becomes `text` when one is given, then focuses the
       * field as a Tab does, with no click to put the caret down, and reads
       * where the caret stands and the hint
       * once CodeMirror has placed it (it parks an unmeasured tooltip at a
       * top of -10000px): its marked parameter and text, whether it stands
       * in the surface's root, inside the window, and on top at each corner;
       * then whether it closes with the caret at the end, outside the call.
       */

      const expected = {
        marked: "end?: number",
        inSurface: true,
        inWindow: true,
        shown: true,
        closed: true,
      };
      const isStringSlice = (hint: Hint) => {
        expect(hint.text).toContain("slice(start: number, end?: number)");
        expect(hint.text).toContain("The part of the text");
        expect(hint.text).not.toContain("The elements of the list");
      };

      const inFilter = JSON.parse(
        await obRun(
          run.vaultId,
          async (
            { page: pageHelpers },
            { __typedArg0, __typedArg1, __typedArg2 },
          ) => {
            const { press, until } = pageHelpers;
            const el = (
              pageHelpers.scratch.zotlitE2EHint!
                .view as import("obsidian").ItemView
            ).contentEl;
            const popover = el.querySelector<HTMLElement>(
              '[data-query-popover="filter"]',
            )!;
            press(
              el.querySelector<HTMLElement>('[data-query-toolbar="filter"]')!,
              "Filter",
            );
            await until("Filter popover", () =>
              popover.matches(":popover-open"),
            );
            try {
              const content = await until(
                "expression field",
                () =>
                  popover
                    .querySelector<HTMLElement>(
                      '[data-filter-section="view"] [data-condition-row]',
                    )
                    ?.querySelector<CodeMirrorContent>(".cm-content")!,
                5000,
              );
              const root = content.closest<HTMLElement>("[popover]")!;
              const doc = content.ownerDocument;
              const win = doc.defaultView;
              const view = content.cmTile.root.view;
              if (__typedArg0) {
              } else {
                view.dispatch({
                  changes: {
                    from: 0,
                    to: view.state.doc.length,
                    insert: __typedArg1,
                  },
                  userEvent: "input.type",
                });
              }
              view.dispatch({ selection: { anchor: __typedArg2 } });
              content.focus();
              const hint = await until(
                "Signature Hint",
                () => {
                  const shown =
                    doc.querySelector<HTMLElement>(".zt-signature-hint")!;
                  return shown && !shown.hidden && shown;
                },
                5000,
              );
              await until(
                "hint placed in the surface and measured",
                () =>
                  hint.closest<HTMLElement>("[popover]")! === root &&
                  hint.style.top !== "-10000px" &&
                  hint.getBoundingClientRect().width > 0,
                5000,
              );
              const r = hint.getBoundingClientRect();
              const corners = [
                [r.left + 2, r.top + 2],
                [r.right - 2, r.top + 2],
                [r.left + 2, r.bottom - 2],
                [r.right - 2, r.bottom - 2],
              ] as const;
              const domSelection = doc.getSelection();
              const out = {
                closed: false,
                caret: view.state.selection.main.head,
                domCaret:
                  domSelection!.anchorNode &&
                  content.contains(domSelection!.anchorNode)
                    ? view.posAtDOM(
                        domSelection!.anchorNode,
                        domSelection!.anchorOffset,
                      )
                    : null,
                marked:
                  hint.querySelector<HTMLElement>("mark")?.textContent ?? null,
                text: hint.textContent,
                inSurface: hint.closest<HTMLElement>("[popover]")! === root,
                inWindow:
                  r.width > 0 &&
                  r.left >= 0 &&
                  r.top >= 0 &&
                  r.right <= win!.innerWidth &&
                  r.bottom <= win!.innerHeight,
                shown: corners.every(([x, y]) => {
                  const hit = doc.elementFromPoint(x, y);
                  return !!hit && hint.contains(hit);
                }),
              };
              view.dispatch({ selection: { anchor: view.state.doc.length } });
              out.closed = await until(
                "hint closes",
                () => !doc.querySelector<HTMLElement>(".zt-signature-hint")!,
                5000,
              );
              return String(JSON.stringify(out));
            } finally {
              popover.hidePopover();
            }
          },
          {
            __typedArg0: undefined === undefined,
            __typedArg1: undefined,
            __typedArg2: "title.slice(0, ".length,
          },
        ),
      ) as Hint;
      // The focus keeps the caret where it was, in the state and on screen.
      expect(inFilter).toMatchObject({
        ...expected,
        caret: "title.slice(0, ".length,
        domCaret: "title.slice(0, ".length,
      });
      isStringSlice(inFilter);

      const inFormula = JSON.parse(
        await obRun(
          run.vaultId,
          async (
            { page: pageHelpers },
            { __typedArg0, __typedArg1, __typedArg2, __typedArg3 },
          ) => {
            const { press, until } = pageHelpers;
            const el = (
              pageHelpers.scratch.zotlitE2EHint!
                .view as import("obsidian").ItemView
            ).contentEl;
            press(
              el.querySelector<HTMLElement>("[data-query-properties]")!,
              "Properties",
            );
            const popup = await until("Properties popover", () =>
              el.ownerDocument
                .querySelector<HTMLElement>(
                  "[data-query-properties-popup]:popover-open [data-query-property]",
                )
                ?.closest<HTMLElement>("[data-query-properties-popup]")!,
            );
            press(
              [...popup.querySelectorAll<HTMLElement>('[role="option"]')].find(
                (n) => n.textContent === __typedArg0,
              ),
              "Add formula",
            );
            try {
              const content = await until(
                "expression field",
                () =>
                  popup
                    .querySelector<HTMLElement>(
                      "[data-chooser-page] [data-query-formula-expression]",
                    )
                    ?.querySelector<CodeMirrorContent>(".cm-content")!,
                5000,
              );
              const root = content.closest<HTMLElement>("[popover]")!;
              const doc = content.ownerDocument;
              const win = doc.defaultView;
              const view = content.cmTile.root.view;
              if (__typedArg1) {
              } else {
                view.dispatch({
                  changes: {
                    from: 0,
                    to: view.state.doc.length,
                    insert: __typedArg2,
                  },
                  userEvent: "input.type",
                });
              }
              view.dispatch({ selection: { anchor: __typedArg3 } });
              content.focus();
              const hint = await until(
                "Signature Hint",
                () => {
                  const shown =
                    doc.querySelector<HTMLElement>(".zt-signature-hint")!;
                  return shown && !shown.hidden && shown;
                },
                5000,
              );
              await until(
                "hint placed in the surface and measured",
                () =>
                  hint.closest<HTMLElement>("[popover]")! === root &&
                  hint.style.top !== "-10000px" &&
                  hint.getBoundingClientRect().width > 0,
                5000,
              );
              const r = hint.getBoundingClientRect();
              const corners = [
                [r.left + 2, r.top + 2],
                [r.right - 2, r.top + 2],
                [r.left + 2, r.bottom - 2],
                [r.right - 2, r.bottom - 2],
              ] as const;
              const domSelection = doc.getSelection();
              const out = {
                closed: false,
                caret: view.state.selection.main.head,
                domCaret:
                  domSelection!.anchorNode &&
                  content.contains(domSelection!.anchorNode)
                    ? view.posAtDOM(
                        domSelection!.anchorNode,
                        domSelection!.anchorOffset,
                      )
                    : null,
                marked:
                  hint.querySelector<HTMLElement>("mark")?.textContent ?? null,
                text: hint.textContent,
                inSurface: hint.closest<HTMLElement>("[popover]")! === root,
                inWindow:
                  r.width > 0 &&
                  r.left >= 0 &&
                  r.top >= 0 &&
                  r.right <= win!.innerWidth &&
                  r.bottom <= win!.innerHeight,
                shown: corners.every(([x, y]) => {
                  const hit = doc.elementFromPoint(x, y);
                  return !!hit && hint.contains(hit);
                }),
              };
              view.dispatch({ selection: { anchor: view.state.doc.length } });
              out.closed = await until(
                "hint closes",
                () => !doc.querySelector<HTMLElement>(".zt-signature-hint")!,
                5000,
              );
              return String(JSON.stringify(out));
            } finally {
              popup.hidePopover();
            }
          },
          {
            __typedArg0: run.m.query_view_formula_add(),
            __typedArg1: "title.slice(1, )" === undefined,
            __typedArg2: "title.slice(1, )",
            __typedArg3: "title.slice(1, ".length,
          },
        ),
      ) as Hint;
      expect(inFormula).toMatchObject({
        ...expected,
        caret: "title.slice(1, ".length,
        domCaret: "title.slice(1, ".length,
      });
      isStringSlice(inFormula);
    },
    120000,
  );

  it.each(["main", "popout"] as const)(
    "offers Expression Completion in a Formula and a filter condition, above the chooser and the Filter popover, in the %s window",
    async (host) => {
      const path = "query-files/Expression completion.zotquery";
      // A view whose own filter is an expression row, which the visual rows
      // cannot show.
      const source = `views:\n  - type: table\n    name: Items\n    from: items\n    order:\n      - title\n    limit: 5\n    filters:\n      and:\n        - title.length > 0\n`;
      // What one field of a surface offers as it is typed in: the list
      // drawn in the surface's root, in Obsidian's suggestion skin with its
      // signature and description cells, its middle on top past the
      // surface's edge where it reaches past it.

      // A new Formula: `mi` offers `min()`, which Enter writes with the
      // caret between its parentheses. In it, `ti` offers `title`, which
      // Tab writes, keeping focus in the field. Then `, ti` opens the list
      // below the call's Signature Hint: Escape closes the list, then the hint,
      // each keeping the page; Escape again steps back to the rows.
      // Then the view's filter condition: `tit` in a call offers `title`,
      // the list below the caret and the call's Signature Hint above it,
      // apart. A click on the row writes it while the Filter popover stays
      // open. The eval restores the vault and the layout before it answers.
      const { formula, filter } = JSON.parse(
        await obRun(
          run.vaultId,
          async (
            { app, page: pageHelpers },
            { __typedArg0, __typedArg1, __typedArg2, __typedArg3 },
          ) => {
            const { press, until } = pageHelpers;
            const listOf = async (
              root: HTMLElement,
              content: import("./page-query-types.ts").CodeMirrorContent,
              text: string,
            ) => {
              const doc = content.ownerDocument;
              const field = content.cmTile.root.view;
              field.focus();
              await until(
                "focus in the field",
                () => doc.activeElement === content && doc.hasFocus(),
              );
              doc.execCommand("insertText", false, text);
              const list = await until("list opens", () =>
                root.querySelector<HTMLElement>(".cm-tooltip-autocomplete")!,
              );
              await until(
                "list placed and measured",
                () =>
                  list.style.top !== "-10000px" &&
                  list.getBoundingClientRect().width > 0,
                5000,
              );
              const r = list.getBoundingClientRect();
              const edge = root.getBoundingClientRect().bottom;
              const y =
                r.bottom > edge + 8
                  ? Math.min(edge + 4, r.bottom - 4)
                  : r.top + r.height / 2;
              const hit = doc.elementFromPoint(r.left + r.width / 2, y);
              const row = list.querySelector<HTMLElement>("li")!;
              return {
                list,
                skin:
                  list.classList.contains("suggestion-container") &&
                  row.classList.contains("suggestion-item"),
                shown: !!hit && list.contains(hit),
                first: {
                  label: row.querySelector<HTMLElement>(".cm-completionLabel")
                    ?.textContent,
                  type:
                    row.querySelector<HTMLElement>(
                      ".zt-template-completion-type",
                    )?.textContent ?? null,
                  note:
                    row.querySelector<HTMLElement>(".suggestion-note")
                      ?.textContent ?? null,
                },
              };
            };
            const { trusted } = pageHelpers;
            const picked = (list: HTMLElement) =>
              [...list.querySelectorAll<HTMLElement>("li")].findIndex(
                (li) => li.getAttribute("aria-selected") === "true",
              );
            const ready = async (
              input: ReturnType<
                import("./page-context.ts").ObsidianContext["page"]["trusted"]
              >,
              list: HTMLElement,
            ) => {
              const end = Temporal.Now.instant().epochMilliseconds + 2000;
              while (Temporal.Now.instant().epochMilliseconds < end) {
                await input.key("Down");
                if (picked(list) > 0) {
                  await input.key("Up");
                  await until(
                    "first row picked again",
                    () => picked(list) === 0,
                  );
                  return;
                }
              }
              throw new Error("Timed out: the list takes keys");
            };
            await using cleanup = new AsyncDisposableStack();
            const layout = app.workspace.getLayout();
            cleanup.defer(() => app.workspace.changeLayout(layout));
            const file = cleanup.adopt(
              await app.vault.create(__typedArg0, __typedArg1),
              (file) => app.vault.delete(file),
            );
            const leaf = cleanup.adopt(app.workspace.getLeaf("tab"), (leaf) =>
              leaf.detach(),
            );
            cleanup.defer(() => {
              for (const popup of (
                (leaf.view as import("obsidian").ItemView)?.contentEl?.doc ??
                document
              ).querySelectorAll<HTMLElement>("[popover]:popover-open"))
                popup.hidePopover();
            });
            await leaf.openFile(file);
            app.workspace.setActiveLeaf(leaf, { focus: true });
            await (
              leaf.view as import("@/views/query-view/file-view").QueryFileView
            ).query.settled;
            if (__typedArg2) {
              app.workspace.moveLeafToPopout(leaf);
              await until(
                "view in the popout",
                () =>
                  (leaf.view as import("obsidian").ItemView).contentEl
                    .ownerDocument !== document,
                10000,
              );
              (leaf.view as import("obsidian").ItemView).contentEl.win.focus();
              await until(
                "popout focused",
                () =>
                  (
                    leaf.view as import("obsidian").ItemView
                  ).contentEl.doc.hasFocus(),
                5000,
              );
            } else {
            }
            const formula = await (async () => {
              const view = leaf.view;
              const el = (view as import("obsidian").ItemView).contentEl;
              const input = trusted(el.win);
              await until(
                "the window takes keys",
                () => activeWindow === el.win,
              );
              press(
                await until("Properties button", () =>
                  el.querySelector<HTMLElement>("[data-query-properties]")!,
                ),
                "Properties",
              );
              const popup = await until("Properties popover", () =>
                el.doc.querySelector<HTMLElement>(
                  "[data-query-properties-popup]:popover-open",
                )!,
              );
              press(
                await until("Add formula", () =>
                  [
                    ...popup.querySelectorAll<HTMLElement>('[role="option"]'),
                  ].find((n) => n.textContent === __typedArg3),
                ),
                "Add formula",
              );
              const page = await until("formula page", () =>
                popup.querySelector<HTMLElement>(
                  "[data-chooser-page] [data-query-formula-page]",
                )!,
              );
              const content = await until("editor", () =>
                page.querySelector<CodeMirrorContent>(
                  "[data-query-formula-expression] .cm-content",
                )!,
              );
              const editor = content.cmTile.root.view;
              const offered = await listOf(popup, content, "mi");
              await ready(input, offered.list);
              await input.key("Return");
              await until(
                "Enter writes the entry",
                () => editor.state.doc.toString() !== "mi",
              );
              const accepted = {
                doc: editor.state.doc.toString(),
                caret: editor.state.selection.main.head,
              };
              await listOf(popup, content, "ti");
              await new Promise((r) => setTimeout(r, 200));
              await input.key("Tab");
              await until(
                "Tab writes the entry",
                () => editor.state.doc.toString() !== "min(ti)",
              );
              const tabbed = {
                doc: editor.state.doc.toString(),
                list: !!popup.querySelector<HTMLElement>(
                  ".cm-tooltip-autocomplete",
                )!,
                focus: el.doc.activeElement === content,
              };
              await listOf(popup, content, ", ti");
              await input.key("Escape");
              await until(
                "Escape closes the list",
                () =>
                  !popup.querySelector<HTMLElement>(
                    ".cm-tooltip-autocomplete",
                  )!,
              );
              const first = {
                page: !!popup.querySelector<HTMLElement>(
                  "[data-chooser-page]",
                )!,
                hint: !!popup.querySelector<HTMLElement>(".zt-signature-hint")!,
              };
              await input.key("Escape");
              await until(
                "Escape closes the hint",
                () => !popup.querySelector<HTMLElement>(".zt-signature-hint")!,
              );
              const second = {
                page: !!popup.querySelector<HTMLElement>(
                  "[data-chooser-page]",
                )!,
              };
              await input.key("Escape");
              await until(
                "Escape leaves the page",
                () => !popup.querySelector<HTMLElement>("[data-chooser-page]")!,
              );
              const third = { open: popup.matches(":popover-open") };
              popup.hidePopover();
              return {
                offered: { ...offered, list: undefined },
                accepted,
                tabbed,
                first,
                second,
                third,
              };
            })();
            const filter = await (async () => {
              const el = (leaf.view as import("obsidian").ItemView).contentEl;
              const input = trusted(el.win);
              press(
                await until("Filter button", () =>
                  el.querySelector<HTMLElement>(
                    '[data-query-toolbar="filter"]',
                  )!,
                ),
                "Filter",
              );
              const popup = await until("Filter popover", () =>
                el.doc.querySelector<HTMLElement>(
                  '[data-query-popover="filter"]:popover-open',
                )!,
              );
              const content = await until("expression row", () =>
                popup.querySelector<CodeMirrorContent>(
                  '[data-filter-section="view"] [data-condition-row] .cm-content',
                )!,
              );
              const editor = content.cmTile.root.view;
              editor.dispatch({
                selection: { anchor: editor.state.doc.length },
              });
              const offered = await listOf(popup, content, " && max(tit");
              const hint = await until("Signature Hint", () =>
                popup.querySelector<HTMLElement>(".zt-signature-hint")!,
              );
              const caret = editor.coordsAtPos(
                editor.state.selection.main.head,
              );
              const h = hint.getBoundingClientRect();
              const l = offered.list.getBoundingClientRect();
              const apart = {
                hintAbove: h.bottom <= caret!.top + 1,
                listBelow: l.top >= caret!.bottom - 1,
              };
              const row = [
                ...offered.list.querySelectorAll<HTMLElement>("li"),
              ].find(
                (li) =>
                  li.querySelector<HTMLElement>(".cm-completionLabel")
                    ?.textContent === "title",
              );
              await input.click(row!);
              await until("the click writes the entry", () =>
                editor.state.doc.toString().endsWith("(title"),
              );
              const after = {
                doc: editor.state.doc.toString(),
                open: popup.matches(":popover-open"),
              };
              popup.hidePopover();
              return { offered: { ...offered, list: undefined }, apart, after };
            })();
            return String(JSON.stringify({ formula, filter }));
          },
          {
            __typedArg0: path,
            __typedArg1: source,
            __typedArg2: host === "popout",
            __typedArg3: run.m.query_view_formula_add(),
          },
        ),
      );
      expect(formula).toEqual({
        offered: {
          skin: true,
          shown: true,
          first: {
            label: "min",
            type: "min(…) → number",
            note: "The smallest number among the arguments, or null when no argument is a number.",
          },
        },
        accepted: { doc: "min()", caret: 4 },
        tabbed: { doc: "min(title)", list: false, focus: true },
        first: { page: true, hint: true },
        second: { page: true },
        third: { open: true },
      });

      expect(filter).toEqual({
        offered: {
          skin: true,
          shown: true,
          first: { label: "title", type: "string", note: "Title" },
        },
        apart: { hintAbove: true, listBelow: true },
        after: { doc: "title.length > 0 && max(title", open: true },
      });
    },
    120000,
  );

  it.each(["main", "popout"] as const)(
    "closes only a chooser page's menu on Escape, and then steps back from the page, in the %s window",
    async (host) => {
      // The view menu's Configure view page of the Fixture's Query File:
      // its "…" opens the page menu. Escape closes the menu and keeps the
      // page; Escape again steps back to the rows, the popup still open.
      // The eval restores the layout before it answers.
      const escapes = JSON.parse(
        await obRun(
          run.vaultId,
          async ({ app, page: pageHelpers }, { __typedArg0 }) => {
            const { until } = pageHelpers;
            const { trusted } = pageHelpers;
            await using cleanup = new AsyncDisposableStack();
            const layout = app.workspace.getLayout();
            cleanup.defer(() => app.workspace.changeLayout(layout));
            const leaf = cleanup.adopt(app.workspace.getLeaf("tab"), (leaf) =>
              leaf.detach(),
            );
            cleanup.defer(() => {
              for (const popup of (
                (leaf.view as import("obsidian").ItemView)?.contentEl?.doc ??
                document
              ).querySelectorAll<HTMLElement>("[popover]:popover-open"))
                popup.hidePopover();
            });
            await leaf.openFile(
              app.vault.getFileByPath("query-files/Reading list.zotquery")!,
            );
            app.workspace.setActiveLeaf(leaf, { focus: true });
            await (
              leaf.view as import("@/views/query-view/file-view").QueryFileView
            ).query.settled;
            if (__typedArg0) {
              app.workspace.moveLeafToPopout(leaf);
              await until(
                "view in the popout",
                () =>
                  (leaf.view as import("obsidian").ItemView).contentEl
                    .ownerDocument !== document,
                10000,
              );
              (leaf.view as import("obsidian").ItemView).contentEl.win.focus();
              await until(
                "popout focused",
                () =>
                  (
                    leaf.view as import("obsidian").ItemView
                  ).contentEl.doc.hasFocus(),
                5000,
              );
            } else {
            }
            const el = (leaf.view as import("obsidian").ItemView).contentEl;
            const input = trusted(el.win);
            await until("the window takes keys", () => activeWindow === el.win);
            await input.click(
              await until("View menu", () =>
                el.querySelector<HTMLElement>("[data-query-view-menu]")!,
              ),
            );
            const popup = await until("view menu opens", () =>
              el.doc.querySelector<HTMLElement>(
                "[data-query-view-list]:popover-open",
              )!,
            );
            const row = await until("a view row", () =>
              popup.querySelector<HTMLElement>("[data-query-view-row]")!,
            );
            row.dispatchEvent(
              new MouseEvent("contextmenu", {
                bubbles: true,
                cancelable: true,
                clientX: 200,
                clientY: 200,
              }),
            );
            const page = await until("Configure view", () =>
              popup
                .querySelector<HTMLElement>("[data-query-configure-view]")
                ?.closest<HTMLElement>("[data-chooser-page]")!,
            );
            await input.click(
              page.querySelector<HTMLElement>("[data-chooser-page-menu]")!,
            );
            const menu = await until("page menu opens", () =>
              page.querySelector<HTMLElement>('[role="menu"]:popover-open')!,
            );
            await input.key("Escape");
            await until(
              "Escape closes the menu",
              () => !menu.matches(":popover-open"),
            );
            await new Promise((r) => setTimeout(r, 200));
            const first = {
              menu: menu.matches(":popover-open"),
              page: !!popup.querySelector<HTMLElement>("[data-chooser-page]")!,
              open: popup.matches(":popover-open"),
            };
            await input.key("Escape");
            await until(
              "Escape leaves the page",
              () => !popup.querySelector<HTMLElement>("[data-chooser-page]")!,
            );
            const second = { open: popup.matches(":popover-open") };
            return String(JSON.stringify({ first, second }));
          },
          { __typedArg0: host === "popout" },
        ),
      );
      expect(escapes).toEqual({
        first: { menu: false, page: true, open: true },
        second: { open: true },
      });
    },
    120000,
  );

  it("offers the members of a typed receiver, the names a list method binds and the vault keys in a filter condition", async () => {
    const path = "query-files/Member completion.zotquery";
    // A Formula of text that the filter condition reads by name.
    const source = `formulas:\n  short: title.slice(0, 10)\nviews:\n  - type: table\n    name: Items\n    from: items\n    order:\n      - title\n    limit: 5\n    filters:\n      and:\n        - title.length > 0\n`;
    const texts = [
      "title.",
      "dateAdded.",
      "formula.short.",
      "attachments[0].",
      "tags.filter(",
      "tags.reduce(",
      "(title +.",
      "firstAuthor.",
      "vault[",
    ];
    // What the list offers for each text typed over the expression row's
    // text; the row is never left empty, which would remove it. The eval
    // restores the vault and the layout before it answers.
    const offered = JSON.parse(
      await obRun(
        run.vaultId,
        async (
          { app, page: pageHelpers },
          { __typedArg0, __typedArg1, __typedArg2 },
        ) => {
          const { press, until } = pageHelpers;
          await using cleanup = new AsyncDisposableStack();
          const layout = app.workspace.getLayout();
          cleanup.defer(() => app.workspace.changeLayout(layout));
          const file = cleanup.adopt(
            await app.vault.create(__typedArg0, __typedArg1),
            (file) => app.vault.delete(file),
          );
          const leaf = cleanup.adopt(app.workspace.getLeaf("tab"), (leaf) =>
            leaf.detach(),
          );
          cleanup.defer(() => {
            for (const popup of document.querySelectorAll<HTMLElement>(
              "[popover]:popover-open",
            ))
              popup.hidePopover();
          });
          await leaf.openFile(file);
          app.workspace.setActiveLeaf(leaf, { focus: true });
          await (
            leaf.view as import("@/views/query-view/file-view").QueryFileView
          ).query.settled;
          const el = (leaf.view as import("obsidian").ItemView).contentEl;
          press(
            await until("Filter button", () =>
              el.querySelector<HTMLElement>('[data-query-toolbar="filter"]')!,
            ),
            "Filter",
          );
          const popup = await until("Filter popover", () =>
            el.doc.querySelector<HTMLElement>(
              '[data-query-popover="filter"]:popover-open',
            )!,
          );
          const content = await until("expression row", () =>
            popup.querySelector<CodeMirrorContent>(
              '[data-filter-section="view"] [data-condition-row] .cm-content',
            )!,
          );
          const editor = content.cmTile.root.view;
          const out: Record<string, string[]> = {};
          for (const text of __typedArg2) {
            editor.contentDOM.blur();
            await until(
              "the list closes",
              () =>
                !popup.querySelector<HTMLElement>(".cm-tooltip-autocomplete")!,
            );
            editor.dispatch({
              selection: { anchor: 0, head: editor.state.doc.length },
            });
            editor.focus();
            await until(
              "focus in the field",
              () => el.doc.activeElement === content && el.doc.hasFocus(),
            );
            el.doc.execCommand("insertText", false, text);
            const list = await until(
              `list for ${text}`,
              () =>
                editor.state.doc.toString() === text &&
                popup.querySelector<HTMLElement>(
                  ".cm-tooltip-autocomplete li",
                )! &&
                popup.querySelector<HTMLElement>(".cm-tooltip-autocomplete")!,
            );
            out[text] = [
              ...list.querySelectorAll<HTMLElement>(".cm-completionLabel"),
            ].map((n) => n.textContent);
          }
          popup.hidePopover();
          return String(JSON.stringify(out));
        },
        { __typedArg0: path, __typedArg1: source, __typedArg2: texts },
      ),
    ) as Record<string, string[]>;
    const has = (text: string, names: string[], not: string[] = []) => {
      expect(offered[text], text).toEqual(expect.arrayContaining(names));
      for (const name of not) expect(offered[text], text).not.toContain(name);
    };
    has("title.", ["lower", "length"], ["year", "format"]);
    has("dateAdded.", ["year", "format"], ["lower"]);
    has("formula.short.", ["lower"], ["year"]);
    has("attachments[0].", ["title", "fileType"]);
    has("(title +.", ["lower", "year", "filter"]);
    has("firstAuthor.", ["fullName", "family", "given"]);
    expect(offered["tags.filter("]!.slice(0, 2)).toEqual(["value", "index"]);
    expect(offered["tags.reduce("]!.slice(0, 3)).toEqual([
      "value",
      "index",
      "acc",
    ]);
    // Each name a Literature Note carries, quoted.
    expect(offered["vault["]!.length).toBeGreaterThan(0);
    for (const key of offered["vault["]!) expect(key).toMatch(/^".*"$/);
  }, 120000);

  it("exports a note with a Query File embed and a Query Block to PDF with their rows and no toolbar", async () => {
    const notePath = "query-files/Export check.md";
    const pdfPath = join(workspaceRoot, ".scratch", "e2e-query-export.pdf");
    const layout = await obRun(
      run.vaultId,
      async ({ app }) => {
        return String(JSON.stringify(app.workspace.getLayout()));
      },
      undefined,
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await rm(pdfPath, { force: true });
      await obRun(
        run.vaultId,
        async ({ app }, { __typedArg0, __typedArg1 }) => {
          await app.workspace.changeLayout(JSON.parse(__typedArg0));
          const file = app.vault.getFileByPath(__typedArg1)!;
          if (file) await app.vault.delete(file);
          return String(true);
        },
        { __typedArg0: layout, __typedArg1: notePath },
      );
    });
    const note = [
      "---",
      "zotero-key: SAKIMA22",
      "---",
      "![[Lab annotations.zotquery#This item]]",
      "",
      "```zotquery",
      "views:",
      "  - type: annotations",
      "    name: Block view",
      "    from: annotations",
      "    filters: item == this.item",
      "```",
      "",
    ].join("\n");
    const report = JSON.parse(
      await cliCommand(run.vaultId, "zotlit:query", {
        args: {
          from: "annotations",
          filter: "item == this.item",
          "this-item": "SAKIMA22",
          fields: "item.title",
          limit: "100",
        },
      }),
    ) as ItemQueryReport;
    expect(report.ok).toBe(true);
    const own = report.rows!.map((row) => row.indexedKey);
    expect(own.length).toBeGreaterThan(1);

    // Obsidian's own Export to PDF: its modal's export, with the file path
    // the save dialog would give. The printed page is read as it is drawn,
    // in the hidden window Obsidian prints from.
    const printed = JSON.parse(
      await obRun(
        run.vaultId,
        async ({ app }, { __typedArg0, __typedArg1, __typedArg2 }) => {
          const file = await app.vault.create(__typedArg0, __typedArg1);
          const leaf = app.workspace.getLeaf("tab");
          await leaf.openFile(file, { state: { mode: "preview" } });
          app.workspace.setActiveLeaf(leaf, { focus: true });
          const modalProto = Object.getPrototypeOf(
            Object.getPrototypeOf(Object.getPrototypeOf(app.setting)),
          ) as Pick<QueryPrintModal, "open">;
          const open = modalProto.open;
          const capture: { modal: QueryPrintModal | null } = { modal: null };
          modalProto.open = new Proxy(open, {
            apply(target, receiver: QueryPrintModal, args) {
              capture.modal = receiver;
              return Reflect.apply(target, receiver, args);
            },
          });
          try {
            (
              leaf.view as import("obsidian").MarkdownView & {
                printToPdf(): void;
              }
            ).printToPdf();
          } finally {
            modalProto.open = open;
          }
          const modal = capture.modal!;
          modal.close();
          let page: PrintedQueryPage | null = null;
          const print = modal!.print.bind(modal);
          modal!.print = async (
            el: HTMLElement,
            component: import("obsidian").Component,
            includeName: boolean,
          ) => {
            const out = await print(el, component, includeName);
            const win = el.win;
            const shown = (n: HTMLElement) =>
              win.getComputedStyle(n).display !== "none";
            const views = [
              ...el.querySelectorAll<HTMLElement>(".zt-query-view"),
            ];
            page = {
              ownWindow: win !== window,
              views: views.map((view) => ({
                host: view.classList.contains("internal-embed")
                  ? "embed"
                  : view.classList.contains("block-language-zotquery")
                    ? "block"
                    : "other",
                cards: [
                  ...view.querySelectorAll<HTMLElement>(".zt-annot-card"),
                ].map((n) => n.getAttribute("data-zotero-annotation-key")!),
                toolbar: [
                  ...view.querySelectorAll<HTMLElement>('[role="toolbar"]'),
                ].some(shown),
                readOnly: [
                  ...view.querySelectorAll<HTMLElement>(
                    "[data-query-read-only]",
                  ),
                ].some(shown),
                clipped: [
                  ...view.querySelectorAll<HTMLElement>(".annots-container"),
                ].some((list) => list.scrollHeight > list.clientHeight + 1),
                blank:
                  view.offsetHeight -
                    (view.querySelector<HTMLElement>('[role="grid"]')
                      ?.offsetHeight ?? 0) >
                  100,
              })),
            };
            return out;
          };
          await modal!.printToPdf({
            filepath: __typedArg2,
            includeName: true,
            pageSize: "A4",
            landscape: false,
            marginsType: 0,
            scaleFactor: 100,
            scale: 1,
            open: false,
          });
          return String(JSON.stringify(page));
        },
        { __typedArg0: notePath, __typedArg1: note, __typedArg2: pdfPath },
        { timeoutMs: 180000 },
      ),
    ) as {
      ownWindow: boolean;
      views: {
        host: string;
        cards: string[];
        toolbar: boolean;
        readOnly: boolean;
        clipped: boolean;
        /** Empty space below the cards, as a fixed height leaves. */
        blank: boolean;
      }[];
    };
    expect(printed).toEqual({
      ownWindow: true,
      views: ["embed", "block"].map((host) => ({
        host,
        cards: own,
        toolbar: false,
        readOnly: false,
        clipped: false,
        blank: false,
      })),
    });
    expect((await readFile(pdfPath)).subarray(0, 5).toString()).toBe("%PDF-");
  }, 240000);

  it("filters a Query File tab from its Filter popover, and the file text and the cards follow", async () => {
    const layout = await obRun(
      run.vaultId,
      async ({ app }) => {
        return String(JSON.stringify(app.workspace.getLayout()));
      },
      undefined,
    );
    const path = "query-files/Filtered.zotquery";
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obRun(
        run.vaultId,
        async ({ app }, { __typedArg0, __typedArg1 }) => {
          await app.workspace.changeLayout(JSON.parse(__typedArg0));
          const file = app.vault.getFileByPath(__typedArg1)!;
          if (file) await app.vault.delete(file);
          return String(true);
        },
        { __typedArg0: layout, __typedArg1: path },
      );
    });
    /** The rows ZotLit Query gives for a filter, through the CLI. */
    const queryKeys = async (filter: string) => {
      const report = JSON.parse(
        await cliCommand(run.vaultId, "zotlit:query", {
          args: { from: "annotations", fields: "[]", limit: "100", filter },
        }),
      ) as ItemQueryReport;
      expect(report.ok).toBe(true);
      return report.rows!.map((row) => row.indexedKey);
    };
    interface Tab {
      text: string;
      cards: string[];
      filterError: boolean;
      /** The row count the Results menu shows, or `null` while it shows none. */
      count: string | null;
      /** The text of each row's diagnostic in the "This view" section. */
      rowIssues: (string | null)[];
      /** The report of the diagnostic the view shows above the cards. */
      diagnostic: string | null;
    }

    const tabWhen = async (ready: (tab: Tab) => boolean): Promise<Tab> => {
      let tab: Tab | null = null;
      const settled = await waitFor(async () => {
        tab = JSON.parse(
          await obRun(
            run.vaultId,
            async ({ app }, { __typedArg0 }) => {
              const view = app.workspace.getMostRecentLeaf()!.view;
              if (
                view.getViewType() !== "zotlit-query-file" ||
                (view as import("obsidian").FileView).file?.path !== __typedArg0
              )
                return String("null");
              await (
                view as import("@/views/query-view/file-view").QueryFileView
              ).query.settled;
              const el = (view as import("obsidian").ItemView).contentEl;
              return String(
                JSON.stringify({
                  text: await app.vault.read(
                    (view as import("obsidian").FileView).file!,
                  ),
                  cards: [
                    ...el.querySelectorAll<HTMLElement>(".zt-annot-card"),
                  ].map((n) => n.getAttribute("data-zotero-annotation-key")!),
                  filterError:
                    el.querySelector<HTMLElement>(
                      "[data-query-filter-error]",
                    )! !== null,
                  count:
                    el
                      .querySelector<HTMLElement>("[data-query-count]")
                      ?.getAttribute("data-query-count") ?? null,
                  rowIssues: [
                    ...el.querySelectorAll<HTMLElement>(
                      '[data-filter-section="view"] [data-condition-row]',
                    ),
                  ].map(
                    (n) =>
                      n.querySelector<HTMLElement>('[role="alert"]')
                        ?.textContent ?? null,
                  ),
                  diagnostic:
                    el.querySelector<HTMLElement>("[data-query-diagnostic] pre")
                      ?.textContent ?? null,
                }),
              );
            },
            { __typedArg0: path },
          ),
        ) as Tab | null;
        return tab !== null && ready(tab);
      }, 120);
      if (!settled) throw new Error(`Filtered tab: ${JSON.stringify(tab)}`);
      return tab!;
    };
    /** Run `body` against the open Filter popover of the active tab. */

    await obRun(
      run.vaultId,
      async ({ app }, { __typedArg0, __typedArg1 }) => {
        const file = await app.vault.create(__typedArg0, __typedArg1);
        const leaf = app.workspace.getLeaf("tab");
        await leaf.openFile(file);
        app.workspace.setActiveLeaf(leaf, { focus: true });
        return String(true);
      },
      {
        __typedArg0: path,
        __typedArg1: [
          "views:",
          "  - type: annotations",
          "    name: Figures",
          "    from: annotations",
          '    filters: tags.contains("figure")',
          "    limit: 100",
          "",
        ].join("\n"),
      },
    );
    const figures = await queryKeys('tags.contains("figure")');
    expect(figures.length).toBeGreaterThan(0);
    await tabWhen(
      (tab) => JSON.stringify(tab.cards) === JSON.stringify(figures),
    );

    // The popover opens with the two sections; the view's tag condition
    // shows as a visual row, and the empty "All views" section shows one
    // placeholder row.
    const sections = JSON.parse(
      await obRun(
        run.vaultId,
        async ({ app, page: pageHelpers }, { __typedArg0 }) => {
          const { press } = pageHelpers;
          const el = (
            app.workspace.getMostRecentLeaf()!
              .view as import("obsidian").ItemView
          ).contentEl;
          const popover = el.querySelector<HTMLElement>(
            '[data-query-popover="filter"]',
          )!;
          if (!popover.matches(":popover-open"))
            press(
              el.querySelector<HTMLElement>('[data-query-toolbar="filter"]')!,
              "Filter",
            );
          const section = (name: string) =>
            popover.querySelector<HTMLElement>(
              `[data-filter-section="${name}"]`,
            )!;

          return String(
            JSON.stringify({
              open: popover.matches(":popover-open"),
              all: section("all").querySelector<HTMLElement>(
                "[data-filter-heading]",
              )!.textContent,
              allRows: section("all").querySelectorAll<HTMLElement>(
                "[data-condition-row]",
              ).length,
              view: section("view").querySelector<HTMLElement>(
                "[data-filter-heading]",
              )!.textContent,
              tag: section("view").querySelector<HTMLInputElement>(
                `[data-condition-row] input[aria-label="${__typedArg0}"]`,
              )!.value,
            }),
          );
        },
        { __typedArg0: run.m.workbench_filter_value() },
      ),
    ) as Record<string, unknown>;
    expect(sections).toEqual({
      open: true,
      all: run.m.query_view_filter_all_views(),
      allRows: 1,
      view: run.m.query_view_filter_this_view(),
      tag: "figure",
    });

    // A new tag value saves the view's filters and runs them.
    await obRun(
      run.vaultId,
      async ({ app, page: pageHelpers }, { __typedArg0 }) => {
        const { press } = pageHelpers;
        const el = (
          app.workspace.getMostRecentLeaf()!.view as import("obsidian").ItemView
        ).contentEl;
        const popover = el.querySelector<HTMLElement>(
          '[data-query-popover="filter"]',
        )!;
        if (!popover.matches(":popover-open"))
          press(
            el.querySelector<HTMLElement>('[data-query-toolbar="filter"]')!,
            "Filter",
          );
        const section = (name: string) =>
          popover.querySelector<HTMLElement>(
            `[data-filter-section="${name}"]`,
          )!;
        const set = (
          control: HTMLInputElement | HTMLSelectElement,
          value: string,
        ) => {
          control.value = value;
          control.dispatchEvent(new Event("input", { bubbles: true }));
        };

        set(
          section("view").querySelector<HTMLInputElement>(
            `[data-condition-row] input[aria-label="${__typedArg0}"]`,
          )!,
          "methodology",
        );
        return String(true);
      },
      { __typedArg0: run.m.workbench_filter_value() },
    );
    const methodology = await queryKeys('tags.contains("methodology")');
    expect(methodology).not.toEqual(figures);
    // The tab saves after a short delay, so the file text follows the cards.
    await tabWhen(
      (tab) =>
        JSON.stringify(tab.cards) === JSON.stringify(methodology) &&
        tab.text.includes(
          '    filters:\n      and:\n        - tags.contains("methodology")\n',
        ),
    );

    // The placeholder row for all views becomes a colour condition, Yellow,
    // and saves as the file's top-level filters; both sections hold. The
    // empty section starts folded, so the reader unfolds it first.
    await obRun(
      run.vaultId,
      async ({ app, page: pageHelpers }, { __typedArg0 }) => {
        const { press, pick } = pageHelpers;
        const el = (
          app.workspace.getMostRecentLeaf()!.view as import("obsidian").ItemView
        ).contentEl;
        const popover = el.querySelector<HTMLElement>(
          '[data-query-popover="filter"]',
        )!;
        if (!popover.matches(":popover-open"))
          press(
            el.querySelector<HTMLElement>('[data-query-toolbar="filter"]')!,
            "Filter",
          );
        const section = (name: string) =>
          popover.querySelector<HTMLElement>(
            `[data-filter-section="${name}"]`,
          )!;

        const fold =
          section("all").querySelector<HTMLDetailsElement>("details")!;
        if (!fold.open)
          press(
            fold.querySelector<HTMLElement>("summary")!,
            "All views heading",
          );
        await pick(
          section("all").querySelector<HTMLSelectElement>(
            `[data-condition-row] select[aria-label="${__typedArg0}"]`,
          )!,
          "yellow",
          "Value",
        );
        return String(true);
      },
      { __typedArg0: run.m.workbench_filter_value() },
    );
    const yellow = await queryKeys(
      '(colorName == "yellow") && (tags.contains("methodology"))',
    );
    await tabWhen(
      (tab) =>
        /^filters:\n {2}and:\n {4}- colorName == "yellow"\nviews:/.test(
          tab.text,
        ) && JSON.stringify(tab.cards) === JSON.stringify(yellow),
    );

    // A wrong expression marks its row with the query's diagnostic; the
    // cards stay, and the view says the filter has an error.
    await obRun(
      run.vaultId,
      async ({ app, page: pageHelpers }, { __typedArg0 }) => {
        const { press, until } = pageHelpers;
        const el = (
          app.workspace.getMostRecentLeaf()!.view as import("obsidian").ItemView
        ).contentEl;
        const popover = el.querySelector<HTMLElement>(
          '[data-query-popover="filter"]',
        )!;
        if (!popover.matches(":popover-open"))
          press(
            el.querySelector<HTMLElement>('[data-query-toolbar="filter"]')!,
            "Filter",
          );
        const section = (name: string) =>
          popover.querySelector<HTMLElement>(
            `[data-filter-section="${name}"]`,
          )!;

        const write = (field: HTMLElement, text: string) => {
          const view =
            field.querySelector<CodeMirrorContent>(".cm-content")!.cmTile.root
              .view;
          view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: text },
            userEvent: "input.type",
          });
        };
        press(
          section("view").querySelector<HTMLButtonElement>(
            `[data-condition-row] button[aria-label="${__typedArg0}"]`,
          )!,
          "Edit as expression",
        );
        write(
          await until(
            "expression field",
            () =>
              section("view").querySelector<CodeMirrorContent>(
                "[data-condition-row] .cm-content",
              )?.parentElement,
          ),
          "nosuchfield == 1",
        );
        return String(true);
      },
      { __typedArg0: run.m.workbench_match_edit_as_expression() },
    );
    const broken = await tabWhen(
      (tab) =>
        tab.filterError &&
        tab.rowIssues[0] !== null &&
        tab.text.includes("        - nosuchfield == 1\n"),
    );
    expect(broken.cards).toEqual(yellow);
    // The count of the kept cards stays in the Results menu.
    expect(broken.count).toBe(String(yellow.length));
    expect(broken.rowIssues[0]).toContain("nosuchfield");
    /**
     * The text the expression rows of the view's own filters underline,
     * once it is `expected` or the wait ends: the editor draws its marks
     * after the frame that shows the row.
     */
    const underlines = async (expected: string[]) =>
      JSON.parse(
        await obRun(
          run.vaultId,
          async ({ app, page: pageHelpers }, { __typedArg0 }) => {
            const { press, until } = pageHelpers;
            const el = (
              app.workspace.getMostRecentLeaf()!
                .view as import("obsidian").ItemView
            ).contentEl;
            const popover = el.querySelector<HTMLElement>(
              '[data-query-popover="filter"]',
            )!;
            if (!popover.matches(":popover-open"))
              press(
                el.querySelector<HTMLElement>('[data-query-toolbar="filter"]')!,
                "Filter",
              );
            const section = (name: string) =>
              popover.querySelector<HTMLElement>(
                `[data-filter-section="${name}"]`,
              )!;

            const read = () =>
              JSON.stringify(
                [
                  ...section("view").querySelectorAll<HTMLElement>(
                    "[data-condition-row] .cm-lintRange-error",
                  ),
                ].map((n) => n.textContent),
              );
            await until("underlines", () => read() === __typedArg0).catch(
              () => {},
            );
            return String(read());
          },
          { __typedArg0: JSON.stringify(expected) },
        ),
      ) as string[];
    // The row underlines the name the query found wrong.
    expect(await underlines(["nosuchfield"])).toEqual(["nosuchfield"]);
    // The condition shows no tooltip over the underline, not even an empty
    // one, well past CodeMirror's hover delay.
    const hovered = JSON.parse(
      await obRun(
        run.vaultId,
        async ({ app, page: pageHelpers }) => {
          const { press } = pageHelpers;
          const el = (
            app.workspace.getMostRecentLeaf()!
              .view as import("obsidian").ItemView
          ).contentEl;
          const popover = el.querySelector<HTMLElement>(
            '[data-query-popover="filter"]',
          )!;
          if (!popover.matches(":popover-open"))
            press(
              el.querySelector<HTMLElement>('[data-query-toolbar="filter"]')!,
              "Filter",
            );
          const section = (name: string) =>
            popover.querySelector<HTMLElement>(
              `[data-filter-section="${name}"]`,
            )!;

          const mark = section("view").querySelector<HTMLElement>(
            "[data-condition-row] .cm-lintRange-error",
          )!;
          const r = mark.getBoundingClientRect();
          mark.dispatchEvent(
            new MouseEvent("mousemove", {
              bubbles: true,
              clientX: r.left + r.width / 2,
              clientY: r.top + r.height / 2,
            }),
          );
          await new Promise((r) => setTimeout(r, 800));
          return String(
            JSON.stringify(
              [
                ...mark.ownerDocument.querySelectorAll<HTMLElement>(
                  ".cm-tooltip-hover, .cm-tooltip-lint",
                ),
              ].map((n) => n.className),
            ),
          );
        },
        undefined,
      ),
    ) as string[];
    expect(hovered).toEqual([]);

    // The expression field colors each kind of token with Obsidian's code
    // color for it, in the light and in the dark theme.
    const tokens = {
      property: "title",
      function: "lower",
      value: "true",
      string: '"fig"',
      operator: "==",
      punctuation: ".",
    };
    const colors = JSON.parse(
      await obRun(
        run.vaultId,
        async ({ app, page: pageHelpers }, { __typedArg0 }) => {
          const { press, until } = pageHelpers;
          const el = (
            app.workspace.getMostRecentLeaf()!
              .view as import("obsidian").ItemView
          ).contentEl;
          const popover = el.querySelector<HTMLElement>(
            '[data-query-popover="filter"]',
          )!;
          if (!popover.matches(":popover-open"))
            press(
              el.querySelector<HTMLElement>('[data-query-toolbar="filter"]')!,
              "Filter",
            );
          const section = (name: string) =>
            popover.querySelector<HTMLElement>(
              `[data-filter-section="${name}"]`,
            )!;

          const write = (field: HTMLElement, text: string) => {
            const view =
              field.querySelector<CodeMirrorContent>(".cm-content")!.cmTile.root
                .view;
            view.dispatch({
              changes: { from: 0, to: view.state.doc.length, insert: text },
              userEvent: "input.type",
            });
          };
          const row = section("view").querySelector<HTMLElement>(
            "[data-condition-row]",
          )!;
          write(row, 'title.lower().contains("fig") == true');
          const tokens = __typedArg0;
          const hook = (kind: string) =>
            `.zt-template-${kind === "function" ? "filter" : kind}`;
          const token = (kind: string, text: string) =>
            [
              ...row.querySelectorAll<HTMLElement>(`.cm-line ${hook(kind)}`),
            ].find((n) => n.textContent === text);
          await until("token hooks", () =>
            Object.entries(tokens).every(([kind, text]) => token(kind, text)),
          );
          const doc = row.ownerDocument;
          const read = () =>
            Object.fromEntries(
              Object.entries(tokens).map(([kind, text]) => {
                const probe = doc.createElement("span");
                probe.style.color = `var(--code-${kind})`;
                popover.append(probe);
                const code = getComputedStyle(probe).color;
                probe.remove();
                return [
                  kind,
                  { token: getComputedStyle(token(kind, text)!).color, code },
                ];
              }),
            );
          const body = doc.body;
          const wasDark = body.classList.contains("theme-dark");
          const theme = (dark: boolean) => {
            body.classList.toggle("theme-dark", dark);
            body.classList.toggle("theme-light", !dark);
          };
          try {
            theme(false);
            const light = read();
            theme(true);
            return String(JSON.stringify({ light, dark: read() }));
          } finally {
            theme(wasDark);
          }
        },
        { __typedArg0: tokens },
      ),
    ) as Record<
      "light" | "dark",
      Record<keyof typeof tokens, { token: string; code: string }>
    >;
    for (const scheme of ["light", "dark"] as const)
      for (const [kind, { token, code }] of Object.entries(colors[scheme]))
        expect({ scheme, kind, token }).toEqual({ scheme, kind, token: code });
    // The two themes give the code colors different values.
    expect(colors.light.property.code).not.toBe(colors.dark.property.code);

    // One line of expression reads as a native text input: the field fills
    // the row's input-high box, and its text and caret sit at the centre of
    // it. Wrapped text grows the box, as a textarea does.
    type Alignment = Record<
      "text" | "caret" | "field" | "line" | "box",
      number
    >;
    const aligned = JSON.parse(
      await obRun(
        run.vaultId,
        async ({ app, page: pageHelpers }) => {
          const { press } = pageHelpers;
          const el = (
            app.workspace.getMostRecentLeaf()!
              .view as import("obsidian").ItemView
          ).contentEl;
          const popover = el.querySelector<HTMLElement>(
            '[data-query-popover="filter"]',
          )!;
          if (!popover.matches(":popover-open"))
            press(
              el.querySelector<HTMLElement>('[data-query-toolbar="filter"]')!,
              "Filter",
            );
          const section = (name: string) =>
            popover.querySelector<HTMLElement>(
              `[data-filter-section="${name}"]`,
            )!;

          const write = (field: HTMLElement, text: string) => {
            const view =
              field.querySelector<CodeMirrorContent>(".cm-content")!.cmTile.root
                .view;
            view.dispatch({
              changes: { from: 0, to: view.state.doc.length, insert: text },
              userEvent: "input.type",
            });
          };
          const row = section("view").querySelector<HTMLElement>(
            "[data-condition-row]",
          )!;
          const field = row.querySelector<HTMLElement>(
            '[data-part="expression"]',
          )!;
          const box = () =>
            field.closest<HTMLElement>('[data-part="statement"]')!;
          const centre = (el: HTMLElement) => {
            const r = el.getBoundingClientRect();
            return r.top + r.height / 2;
          };
          const height = (el: HTMLElement) => el.getBoundingClientRect().height;
          const measure = async (text: string) => {
            write(row, text);
            await new Promise((r) =>
              requestAnimationFrame(() => requestAnimationFrame(r)),
            );
            const view =
              field.querySelector<CodeMirrorContent>(".cm-content")!.cmTile.root
                .view;
            const line = field.querySelector<HTMLElement>(".cm-line")!;
            const caret = view.coordsAtPos(0);
            return {
              text: centre(line) - centre(box()),
              caret: (caret!.top + caret!.bottom) / 2 - centre(box()),
              field: height(field) - height(box()),
              line:
                Number.parseFloat(getComputedStyle(line).lineHeight) -
                Number.parseFloat(getComputedStyle(field).lineHeight),
              box: height(box()),
            };
          };
          const one = await measure('title.contains("fig")');
          const wrapped = await measure(
            `${'title.contains("fig") || '.repeat(12)}true`,
          );
          return String(
            JSON.stringify({
              one,
              wrapped,
              input: Number.parseFloat(
                getComputedStyle(field).getPropertyValue("--input-height"),
              ),
            }),
          );
        },
        undefined,
      ),
    ) as { one: Alignment; wrapped: Alignment; input: number };
    expect(aligned.one.box).toBeCloseTo(aligned.input, 0);
    expect(Math.abs(aligned.one.field)).toBeLessThanOrEqual(1);
    expect(Math.abs(aligned.one.text)).toBeLessThanOrEqual(1);
    expect(Math.abs(aligned.one.caret)).toBeLessThanOrEqual(1);
    // The text reads at the field's own line height, not CodeMirror's.
    expect(Math.abs(aligned.one.line)).toBeLessThanOrEqual(0.5);
    expect(aligned.wrapped.box).toBeGreaterThan(aligned.input + 10);
    expect(Math.abs(aligned.wrapped.field)).toBeLessThanOrEqual(1);

    // A syntax error names the tokens the filter lacks once, with the place
    // in the filter: the hint that lists them again stays out. The fault sits
    // at the ")" after the condition, so the view shows it above the cards.
    await obRun(
      run.vaultId,
      async ({ app, page: pageHelpers }) => {
        const { press } = pageHelpers;
        const el = (
          app.workspace.getMostRecentLeaf()!.view as import("obsidian").ItemView
        ).contentEl;
        const popover = el.querySelector<HTMLElement>(
          '[data-query-popover="filter"]',
        )!;
        if (!popover.matches(":popover-open"))
          press(
            el.querySelector<HTMLElement>('[data-query-toolbar="filter"]')!,
            "Filter",
          );
        const section = (name: string) =>
          popover.querySelector<HTMLElement>(
            `[data-filter-section="${name}"]`,
          )!;

        const write = (field: HTMLElement, text: string) => {
          const view =
            field.querySelector<CodeMirrorContent>(".cm-content")!.cmTile.root
              .view;
          view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: text },
            userEvent: "input.type",
          });
        };
        write(
          section("view").querySelector<HTMLElement>("[data-condition-row]")!,
          "place !=",
        );
        return String(true);
      },
      undefined,
    );
    // The dangling operator is underlined as it is typed.
    expect(await underlines(["!="])).toEqual(["!="]);
    const unfinished = await tabWhen(
      (tab) =>
        tab.diagnostic !== null && tab.text.includes("        - place !=\n"),
    );
    const [said, excerpt, caret, ...rest] = unfinished.diagnostic!.split("\n");
    expect(said).toMatch(/where the filter takes .*a regular expression.*\.$/);
    expect(rest).toEqual([]);
    expect(excerpt).toContain("(place !=)");
    expect(caret!.trim()).toBe("^");

    // "Edit visually" goes back once the expression fits a row.
    await obRun(
      run.vaultId,
      async ({ app, page: pageHelpers }, { __typedArg0 }) => {
        const { press, until } = pageHelpers;
        const el = (
          app.workspace.getMostRecentLeaf()!.view as import("obsidian").ItemView
        ).contentEl;
        const popover = el.querySelector<HTMLElement>(
          '[data-query-popover="filter"]',
        )!;
        if (!popover.matches(":popover-open"))
          press(
            el.querySelector<HTMLElement>('[data-query-toolbar="filter"]')!,
            "Filter",
          );
        const section = (name: string) =>
          popover.querySelector<HTMLElement>(
            `[data-filter-section="${name}"]`,
          )!;

        const write = (field: HTMLElement, text: string) => {
          const view =
            field.querySelector<CodeMirrorContent>(".cm-content")!.cmTile.root
              .view;
          view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: text },
            userEvent: "input.type",
          });
        };
        const row = section("view").querySelector<HTMLElement>(
          "[data-condition-row]",
        )!;
        write(row, 'tags.contains("figure")');
        press(
          await until("Edit visually enabled", () => {
            const button = row.querySelector<HTMLButtonElement>(
              `button[aria-label="${__typedArg0}"]`,
            )!;
            return button && !button.disabled ? button : null;
          }),
          "Edit visually",
        );
        return String(true);
      },
      { __typedArg0: run.m.workbench_match_edit_visually() },
    );
    const back = await queryKeys(
      '(colorName == "yellow") && (tags.contains("figure"))',
    );
    await tabWhen(
      (tab) =>
        !tab.filterError &&
        JSON.stringify(tab.cards) === JSON.stringify(back) &&
        tab.text.includes('        - tags.contains("figure")\n'),
    );
    expect(
      await obRun(
        run.vaultId,
        async ({ app, page: pageHelpers }, { __typedArg0 }) => {
          const { press } = pageHelpers;
          const el = (
            app.workspace.getMostRecentLeaf()!
              .view as import("obsidian").ItemView
          ).contentEl;
          const popover = el.querySelector<HTMLElement>(
            '[data-query-popover="filter"]',
          )!;
          if (!popover.matches(":popover-open"))
            press(
              el.querySelector<HTMLElement>('[data-query-toolbar="filter"]')!,
              "Filter",
            );
          const section = (name: string) =>
            popover.querySelector<HTMLElement>(
              `[data-filter-section="${name}"]`,
            )!;

          return String(
            section("view").querySelector<HTMLInputElement>(
              `[data-condition-row] input[aria-label="${__typedArg0}"]`,
            )?.value ?? null,
          );
        },
        { __typedArg0: run.m.workbench_filter_value() },
      ),
    ).toBe("figure");

    // A condition dragged by its grip above another takes the first place,
    // and the file keeps the new order.
    const figureLine = '        - tags.contains("figure")';
    const nextLine = (text: string) => {
      const lines = text.split("\n");
      return lines[lines.indexOf(figureLine) + 1] ?? "";
    };
    await obRun(
      run.vaultId,
      async ({ app, page: pageHelpers }, { __typedArg0, __typedArg1 }) => {
        const { press, until } = pageHelpers;
        const el = (
          app.workspace.getMostRecentLeaf()!.view as import("obsidian").ItemView
        ).contentEl;
        const popover = el.querySelector<HTMLElement>(
          '[data-query-popover="filter"]',
        )!;
        if (!popover.matches(":popover-open"))
          press(
            el.querySelector<HTMLElement>('[data-query-toolbar="filter"]')!,
            "Filter",
          );
        const section = (name: string) =>
          popover.querySelector<HTMLElement>(
            `[data-filter-section="${name}"]`,
          )!;

        press(
          [...section("view").querySelectorAll<HTMLElement>("button")].find(
            (button) => button.textContent.trim() === __typedArg0,
          ),
          "Add condition",
        );
        await until("new row", () =>
          section("view").querySelector<HTMLSelectElement>(
            `[data-condition-row] select[aria-label="${__typedArg1}"]`,
          )!,
        );
        return String(true);
      },
      {
        __typedArg0: run.m.workbench_match_add_condition(),
        __typedArg1: run.m.workbench_filter_value(),
      },
    );
    // The focus goes to the new row's condition type.
    expect(
      await obRun(
        run.vaultId,
        async ({ app, page: pageHelpers }) => {
          const { press } = pageHelpers;
          const el = (
            app.workspace.getMostRecentLeaf()!
              .view as import("obsidian").ItemView
          ).contentEl;
          const popover = el.querySelector<HTMLElement>(
            '[data-query-popover="filter"]',
          )!;
          if (!popover.matches(":popover-open"))
            press(
              el.querySelector<HTMLElement>('[data-query-toolbar="filter"]')!,
              "Filter",
            );
          const section = (name: string) =>
            popover.querySelector<HTMLElement>(
              `[data-filter-section="${name}"]`,
            )!;

          return String(
            popover.ownerDocument.activeElement?.closest<HTMLElement>(
              "[data-condition-row]",
            )! ===
              [
                ...section("view").querySelectorAll<HTMLElement>(
                  "[data-condition-row]",
                ),
              ].at(-1) &&
              popover.ownerDocument.activeElement!.getAttribute("aria-label"),
          );
        },
        undefined,
      ),
    ).toBe(run.m.workbench_match_condition_kind());
    await obRun(
      run.vaultId,
      async ({ app, page: pageHelpers }, { __typedArg0 }) => {
        const { press, pick } = pageHelpers;
        const el = (
          app.workspace.getMostRecentLeaf()!.view as import("obsidian").ItemView
        ).contentEl;
        const popover = el.querySelector<HTMLElement>(
          '[data-query-popover="filter"]',
        )!;
        if (!popover.matches(":popover-open"))
          press(
            el.querySelector<HTMLElement>('[data-query-toolbar="filter"]')!,
            "Filter",
          );
        const section = (name: string) =>
          popover.querySelector<HTMLElement>(
            `[data-filter-section="${name}"]`,
          )!;

        await pick(
          section("view").querySelector<HTMLSelectElement>(
            `[data-condition-row] select[aria-label="${__typedArg0}"]`,
          )!,
          "red",
          "Value",
        );
        return String(true);
      },
      { __typedArg0: run.m.workbench_filter_value() },
    );
    const added = nextLine(
      (await tabWhen((tab) => nextLine(tab.text).startsWith("        - ")))
        .text,
    );
    // `drag(from, over, y)` drags the grip at path `from` over `over` at the
    // height `y` answers from its box, drops it, and tells whether `over`
    // took the drop.

    const viewFilters = (...lines: string[]) =>
      `    filters:\n      and:\n${lines.join("\n")}\n`;
    await obRun(
      run.vaultId,
      async ({ app, page: pageHelpers }) => {
        const { press } = pageHelpers;
        const el = (
          app.workspace.getMostRecentLeaf()!.view as import("obsidian").ItemView
        ).contentEl;
        const popover = el.querySelector<HTMLElement>(
          '[data-query-popover="filter"]',
        )!;
        if (!popover.matches(":popover-open"))
          press(
            el.querySelector<HTMLElement>('[data-query-toolbar="filter"]')!,
            "Filter",
          );
        const section = (name: string) =>
          popover.querySelector<HTMLElement>(
            `[data-filter-section="${name}"]`,
          )!;

        const grip = (path: string) =>
          section("view").querySelector<HTMLElement>(
            `[data-reorder-handle="${path}"]`,
          )!;
        const drag = (
          from: string,
          over: HTMLElement,
          y: (rect: DOMRect) => number,
        ) => {
          const transfer = new DataTransfer();
          const fire = (target: HTMLElement, type: string) => {
            const r = target.getBoundingClientRect();
            const event = new DragEvent(type, {
              bubbles: true,
              cancelable: true,
              dataTransfer: transfer,
              clientX: r.left + r.width / 2,
              clientY: y(r),
            });
            target.dispatchEvent(event);
            return event.defaultPrevented;
          };
          fire(grip(from), "dragstart");
          const took = fire(over, "dragover");
          if (took) fire(over, "drop");
          fire(grip(from), "dragend");
          return took;
        };
        const top = (r: DOMRect) => r.top + 2;
        return String(
          drag("1", grip("0").closest<HTMLElement>('[data-part="row"]')!, top),
        );
      },
      undefined,
    );
    await tabWhen((tab) => tab.text.includes(viewFilters(added, figureLine)));

    // Alt+ArrowDown and Alt+ArrowUp move the focused condition one place,
    // and the focus stays on its grip.

    await obRun(
      run.vaultId,
      async ({ app, page: pageHelpers }) => {
        const { press } = pageHelpers;
        const el = (
          app.workspace.getMostRecentLeaf()!.view as import("obsidian").ItemView
        ).contentEl;
        const popover = el.querySelector<HTMLElement>(
          '[data-query-popover="filter"]',
        )!;
        if (!popover.matches(":popover-open"))
          press(
            el.querySelector<HTMLElement>('[data-query-toolbar="filter"]')!,
            "Filter",
          );
        const section = (name: string) =>
          popover.querySelector<HTMLElement>(
            `[data-filter-section="${name}"]`,
          )!;

        section("view")
          .querySelector<HTMLElement>('[data-reorder-handle="0"]')!
          .focus();
        return String(true);
      },
      undefined,
    );
    expect(
      await obRun(
        run.vaultId,
        async ({ app, page: pageHelpers }, { __typedArg0 }) => {
          const { press, until } = pageHelpers;
          const el = (
            app.workspace.getMostRecentLeaf()!
              .view as import("obsidian").ItemView
          ).contentEl;
          const popover = el.querySelector<HTMLElement>(
            '[data-query-popover="filter"]',
          )!;
          if (!popover.matches(":popover-open"))
            press(
              el.querySelector<HTMLElement>('[data-query-toolbar="filter"]')!,
              "Filter",
            );

          document.activeElement!.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "ArrowDown",
              altKey: true,
              bubbles: true,
              cancelable: true,
            }),
          );
          return String(
            (
              await until("focus follows", () => {
                const path = document.activeElement?.getAttribute(
                  "data-reorder-handle",
                );
                return path && path !== (__typedArg0 ? "0" : "1") ? path : null;
              })
            ).toString(),
          );
        },
        { __typedArg0: true },
      ),
    ).toBe("1");
    await tabWhen((tab) => tab.text.includes(viewFilters(figureLine, added)));
    expect(
      await obRun(
        run.vaultId,
        async ({ app, page: pageHelpers }, { __typedArg0 }) => {
          const { press, until } = pageHelpers;
          const el = (
            app.workspace.getMostRecentLeaf()!
              .view as import("obsidian").ItemView
          ).contentEl;
          const popover = el.querySelector<HTMLElement>(
            '[data-query-popover="filter"]',
          )!;
          if (!popover.matches(":popover-open"))
            press(
              el.querySelector<HTMLElement>('[data-query-toolbar="filter"]')!,
              "Filter",
            );

          document.activeElement!.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "ArrowUp",
              altKey: true,
              bubbles: true,
              cancelable: true,
            }),
          );
          return String(
            (
              await until("focus follows", () => {
                const path = document.activeElement?.getAttribute(
                  "data-reorder-handle",
                );
                return path && path !== (__typedArg0 ? "0" : "1") ? path : null;
              })
            ).toString(),
          );
        },
        { __typedArg0: false },
      ),
    ).toBe("0");
    await tabWhen((tab) => tab.text.includes(viewFilters(added, figureLine)));

    // A condition dropped on a nested group's body goes to the end of that
    // group; a group takes no drop inside itself; a nested condition dragged
    // above the first row leaves its group.
    const nested = (line: string) => `    ${line}`;
    await obRun(
      run.vaultId,
      async ({ app, page: pageHelpers }, { __typedArg0, __typedArg1 }) => {
        const { press, until, pick } = pageHelpers;
        const el = (
          app.workspace.getMostRecentLeaf()!.view as import("obsidian").ItemView
        ).contentEl;
        const popover = el.querySelector<HTMLElement>(
          '[data-query-popover="filter"]',
        )!;
        if (!popover.matches(":popover-open"))
          press(
            el.querySelector<HTMLElement>('[data-query-toolbar="filter"]')!,
            "Filter",
          );
        const section = (name: string) =>
          popover.querySelector<HTMLElement>(
            `[data-filter-section="${name}"]`,
          )!;

        press(
          [...section("view").querySelectorAll<HTMLElement>("button")].find(
            (button) => button.textContent.trim() === __typedArg0,
          ),
          "Add group",
        );
        await pick(
          await until(
            "group row",
            () =>
              section("view").querySelectorAll<HTMLSelectElement>(
                `[data-condition-row] select[aria-label="${__typedArg1}"]`,
              )[1],
          ),
          "red",
          "Value",
        );
        return String(true);
      },
      {
        __typedArg0: run.m.workbench_match_add_group(),
        __typedArg1: run.m.workbench_filter_value(),
      },
    );
    await tabWhen((tab) =>
      tab.text.includes(
        viewFilters(added, figureLine, "        - and:", nested(added)),
      ),
    );
    expect(
      await obRun(
        run.vaultId,
        async ({ app, page: pageHelpers }) => {
          const { press } = pageHelpers;
          const el = (
            app.workspace.getMostRecentLeaf()!
              .view as import("obsidian").ItemView
          ).contentEl;
          const popover = el.querySelector<HTMLElement>(
            '[data-query-popover="filter"]',
          )!;
          if (!popover.matches(":popover-open"))
            press(
              el.querySelector<HTMLElement>('[data-query-toolbar="filter"]')!,
              "Filter",
            );
          const section = (name: string) =>
            popover.querySelector<HTMLElement>(
              `[data-filter-section="${name}"]`,
            )!;

          const grip = (path: string) =>
            section("view").querySelector<HTMLElement>(
              `[data-reorder-handle="${path}"]`,
            )!;
          const drag = (
            from: string,
            over: HTMLElement,
            y: (rect: DOMRect) => number,
          ) => {
            const transfer = new DataTransfer();
            const fire = (target: HTMLElement, type: string) => {
              const r = target.getBoundingClientRect();
              const event = new DragEvent(type, {
                bubbles: true,
                cancelable: true,
                dataTransfer: transfer,
                clientX: r.left + r.width / 2,
                clientY: y(r),
              });
              target.dispatchEvent(event);
              return event.defaultPrevented;
            };
            fire(grip(from), "dragstart");
            const took = fire(over, "dragover");
            if (took) fire(over, "drop");
            fire(grip(from), "dragend");
            return took;
          };

          const footer = [
            ...section("view").querySelectorAll<HTMLElement>(
              '[data-part="group"][data-state="nested"] > [data-part="actions"]',
            ),
          ].at(-1);
          return String(
            drag("1", footer!, (r: DOMRect) => r.top + r.height / 2),
          );
        },
        undefined,
      ),
    ).toBe("true");
    await tabWhen((tab) =>
      tab.text.includes(
        viewFilters(added, "        - and:", nested(added), nested(figureLine)),
      ),
    );
    expect(
      await obRun(
        run.vaultId,
        async ({ app, page: pageHelpers }) => {
          const { press } = pageHelpers;
          const el = (
            app.workspace.getMostRecentLeaf()!
              .view as import("obsidian").ItemView
          ).contentEl;
          const popover = el.querySelector<HTMLElement>(
            '[data-query-popover="filter"]',
          )!;
          if (!popover.matches(":popover-open"))
            press(
              el.querySelector<HTMLElement>('[data-query-toolbar="filter"]')!,
              "Filter",
            );
          const section = (name: string) =>
            popover.querySelector<HTMLElement>(
              `[data-filter-section="${name}"]`,
            )!;

          const grip = (path: string) =>
            section("view").querySelector<HTMLElement>(
              `[data-reorder-handle="${path}"]`,
            )!;
          const drag = (
            from: string,
            over: HTMLElement,
            y: (rect: DOMRect) => number,
          ) => {
            const transfer = new DataTransfer();
            const fire = (target: HTMLElement, type: string) => {
              const r = target.getBoundingClientRect();
              const event = new DragEvent(type, {
                bubbles: true,
                cancelable: true,
                dataTransfer: transfer,
                clientX: r.left + r.width / 2,
                clientY: y(r),
              });
              target.dispatchEvent(event);
              return event.defaultPrevented;
            };
            fire(grip(from), "dragstart");
            const took = fire(over, "dragover");
            if (took) fire(over, "drop");
            fire(grip(from), "dragend");
            return took;
          };
          const top = (r: DOMRect) => r.top + 2;
          return String(
            drag(
              "1",
              grip("1.0").closest<HTMLElement>('[data-part="row"]')!,
              top,
            ),
          );
        },
        undefined,
      ),
    ).toBe("false");
    await obRun(
      run.vaultId,
      async ({ app, page: pageHelpers }) => {
        const { press } = pageHelpers;
        const el = (
          app.workspace.getMostRecentLeaf()!.view as import("obsidian").ItemView
        ).contentEl;
        const popover = el.querySelector<HTMLElement>(
          '[data-query-popover="filter"]',
        )!;
        if (!popover.matches(":popover-open"))
          press(
            el.querySelector<HTMLElement>('[data-query-toolbar="filter"]')!,
            "Filter",
          );
        const section = (name: string) =>
          popover.querySelector<HTMLElement>(
            `[data-filter-section="${name}"]`,
          )!;

        const grip = (path: string) =>
          section("view").querySelector<HTMLElement>(
            `[data-reorder-handle="${path}"]`,
          )!;
        const drag = (
          from: string,
          over: HTMLElement,
          y: (rect: DOMRect) => number,
        ) => {
          const transfer = new DataTransfer();
          const fire = (target: HTMLElement, type: string) => {
            const r = target.getBoundingClientRect();
            const event = new DragEvent(type, {
              bubbles: true,
              cancelable: true,
              dataTransfer: transfer,
              clientX: r.left + r.width / 2,
              clientY: y(r),
            });
            target.dispatchEvent(event);
            return event.defaultPrevented;
          };
          fire(grip(from), "dragstart");
          const took = fire(over, "dragover");
          if (took) fire(over, "drop");
          fire(grip(from), "dragend");
          return took;
        };
        const top = (r: DOMRect) => r.top + 2;
        return String(
          drag(
            "1.1",
            grip("0").closest<HTMLElement>('[data-part="row"]')!,
            top,
          ),
        );
      },
      undefined,
    );
    await tabWhen((tab) =>
      tab.text.includes(
        viewFilters(figureLine, added, "        - and:", nested(added)),
      ),
    );

    // A None group stores as `not`, and its rows after the first read "or".
    const blue = '            - colorName == "blue"';

    await obRun(
      run.vaultId,
      async ({ app, page: pageHelpers }, { __typedArg0 }) => {
        const { press } = pageHelpers;
        const el = (
          app.workspace.getMostRecentLeaf()!.view as import("obsidian").ItemView
        ).contentEl;
        const popover = el.querySelector<HTMLElement>(
          '[data-query-popover="filter"]',
        )!;
        if (!popover.matches(":popover-open"))
          press(
            el.querySelector<HTMLElement>('[data-query-toolbar="filter"]')!,
            "Filter",
          );
        const section = (name: string) =>
          popover.querySelector<HTMLElement>(
            `[data-filter-section="${name}"]`,
          )!;
        const set = (
          control: HTMLInputElement | HTMLSelectElement,
          value: string,
        ) => {
          control.value = value;
          control.dispatchEvent(new Event("input", { bubbles: true }));
        };

        set(
          section("view")
            .querySelector<HTMLElement>(
              '[data-part="group"][data-state="nested"]',
            )!
            .querySelector<HTMLSelectElement>(
              `select[aria-label="${__typedArg0}"]`,
            )!,
          "none",
        );
        return String(true);
      },
      { __typedArg0: run.m.workbench_match_match() },
    );
    await tabWhen((tab) =>
      tab.text.includes(
        viewFilters(figureLine, added, "        - not:", nested(added)),
      ),
    );
    await obRun(
      run.vaultId,
      async ({ app, page: pageHelpers }, { __typedArg0, __typedArg1 }) => {
        const { press, until, pick } = pageHelpers;
        const el = (
          app.workspace.getMostRecentLeaf()!.view as import("obsidian").ItemView
        ).contentEl;
        const popover = el.querySelector<HTMLElement>(
          '[data-query-popover="filter"]',
        )!;
        if (!popover.matches(":popover-open"))
          press(
            el.querySelector<HTMLElement>('[data-query-toolbar="filter"]')!,
            "Filter",
          );
        const section = (name: string) =>
          popover.querySelector<HTMLElement>(
            `[data-filter-section="${name}"]`,
          )!;

        const group = () =>
          section("view").querySelector<HTMLElement>(
            '[data-part="group"][data-state="nested"]',
          )!;
        press(
          [...group().querySelectorAll<HTMLElement>("button")].find(
            (button) => button.textContent.trim() === __typedArg0,
          ),
          "Add condition",
        );
        await pick(
          await until(
            "second row",
            () =>
              group()?.querySelectorAll<HTMLSelectElement>(
                `[data-condition-row] select[aria-label="${__typedArg1}"]`,
              )[1],
          ),
          "blue",
          "Value",
        );
        return String(true);
      },
      {
        __typedArg0: run.m.workbench_match_add_condition(),
        __typedArg1: run.m.workbench_filter_value(),
      },
    );
    await tabWhen((tab) =>
      tab.text.includes(
        viewFilters(figureLine, added, "        - not:", nested(added), blue),
      ),
    );
    expect(
      JSON.parse(
        await obRun(
          run.vaultId,
          async ({ app, page: pageHelpers }) => {
            const { press } = pageHelpers;
            const el = (
              app.workspace.getMostRecentLeaf()!
                .view as import("obsidian").ItemView
            ).contentEl;
            const popover = el.querySelector<HTMLElement>(
              '[data-query-popover="filter"]',
            )!;
            if (!popover.matches(":popover-open"))
              press(
                el.querySelector<HTMLElement>('[data-query-toolbar="filter"]')!,
                "Filter",
              );
            const section = (name: string) =>
              popover.querySelector<HTMLElement>(
                `[data-filter-section="${name}"]`,
              )!;

            return String(
              JSON.stringify(
                [
                  ...section("view").querySelectorAll<HTMLElement>(
                    '[data-part="group"][data-state="nested"] [data-part="conjunction"]',
                  ),
                ].map((label) => label.textContent),
              ),
            );
          },
          undefined,
        ),
      ),
    ).toEqual([
      run.m.workbench_match_conjunction_where(),
      run.m.workbench_match_conjunction_or(),
    ]);

    // Removing the last row of a nested group removes the group, and
    // removing the last row of the view's filter removes its filter.

    await obRun(
      run.vaultId,
      async ({ app, page: pageHelpers }, { __typedArg0 }) => {
        const { press } = pageHelpers;
        const el = (
          app.workspace.getMostRecentLeaf()!.view as import("obsidian").ItemView
        ).contentEl;
        const popover = el.querySelector<HTMLElement>(
          '[data-query-popover="filter"]',
        )!;
        if (!popover.matches(":popover-open"))
          press(
            el.querySelector<HTMLElement>('[data-query-toolbar="filter"]')!,
            "Filter",
          );
        const section = (name: string) =>
          popover.querySelector<HTMLElement>(
            `[data-filter-section="${name}"]`,
          )!;

        press(
          section("view")
            .querySelector<HTMLElement>(
              '[data-part="group"][data-state="nested"]',
            )!
            .querySelector<HTMLButtonElement>(
              `[data-condition-row] button[aria-label="${__typedArg0}"]`,
            )!,
          "Remove condition",
        );
        return String(true);
      },
      { __typedArg0: run.m.workbench_match_remove_condition() },
    );
    await tabWhen((tab) =>
      tab.text.includes(viewFilters(figureLine, added, "        - not:", blue)),
    );
    await obRun(
      run.vaultId,
      async ({ app, page: pageHelpers }, { __typedArg0 }) => {
        const { press } = pageHelpers;
        const el = (
          app.workspace.getMostRecentLeaf()!.view as import("obsidian").ItemView
        ).contentEl;
        const popover = el.querySelector<HTMLElement>(
          '[data-query-popover="filter"]',
        )!;
        if (!popover.matches(":popover-open"))
          press(
            el.querySelector<HTMLElement>('[data-query-toolbar="filter"]')!,
            "Filter",
          );
        const section = (name: string) =>
          popover.querySelector<HTMLElement>(
            `[data-filter-section="${name}"]`,
          )!;

        press(
          section("view")
            .querySelector<HTMLElement>(
              '[data-part="group"][data-state="nested"]',
            )!
            .querySelector<HTMLButtonElement>(
              `[data-condition-row] button[aria-label="${__typedArg0}"]`,
            )!,
          "Remove condition",
        );
        return String(true);
      },
      { __typedArg0: run.m.workbench_match_remove_condition() },
    );
    await tabWhen(
      (tab) =>
        tab.text.includes(viewFilters(figureLine, added)) &&
        !tab.text.includes("- not:"),
    );
    expect(
      await obRun(
        run.vaultId,
        async ({ app, page: pageHelpers }) => {
          const { press } = pageHelpers;
          const el = (
            app.workspace.getMostRecentLeaf()!
              .view as import("obsidian").ItemView
          ).contentEl;
          const popover = el.querySelector<HTMLElement>(
            '[data-query-popover="filter"]',
          )!;
          if (!popover.matches(":popover-open"))
            press(
              el.querySelector<HTMLElement>('[data-query-toolbar="filter"]')!,
              "Filter",
            );
          const section = (name: string) =>
            popover.querySelector<HTMLElement>(
              `[data-filter-section="${name}"]`,
            )!;

          return String(
            section("view").querySelector<HTMLElement>(
              '[data-part="group"][data-state="nested"]',
            )! === null,
          );
        },
        undefined,
      ),
    ).toBe("true");
    await obRun(
      run.vaultId,
      async ({ app, page: pageHelpers }, { __typedArg0 }) => {
        const { press } = pageHelpers;
        const el = (
          app.workspace.getMostRecentLeaf()!.view as import("obsidian").ItemView
        ).contentEl;
        const popover = el.querySelector<HTMLElement>(
          '[data-query-popover="filter"]',
        )!;
        if (!popover.matches(":popover-open"))
          press(
            el.querySelector<HTMLElement>('[data-query-toolbar="filter"]')!,
            "Filter",
          );
        const section = (name: string) =>
          popover.querySelector<HTMLElement>(
            `[data-filter-section="${name}"]`,
          )!;

        press(
          section("view").querySelector<HTMLButtonElement>(
            `[data-condition-row] button[aria-label="${__typedArg0}"]`,
          )!,
          "Remove condition",
        );
        return String(true);
      },
      { __typedArg0: run.m.workbench_match_remove_condition() },
    );
    await obRun(
      run.vaultId,
      async ({ app, page: pageHelpers }, { __typedArg0 }) => {
        const { press } = pageHelpers;
        const el = (
          app.workspace.getMostRecentLeaf()!.view as import("obsidian").ItemView
        ).contentEl;
        const popover = el.querySelector<HTMLElement>(
          '[data-query-popover="filter"]',
        )!;
        if (!popover.matches(":popover-open"))
          press(
            el.querySelector<HTMLElement>('[data-query-toolbar="filter"]')!,
            "Filter",
          );
        const section = (name: string) =>
          popover.querySelector<HTMLElement>(
            `[data-filter-section="${name}"]`,
          )!;

        press(
          section("view").querySelector<HTMLButtonElement>(
            `[data-condition-row] button[aria-label="${__typedArg0}"]`,
          )!,
          "Remove condition",
        );
        return String(true);
      },
      { __typedArg0: run.m.workbench_match_remove_condition() },
    );
    await tabWhen((tab) => !/^ {4}filters:/m.test(tab.text));
    expect(
      await obRun(
        run.vaultId,
        async ({ app, page: pageHelpers }) => {
          const { press } = pageHelpers;
          const el = (
            app.workspace.getMostRecentLeaf()!
              .view as import("obsidian").ItemView
          ).contentEl;
          const popover = el.querySelector<HTMLElement>(
            '[data-query-popover="filter"]',
          )!;
          if (!popover.matches(":popover-open"))
            press(
              el.querySelector<HTMLElement>('[data-query-toolbar="filter"]')!,
              "Filter",
            );
          const section = (name: string) =>
            popover.querySelector<HTMLElement>(
              `[data-filter-section="${name}"]`,
            )!;

          return String(
            section("view").querySelectorAll<HTMLElement>(
              "[data-condition-row]",
            ).length,
          );
        },
        undefined,
      ),
    ).toBe("1");
  }, 180000);

  it("underlines a condition's Fault in the Filter popover of a Query File tab in a popout window", async () => {
    const layout = await obRun(
      run.vaultId,
      async ({ app }) => {
        return String(JSON.stringify(app.workspace.getLayout()));
      },
      undefined,
    );
    const path = "query-files/Popout faults.zotquery";
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obRun(
        run.vaultId,
        async ({ app }, { __typedArg0, __typedArg1, __typedArg2 }) => {
          for (const leaf of app.workspace.getLeavesOfType("zotlit-query-file"))
            if (
              (leaf.view as import("obsidian").FileView).file?.path ===
              __typedArg0
            )
              leaf.detach();
          await app.workspace.changeLayout(JSON.parse(__typedArg1));
          const file = app.vault.getFileByPath(__typedArg2)!;
          if (file) await app.vault.delete(file);
          return String(true);
        },
        { __typedArg0: path, __typedArg1: layout, __typedArg2: path },
      );
    });
    await obRun(
      run.vaultId,
      async ({ app }, { __typedArg0, __typedArg1 }) => {
        const file = await app.vault.create(__typedArg0, __typedArg1);
        const leaf = app.workspace.getLeaf("tab");
        await leaf.openFile(file);
        app.workspace.moveLeafToPopout(leaf);
        return String(true);
      },
      {
        __typedArg0: path,
        __typedArg1: [
          "views:",
          "  - type: annotations",
          "    name: Faults",
          "    from: annotations",
          "    filters: nosuchfield == 1",
          "",
        ].join("\n"),
      },
    );
    const shown = JSON.parse(
      await obRun(
        run.vaultId,
        async ({ app, page: pageHelpers }, { __typedArg0 }) => {
          const { press, until } = pageHelpers;
          const view = await until(
            "the tab in a popout",
            () =>
              app.workspace
                .getLeavesOfType("zotlit-query-file")
                .map((leaf) => leaf.view)
                .find(
                  (view) =>
                    (view as import("obsidian").FileView).file?.path ===
                      __typedArg0 && view.containerEl.win !== window,
                ),
            20000,
          );
          await (view as import("@/views/query-view/file-view").QueryFileView)
            .query.settled;
          const el = (view as import("obsidian").ItemView).contentEl;
          const doc = el.ownerDocument;
          const button = await until(
            "Filter button",
            () =>
              el.querySelector<HTMLElement>('[data-query-toolbar="filter"]')!,
            20000,
          );
          const popover = el.querySelector<HTMLElement>(
            '[data-query-popover="filter"]',
          )!;
          press(button, "Filter");
          const mark = await until(
            "underline",
            () =>
              popover!.querySelector<HTMLElement>(
                '[data-filter-section="view"] [data-condition-row] .cm-lintRange-error',
              )!,
            20000,
          );
          const probe = doc.createElement("span");
          probe.style.color = "var(--text-error)";
          popover!.append(probe);
          const error = getComputedStyle(probe).color;
          probe.remove();
          const style = getComputedStyle(mark);
          return String(
            JSON.stringify({
              popout: doc !== document,
              text: mark.textContent,
              line: style.textDecorationStyle,
              color: style.textDecorationColor === error,
            }),
          );
        },
        { __typedArg0: path },
      ),
    ) as { popout: boolean; text: string; line: string; color: boolean };
    expect(shown).toEqual({
      popout: true,
      text: "nosuchfield",
      line: "wavy",
      color: true,
    });
  }, 120000);

  // #1641: a crowded condition row once squeezed its property select to its
  // icon, and broke its chips mid-word. The select keeps its whole name at
  // any depth, and each chip keeps its value on one line.
  it("keeps each condition's property name and chips whole in the Filter popover, in a nested group and with a chip list", async () => {
    const layout = await obRun(
      run.vaultId,
      async ({ app }) => {
        return String(JSON.stringify(app.workspace.getLayout()));
      },
      undefined,
    );
    const deep = "query-files/Nested conditions.zotquery";
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obRun(
        run.vaultId,
        async ({ app }, { __typedArg0, __typedArg1 }) => {
          for (const popup of document.querySelectorAll<HTMLElement>(
            "[popover]:popover-open",
          ))
            popup.hidePopover();
          for (const leaf of app.workspace.getLeavesOfType("zotlit-query-file"))
            leaf.detach();
          await app.workspace.changeLayout(JSON.parse(__typedArg0));
          const file = app.vault.getFileByPath(__typedArg1)!;
          if (file) await app.vault.delete(file);
          return String(true);
        },
        { __typedArg0: layout, __typedArg1: deep },
      );
    });
    await obRun(
      run.vaultId,
      async ({ app }, { __typedArg0, __typedArg1 }) => {
        await app.vault.create(__typedArg0, __typedArg1);
        return String(true);
      },
      {
        __typedArg0: deep,
        __typedArg1: [
          "views:",
          "  - type: table",
          "    name: Nested",
          "    from: items",
          "    filters:",
          "      and:",
          "        - 'date.year >= 1950'",
          "        - or:",
          "            - 'itemType == \"book\"'",
          "            - and:",
          "                - 'firstAuthor.fullName.contains(\"Collator\")'",
          "                - or:",
          "                    - 'title.contains(\"reading\")'",
          "                    - and:",
          "                        - 'title.contains(\"method\")'",
          '                        - \'tags.containsAny("methodology", "visualization")\'',
          "    order:",
          "      - title",
          "",
        ].join("\n"),
      },
    );
    interface Row {
      kind: string;
      label: number;
      clipped: boolean;
      chips: Record<string, number>;
    }
    /**
     * The condition rows of a view's own filter: each property select's
     * label width and whether its text is cut, and the lines each chip's
     * value takes.
     */
    const rowsOf = async (path: string, view: string) =>
      JSON.parse(
        await obRun(
          run.vaultId,
          async (
            { app, page: pageHelpers },
            { __typedArg0, __typedArg1, __typedArg2 },
          ) => {
            const { press, until } = pageHelpers;
            const leaf = app.workspace.getLeaf("tab");
            await leaf.openFile(app.vault.getFileByPath(__typedArg0)!);
            app.workspace.setActiveLeaf(leaf, { focus: true });
            (
              leaf.view as import("@/views/query-view/file-view").QueryFileView
            ).query.selectView(__typedArg1);
            await (
              leaf.view as import("@/views/query-view/file-view").QueryFileView
            ).query.settled;
            const el = (leaf.view as import("obsidian").ItemView).contentEl;
            const button = await until(
              "Filter button",
              () =>
                el.querySelector<HTMLElement>('[data-query-toolbar="filter"]')!,
              20000,
            );
            const popover = el.querySelector<HTMLElement>(
              '[data-query-popover="filter"]',
            )!;
            press(button, "Filter");
            await until("Filter popover", () =>
              popover!.matches(":popover-open"),
            );
            const pickers = () => [
              ...popover!.querySelectorAll<HTMLElement>(
                `[data-filter-section="view"] [data-condition-row] [aria-label=${JSON.stringify(__typedArg2)}]`,
              ),
            ];
            await until("condition rows", () => pickers().length > 0, 5000);
            await new Promise((r) =>
              requestAnimationFrame(() => requestAnimationFrame(r)),
            );
            const lines = (node: HTMLElement) => {
              const range = node.ownerDocument.createRange();
              range.selectNodeContents(node);
              return new Set(
                [...range.getClientRects()].map((r) => Math.round(r.top)),
              ).size;
            };
            const rows = pickers().map((picker) => {
              const label = picker.querySelector<HTMLElement>(
                ":scope > span:not([data-select-icon])",
              )!;
              const row = picker.closest<HTMLElement>("[data-condition-row]")!;
              return {
                kind: picker.dataset.value,
                label: Math.round(label!.getBoundingClientRect().width),
                clipped: label!.scrollWidth > label!.clientWidth,
                chips: Object.fromEntries(
                  [
                    ...row!.querySelectorAll<HTMLInputElement>(
                      "[data-chip-input] .multi-select-pill-content",
                    ),
                  ].map((content) => [content.textContent, lines(content)]),
                ),
              };
            });
            popover!.hidePopover();
            leaf.detach();
            return String(JSON.stringify(rows));
          },
          {
            __typedArg0: path,
            __typedArg1: view,
            __typedArg2: run.m.workbench_match_condition_kind(),
          },
        ),
      ) as Row[];
    const whole = (rows: Row[]) =>
      rows.map(({ kind, chips }) => ({
        kind,
        label: expect.any(Number) as number,
        clipped: false,
        chips: Object.fromEntries(
          Object.keys(chips).map((value) => [value, 1]),
        ),
      }));

    // The Fixture's view: "Tag contains any of" beside "Item type is Book",
    // in a group of "Any of the following".
    const advanced = await rowsOf(
      "query-files/Formula lab.zotquery",
      "Advanced filters",
    );
    expect(advanced.map(({ kind }) => kind)).toContain("tags");
    expect(advanced).toEqual(whole(advanced));
    expect(advanced.find(({ kind }) => kind === "tags")?.chips).toEqual({
      methodology: 1,
      visualization: 1,
    });
    for (const { label } of advanced) expect(label).toBeGreaterThan(0);

    // Five groups deep, a row with a plain value keeps its property's name
    // as well.
    const nested = await rowsOf(deep, "Nested");
    expect(nested.map(({ kind }) => kind)).toEqual([
      "year",
      "item-type",
      "first-author",
      "item-title",
      "item-title",
      "tags",
    ]);
    expect(nested).toEqual(whole(nested));
    for (const { label } of nested) expect(label).toBeGreaterThan(0);
  }, 120000);

  // The Fixture's Literature Note of SAKIMA22 ends with a Query Block of
  // `item == this.item`. A change in the view rewrites the block text only,
  // and the Live Preview widget stays on the page.
  it("shows a Query Block of its note's Item and saves a sort change into the block", async () => {
    const notePath = "literatures/SAKIMA22.md";
    const layout = await obRun(
      run.vaultId,
      async ({ app }) => {
        return String(JSON.stringify(app.workspace.getLayout()));
      },
      undefined,
    );
    const original = await obRun(
      run.vaultId,
      async ({ app }, { __typedArg0 }) => {
        return String(
          await app.vault.read(app.vault.getFileByPath(__typedArg0)!),
        );
      },
      { __typedArg0: notePath },
    );
    await using cleanup = new AsyncDisposableStack();
    const scratchFiles: string[] = [];
    cleanup.defer(async () => {
      await obRun(
        run.vaultId,
        async (
          { app },
          { __typedArg0, __typedArg1, __typedArg2, __typedArg3 },
        ) => {
          await app.workspace.changeLayout(JSON.parse(__typedArg0));
          await app.vault.modify(
            app.vault.getFileByPath(__typedArg1)!,
            __typedArg2,
          );
          for (const path of __typedArg3) {
            const file = app.vault.getFileByPath(path)!;
            if (file) await app.vault.delete(file);
          }
          return String(true);
        },
        {
          __typedArg0: layout,
          __typedArg1: notePath,
          __typedArg2: original,
          __typedArg3: scratchFiles,
        },
      );
    });

    /** What `view` shows, once its query settled. */

    interface Shown {
      file: string;
      mark: string | null;
      count: string | null;
      cards: string[];
      diagnostic: string | null;
      readOnly: string | null;
    }
    const shownWhen = (view: NoteQueryView, ready: (shown: Shown) => boolean) =>
      readQueryViewUntil(
        run.vaultId,
        async ({ app, page: pageHelpers }, { __typedArg0 }) => {
          const el = await pageHelpers.revealQueryView(__typedArg0);
          return {
            file: (
              app.workspace.getMostRecentLeaf()!
                .view as import("obsidian").FileView
            ).file!.path,
            mark: el.dataset.e2eMark ?? null,
            count:
              el
                .querySelector<HTMLElement>("[data-query-count]")
                ?.getAttribute("data-query-count") ?? null,
            cards: [...el.querySelectorAll<HTMLElement>(".zt-annot-card")].map(
              (n) => n.getAttribute("data-zotero-annotation-key")!,
            ),
            diagnostic:
              el
                .querySelector<HTMLElement>("[data-query-diagnostic]")
                ?.getAttribute("data-query-diagnostic") ?? null,
            readOnly:
              el.querySelector<HTMLElement>("[data-query-read-only]")
                ?.textContent ?? null,
          };
        },
        { __typedArg0: view },
        {
          ready,
          what: "Query View",
          tries: 120,
        },
      );
    /** Runs `script` with `el`, the element that holds `view`. */

    /** The Annotation keys ZotLit Query gives for an Item, through the CLI. */
    const itemAnnotations = async (item: string, sort?: string) => {
      const report = JSON.parse(
        await cliCommand(run.vaultId, "zotlit:query", {
          args: {
            from: "annotations",
            filter: "item == this.item",
            "this-item": item,
            fields: "item.title",
            limit: "100",
            ...(sort === undefined ? {} : { sort }),
          },
        }),
      ) as ItemQueryReport;
      expect(report.ok).toBe(true);
      return report.rows!.map((row) => row.indexedKey);
    };
    const open = async (
      path: string,
      mode: "live" | "reading",
      target: QueryViewTarget = { block: 0 },
    ) => {
      await obRun(
        run.vaultId,
        async ({ app }, { __typedArg0, __typedArg1 }) => {
          const leaf = app.workspace.getLeaf("tab");
          await leaf.openFile(app.vault.getFileByPath(__typedArg0)!, {
            state: __typedArg1
              ? { mode: "source", source: false }
              : { mode: "preview" },
          });
          app.workspace.setActiveLeaf(leaf, { focus: true });
          return String(true);
        },
        { __typedArg0: path, __typedArg1: mode === "live" },
      );
      return revealQueryView(run.vaultId, path, target);
    };

    // In Live Preview, `this` is the Item of the note's `zotero-key`.
    const own = await itemAnnotations("SAKIMA22");
    expect(own.length).toBeGreaterThan(1);
    const liveView = await open(notePath, "live");
    const live = await shownWhen(liveView, (shown) => shown.count !== null);
    expect(live).toMatchObject({
      file: notePath,
      count: String(own.length),
      cards: own,
      diagnostic: null,
      readOnly: null,
    });

    // A sort change in the toolbar rewrites the block text, and nothing else
    // in the note. Each step of the Sort control saves.
    await obRun(
      run.vaultId,
      async ({ page: pageHelpers }, { __typedArg0 }) => {
        const { press } = pageHelpers;
        const el = await pageHelpers.revealQueryView(__typedArg0);
        el.dataset.e2eMark = "kept";
        press(
          el.querySelector<HTMLElement>('[data-query-toolbar="sort"]')!,
          "Sort",
        );
        return String(true);
      },
      { __typedArg0: liveView },
    );
    await obRun(
      run.vaultId,
      async ({ page: pageHelpers }, { __typedArg0 }) => {
        const { press } = pageHelpers;
        const el = await pageHelpers.revealQueryView(__typedArg0);
        press(
          el.querySelector<HTMLElement>(
            '[data-query-popover="sort"] [data-sort-add]',
          )!,
          "Add sort",
        );
        return String(true);
      },
      { __typedArg0: liveView },
    );
    for (const [control, value] of [
      ["data-sort-property", "type"],
      ["data-sort-direction", "DESC"],
    ] as const) {
      await readQueryViewUntil(
        run.vaultId,
        async ({ page: pageHelpers }, { __typedArg0, __typedArg1 }) => {
          return !!(
            await pageHelpers.revealQueryView(__typedArg0)
          ).querySelector<HTMLButtonElement | HTMLSelectElement>(
            `[data-query-popover="sort"] [${__typedArg1}]`,
          )!;
        },
        { __typedArg0: liveView, __typedArg1: control },
        { ready: (present) => present, what: `${control} in the Sort popover` },
      );
      await obRun(
        run.vaultId,
        async (
          { page: pageHelpers },
          { __typedArg0, __typedArg1, __typedArg2, __typedArg3 },
        ) => {
          const { pick } = pageHelpers;
          const el = await pageHelpers.revealQueryView(__typedArg0);
          await pick(
            el.querySelector<HTMLButtonElement | HTMLSelectElement>(
              `[data-query-popover="sort"] [${__typedArg1}]`,
            )!,
            __typedArg2,
            `${__typedArg3}`,
          );
          return String(true);
        },
        {
          __typedArg0: liveView,
          __typedArg1: control,
          __typedArg2: value,
          __typedArg3: control,
        },
      );
    }
    const written = original.replace(
      "    limit: 100\n```",
      "    limit: 100\n    sort:\n      - property: type\n        direction: DESC\n```",
    );
    expect(written).not.toBe(original);
    expect(
      await waitFor(
        async () =>
          (await obRun(
            run.vaultId,
            async ({ app }, { __typedArg0 }) => {
              return String(
                await app.vault.read(app.vault.getFileByPath(__typedArg0)!),
              );
            },
            { __typedArg0: notePath },
          )) === written,
      ),
    ).toBe(true);
    const sorted = await itemAnnotations("SAKIMA22", "-type");
    const resorted = await shownWhen(
      liveView,
      (shown) => JSON.stringify(shown.cards) === JSON.stringify(sorted),
    );
    // The Live Preview widget that showed the view is the one that shows it now.
    expect(resorted.mark).toBe("kept");

    // Reading view shows the saved sort, and `this` follows the note's
    // `zotero-key` when the frontmatter changes.
    const readingView = await open(notePath, "reading");
    await shownWhen(
      readingView,
      (shown) => JSON.stringify(shown.cards) === JSON.stringify(sorted),
    );
    const other = await itemAnnotations("RUGIER24", "-type");
    expect(other.length).toBeGreaterThan(0);
    await obRun(
      run.vaultId,
      async ({ app }, { __typedArg0 }) => {
        await app.fileManager.processFrontMatter(
          app.vault.getFileByPath(__typedArg0)!,
          (fm) => {
            fm["zotero-key"] = "RUGIER24";
          },
        );
        return String(true);
      },
      { __typedArg0: notePath },
    );
    await shownWhen(
      readingView,
      (shown) => JSON.stringify(shown.cards) === JSON.stringify(other),
    );

    // A section embed shows the block, and a sort change there saves to the
    // note that holds it.
    const embedPath = "Query block embed.md";
    scratchFiles.push(embedPath);
    await obRun(
      run.vaultId,
      async ({ app }, { __typedArg0, __typedArg1, __typedArg2 }) => {
        await app.vault.modify(
          app.vault.getFileByPath(__typedArg0)!,
          __typedArg1,
        );
        await app.vault.create(__typedArg2, "![[SAKIMA22#Sakima’s song]]\n");
        return String(true);
      },
      { __typedArg0: notePath, __typedArg1: written, __typedArg2: embedPath },
    );
    const sectionView = await open(embedPath, "reading", {
      embed: "SAKIMA22#Sakima’s song",
    });
    const embedded = await shownWhen(
      sectionView,
      (shown) => JSON.stringify(shown.cards) === JSON.stringify(sorted),
    );
    expect(embedded.readOnly).toBeNull();
    await obRun(
      run.vaultId,
      async ({ page: pageHelpers }, { __typedArg0 }) => {
        const { press } = pageHelpers;
        const el = await pageHelpers.revealQueryView(__typedArg0);
        press(
          el.querySelector<HTMLElement>('[data-query-toolbar="sort"]')!,
          "Sort",
        );
        return String(true);
      },
      { __typedArg0: sectionView },
    );
    await obRun(
      run.vaultId,
      async ({ page: pageHelpers }, { __typedArg0 }) => {
        const el = await pageHelpers.revealQueryView(__typedArg0);
        const select = el.querySelector<HTMLButtonElement>(
          '[data-query-popover="sort"] [data-sort-direction]',
        )!;
        select!.value = "ASC";
        select!.dispatchEvent(new Event("change", { bubbles: true }));
        return String(true);
      },
      { __typedArg0: sectionView },
    );
    const fromEmbed = written.replace(
      "        direction: DESC\n```",
      "        direction: ASC\n```",
    );
    expect(fromEmbed).not.toBe(written);
    expect(
      await waitFor(
        async () =>
          (await obRun(
            run.vaultId,
            async ({ app }, { __typedArg0 }) => {
              return String(
                await app.vault.read(app.vault.getFileByPath(__typedArg0)!),
              );
            },
            { __typedArg0: notePath },
          )) === fromEmbed,
      ),
    ).toBe(true);
    expect(
      await obRun(
        run.vaultId,
        async ({ app }, { __typedArg0 }) => {
          return String(
            await app.vault
              .read(app.vault.getFileByPath(__typedArg0)!)
              .then(JSON.stringify),
          );
        },
        { __typedArg0: embedPath },
      ),
    ).toBe(JSON.stringify("![[SAKIMA22#Sakima’s song]]\n"));

    // In a note without a `zotero-key`, the view names `this`.
    const plainPath = "Query block without key.md";
    scratchFiles.push(plainPath);
    await obRun(
      run.vaultId,
      async ({ app }, { __typedArg0, __typedArg1 }) => {
        await app.vault.create(__typedArg0, __typedArg1);
        return String(true);
      },
      {
        __typedArg0: plainPath,
        __typedArg1:
          "# Without a key\n\n```zotquery\nviews:\n  - type: annotations\n    name: Mine\n    from: annotations\n    filters: item == this.item\n```\n",
      },
    );
    const plainView = await open(plainPath, "live");
    const unbound = await shownWhen(
      plainView,
      (shown) => shown.diagnostic !== null,
    );
    expect(unbound).toMatchObject({
      diagnostic: "unbound-context",
      cards: [],
    });
  }, 180000);

  it("saves a limit typed into a Query Block when its note closes or shows another file before the save delay ends", async () => {
    const notePath = "literatures/SAKIMA22.md";
    const layout = await obRun(
      run.vaultId,
      async ({ app }) => {
        return String(JSON.stringify(app.workspace.getLayout()));
      },
      undefined,
    );
    const original = await obRun(
      run.vaultId,
      async ({ app }, { __typedArg0 }) => {
        return String(
          await app.vault.read(app.vault.getFileByPath(__typedArg0)!),
        );
      },
      { __typedArg0: notePath },
    );
    expect(original).toContain("    limit: 100\n```");

    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obRun(
        run.vaultId,
        async ({ app }, { __typedArg0, __typedArg1, __typedArg2 }) => {
          await app.workspace.changeLayout(JSON.parse(__typedArg0));
          await app.vault.modify(
            app.vault.getFileByPath(__typedArg1)!,
            __typedArg2,
          );
          return String(true);
        },
        { __typedArg0: layout, __typedArg1: notePath, __typedArg2: original },
      );
    });
    const read = () =>
      obRun(
        run.vaultId,
        async ({ app }, { __typedArg0 }) => {
          return String(
            await app.vault.read(app.vault.getFileByPath(__typedArg0)!),
          );
        },
        { __typedArg0: notePath },
      );

    const cases = [
      ["live", "close"],
      ["live", "switch"],
      ["reading", "close"],
    ] as const;
    const outcomes: { mode: string; leave: string; saved: boolean }[] = [];
    for (const [index, [mode, leave]] of cases.entries()) {
      const limit = String(3 + index);
      await obRun(
        run.vaultId,
        async ({ app }, { __typedArg0, __typedArg1, __typedArg2 }) => {
          await app.workspace.changeLayout(JSON.parse(__typedArg0));
          await app.vault.modify(
            app.vault.getFileByPath(__typedArg1)!,
            __typedArg2,
          );
          return String(true);
        },
        { __typedArg0: layout, __typedArg1: notePath, __typedArg2: original },
      );
      await obRun(
        run.vaultId,
        async ({ app, page: pageHelpers }, { __typedArg0, __typedArg1 }) => {
          const leaf = app.workspace.getLeaf("tab");
          await leaf.openFile(app.vault.getFileByPath(__typedArg0)!, {
            state: __typedArg1
              ? { mode: "source", source: false }
              : { mode: "preview" },
          });
          app.workspace.setActiveLeaf(leaf, { focus: true });
          pageHelpers.scratch.zotlitE2EBlockLeaf = leaf;
          return String(true);
        },
        { __typedArg0: notePath, __typedArg1: mode === "live" },
      );
      const block = await revealQueryView(run.vaultId, notePath, {
        block: 0,
      });
      await readQueryViewUntil(
        run.vaultId,
        async ({ page: pageHelpers }, { __typedArg0 }) => {
          return !!(
            await pageHelpers.revealQueryView(__typedArg0)
          ).querySelector<HTMLElement>("[data-query-count]")!;
        },
        { __typedArg0: block },
        { ready: (counted) => counted, what: "Query Block count", tries: 120 },
      );
      // The limit, then the note goes at once, well inside the save delay. The
      // block is the one the mode shows; the other mode's copy stays hidden.
      await obRun(
        run.vaultId,
        async (
          { app, page: pageHelpers },
          { __typedArg0, __typedArg1, __typedArg2, __typedArg3 },
        ) => {
          const { press, until } = pageHelpers;
          const leaf = pageHelpers.scratch.zotlitE2EBlockLeaf;
          const el = await pageHelpers.revealQueryView(__typedArg0);
          press(
            el.querySelector<HTMLElement>("[data-query-results]")!,
            "Results",
          );
          const input = await until("limit field", () =>
            el.querySelector<HTMLInputElement>(
              "[data-query-results-popup] [data-query-limit]",
            )!,
          );
          Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            "value",
          )!.set!.call(input, __typedArg1);
          input.dispatchEvent(new Event("input", { bubbles: true }));
          if (__typedArg2) {
            leaf!.detach();
          } else {
            await leaf!.openFile(
              app.vault.getMarkdownFiles().find((f) => f.path !== __typedArg3)!,
            );
          }
          delete pageHelpers.scratch.zotlitE2EBlockLeaf;
          return String(true);
        },
        {
          __typedArg0: block,
          __typedArg1: limit,
          __typedArg2: leave === "close",
          __typedArg3: notePath,
        },
      );
      const expected = original.replace(
        "    limit: 100\n```",
        `    limit: ${limit}\n\`\`\``,
      );
      await waitFor(async () => (await read()) === expected);
      outcomes.push({ mode, leave, saved: (await read()) === expected });
    }
    expect(outcomes).toEqual(
      cases.map(([mode, leave]) => ({ mode, leave, saved: true })),
    );
  }, 180000);

  it("adds, renames and sets a default view of a Query File from the view menu, and the file keeps them", async () => {
    const path = "query-files/Reading annotations.zotquery";
    const layout = await obRun(
      run.vaultId,
      async ({ app }) => {
        return String(JSON.stringify(app.workspace.getLayout()));
      },
      undefined,
    );
    const original = await obRun(
      run.vaultId,
      async ({ app }, { __typedArg0 }) => {
        return String(
          await app.vault.read(app.vault.getFileByPath(__typedArg0)!),
        );
      },
      { __typedArg0: path },
    );
    await using cleanup = new AsyncDisposableStack();
    // The tab closes before the text goes back, so no pending save of the
    // tab writes over it.
    cleanup.defer(async () => {
      await obRun(
        run.vaultId,
        async ({ app }, { __typedArg0, __typedArg1, __typedArg2 }) => {
          for (const leaf of app.workspace.getLeavesOfType("zotlit-query-file"))
            leaf.detach();
          await app.vault.modify(
            app.vault.getFileByPath(__typedArg0)!,
            __typedArg1,
          );
          await app.workspace.changeLayout(JSON.parse(__typedArg2));
          return String(true);
        },
        { __typedArg0: path, __typedArg1: original, __typedArg2: layout },
      );
    });

    /** The view on screen, its cards, and the page labels the cards show. */
    const shown = (view: string) =>
      obRunUntil(
        run.vaultId,
        async ({ app }) => {
          const view = app.workspace.getMostRecentLeaf()!.view;
          if (view.getViewType() !== "zotlit-query-file") return "none";
          await (view as import("@/views/query-view/file-view").QueryFileView)
            .query.settled;
          const el = (view as import("obsidian").ItemView).contentEl;
          const cards =
            el.querySelectorAll<HTMLElement>(".zt-annot-card").length;
          return `${
            el.querySelector<HTMLElement>("[data-query-view-menu]")?.textContent
          }:${cards > 0}`;
        },
        undefined,
        {
          ready: (value) => value === `${view}:true`,
          what: "query-view.e2e.ts:1236",
        },
      ).then(
        () => true,
        () => false,
      );

    /** The view rows the open view menu shows. */

    await obRun(
      run.vaultId,
      async ({ app }, { __typedArg0 }) => {
        const old = app.workspace.getLeavesOfType("zotlit-query-file");
        const leaf = app.workspace.getLeaf("tab");
        await leaf.openFile(app.vault.getFileByPath(__typedArg0)!);
        app.workspace.setActiveLeaf(leaf, { focus: true });
        for (const other of old) other.detach();
        return String(true);
      },
      { __typedArg0: path },
    );
    expect(await shown("All annotations")).toBe(true);
    // A page number takes "p."; a named page label reads as it is.
    const shownPages: string[] = JSON.parse(
      await obRun(
        run.vaultId,
        async ({ app }) => {
          return String(
            JSON.stringify(
              [
                ...(
                  app.workspace.getMostRecentLeaf()!
                    .view as import("obsidian").ItemView
                ).contentEl.querySelectorAll<HTMLElement>(
                  ".zt-annot-page-chip",
                ),
              ]
                .map((n) => n.textContent)
                .filter(Boolean),
            ),
          );
        },
        undefined,
      ),
    );
    expect(shownPages).toContain("p. 1");
    expect(shownPages).toContain("Chapter 1");

    // The view menu narrows its views as the researcher types.
    await obRun(
      run.vaultId,
      async ({ app, page: pageHelpers }) => {
        const { press } = pageHelpers;
        press(
          (
            app.workspace.getMostRecentLeaf()!
              .view as import("obsidian").ItemView
          ).contentEl.querySelector<HTMLElement>("[data-query-view-menu]")!,
          "View menu",
        );
        return String(true);
      },
      undefined,
    );
    await obRunUntil(
      run.vaultId,
      async ({ app }) => {
        return [
          ...(
            app.workspace.getMostRecentLeaf()!
              .view as import("obsidian").ItemView
          ).contentEl.querySelectorAll<HTMLElement>(
            "[data-query-view-list]:popover-open [data-query-view-row]",
          ),
        ].map((n) => n.getAttribute("data-query-view-row"));
      },
      undefined,
      {
        ready: (value) =>
          isDeepStrictEqual(value, ["All annotations", "Figures"]),
        what: "query-view.e2e.ts:1260",
      },
    );
    await obRun(
      run.vaultId,
      async ({ app }, { __typedArg0 }) => {
        const input = (
          app.workspace.getMostRecentLeaf()!.view as import("obsidian").ItemView
        ).contentEl.querySelector<HTMLInputElement>(
          "[data-query-view-list] input",
        )!;
        input!.value = __typedArg0;
        input!.dispatchEvent(new Event("input", { bubbles: true }));
        return String(true);
      },
      { __typedArg0: "fig" },
    );
    await obRunUntil(
      run.vaultId,
      async ({ app }) => {
        return [
          ...(
            app.workspace.getMostRecentLeaf()!
              .view as import("obsidian").ItemView
          ).contentEl.querySelectorAll<HTMLElement>(
            "[data-query-view-list]:popover-open [data-query-view-row]",
          ),
        ].map((n) => n.getAttribute("data-query-view-row"));
      },
      undefined,
      {
        ready: (value) => isDeepStrictEqual(value, ["Figures"]),
        what: "query-view.e2e.ts:1266",
      },
    );
    await obRun(
      run.vaultId,
      async ({ app }, { __typedArg0 }) => {
        const input = (
          app.workspace.getMostRecentLeaf()!.view as import("obsidian").ItemView
        ).contentEl.querySelector<HTMLInputElement>(
          "[data-query-view-list] input",
        )!;
        input!.value = __typedArg0;
        input!.dispatchEvent(new Event("input", { bubbles: true }));
        return String(true);
      },
      { __typedArg0: "" },
    );

    // "Add view" adds a view, shows it, and opens Configure view on its
    // name as a page of the menu; the name typed there renames it.
    await obRun(
      run.vaultId,
      async ({ app, page: pageHelpers }) => {
        const { press } = pageHelpers;
        press(
          (
            app.workspace.getMostRecentLeaf()!
              .view as import("obsidian").ItemView
          ).contentEl.querySelector<HTMLElement>(
            '[data-query-view-action="add"]',
          )!,
          "Add view",
        );
        return String(true);
      },
      undefined,
    );
    await obRunUntil(
      run.vaultId,
      async (_context) => {
        return !!activeDocument.querySelector<HTMLInputElement>(
          "[data-query-view-list]:popover-open [data-chooser-page] [data-query-view-name]",
        )!;
      },
      undefined,
      { what: "query-view.e2e.ts:1279" },
    );
    // Configure view offers only the layouts built for the view's dataset.
    expect(
      await obRun(
        run.vaultId,
        async (_context) => {
          return String(
            JSON.stringify(
              [
                ...activeDocument.querySelectorAll<HTMLOptionElement>(
                  "[data-query-view-list]:popover-open [data-chooser-page] [data-query-view-layout] option",
                ),
              ].map((n) => n.textContent),
            ),
          );
        },
        undefined,
      ),
    ).toBe(
      JSON.stringify([
        run.m.query_view_layout_annotations(),
        run.m.query_view_layout_list(),
        run.m.query_view_layout_cards(),
      ]),
    );
    await obRun(
      run.vaultId,
      async (_context) => {
        const input = activeDocument.querySelector<HTMLInputElement>(
          "[data-query-view-list]:popover-open [data-chooser-page] [data-query-view-name]",
        )!;
        input!.value = "Methods";
        input!.dispatchEvent(new Event("input", { bubbles: true }));
        input!.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
        );
        return String(true);
      },
      undefined,
    );
    expect(await shown("Methods")).toBe(true);

    // "Show page" off takes the page labels off the cards at once.
    expect(
      JSON.parse(
        await obRun(
          run.vaultId,
          async ({ app }) => {
            return String(
              JSON.stringify(
                [
                  ...(
                    app.workspace.getMostRecentLeaf()!
                      .view as import("obsidian").ItemView
                  ).contentEl.querySelectorAll<HTMLElement>(
                    ".zt-annot-page-chip",
                  ),
                ]
                  .map((n) => n.textContent)
                  .filter(Boolean),
              ),
            );
          },
          undefined,
        ),
      ),
    ).not.toEqual([]);
    await obRun(
      run.vaultId,
      async ({ page: pageHelpers }) => {
        const { press } = pageHelpers;
        const page = activeDocument.querySelector<HTMLElement>(
          "[data-query-view-list]:popover-open [data-chooser-page]",
        )!;
        press(
          page!.querySelector<HTMLElement>(
            '[data-query-view-option="showPage"] [role="switch"]',
          )!,
          "Show page",
        );
        press(
          page!.querySelector<HTMLElement>("[data-chooser-page-close]")!,
          "Close",
        );
        return String(true);
      },
      undefined,
    );
    await obRunUntil(
      run.vaultId,
      async ({ app }) => {
        return [
          ...(
            app.workspace.getMostRecentLeaf()!
              .view as import("obsidian").ItemView
          ).contentEl.querySelectorAll<HTMLElement>(".zt-annot-page-chip"),
        ]
          .map((n) => n.textContent)
          .filter(Boolean);
      },
      undefined,
      {
        ready: (value) => isDeepStrictEqual(value, []),
        what: "query-view.e2e.ts:1310",
      },
    );

    // A right-click on the view's row opens its Configure view, whose
    // "Default view" moves it to the top of the list.
    await obRun(
      run.vaultId,
      async ({ app, page: pageHelpers }) => {
        const { press } = pageHelpers;
        press(
          (
            app.workspace.getMostRecentLeaf()!
              .view as import("obsidian").ItemView
          ).contentEl.querySelector<HTMLElement>("[data-query-view-menu]")!,
          "View menu",
        );
        return String(true);
      },
      undefined,
    );
    await obRunUntil(
      run.vaultId,
      async ({ app }) => {
        return [
          ...(
            app.workspace.getMostRecentLeaf()!
              .view as import("obsidian").ItemView
          ).contentEl.querySelectorAll<HTMLElement>(
            "[data-query-view-list]:popover-open [data-query-view-row]",
          ),
        ].map((n) => n.getAttribute("data-query-view-row"));
      },
      undefined,
      {
        ready: (value) =>
          isDeepStrictEqual(value, ["All annotations", "Figures", "Methods"]),
        what: "query-view.e2e.ts:1321",
      },
    );
    await obRun(
      run.vaultId,
      async ({ app, page: pageHelpers }) => {
        const { press, until } = pageHelpers;
        const row = (
          app.workspace.getMostRecentLeaf()!.view as import("obsidian").ItemView
        ).contentEl.querySelector<HTMLElement>(
          '[data-query-view-row="Methods"]',
        )!;
        row!.dispatchEvent(
          new MouseEvent("contextmenu", {
            bubbles: true,
            cancelable: true,
            clientX: 200,
            clientY: 200,
          }),
        );
        const page = await until("Configure view of Methods", () =>
          activeDocument
            .querySelector<HTMLElement>(
              '[data-query-view-list]:popover-open [data-query-configure-view="Methods"]',
            )
            ?.closest<HTMLElement>("[data-chooser-page]")!,
        );
        press(
          page.querySelector<HTMLElement>("[data-chooser-page-menu]")!,
          "More options",
        );
        const item = await until("Default view", () =>
          page.querySelector<HTMLElement>(
            '[role="menu"]:popover-open [data-chooser-page-menu-item="default"]',
          )!,
        );
        press(item, "Default view");
        press(
          page.querySelector<HTMLElement>("[data-chooser-page-close]")!,
          "Close",
        );
        return String(true);
      },
      undefined,
    );

    // Each change saved to the file.
    await obRunUntil(
      run.vaultId,
      async ({ app }, { __typedArg0 }) => {
        return await app.vault
          .read(app.vault.getFileByPath(__typedArg0)!)
          .then((t) =>
            String(
              t.indexOf("name: Methods") > -1 &&
                t.indexOf("name: Methods") <
                  t.indexOf("name: All annotations") &&
                t.includes("showPage: false"),
            ),
          );
      },
      { __typedArg0: path },
      { ready: (value) => value === "true", what: "query-view.e2e.ts:1332" },
    );

    // A plain open of the file shows the first view, as the file holds it.
    await obRun(
      run.vaultId,
      async ({ app }, { __typedArg0 }) => {
        const old = app.workspace.getLeavesOfType("zotlit-query-file");
        const leaf = app.workspace.getLeaf("tab");
        await leaf.openFile(app.vault.getFileByPath(__typedArg0)!);
        app.workspace.setActiveLeaf(leaf, { focus: true });
        for (const other of old) other.detach();
        return String(true);
      },
      { __typedArg0: path },
    );
    expect(await shown("Methods")).toBe(true);
    expect(
      await obRun(
        run.vaultId,
        async ({ app }) => {
          return String(
            JSON.stringify(
              [
                ...(
                  app.workspace.getMostRecentLeaf()!
                    .view as import("obsidian").ItemView
                ).contentEl.querySelectorAll<HTMLElement>(
                  ".zt-annot-page-chip",
                ),
              ]
                .map((n) => n.textContent)
                .filter(Boolean),
            ),
          );
        },
        undefined,
      ),
    ).toBe("[]");
    await obRun(
      run.vaultId,
      async ({ app, page: pageHelpers }) => {
        const { press } = pageHelpers;
        press(
          (
            app.workspace.getMostRecentLeaf()!
              .view as import("obsidian").ItemView
          ).contentEl.querySelector<HTMLElement>("[data-query-view-menu]")!,
          "View menu",
        );
        return String(true);
      },
      undefined,
    );
    await obRunUntil(
      run.vaultId,
      async ({ app }) => {
        return [
          ...(
            app.workspace.getMostRecentLeaf()!
              .view as import("obsidian").ItemView
          ).contentEl.querySelectorAll<HTMLElement>(
            "[data-query-view-list]:popover-open [data-query-view-row]",
          ),
        ].map((n) => n.getAttribute("data-query-view-row"));
      },
      undefined,
      {
        ready: (value) =>
          isDeepStrictEqual(value, ["Methods", "All annotations", "Figures"]),
        what: "query-view.e2e.ts:1348",
      },
    );

    // The chevron on a view's row opens Configure view on that view and
    // leaves the view on screen as it is.
    await obRun(
      run.vaultId,
      async ({ app, page: pageHelpers }) => {
        const { press } = pageHelpers;
        press(
          (
            app.workspace.getMostRecentLeaf()!
              .view as import("obsidian").ItemView
          ).contentEl.querySelector<HTMLElement>(
            '[data-query-view-list]:popover-open [data-query-view-configure="Figures"]',
          )!,
          "Configure Figures",
        );
        return String(true);
      },
      undefined,
    );
    await obRunUntil(
      run.vaultId,
      async (_context) => {
        return activeDocument.querySelector<HTMLInputElement>(
          "[data-query-view-list]:popover-open [data-chooser-page] [data-query-view-name]",
        )?.value;
      },
      undefined,
      { ready: (value) => value === "Figures", what: "query-view.e2e.ts:1360" },
    );
    expect(await shown("Methods")).toBe(true);
    await obRun(
      run.vaultId,
      async ({ page: pageHelpers }) => {
        const { press } = pageHelpers;
        press(
          activeDocument.querySelector<HTMLElement>(
            "[data-query-view-list]:popover-open [data-chooser-page] [data-chooser-page-close]",
          )!,
          "Close",
        );
        return String(true);
      },
      undefined,
    );
  }, 180000);

  it("switches a Query File view to List and to Cards, and shows the same rows under the same groups", async () => {
    const path = "query-files/Reading annotations.zotquery";
    const layout = await obRun(
      run.vaultId,
      async ({ app }) => {
        return String(JSON.stringify(app.workspace.getLayout()));
      },
      undefined,
    );
    const original = await obRun(
      run.vaultId,
      async ({ app }, { __typedArg0 }) => {
        return String(
          await app.vault.read(app.vault.getFileByPath(__typedArg0)!),
        );
      },
      { __typedArg0: path },
    );
    await using cleanup = new AsyncDisposableStack();
    // The tab closes before the text goes back, so no pending save of the
    // tab writes over it.
    cleanup.defer(async () => {
      // Teardown closes a popover a failed step left open; not a reader's press.
      await obRun(
        run.vaultId,
        async ({ app }, { __typedArg0, __typedArg1, __typedArg2 }) => {
          for (const popup of activeDocument.querySelectorAll<HTMLElement>(
            "[popover]:popover-open",
          ))
            popup.hidePopover();
          for (const leaf of app.workspace.getLeavesOfType("zotlit-query-file"))
            leaf.detach();
          await app.vault.modify(
            app.vault.getFileByPath(__typedArg0)!,
            __typedArg1,
          );
          await app.workspace.changeLayout(JSON.parse(__typedArg2));
          return String(true);
        },
        { __typedArg0: path, __typedArg1: original, __typedArg2: layout },
      );
    });
    await obRun(
      run.vaultId,
      async ({ app }, { __typedArg0 }) => {
        const leaf = app.workspace.getLeaf("tab");
        await leaf.openFile(app.vault.getFileByPath(__typedArg0)!);
        app.workspace.setActiveLeaf(leaf, { focus: true });
        return String(true);
      },
      { __typedArg0: path },
    );
    /** The rows the tab shows, by the Layout that draws them. */

    interface Tab {
      layout: string;
      cards: string[];
      rows: string[];
      headings: string[];
      markers: string | null;
      text: string;
    }
    const tabWhen = async (ready: (tab: Tab) => boolean): Promise<Tab> => {
      let tab: Tab | null = null;
      const settled = await waitFor(async () => {
        tab = JSON.parse(
          await obRun(
            run.vaultId,
            async ({ app }) => {
              const view = app.workspace.getMostRecentLeaf()!.view;
              if (view.getViewType() !== "zotlit-query-file")
                return String("null");
              await (
                view as import("@/views/query-view/file-view").QueryFileView
              ).query.settled;
              const el = (view as import("obsidian").ItemView).contentEl;
              return String(
                JSON.stringify({
                  layout:
                    el
                      .querySelector<HTMLElement>("[data-query-layout]")
                      ?.getAttribute("data-query-layout") ?? "annotations",
                  cards: [
                    ...el.querySelectorAll<HTMLElement>(".zt-annot-card"),
                  ].map((n) => n.getAttribute("data-zotero-annotation-key")!),
                  rows: [
                    ...el.querySelectorAll<HTMLElement>("[data-query-row]"),
                  ].map((n) => n.getAttribute("data-query-row")),
                  headings: [
                    ...el.querySelectorAll<HTMLElement>("[data-query-group]"),
                  ].map((n) => n.textContent),
                  markers:
                    el
                      .querySelector<HTMLElement>("[data-query-markers]")
                      ?.getAttribute("data-query-markers") ?? null,
                  text: await app.vault.read(
                    (view as import("obsidian").FileView).file!,
                  ),
                }),
              );
            },
            undefined,
          ),
        ) as Tab | null;
        return tab !== null && ready(tab);
      }, 120);
      if (!settled) throw new Error(`Query File tab: ${JSON.stringify(tab)}`);
      return tab!;
    };
    /** Open Configure view on the view on screen, and pick a Layout there. */
    const pickLayout = (type: string) =>
      obRun(
        run.vaultId,
        async ({ app, page: pageHelpers }, { __typedArg0 }) => {
          const { until } = pageHelpers;
          const el = (
            app.workspace.getMostRecentLeaf()!
              .view as import("obsidian").ItemView
          ).contentEl;
          if (
            !activeDocument.querySelector<HTMLElement>(
              "[data-query-view-list]:popover-open [data-chooser-page]",
            )!
          )
            el.querySelector<HTMLElement>(
              "[data-query-view-menu]",
            )!.dispatchEvent(
              new MouseEvent("contextmenu", {
                bubbles: true,
                cancelable: true,
                clientX: 200,
                clientY: 200,
              }),
            );
          const select = await until("Configure view opens", () =>
            activeDocument.querySelector<HTMLSelectElement>(
              "[data-query-view-list]:popover-open [data-chooser-page] [data-query-view-layout]",
            )!,
          );
          select.value = __typedArg0;
          select.dispatchEvent(new Event("change", { bubbles: true }));
          return String(true);
        },
        { __typedArg0: type },
      );

    const annotations = await tabWhen((tab) => tab.cards.length > 0);
    expect(annotations.layout).toBe("annotations");
    expect(annotations.headings.length).toBeGreaterThan(1);

    // List: the same rows in the same order, under the same Item headings.
    await pickLayout("list");
    const list = await tabWhen((tab) => tab.layout === "list");
    expect(list).toMatchObject({
      cards: [],
      rows: annotations.cards,
      headings: annotations.headings,
      markers: "bullet",
    });

    // A List option in Configure view draws at once and saves to the file.
    await obRun(
      run.vaultId,
      async (_context) => {
        const select = activeDocument.querySelector<HTMLSelectElement>(
          '[data-query-view-list]:popover-open [data-chooser-page] [data-query-view-option="markers"]',
        )!;
        select!.value = "number";
        select!.dispatchEvent(new Event("change", { bubbles: true }));
        return String(true);
      },
      undefined,
    );
    const numbered = await tabWhen(
      (tab) => tab.markers === "number" && tab.text.includes("markers: number"),
    );
    expect(numbered.rows).toEqual(annotations.cards);

    // Cards: the same rows again; the switch keeps the grouping and the
    // limit of the view, and changes only its Layout.
    await pickLayout("cards");
    const cards = await tabWhen(
      (tab) => tab.layout === "cards" && tab.text.includes("type: cards"),
    );
    expect(cards).toMatchObject({
      cards: [],
      rows: annotations.cards,
      headings: annotations.headings,
    });
    expect(cards.text).toContain(
      "groupBy:\n      property: item.indexedKey\n      direction: ASC\n",
    );
    expect(cards.text).toContain("limit: 100\n");
  }, 180000);

  it("finds the same Items in the Table, List and Cards from one search, and Cards name and show properties as the Table does", async () => {
    const path = "query-files/Items in three layouts.zotquery";
    const layout = await obRun(
      run.vaultId,
      async ({ app }) => {
        return String(JSON.stringify(app.workspace.getLayout()));
      },
      undefined,
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      // Teardown closes a popover a failed step left open; not a reader's press.
      await obRun(
        run.vaultId,
        async ({ app }, { __typedArg0, __typedArg1 }) => {
          for (const popup of activeDocument.querySelectorAll<HTMLElement>(
            "[popover]:popover-open",
          ))
            popup.hidePopover();
          for (const leaf of app.workspace.getLeavesOfType("zotlit-query-file"))
            leaf.detach();
          const file = app.vault.getFileByPath(__typedArg0)!;
          if (file) await app.vault.delete(file);
          await app.workspace.changeLayout(JSON.parse(__typedArg1));
          return String(true);
        },
        { __typedArg0: path, __typedArg1: layout },
      );
    });
    await obRun(
      run.vaultId,
      async ({ app }, { __typedArg0, __typedArg1 }) => {
        const file = await app.vault.create(__typedArg0, __typedArg1);
        const leaf = app.workspace.getLeaf("tab");
        await leaf.openFile(file);
        app.workspace.setActiveLeaf(leaf, { focus: true });
        return String(true);
      },
      {
        __typedArg0: path,
        __typedArg1:
          "views:\n  - type: table\n    name: Items\n    from: items\n    order:\n      - title\n      - itemType\n      - date\n      - publicationTitle\n    limit: 100\n",
      },
    );
    /**
     * The Items the tab shows, each with the text of its cells, and the
     * names of the properties: the Table's column headers, or the labels of
     * the first card.
     */

    interface Tab {
      layout: string;
      rows: { key: string; cells: string[] }[];
      labels: string[];
    }
    const tabWhen = async (ready: (tab: Tab) => boolean): Promise<Tab> => {
      let tab: Tab | null = null;
      const settled = await waitFor(async () => {
        tab = JSON.parse(
          await obRun(
            run.vaultId,
            async ({ app }) => {
              const view = app.workspace.getMostRecentLeaf()!.view;
              if (view.getViewType() !== "zotlit-query-file")
                return String("null");
              await (
                view as import("@/views/query-view/file-view").QueryFileView
              ).query.settled;
              const el = (view as import("obsidian").ItemView).contentEl;
              const layout =
                el
                  .querySelector<HTMLElement>("[data-query-layout]")
                  ?.getAttribute("data-query-layout") ??
                (el.querySelector<HTMLElement>("[data-query-table]")!
                  ? "table"
                  : "annotations");
              const rows =
                layout === "table"
                  ? [
                      ...el.querySelectorAll<HTMLTableRowElement>(
                        'tr[data-query-table-row="item"]',
                      ),
                    ].map((n) => ({
                      key: n.getAttribute("data-query-key"),
                      cells: [...n.querySelectorAll<HTMLElement>("td")]
                        .slice(1)
                        .map((c) => c.textContent),
                    }))
                  : [
                      ...el.querySelectorAll<HTMLElement>("[data-query-row]"),
                    ].map((n) => ({
                      key: n.getAttribute("data-query-row"),
                      cells:
                        layout === "cards"
                          ? [...n.children].map((part, at) =>
                              at === 0
                                ? part.textContent
                                : part.children[1]?.textContent,
                            )
                          : [n.textContent],
                    }));
              const labels =
                layout === "table"
                  ? [
                      ...el.querySelectorAll<HTMLTableCellElement>(
                        "th[data-query-column]",
                      ),
                    ].map((n) => n.textContent)
                  : [
                      ...(el.querySelector<HTMLElement>("[data-query-row]")
                        ?.children ?? []),
                    ]
                      .slice(1)
                      .map((part) => part.children[0]?.textContent);
              return String(JSON.stringify({ layout, rows, labels }));
            },
            undefined,
          ),
        ) as Tab | null;
        return tab !== null && ready(tab);
      }, 120);
      if (!settled) throw new Error(`Query File tab: ${JSON.stringify(tab)}`);
      return tab!;
    };
    /** Pick a Layout in Configure view, then close it. */
    const pickLayout = (type: string) =>
      obRun(
        run.vaultId,
        async ({ app, page: pageHelpers }, { __typedArg0 }) => {
          const { press, until } = pageHelpers;
          const el = (
            app.workspace.getMostRecentLeaf()!
              .view as import("obsidian").ItemView
          ).contentEl;
          el.querySelector<HTMLElement>(
            "[data-query-view-menu]",
          )!.dispatchEvent(
            new MouseEvent("contextmenu", {
              bubbles: true,
              cancelable: true,
              clientX: 200,
              clientY: 200,
            }),
          );
          await until("Configure view opens", () =>
            activeDocument.querySelector<HTMLSelectElement>(
              "[data-query-view-list]:popover-open [data-chooser-page] [data-query-view-layout]",
            )!,
          );
          const page = activeDocument.querySelector<HTMLElement>(
            "[data-query-view-list]:popover-open [data-chooser-page]",
          )!;
          const select = page!.querySelector<HTMLSelectElement>(
            "[data-query-view-layout]",
          )!;
          select!.value = __typedArg0;
          select!.dispatchEvent(new Event("change", { bubbles: true }));
          press(
            page!.querySelector<HTMLElement>("[data-chooser-page-close]")!,
            "Close",
          );
          return String(true);
        },
        { __typedArg0: type },
      );
    /** Type into the toolbar search, which opens on its first use. */
    const search = (text: string) =>
      obRun(
        run.vaultId,
        async ({ app, page: pageHelpers }, { __typedArg0 }) => {
          const { press, until } = pageHelpers;
          const el = (
            app.workspace.getMostRecentLeaf()!
              .view as import("obsidian").ItemView
          ).contentEl;
          if (!el.querySelector<HTMLInputElement>("[data-query-search]")!) {
            press(
              el.querySelector<HTMLElement>('[data-query-toolbar="search"]')!,
              "Search",
            );
            await until("search field", () =>
              el.querySelector<HTMLInputElement>("[data-query-search]")!,
            );
          }
          const input = el.querySelector<HTMLInputElement>(
            "[data-query-search]",
          )!;
          Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            "value",
          )!.set!.call(input, __typedArg0);
          input!.dispatchEvent(new Event("input", { bubbles: true }));
          return String(true);
        },
        { __typedArg0: text },
      );

    const table = await tabWhen(
      (tab) => tab.layout === "table" && tab.rows.length > 0,
    );
    const total = table.rows.length;
    // Each layout finds the Items by the Item Type the Table shows, not by
    // the name Zotero stores.
    const found: Record<string, string[]> = {};
    for (const type of ["table", "list", "cards"]) {
      if (type !== "table") {
        await search("");
        await pickLayout(type);
        await tabWhen(
          (tab) => tab.layout === type && tab.rows.length === total,
        );
      }
      await search("journal article");
      const hits = await tabWhen(
        (tab) =>
          tab.layout === type && tab.rows.length > 0 && tab.rows.length < total,
      );
      found[type] = hits.rows.map((row) => row.key).toSorted();
      await search("journalarticle");
      await tabWhen((tab) => tab.layout === type && tab.rows.length === 0);
    }
    expect(found.list).toEqual(found.table);
    expect(found.cards).toEqual(found.table);

    // A card names each property under the title by the Table's column
    // header, and shows each value as the Table's cell does.
    await search("");
    const cards = await tabWhen(
      (tab) => tab.layout === "cards" && tab.rows.length === total,
    );
    expect(table.labels.slice(0, 2)).toEqual(["Title", "Item Type"]);
    expect(cards.labels).toEqual(table.labels.slice(1));
    const cells = new Map(table.rows.map((row) => [row.key, row.cells]));
    for (const card of cards.rows)
      expect(card.cells).toEqual(cells.get(card.key)!.slice(0, 4));

    // "Hide all" leaves no property ticked and none shown, as in Bases, the
    // Literature Note Property with them: the Table keeps a row for each Item,
    // and a card stays for each Item with nothing in it.
    await pickLayout("table");
    await tabWhen((tab) => tab.layout === "table" && tab.rows.length === total);
    const hidden = JSON.parse(
      await obRun(
        run.vaultId,
        async ({ app, page: pageHelpers }) => {
          const { press, until } = pageHelpers;
          const view = app.workspace.getMostRecentLeaf()!.view;
          const el = (view as import("obsidian").ItemView).contentEl;
          press(
            el.querySelector<HTMLElement>("[data-query-properties]")!,
            "Properties",
          );
          const popup = () =>
            activeDocument.querySelector<HTMLElement>(
              "[data-query-properties-popup]",
            )!;
          const selected = () => [
            ...popup()!.querySelectorAll<HTMLElement>(
              '[data-query-property][aria-selected="true"]',
            ),
          ];
          await until(
            "Properties popover opens",
            () => popup()?.matches(":popover-open") && selected().length > 0,
          );
          press(
            popup()!.querySelector<HTMLElement>(
              '[data-query-properties-action="hide-all"]',
            )!,
            "Hide all",
          );
          await until(
            "Hide all clears the ticks",
            () => selected().length === 0,
          );
          const ticks = selected().length;
          popup()!.hidePopover();
          await until(
            "Table drops the columns",
            () =>
              !el.querySelector<HTMLTableCellElement>("th[data-query-column]")!,
          );
          await (view as import("@/views/query-view/file-view").QueryFileView)
            .query.settled;
          return String(
            JSON.stringify({
              header: [
                ...el.querySelectorAll<HTMLTableCellElement>(
                  "[data-query-table] thead th",
                ),
              ].map((n) => n.textContent.trim()),
              rows: el.querySelectorAll<HTMLTableRowElement>(
                'tr[data-query-table-row="item"]',
              ).length,
              ticks,
            }),
          );
        },
        undefined,
      ),
    ) as { header: string[]; rows: number; ticks: number };
    expect(hidden).toEqual({
      header: [""],
      rows: total,
      ticks: 0,
    });
    await pickLayout("cards");
    const empty = await tabWhen(
      (tab) => tab.layout === "cards" && tab.rows.length === total,
    );
    expect(empty.labels).toEqual([]);
    expect(empty.rows.every((row) => row.cells.length === 0)).toBe(true);
  }, 180000);

  it("groups a Query File by colour in a Manual order, hides a colour, and keeps it on reopen", async () => {
    const layout = await obRun(
      run.vaultId,
      async ({ app }) => {
        return String(JSON.stringify(app.workspace.getLayout()));
      },
      undefined,
    );
    const path = "query-files/By colour.zotquery";
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obRun(
        run.vaultId,
        async ({ app }, { __typedArg0, __typedArg1 }) => {
          await app.workspace.changeLayout(JSON.parse(__typedArg0));
          const file = app.vault.getFileByPath(__typedArg1)!;
          if (file) await app.vault.delete(file);
          return String(true);
        },
        { __typedArg0: layout, __typedArg1: path },
      );
    });

    await obRun(
      run.vaultId,
      async ({ app }, { __typedArg0, __typedArg1 }) => {
        await app.vault.create(__typedArg0, __typedArg1);
        return String(true);
      },
      {
        __typedArg0: path,
        __typedArg1:
          "views:\n  - type: annotations\n    name: Colours\n    from: annotations\n    limit: 100\n",
      },
    );
    await obRun(
      run.vaultId,
      async ({ app }, { __typedArg0 }) => {
        const file = app.vault.getFileByPath(__typedArg0)!;
        const leaf = app.workspace.getLeaf("tab");
        await leaf.openFile(file!);
        app.workspace.setActiveLeaf(leaf, { focus: true });
        return String(true);
      },
      { __typedArg0: path },
    );

    /** The group headings and the Manual order rows of the active tab, once settled. */

    interface Tab {
      count: string | null;
      headings: string[];
      order: [string, boolean][];
    }
    const tabWhen = async (ready: (tab: Tab) => boolean): Promise<Tab> => {
      let tab: Tab | null = null;
      const settled = await waitFor(async () => {
        tab = JSON.parse(
          await obRun(
            run.vaultId,
            async ({ app }, { __typedArg0 }) => {
              const view = app.workspace.getMostRecentLeaf()!.view;
              if (
                view.getViewType() !== "zotlit-query-file" ||
                (view as import("obsidian").FileView).file?.path !== __typedArg0
              )
                return String("null");
              await (
                view as import("@/views/query-view/file-view").QueryFileView
              ).query.settled;
              const el = (view as import("obsidian").ItemView).contentEl;
              return String(
                JSON.stringify({
                  count:
                    el
                      .querySelector<HTMLElement>("[data-query-count]")
                      ?.getAttribute("data-query-count") ?? null,
                  headings: [
                    ...el.querySelectorAll<HTMLElement>("[data-query-group]"),
                  ].map((n) => n.textContent),
                  order: [
                    ...el.querySelectorAll<HTMLElement>("[data-group-row]"),
                  ].map((n) => [
                    n.getAttribute("data-group-row"),
                    n.querySelector<HTMLInputElement>("input")!.checked,
                  ]),
                }),
              );
            },
            { __typedArg0: path },
          ),
        ) as Tab | null;
        return tab !== null && ready(tab);
      }, 120);
      if (!settled) throw new Error(`Query File tab: ${JSON.stringify(tab)}`);
      return tab!;
    };
    /** Choose an option of a select in the Group popover, opening it first. */
    const choose = (selector: string, value: string) =>
      obRun(
        run.vaultId,
        async (
          { app, page: pageHelpers },
          { __typedArg0, __typedArg1, __typedArg2 },
        ) => {
          const { press, pick } = pageHelpers;
          const el = (
            app.workspace.getMostRecentLeaf()!
              .view as import("obsidian").ItemView
          ).contentEl;
          const popover = el.querySelector<HTMLElement>(
            '[data-query-popover="group"]',
          )!;
          if (!popover!.matches(":popover-open"))
            press(
              el.querySelector<HTMLElement>('[data-query-toolbar="group"]')!,
              "Group",
            );
          await pick(
            popover!.querySelector<HTMLButtonElement | HTMLSelectElement>(
              `${__typedArg0}`,
            )!,
            __typedArg1,
            __typedArg2,
          );
          return String(true);
        },
        { __typedArg0: selector, __typedArg1: value, __typedArg2: selector },
      );

    await tabWhen((tab) => tab.count !== null);
    // The colours of the rows.
    const report = JSON.parse(
      await cliCommand(run.vaultId, "zotlit:query", {
        args: { from: "annotations", fields: "colorName", limit: "100" },
      }),
    ) as ItemQueryReport;
    expect(report.ok).toBe(true);
    const colours = [
      ...new Set(report.rows!.map((row) => String(row.values.colorName))),
    ];
    expect(colours.length).toBeGreaterThan(1);

    await choose("[data-group-property]", "colorName");
    const grouped = await tabWhen(
      (tab) => tab.headings.length === colours.length,
    );
    // Ascending groups go from A to Z by the colour's name, as in Bases.
    expect(grouped.headings).toEqual(
      grouped.headings.toSorted((a, b) => a.localeCompare(b, "en")),
    );
    await choose("[data-group-direction]", "MANUAL");
    const manual = await tabWhen((tab) => tab.order.length > 0);
    expect(manual.order.map(([colour]) => colour).toSorted()).toEqual(
      colours.toSorted(),
    );
    expect(manual.order.every(([, ticked]) => ticked)).toBe(true);

    // A tick hides the first colour.
    const [hidden, ...shown] = manual.order.map(([colour]) => colour);
    await obRun(
      run.vaultId,
      async ({ app, page: pageHelpers }, { __typedArg0, __typedArg1 }) => {
        const { press } = pageHelpers;
        const el = (
          app.workspace.getMostRecentLeaf()!.view as import("obsidian").ItemView
        ).contentEl;
        const popover = el.querySelector<HTMLElement>(
          '[data-query-popover="group"]',
        )!;
        if (!popover!.matches(":popover-open"))
          press(
            el.querySelector<HTMLElement>('[data-query-toolbar="group"]')!,
            "Group",
          );
        press(
          popover!.querySelector<HTMLInputElement>(
            `[data-group-row=${__typedArg0}] input`,
          )!,
          `group row ${__typedArg1}`,
        );
        popover!.hidePopover();
        return String(true);
      },
      { __typedArg0: hidden, __typedArg1: hidden },
    );
    const after = await tabWhen((tab) => tab.headings.length === shown.length);
    const expectedCount = report.rows!.filter(
      (row) => row.values.colorName !== hidden,
    ).length;
    expect(after.count).toBe(String(expectedCount));

    // The file holds the grouping; a reopened tab shows the same groups.
    await obRun(
      run.vaultId,
      async ({ app }) => {
        app.workspace.getMostRecentLeaf()!.detach();
        return String(true);
      },
      undefined,
    );
    let text = "";
    await waitFor(async () => {
      text = await obRun(
        run.vaultId,
        async ({ app }, { __typedArg0 }) => {
          return String(
            await app.vault.read(app.vault.getFileByPath(__typedArg0)!),
          );
        },
        { __typedArg0: path },
      );
      return text.includes("groupOrder");
    }, 30);
    expect(text).toContain(
      "    groupBy:\n      property: colorName\n      direction: ASC\n",
    );
    expect(text).toContain(
      `    groupOrder:\n${shown.map((colour) => `      - ${colour}`).join("\n")}`,
    );
    await obRun(
      run.vaultId,
      async ({ app }, { __typedArg0 }) => {
        const file = app.vault.getFileByPath(__typedArg0)!;
        const leaf = app.workspace.getLeaf("tab");
        await leaf.openFile(file!);
        app.workspace.setActiveLeaf(leaf, { focus: true });
        return String(true);
      },
      { __typedArg0: path },
    );
    const reopened = await tabWhen((tab) => tab.count !== null);
    expect(reopened.headings).toEqual(after.headings);
    expect(reopened.count).toBe(after.count);
  }, 180000);

  it("steps the Card Selection through the cards a grouped Query File draws: past a collapsed group, and to each place of a card under two tags", async () => {
    const layout = await obRun(
      run.vaultId,
      async ({ app }) => {
        return String(JSON.stringify(app.workspace.getLayout()));
      },
      undefined,
    );
    const colourPath = "query-files/Step by colour.zotquery";
    const tagPath = "query-files/Step by tag.zotquery";
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obRun(
        run.vaultId,
        async ({ app }, { __typedArg0, __typedArg1 }) => {
          await app.workspace.changeLayout(JSON.parse(__typedArg0));
          for (const path of __typedArg1) {
            const file = app.vault.getFileByPath(path)!;
            if (file) await app.vault.delete(file);
          }
          return String(true);
        },
        { __typedArg0: layout, __typedArg1: [colourPath, tagPath] },
      );
    });

    /** The cards on screen in DOM order, each at its place, and the headings. */

    interface Shown {
      cards: { key: string; place: string }[];
      headings: { key: string; collapsed: boolean }[];
    }
    const open = async (
      path: string,
      text: string,
      ready: (shown: Shown) => boolean,
    ): Promise<Shown> => {
      await obRun(
        run.vaultId,
        async ({ app }, { __typedArg0, __typedArg1 }) => {
          const file = await app.vault.create(__typedArg0, __typedArg1);
          const leaf = app.workspace.getLeaf("tab");
          await leaf.openFile(file);
          app.workspace.setActiveLeaf(leaf, { focus: true });
          return String(true);
        },
        { __typedArg0: path, __typedArg1: text },
      );
      return shownWhen(path, ready);
    };
    const shownWhen = async (
      path: string,
      ready: (shown: Shown) => boolean,
    ): Promise<Shown> => {
      let shown: Shown | null = null;
      const settled = await waitFor(async () => {
        shown = JSON.parse(
          await obRun(
            run.vaultId,
            async ({ app }, { __typedArg0 }) => {
              const view = app.workspace.getMostRecentLeaf()!.view;
              if (
                view.getViewType() !== "zotlit-query-file" ||
                (view as import("obsidian").FileView).file?.path !== __typedArg0
              )
                return String("null");
              await (
                view as import("@/views/query-view/file-view").QueryFileView
              ).query.settled;
              const grid = (
                view as import("obsidian").ItemView
              ).contentEl.querySelector<HTMLElement>('[role="grid"]')!;
              return String(
                JSON.stringify({
                  cards: [
                    ...(grid?.querySelectorAll<HTMLElement>(".zt-annot-card") ??
                      []),
                  ].map((n) => ({
                    key: n.getAttribute("data-zotero-annotation-key"),
                    place: n.getAttribute("data-card-place"),
                  })),
                  headings: [
                    ...(grid?.querySelectorAll<HTMLElement>(
                      "[data-query-group]",
                    ) ?? []),
                  ].map((n) => ({
                    key: n.getAttribute("data-query-group"),
                    collapsed: n.hasAttribute("data-collapsed"),
                  })),
                }),
              );
            },
            { __typedArg0: path },
          ),
        ) as Shown;
        return shown !== null && ready(shown);
      }, 120);
      if (!settled) throw new Error(`Query File tab: ${JSON.stringify(shown)}`);
      return shown!;
    };
    /**
     * The Card Selection, the place its focus holds, and what the screen
     * shows of it: the card at that place, and the card that has the focus.
     */

    interface Selection {
      focus: string | null;
      selected: string[];
      drawn: boolean;
      active: string | null;
    }
    const selection = async () =>
      JSON.parse(
        await obRun(
          run.vaultId,
          async ({ app }) => {
            const view = app.workspace.getMostRecentLeaf()!.view;
            const sel = (
              view as import("@/views/query-view/file-view").QueryFileView
            ).query.layout.store.getState().cardSelection;
            const el = (view as import("obsidian").ItemView).contentEl;
            const at = [
              ...el.querySelectorAll<HTMLElement>(".zt-annot-card"),
            ].find((n) => n.getAttribute("data-card-place") === sel.focus);
            return String(
              JSON.stringify({
                focus: sel.focus,
                selected: sel.selected,
                drawn:
                  !!at &&
                  at.getClientRects().length > 0 &&
                  at.hasAttribute("data-selected"),
                active:
                  el.ownerDocument.activeElement
                    ?.closest?.(".zt-annot-card")
                    ?.getAttribute("data-card-place") ?? null,
              }),
            );
          },
          undefined,
        ),
      ) as Selection;
    /** Click the card at one place, as a pointer does. */
    const clickAt = (place: string) =>
      obRun(
        run.vaultId,
        async ({ app, page: pageHelpers }, { __typedArg0, __typedArg1 }) => {
          const { press } = pageHelpers;
          const card = [
            ...(
              app.workspace.getMostRecentLeaf()!
                .view as import("obsidian").ItemView
            ).contentEl.querySelectorAll<HTMLElement>(".zt-annot-card"),
          ].find((n) => n.getAttribute("data-card-place") === __typedArg0);
          press(card, `card ${__typedArg1}`);
          card!.focus();
          return String(true);
        },
        { __typedArg0: place, __typedArg1: place },
      );
    /**
     * One key as Obsidian delivers it: through the view's own Scope, with the
     * focused card as the event's target.
     * @returns whether the view handled it.
     */
    const press = async (key: "ArrowDown" | "ArrowUp" | "Delete") =>
      (await obRun(
        run.vaultId,
        async (
          { app },
          { __typedArg0, __typedArg1, __typedArg2, __typedArg3 },
        ) => {
          const view = app.workspace.getMostRecentLeaf()!.view;
          const el = (view as import("obsidian").ItemView).contentEl;
          const active = el.ownerDocument.activeElement;
          const target =
            active && el.contains(active)
              ? active
              : el.querySelector<HTMLElement>('[role="grid"]')!;
          const event = new KeyboardEvent("keydown", {
            key: __typedArg0,
            code: __typedArg1,
            bubbles: true,
            cancelable: true,
          });
          Object.defineProperty(event, "target", { value: target });
          return String(
            String(
              (
                view.scope as import("obsidian").Scope & {
                  handleKey(
                    event: KeyboardEvent,
                    key: { modifiers: string; key: string; vkey: string },
                  ): boolean;
                }
              ).handleKey(event, {
                modifiers: "",
                key: __typedArg2,
                vkey: __typedArg3,
              }) === false,
            ),
          );
        },
        {
          __typedArg0: key,
          __typedArg1: key,
          __typedArg2: key,
          __typedArg3: key,
        },
      )) === "true";
    /** The card at a place, selected alone, drawn, and holding the focus. */
    const on = (place: string, key: string): Selection => ({
      focus: place,
      selected: [key],
      drawn: true,
      active: place,
    });

    // Grouped by colour, with the second group collapsed, ↓ from the last
    // card of the first group lands on the first card of the third: the
    // cards of a collapsed group are not drawn, so the keys pass them.
    const colours = await open(
      colourPath,
      "views:\n  - type: annotations\n    name: Colours\n    from: annotations\n    limit: 100\n    groupBy:\n      property: colorName\n      direction: ASC\n",
      (shown) => shown.headings.length > 2 && shown.cards.length > 3,
    );
    const [first, second, third] = colours.headings;
    const inGroup = (shown: Shown, group: string) =>
      shown.cards.filter((card) => card.place.startsWith(`${group}\n`));
    const secondCards = inGroup(colours, second!.key);
    await obRun(
      run.vaultId,
      async ({ app, page: pageHelpers }, { __typedArg0 }) => {
        const { press } = pageHelpers;
        press(
          (
            app.workspace.getMostRecentLeaf()!
              .view as import("obsidian").ItemView
          ).contentEl.querySelector<HTMLElement>(
            `[data-query-group=${__typedArg0}] button`,
          )!,
          "group heading",
        );
        return String(true);
      },
      { __typedArg0: second!.key },
    );
    const folded = await shownWhen(
      colourPath,
      (shown) =>
        shown.headings.find((heading) => heading.key === second!.key)!
          .collapsed,
    );
    const lastOfFirst = inGroup(folded, first!.key).at(-1)!;
    const firstOfThird = inGroup(folded, third!.key)[0]!;
    await clickAt(lastOfFirst.place);
    expect(await press("ArrowDown")).toBe(true);
    expect(await selection()).toEqual(on(firstOfThird.place, firstOfThird.key));
    expect(await press("ArrowUp")).toBe(true);
    expect(await selection()).toEqual(on(lastOfFirst.place, lastOfFirst.key));

    // A collapse that folds the Selected Card away drops it, so a Delete
    // that follows acts on no hidden Annotation.

    await obRun(
      run.vaultId,
      async ({ app, page: pageHelpers }, { __typedArg0 }) => {
        const { press } = pageHelpers;
        press(
          (
            app.workspace.getMostRecentLeaf()!
              .view as import("obsidian").ItemView
          ).contentEl.querySelector<HTMLElement>(
            `[data-query-group=${__typedArg0}] button`,
          )!,
          "group heading",
        );
        return String(true);
      },
      { __typedArg0: second!.key },
    );
    await shownWhen(colourPath, (shown) =>
      shown.cards.some((card) => card.place === secondCards[0]!.place),
    );
    await clickAt(secondCards[0]!.place);
    expect((await selection()).selected).toEqual([secondCards[0]!.key]);
    await obRun(
      run.vaultId,
      async ({ app, page: pageHelpers }, { __typedArg0 }) => {
        const { press } = pageHelpers;
        press(
          (
            app.workspace.getMostRecentLeaf()!
              .view as import("obsidian").ItemView
          ).contentEl.querySelector<HTMLElement>(
            `[data-query-group=${__typedArg0}] button`,
          )!,
          "group heading",
        );
        return String(true);
      },
      { __typedArg0: second!.key },
    );
    await shownWhen(
      colourPath,
      (shown) =>
        shown.headings.find((heading) => heading.key === second!.key)!
          .collapsed,
    );
    expect((await selection()).selected).toEqual([]);
    expect(await press("Delete")).toBe(false);

    // Grouped by tag, a card with two tags shows under both headings. ↓ and
    // ↑ reach it at each place and step on from the place it holds.
    const tags = await open(
      tagPath,
      "views:\n  - type: annotations\n    name: Tags\n    from: annotations\n    limit: 100\n    groupBy:\n      property: tags[]\n      direction: ASC\n",
      (shown) =>
        shown.headings.length > 1 &&
        shown.cards.some(
          (card, index) =>
            shown.cards.findIndex((other) => other.key === card.key) < index,
        ),
    );
    const twice = tags.cards.findIndex(
      (card, index) =>
        index < tags.cards.length - 1 &&
        tags.cards.findIndex((other) => other.key === card.key) < index,
    );
    expect(twice).toBeGreaterThan(0);
    const [before, at, after] = tags.cards.slice(twice - 1, twice + 2);
    await clickAt(at!.place);
    expect(await press("ArrowDown")).toBe(true);
    expect(await selection()).toEqual(on(after!.place, after!.key));
    expect(await press("ArrowUp")).toBe(true);
    expect(await selection()).toEqual(on(at!.place, at!.key));
    expect(await press("ArrowUp")).toBe(true);
    expect(await selection()).toEqual(on(before!.place, before!.key));

    // From the first card, ↓ walks every card in the order drawn.
    await clickAt(tags.cards[0]!.place);
    const walk = [tags.cards[0]!.place];
    while (await press("ArrowDown")) walk.push((await selection()).focus!);
    expect(walk).toEqual(tags.cards.map((card) => card.place));
  }, 300000);

  it("embeds a Query File in two notes, and a change in one embed saves the file and updates the other", async () => {
    const queryPath = "query-files/Lab annotations.zotquery";
    const labNote = `literatures/${annotationItem.literatureNoteName ?? annotationItem.key}.md`;
    const overview = "query-files/Lab overview.md";
    const layout = await obRun(
      run.vaultId,
      async ({ app }) => {
        return String(JSON.stringify(app.workspace.getLayout()));
      },
      undefined,
    );
    const original = await obRun(
      run.vaultId,
      async ({ app }, { __typedArg0 }) => {
        return String(
          await app.vault.read(app.vault.getFileByPath(__typedArg0)!),
        );
      },
      { __typedArg0: queryPath },
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obRun(
        run.vaultId,
        async ({ app }, { __typedArg0, __typedArg1, __typedArg2 }) => {
          await app.workspace.changeLayout(JSON.parse(__typedArg0));
          await app.vault.modify(
            app.vault.getFileByPath(__typedArg1)!,
            __typedArg2,
          );
          return String(true);
        },
        { __typedArg0: layout, __typedArg1: queryPath, __typedArg2: original },
      );
    });

    // The Literature Note in Reading view, the overview in Live Preview, and the
    // Query File in its own tab, each in a pane of its own so all render.
    await obRun(
      run.vaultId,
      async ({ app }, { __typedArg0, __typedArg1, __typedArg2 }) => {
        const open = async (
          path: string,
          state?: { mode: string; source?: boolean },
        ) => {
          const leaf = app.workspace.getLeaf("split");
          await leaf.setViewState({
            type: state ? "markdown" : "zotlit-query-file",
            state: { file: path, ...state },
            active: true,
          });
        };
        await open(__typedArg0, { mode: "preview" });
        await open(__typedArg1, { mode: "source", source: false });
        await open(__typedArg2);
        return String(true);
      },
      { __typedArg0: labNote, __typedArg1: overview, __typedArg2: queryPath },
    );

    const labEmbed = await revealQueryView(run.vaultId, labNote, {
      embed: "Lab annotations.zotquery#This item",
    });
    const overviewEmbed = await revealQueryView(run.vaultId, overview, {
      embed: "Lab annotations.zotquery",
    });

    /** What each pane shows of the Query File, once every query settled. */

    interface Pane {
      view: string | null;
      count: string | null;
      cards: string[];
      interactive?: boolean;
    }
    type Panes = Record<string, Pane[]> & { tab?: Pane };
    const panesWhen = (ready: (panes: Panes) => boolean) =>
      readQueryViewUntil(
        run.vaultId,
        async (
          { app, page: pageHelpers },
          { __typedArg0, __typedArg1, __typedArg2, __typedArg3 },
        ) => {
          const out: Record<string, Pane[]> = {};
          let tab: Pane | undefined;
          const show = async (
            el: HTMLElement,
            query: import("@/views/query-view/view").QueryView,
          ) => {
            await query.settled;
            return {
              view:
                el.querySelector<HTMLElement>("[data-query-view-menu]")
                  ?.textContent ?? null,
              count:
                el
                  .querySelector<HTMLElement>("[data-query-count]")
                  ?.getAttribute("data-query-count") ?? null,
              cards: [
                ...el.querySelectorAll<HTMLElement>(".zt-annot-card"),
              ].map((n) => n.getAttribute("data-zotero-annotation-key")!),
            };
          };
          for (const [path, el] of [
            [__typedArg0, await pageHelpers.revealQueryView(__typedArg1)],
            [__typedArg2, await pageHelpers.revealQueryView(__typedArg3)],
          ] as const)
            out[path] = [
              {
                ...(await show(el, el.zotlitQueryView!)),
                interactive: el!.classList.contains("interactive-child"),
              },
            ];
          for (const leaf of app.workspace.getLeavesOfType("zotlit-query-file"))
            tab = await show(
              (leaf.view as import("obsidian").ItemView).contentEl,
              (
                leaf.view as import("@/views/query-view/file-view").QueryFileView
              ).query,
            );
          return Object.assign(out, { tab });
        },
        {
          __typedArg0: labNote,
          __typedArg1: labEmbed,
          __typedArg2: overview,
          __typedArg3: overviewEmbed,
        },
        {
          ready,
          what: "Query File panes",
          tries: 120,
        },
      );
    /** The Annotation rows ZotLit Query gives, through the CLI. */
    const queryRows = async (filter: string | null, thisItem?: string) => {
      const report = JSON.parse(
        await cliCommand(run.vaultId, "zotlit:query", {
          args: {
            from: "annotations",
            fields: "item.title",
            limit: "100",
            ...(filter === null ? {} : { filter }),
            ...(thisItem === undefined ? {} : { "this-item": thisItem }),
          },
        }),
      ) as ItemQueryReport;
      expect(report.ok).toBe(true);
      return report.rows!;
    };
    const queryKeys = async (filter: string | null, thisItem?: string) =>
      (await queryRows(filter, thisItem)).map((row) => row.indexedKey);

    // `![[file#View]]` shows that view, with `this.item` the note's Item;
    // `![[file]]` shows the first view, grouped by Item.
    const mine = await queryKeys("item == this.item", annotationItem.key);
    const all = byItem(await queryRows(null)).cards;
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.length).toBeLessThan(all.length);
    const before = await panesWhen(
      (panes) =>
        panes[labNote]?.[0]?.count != null &&
        panes[overview]?.[0]?.count != null &&
        panes.tab?.count != null,
    );
    expect(before[labNote]).toEqual([
      {
        view: "This item",
        count: String(mine.length),
        cards: mine,
        interactive: true,
      },
    ]);
    expect(before[overview]).toEqual([
      {
        view: "All annotations",
        count: String(all.length),
        cards: all,
        interactive: true,
      },
    ]);

    // A filter for all views, set in the Literature Note's embed, saves to the file;
    // the overview's embed and the open tab show it.
    const figure = 'tags.contains("figure")';
    await obRun(
      run.vaultId,
      async (
        { page: pageHelpers },
        { __typedArg0, __typedArg1, __typedArg2 },
      ) => {
        const { press, until, pick } = pageHelpers;
        const el = await pageHelpers.revealQueryView(__typedArg0);
        press(
          el.querySelector<HTMLElement>('[data-query-toolbar="filter"]')!,
          "Filter",
        );
        const all = () =>
          el.querySelector<HTMLElement>(
            '[data-query-popover="filter"] [data-filter-section="all"] [data-condition-row]',
          )!;
        const set = (
          control: HTMLInputElement | HTMLSelectElement,
          value: string,
        ) => {
          control.value = value;
          control.dispatchEvent(new Event("input", { bubbles: true }));
        };
        const fold = el.querySelector<HTMLDetailsElement>(
          '[data-query-popover="filter"] [data-filter-section="all"] details',
        )!;
        if (!fold!.open)
          press(
            fold!.querySelector<HTMLElement>("summary")!,
            "All views heading",
          );
        await until("placeholder row", all);
        await pick(
          all()!.querySelector<HTMLButtonElement>(
            `button[aria-label="${__typedArg1}"]`,
          )!,
          "tags",
          "Condition type",
        );
        set(
          await until("tag value field", () =>
            all()!.querySelector<HTMLInputElement>(
              `input[aria-label="${__typedArg2}"]`,
            )!,
          ),
          "figure",
        );
        el.querySelector<HTMLElement>(
          '[data-query-popover="filter"]',
        )!.hidePopover();
        return String(true);
      },
      {
        __typedArg0: labEmbed,
        __typedArg1: run.m.workbench_match_condition_kind(),
        __typedArg2: run.m.workbench_filter_value(),
      },
    );
    const figures = byItem(await queryRows(figure)).cards;
    const myFigures = await queryKeys(
      `(${figure}) && (item == this.item)`,
      annotationItem.key,
    );
    expect(figures.length).toBeLessThan(all.length);
    const after = await panesWhen(
      (panes) =>
        panes[overview]?.[0]?.count === String(figures.length) &&
        panes.tab?.count === String(figures.length) &&
        panes[labNote]?.[0]?.cards.length === myFigures.length,
    );
    expect(
      await obRun(
        run.vaultId,
        async ({ app }, { __typedArg0 }) => {
          return String(
            await app.vault.read(app.vault.getFileByPath(__typedArg0)!),
          );
        },
        { __typedArg0: queryPath },
      ),
    ).toMatch(/^filters:\n {2}and:\n {4}- tags\.contains\("figure"\)$/m);
    expect(after[overview]![0]!.cards).toEqual(figures);
    expect(after.tab!.cards).toEqual(figures);
    expect(after[labNote]![0]!.cards).toEqual(myFigures);

    // The count in each pane opens that pane's own Results menu.
    const results = JSON.parse(
      await obRun(
        run.vaultId,
        async ({ app, page: pageHelpers }, { __typedArg0, __typedArg1 }) => {
          const { press, until } = pageHelpers;
          const out = [];
          for (const view of [
            async () => await pageHelpers.revealQueryView(__typedArg0),
            async () => await pageHelpers.revealQueryView(__typedArg1),
            ...app.workspace
              .getLeavesOfType("zotlit-query-file")
              .map(
                (l) => () => (l.view as import("obsidian").ItemView).contentEl,
              ),
          ]) {
            const el = await view();
            press(
              el.querySelector<HTMLElement>("[data-query-results]")!,
              "Results",
            );
            const popup = el.querySelector<HTMLElement>(
              "[data-query-results-popup]",
            )!;
            out.push(
              await until(
                "Results opens",
                () => popup!.matches(":popover-open"),
                1000,
              ).catch(() => false),
            );
            activeDocument
              .querySelectorAll<HTMLElement>(":popover-open")
              .forEach((p) => p.hidePopover());
          }
          return String(JSON.stringify(out));
        },
        { __typedArg0: labEmbed, __typedArg1: overviewEmbed },
      ),
    ) as boolean[];
    expect(results).toEqual([true, true, true]);

    // A click in the Live Preview embed leaves the editor's selection alone.
    // The 400 ms after the click is the window an absent selection change is
    // checked over; no event marks "nothing happened".
    const selection = JSON.parse(
      await obRun(
        run.vaultId,
        async ({ app, page: pageHelpers }, { __typedArg0, __typedArg1 }) => {
          const leaf = app.workspace
            .getLeavesOfType("markdown")
            .find(
              (l) =>
                (l.view as import("obsidian").FileView).file!.path ===
                __typedArg0,
            );
          app.workspace.setActiveLeaf(leaf!, { focus: true });
          const cm = (leaf!.view as import("obsidian").MarkdownView).editor.cm;
          cm.dispatch({ selection: { anchor: 0 } });
          const target = (
            await pageHelpers.revealQueryView(__typedArg1)
          ).querySelector<HTMLElement>("[role=toolbar]")!;
          const rect = target!.getBoundingClientRect();
          const init = {
            bubbles: true,
            cancelable: true,
            clientX: rect.left + rect.width / 2,
            clientY: rect.top + rect.height / 2,
            button: 0,
            detail: 1,
          };
          target!.dispatchEvent(new MouseEvent("mousedown", init));
          target!.dispatchEvent(new MouseEvent("mouseup", init));
          target!.dispatchEvent(new MouseEvent("click", init));
          await new Promise((r) => setTimeout(r, 400));

          const { from, to } = cm.state.selection.main;
          return String(JSON.stringify({ from, to }));
        },
        { __typedArg0: overview, __typedArg1: overviewEmbed },
      ),
    ) as { from: number; to: number };
    expect(selection).toEqual({ from: 0, to: 0 });

    // A hover popover over a link to the file shows the embed's first view.
    const popover = JSON.parse(
      await obRun(
        run.vaultId,
        async (
          { app, page: pageHelpers },
          { __typedArg0, __typedArg1, __typedArg2 },
        ) => {
          const { until } = pageHelpers;
          const leaf = app.workspace
            .getLeavesOfType("markdown")
            .find(
              (l) =>
                (l.view as import("obsidian").FileView).file!.path ===
                __typedArg0,
            );
          const targetEl =
            leaf!.view.containerEl.querySelector<HTMLElement>(
              ".markdown-reading-view h1",
            )! ?? leaf!.view.containerEl;
          const rect = targetEl.getBoundingClientRect();
          app.workspace.trigger("hover-link", {
            event: new MouseEvent("mouseover", {
              clientX: rect.left + 5,
              clientY: rect.top + 5,
              ctrlKey: true,
              metaKey: true,
            }),
            source: "preview",
            hoverParent: leaf!.view,
            targetEl,
            linktext: __typedArg1,
            sourcePath: __typedArg2,
          });
          const el = await until(
            "hover popover",
            () =>
              [
                ...activeDocument.querySelectorAll<
                  import("./page-helpers.ts").QueryViewElement
                >(
                  ".hover-popover .internal-embed, .hover-popover .zt-query-view",
                ),
              ].find((el) => el.zotlitQueryView),
            10000,
          ).catch(() => null);
          if (!el) return String("null");
          await el.zotlitQueryView!.settled;
          const out = {
            view:
              el.querySelector<HTMLElement>("[data-query-view-menu]")
                ?.textContent ?? null,
            count:
              el
                .querySelector<HTMLElement>("[data-query-count]")
                ?.getAttribute("data-query-count") ?? null,
          };
          const popover = (
            leaf!.view as import("obsidian").View & {
              hoverPopover?: { hide?: () => void; unload: () => void };
            }
          ).hoverPopover;
          if (popover)
            typeof popover.hide === "function"
              ? popover.hide()
              : popover.unload();
          await until(
            "hover popover closes",
            () =>
              !leaf!.view.containerEl.doc.querySelector<HTMLElement>(
                ".hover-popover",
              )!,
            5000,
          );
          return String(JSON.stringify(out));
        },
        { __typedArg0: labNote, __typedArg1: queryPath, __typedArg2: labNote },
      ),
    ) as { view: string | null; count: string | null } | null;
    expect(popover).toEqual({
      view: "All annotations",
      count: String(figures.length),
    });

    // The link button opens the Query File at the view the embed shows.
    await obRun(
      run.vaultId,
      async ({ app, page: pageHelpers }, { __typedArg0, __typedArg1 }) => {
        const { press } = pageHelpers;
        const leaf = app.workspace
          .getLeavesOfType("markdown")
          .find(
            (l) =>
              (l.view as import("obsidian").FileView).file!.path ===
              __typedArg0,
          );
        app.workspace.setActiveLeaf(leaf!, { focus: true });
        press(
          (
            await pageHelpers.revealQueryView(__typedArg1)
          ).querySelector<HTMLElement>("[data-query-open-file]")!,
          "Open query file",
        );
        return String(true);
      },
      { __typedArg0: labNote, __typedArg1: labEmbed },
    );
    expect(
      await waitFor(async () => {
        const state = JSON.parse(
          await obRun(
            run.vaultId,
            async ({ app }) => {
              return String(
                JSON.stringify(
                  app.workspace.getMostRecentLeaf()!.getViewState(),
                ),
              );
            },
            undefined,
          ),
        ) as { type: string; state: { file?: string; view?: string } };
        return (
          state.type === "zotlit-query-file" &&
          state.state.file === queryPath &&
          state.state.view === "This item"
        );
      }, 30),
    ).toBe(true);
  }, 180000);

  // Each Query View is a Preact root of its own; the ids its labels point
  // to must still be unique in the window.
  it("focuses the limit field of the second of two embeds of one Query File when its label is selected", async () => {
    const queryPath = "query-files/Lab annotations.zotquery";
    const notePath = "query-files/Two embeds.md";
    const layout = await obRun(
      run.vaultId,
      async ({ app }) => {
        return String(JSON.stringify(app.workspace.getLayout()));
      },
      undefined,
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obRun(
        run.vaultId,
        async ({ app }, { __typedArg0, __typedArg1 }) => {
          await app.workspace.changeLayout(JSON.parse(__typedArg0));
          const file = app.vault.getFileByPath(__typedArg1)!;
          if (file) await app.vault.delete(file);
          return String(true);
        },
        { __typedArg0: layout, __typedArg1: notePath },
      );
    });

    await obRun(
      run.vaultId,
      async ({ app }, { __typedArg0, __typedArg1, __typedArg2 }) => {
        await app.vault.create(__typedArg0, __typedArg1);
        const leaf = app.workspace.getLeaf("tab");
        await leaf.setViewState({
          type: "markdown",
          state: { file: __typedArg2, mode: "preview" },
          active: true,
        });
        return String(true);
      },
      {
        __typedArg0: notePath,
        __typedArg1: `![[${queryPath}]]\n\n![[${queryPath}]]\n`,
        __typedArg2: notePath,
      },
    );
    /** The embeds of the Query File in the note, once each query settled. */
    const first = await revealQueryView(run.vaultId, notePath, {
      embed: queryPath,
    });
    const second = await revealQueryView(run.vaultId, notePath, {
      embed: queryPath,
      occurrence: 1,
    });

    await readQueryViewUntil(
      run.vaultId,
      async ({ page: pageHelpers }, { __typedArg0, __typedArg1 }) => {
        const views = [
          await pageHelpers.revealQueryView(__typedArg0),
          await pageHelpers.revealQueryView(__typedArg1),
        ];
        return views.every(
          (el) =>
            !!el
              .querySelector<HTMLElement>("[data-query-count]")
              ?.getAttribute("data-query-count"),
        );
      },
      { __typedArg0: first, __typedArg1: second },
      { ready: (counted) => counted, what: "both embeds' counts", tries: 120 },
    );

    // The second embed's Results menu opens with its limit field focused;
    // focus leaves it, and its label brings it back.
    const focus = JSON.parse(
      await obRun(
        run.vaultId,
        async ({ page: pageHelpers }, { __typedArg0, __typedArg1 }) => {
          const { press, until } = pageHelpers;
          const views = [
            await pageHelpers.revealQueryView(__typedArg0),
            await pageHelpers.revealQueryView(__typedArg1),
          ];
          const el = views[1];
          press(
            el!.querySelector<HTMLElement>("[data-query-results]")!,
            "Results",
          );
          const popup = el!.querySelector<HTMLElement>(
            "[data-query-results-popup]",
          )!;
          const field = await until("limit field", () =>
            popup!.querySelector<HTMLInputElement>("[data-query-limit]")!,
          );
          const label = popup!.querySelector<HTMLLabelElement>("label")!;
          field.blur();
          const blurred = activeDocument.activeElement !== field;
          press(label, "limit label");
          await until(
            "label focuses the limit field",
            () => activeDocument.activeElement === field,
          );
          const out = {
            blurred,
            sameId: label!.htmlFor === field.id,
            unique:
              activeDocument.querySelectorAll<HTMLElement>(
                `#${CSS.escape(field.id)}`,
              ).length === 1,
            focused: activeDocument.activeElement === field,
          };
          activeDocument
            .querySelectorAll<HTMLElement>(":popover-open")
            .forEach((p) => p.hidePopover());
          return String(JSON.stringify(out));
        },
        { __typedArg0: first, __typedArg1: second },
      ),
    ) as Record<string, boolean>;
    expect(focus).toEqual({
      blurred: true,
      sameId: true,
      unique: true,
      focused: true,
    });
  }, 180000);
});
