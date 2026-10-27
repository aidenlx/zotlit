import { isDeepStrictEqual } from "node:util";
import { describe, expect, it } from "vitest";

import { reachable } from "./e2e-run-fixture.ts";
import {
  annotationAttachment,
  annotationItem,
  annotationKeys,
  annotationKeysByPage,
  attachmentAnnotations,
  attachmentTags,
} from "./e2e-run-fixture.ts";
import { registerEndToEndRunHooks, run } from "./e2e-run-lifecycle.ts";
import { readQueryViewUntil, revealQueryView } from "./note-query-view.ts";
import { obRun, obRunUntil } from "./obsidian-cli.ts";
import type {
  AnnotationLeaf,
  PagePdfView,
  CodeMirrorElement,
} from "./page-notes-types.ts";

describe.skipIf(!reachable)("End-to-end Run", () => {
  registerEndToEndRunHooks();

  it("shows the same Fixture Annotations in both surfaces with Zotero closed", async () => {
    const layout = await obRun(
      run.vaultId,
      async ({ app }) => {
        return JSON.stringify(app.workspace.getLayout());
      },
      undefined,
    );
    try {
      await obRun(
        run.vaultId,
        async ({ app }, { annotationAttachmentPath }) => {
          const file = app.vault.getFileByPath(annotationAttachmentPath)!;
          const leaf = app.workspace.getLeaf("tab");
          await leaf.openFile(file);
          app.workspace.setActiveLeaf(leaf, { focus: true });
          app.commands.executeCommandById("zotlit:open-annot-view");
          app.commands.executeCommandById(
            "zotlit:annot-view-follow-active-tab",
          );
        },
        { annotationAttachmentPath: annotationAttachment.path! },
      );
      const expected = [...annotationKeys].sort();

      await obRunUntil(
        run.vaultId,
        async ({ zotlit }, { annotationAttachmentKey }) => {
          const { annotationRepository: repository, bridge } = zotlit.services;
          const list = await bridge.runPromise(
            repository.read(annotationAttachmentKey),
          );
          return {
            source: list?.source.kind ?? null,
            keys: (list?.annotations ?? []).map(({ key }) => key).sort(),
          };
        },
        { annotationAttachmentKey: annotationAttachment.key },
        {
          ready: (value) =>
            isDeepStrictEqual(value, { source: "zotero-db", keys: expected }),
          what: "the Zotero DB annotation list for the attachment to match the expected keys",
        },
      );
      expect(
        await obRun(
          run.vaultId,
          async ({ zotlit }, { annotationAttachmentKey }) => {
            const { annotationRepository: repository, bridge } =
              zotlit.services;
            const list = await bridge.runPromise(
              repository.read(annotationAttachmentKey),
            );
            return {
              source: list?.source.kind ?? null,
              keys: (list?.annotations ?? []).map(({ key }) => key).sort(),
            };
          },
          { annotationAttachmentKey: annotationAttachment.key },
        ),
      ).toEqual({
        source: "zotero-db",
        keys: expected,
      });

      try {
        await obRunUntil(
          run.vaultId,
          async ({ app }) => {
            return (() => {
              const annotationView = (
                app.workspace.getLeavesOfType(
                  "zotero-annotation-view",
                ) as AnnotationLeaf[]
              )[0]?.view;
              const cards = Array.from(
                annotationView?.containerEl.querySelectorAll<HTMLElement>(
                  ".zt-annot-card[data-zotero-annotation-key]",
                ) ?? [],
                (el) => el.getAttribute("data-zotero-annotation-key"),
              ).filter(Boolean);
              return [...new Set(cards)].sort();
            })();
          },
          undefined,
          {
            ready: (value) => isDeepStrictEqual(value, expected),
            what: "the Annotation View card keys to match the expected fixture keys",
          },
        );
      } catch (error) {
        const state = await obRun(
          run.vaultId,
          async ({ app, zotlit }) => {
            return JSON.stringify(
              (() => {
                const services = zotlit.services;
                const leaves = app.workspace.getLeavesOfType(
                  "zotero-annotation-view",
                ) as AnnotationLeaf[];
                const active = app.workspace.getActiveFile();
                const full = active
                  ? (
                      app.vault.adapter as import("obsidian").FileSystemAdapter
                    ).getFullPath(active.path)
                  : null;
                const session = active
                  ? services.pdfAnnotationEditor.bindings.find(
                      (b) => b.filePath === active.path,
                    )?.session
                  : null;
                return {
                  count: leaves.length,
                  snapshot: leaves[0]?.view.snapshot ?? null,
                  active: active?.path ?? null,
                  session: session
                    ? { filePath: active?.path, target: session.target }
                    : null,
                  resolution: full
                    ? services.bridge.runSync(
                        services.attachmentResolver.resolve(full),
                      )
                    : null,
                  fullPath: full,
                  exists: full ? require("fs").existsSync(full) : false,
                  profileDir: services.zoteroPref.resolvedProfileDir,
                  dataDir: services.zoteroPref.dataDir,
                };
              })(),
            );
          },
          undefined,
        );
        throw new Error(`Annotation cards did not render: ${state}`, {
          cause: error,
        });
      }
      expect(
        await obRun(
          run.vaultId,
          async ({ app }) => {
            return (() => {
              const annotationView = (
                app.workspace.getLeavesOfType(
                  "zotero-annotation-view",
                ) as AnnotationLeaf[]
              )[0]?.view;
              const cards = Array.from(
                annotationView?.containerEl.querySelectorAll<HTMLElement>(
                  ".zt-annot-card[data-zotero-annotation-key]",
                ) ?? [],
                (el) => el.getAttribute("data-zotero-annotation-key"),
              ).filter(Boolean);
              return [...new Set(cards)].sort();
            })();
          },
          undefined,
        ),
      ).toEqual(expected);
      // Wait for the card's growing excerpt to settle before starting a transition.
      // A height unchanged for 300 ms counts as settled.
      // Seek each transition to its midpoint so a late timer cannot sample its end.
      // Under reduced motion neither property has an intermediate value.

      const { motion, ...eased } = (await obRun(
        run.vaultId,
        async ({ app, page }) => {
          const { until } = page;
          const card = (
            app.workspace.getLeavesOfType(
              "zotero-annotation-view",
            ) as AnnotationLeaf[]
          )[0]!.view.containerEl.querySelector<HTMLElement>(
            ".zt-annot-card:not([data-selected])",
          )!;
          const read = () => {
            const s = getComputedStyle(card);
            return { fill: s.backgroundColor, ring: s.boxShadow };
          };
          let height = -1,
            since = 0;
          await until(
            "excerpt height settles",
            () => {
              if (card!.offsetHeight !== height) {
                height = card!.offsetHeight;
                since = Temporal.Now.instant().epochMilliseconds;
              }
              return Temporal.Now.instant().epochMilliseconds - since >= 300;
            },
            10000,
          );
          const probe = (on: boolean) => {
            const start = read();
            card!.toggleAttribute("data-selected", on);
            read();
            const transitions = card!
              .getAnimations()
              .filter((animation): animation is CSSTransition =>
                ["background-color", "box-shadow"].includes(
                  (animation as CSSTransition).transitionProperty,
                ),
              );
            for (const animation of transitions) {
              animation.pause();
              animation.currentTime =
                Number(animation.effect!.getComputedTiming().activeDuration) /
                2;
            }
            const mid = read();
            for (const animation of transitions) animation.finish();
            const end = read();
            const eases = (name: "fill" | "ring") =>
              mid[name] !== start[name] && mid[name] !== end[name];
            return { fill: eases("fill"), ring: eases("ring") };
          };
          const motion = !matchMedia("(prefers-reduced-motion: reduce)")
            .matches;
          const select = probe(true);
          const deselect = probe(false);
          return { motion, select, deselect };
        },
        undefined,
      )) as { motion: boolean };
      expect(eased).toEqual({
        select: { fill: motion, ring: motion },
        deselect: { fill: motion, ring: motion },
      });
      // The header block is one press target however much it reports (the
      // view's own More options beside it is not part of it), and the pane
      // names its controls with `aria-label` alone. Both are shapes only a
      // rendered view has: the focus stops are what the DOM ended up with, and
      // a `title` anywhere in the view is the hover tooltip Obsidian would draw
      // over its own.

      expect(
        await obRun(
          run.vaultId,
          async ({ app }) => {
            return JSON.stringify(
              (() => {
                const root = (
                  app.workspace.getLeavesOfType(
                    "zotero-annotation-view",
                  ) as AnnotationLeaf[]
                )[0]?.view.containerEl;
                const block =
                  root?.querySelector<HTMLElement>(".zt-annot-header")
                    ?.parentElement ?? null;
                return {
                  focusable: block
                    ? [
                        ...block.querySelectorAll<HTMLButtonElement>(
                          'button, [tabindex]:not([tabindex="-1"]), a[href], input',
                        ),
                      ].filter(
                        (el) => !el.closest("[data-annot-view-more-options]"),
                      ).length
                    : -1,
                  titled: root
                    ? root!.querySelectorAll<HTMLElement>("[title]").length
                    : -1,
                };
              })(),
            );
          },
          undefined,
        ),
      ).toBe(JSON.stringify({ focusable: 1, titled: 0 }));
      // The tag Chooser hangs in the browser's top layer, placed by CSS anchor
      // positioning — which only a running Obsidian has. A popup that collapsed
      // still holds its rows in the DOM, so what tells is whether its own box
      // is still around them.
      //
      // The tag Chooser is named by its trigger's label, never by DOM order:
      // the filter bar draws the colour Chooser first whenever the palette has
      // a colour, and every Fixture Annotation under this attachment carries
      // one. The popup is then the popover target of that trigger. A closed
      // popup holds no rows or search field, so neither can name it.

      await obRun(
        run.vaultId,
        async ({ app, page }, { tagTriggerLabel, activeTriggerPrefix }) => {
          const { press } = page;
          const root = (
            app.workspace.getLeavesOfType(
              "zotero-annotation-view",
            ) as AnnotationLeaf[]
          )[0]?.view.containerEl;
          const popup = (() => {
            const root = (
              app.workspace.getLeavesOfType(
                "zotero-annotation-view",
              ) as AnnotationLeaf[]
            )[0]?.view.containerEl;
            const trigger = Array.from(
              root?.querySelectorAll<HTMLButtonElement>(
                "button[popovertarget]",
              ) ?? [],
            ).find((b) => {
              const label = b.getAttribute("aria-label") ?? "";
              return (
                label === tagTriggerLabel ||
                label.startsWith(activeTriggerPrefix)
              );
            });
            return trigger
              ? root!.ownerDocument.getElementById(
                  trigger.getAttribute("popovertarget")!,
                )!
              : null;
          })();
          if (!popup) throw new Error("No tag Chooser in the Annotation View");
          if (!popup!.matches(":popover-open"))
            press(
              root!.querySelector<HTMLElement>(
                `[popovertarget="${popup!.id}"]`,
              )!,
              "tag Chooser",
            );
        },
        {
          tagTriggerLabel: run.m.annot_view_filter_tag_trigger(),
          activeTriggerPrefix: run.m.annot_view_filter_tag_trigger_active({
            tags: "",
          }),
        },
      );
      // `menuChrome` is the computed-style half of the proof. The popup wears no
      // `.menu` class, so its chrome can only come from Obsidian's `--menu-*`
      // variables. A throwaway sibling declares the same seven variables and is
      // measured beside it: equal computed values mean the popup reads them, in
      // whatever units the engine resolved, under whatever theme is loaded. The
      // sibling is also checked against the initial values, because an
      // undefined variable would leave both boxes bare and make equality say
      // nothing.
      //
      // The padding is the one read taken from the list box. The popup keeps
      // none of its own, so the search field runs edge to edge, and the list
      // carries `--menu-padding` as the inset.
      //
      // The shadow is the one read compared by suffix. Tailwind's `shadow-()`
      // utility composes its ring and inset placeholders ahead of the value, so
      // the popup carries four transparent stops in front of the three
      // `--menu-shadow` supplies.
      //
      // #1191 asks for one assertion, and this scenario carries three. The
      // chrome read is kept here rather than left to the development loop
      // because it is the one place ADR 0044's variable contract is held: the
      // popup wears no `.menu` class, so nothing else would notice a theme
      // hook that stopped reading those variables. The closed state below is
      // kept for the same reason — only a running Obsidian has the user-agent
      // rule it depends on. `rows` names the vocabulary, which is what proves
      // the popup under measurement is the tag one.

      await obRunUntil(
        run.vaultId,
        async ({ app }, { tagTriggerLabel, activeTriggerPrefix }) => {
          return (() => {
            const popup = (() => {
              const root = (
                app.workspace.getLeavesOfType(
                  "zotero-annotation-view",
                ) as AnnotationLeaf[]
              )[0]?.view.containerEl;
              const trigger = Array.from(
                root?.querySelectorAll<HTMLButtonElement>(
                  "button[popovertarget]",
                ) ?? [],
              ).find((b) => {
                const label = b.getAttribute("aria-label") ?? "";
                return (
                  label === tagTriggerLabel ||
                  label.startsWith(activeTriggerPrefix)
                );
              });
              return trigger
                ? root!.ownerDocument.getElementById(
                    trigger.getAttribute("popovertarget")!,
                  )!
                : null;
            })();
            if (!popup)
              return {
                open: false,
                rows: [],
                rowsInsidePopup: false,
                menuChrome: false,
              };
            const box = popup!.getBoundingClientRect();
            const rows = Array.from(
              popup!.querySelectorAll<HTMLElement>('[role="option"]'),
            );
            const probe = popup!.parentElement!.appendChild(
              document.createElement("div"),
            );
            probe.style.cssText =
              "position:absolute;left:-9999px;visibility:hidden;background-color:var(--menu-background);border:var(--menu-border-width) solid var(--menu-border-color);border-radius:var(--menu-radius);corner-shape:var(--menu-corner-shape);padding:var(--menu-padding);box-shadow:var(--menu-shadow)";
            const got = getComputedStyle(popup) as CSSStyleDeclaration & {
                cornerShape: string;
              },
              want = getComputedStyle(probe) as CSSStyleDeclaration & {
                cornerShape: string;
              };
            const list = popup!.querySelector<HTMLElement>('[role="listbox"]')!;
            const reads = [
              "backgroundColor",
              "borderTopWidth",
              "borderTopColor",
              "borderTopLeftRadius",
              "cornerShape",
            ] as const;
            const chrome =
              reads.every((name) => got[name] === want[name]) &&
              list !== null &&
              getComputedStyle(list).paddingTop === want.paddingTop &&
              got.boxShadow.endsWith(want.boxShadow) &&
              want.backgroundColor !== "rgba(0, 0, 0, 0)" &&
              Number.parseFloat(want.borderTopWidth) > 0 &&
              Number.parseFloat(want.borderTopLeftRadius) > 0 &&
              Number.parseFloat(want.paddingTop) > 0 &&
              want.cornerShape !== "" &&
              want.boxShadow !== "none";
            probe.remove();
            return {
              open: popup!.matches(":popover-open"),
              rows: rows.map((row) => row.textContent).sort(),
              rowsInsidePopup:
                rows.length > 0 &&
                rows.every((row) => {
                  const r = row.getBoundingClientRect();
                  return (
                    r.height > 0 &&
                    r.top >= box.top &&
                    r.bottom <= box.bottom &&
                    r.left >= box.left &&
                    r.right <= box.right
                  );
                }),
              menuChrome: chrome,
            };
          })();
        },
        {
          tagTriggerLabel: run.m.annot_view_filter_tag_trigger(),
          activeTriggerPrefix: run.m.annot_view_filter_tag_trigger_active({
            tags: "",
          }),
        },
        {
          ready: (value) =>
            isDeepStrictEqual(value, {
              open: true,
              rows: attachmentTags,
              rowsInsidePopup: true,
              menuChrome: true,
            }),
          what: "the tag popup to list the attachment tags as rows inside the open popup",
        },
      );
      await obRun(
        run.vaultId,
        async ({ app }, { tagTriggerLabel, activeTriggerPrefix }) => {
          const popup = (() => {
            const root = (
              app.workspace.getLeavesOfType(
                "zotero-annotation-view",
              ) as AnnotationLeaf[]
            )[0]?.view.containerEl;
            const trigger = Array.from(
              root?.querySelectorAll<HTMLButtonElement>(
                "button[popovertarget]",
              ) ?? [],
            ).find((b) => {
              const label = b.getAttribute("aria-label") ?? "";
              return (
                label === tagTriggerLabel ||
                label.startsWith(activeTriggerPrefix)
              );
            });
            return trigger
              ? root!.ownerDocument.getElementById(
                  trigger.getAttribute("popovertarget")!,
                )!
              : null;
          })();
          popup?.hidePopover();
        },
        {
          tagTriggerLabel: run.m.annot_view_filter_tag_trigger(),
          activeTriggerPrefix: run.m.annot_view_filter_tag_trigger_active({
            tags: "",
          }),
        },
      );
      // A closed popover is hidden by the user-agent rule
      // `[popover]:not(:popover-open) { display: none }`, which any
      // unconditional author-origin `display` outranks. The popup then keeps
      // painting after it closes and the view behind draws over it, which
      // reads as a popup that will not close and has lost its background.
      // Only a running Obsidian has that user-agent rule, so this is the one
      // place the closed state can be proven.
      await obRunUntil(
        run.vaultId,
        async ({ app }, { tagTriggerLabel, activeTriggerPrefix }) => {
          return (() => {
            const popup = (() => {
              const root = (
                app.workspace.getLeavesOfType(
                  "zotero-annotation-view",
                ) as AnnotationLeaf[]
              )[0]?.view.containerEl;
              const trigger = Array.from(
                root?.querySelectorAll<HTMLButtonElement>(
                  "button[popovertarget]",
                ) ?? [],
              ).find((b) => {
                const label = b.getAttribute("aria-label") ?? "";
                return (
                  label === tagTriggerLabel ||
                  label.startsWith(activeTriggerPrefix)
                );
              });
              return trigger
                ? root!.ownerDocument.getElementById(
                    trigger.getAttribute("popovertarget")!,
                  )!
                : null;
            })();
            if (!popup) return { open: false, hidden: false };
            return {
              open: popup!.matches(":popover-open"),
              hidden:
                !popup!.checkVisibility() &&
                popup!.getBoundingClientRect().height === 0,
            };
          })();
        },
        {
          tagTriggerLabel: run.m.annot_view_filter_tag_trigger(),
          activeTriggerPrefix: run.m.annot_view_filter_tag_trigger_active({
            tags: "",
          }),
        },
        {
          ready: (value) =>
            isDeepStrictEqual(value, { open: false, hidden: true }),
          what: "the tag popup to close and be hidden",
        },
      );
      for (const [pageIndex, annotations] of annotationKeysByPage) {
        const pageKeys = annotations.map(({ key }) => key).sort();
        await obRunUntil(
          run.vaultId,
          async (
            { app },
            { annotationAttachmentPath, pageNumber, pageKeys },
          ) => {
            const pdfView = (
              app.workspace.getLeavesOfType(
                "pdf",
              ) as (import("obsidian").WorkspaceLeaf & {
                view: PagePdfView;
              })[]
            ).find(
              ({ view }) => view.file?.path === annotationAttachmentPath,
            )?.view;
            const pdfPage = pdfView?.containerEl.querySelector<HTMLElement>(
              `.page[data-page-number="${JSON.stringify(pageNumber)}"]`,
            )!;
            pdfPage?.scrollIntoView({ block: "center" });
            const marks = Array.from(
              pdfView?.containerEl.querySelectorAll<HTMLElement>(
                ".zt-pdf-annotation-mark[data-zotero-annotation-key]",
              ) ?? [],
              (el) => el.getAttribute("data-zotero-annotation-key"),
            ).filter((key) => pageKeys.includes(key!));
            return [...new Set(marks)].sort();
          },
          {
            annotationAttachmentPath: annotationAttachment.path,
            pageNumber: pageIndex + 1,
            pageKeys,
          },
          {
            ready: (value) => isDeepStrictEqual(value, pageKeys),
            what: "the PDF page marks to list the expected annotation keys",
          },
        );
      }
      expect(
        await obRun(
          run.vaultId,
          async ({ app, zotlit }, { annotationAttachmentKey }) => {
            const { annotationRepository: repository, bridge } =
              zotlit.services;
            const text =
              (
                app.workspace.getLeavesOfType(
                  "zotero-annotation-view",
                ) as AnnotationLeaf[]
              )[0]?.view.contentEl.textContent ?? "";
            const labels = ["Zotero DB", "Local API", "database source"];
            return JSON.stringify({
              capability: bridge.runSync(
                repository.capabilityFor(annotationAttachmentKey),
              ),
              sourceLabels: labels.some((label) =>
                text.toLowerCase().includes(label.toLowerCase()),
              ),
            });
          },
          { annotationAttachmentKey: annotationAttachment.key },
        ),
      ).toBe(
        JSON.stringify({
          capability: {
            kind: "read-only",
            reason: "zotero-unavailable",
          },
          sourceLabels: false,
        }),
      );
    } finally {
      await obRun(
        run.vaultId,
        async ({ app }, { layout }) => {
          await app.workspace.changeLayout(JSON.parse(layout));
        },
        { layout },
      );
    }
  }, 120000);

  it("groups the sidebar Annotation View by colour from More options", async () => {
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
          await app.workspace.changeLayout(JSON.parse(layout));
        },
        { layout },
      );
    });
    await obRun(
      run.vaultId,
      async ({ app }, { annotationAttachmentPath }) => {
        const file = app.vault.getFileByPath(annotationAttachmentPath)!;
        const leaf = app.workspace.getLeaf("tab");
        await leaf.openFile(file);
        app.workspace.setActiveLeaf(leaf, { focus: true });
        app.commands.executeCommandById("zotlit:open-annot-view");
        app.commands.executeCommandById("zotlit:annot-view-follow-active-tab");
      },
      { annotationAttachmentPath: annotationAttachment.path! },
    );

    /** The sidebar's cards in screen order, each under the group heading above it. */

    interface Sidebar {
      cards: { key: string; color: string; group: string | null }[];
      query: string | null;
    }
    const sidebarWhen = async (
      ready: (state: Sidebar) => boolean,
    ): Promise<Sidebar> => {
      let state: Sidebar | null = null;
      await expect
        .poll(
          async () => {
            const text = await obRun(
              run.vaultId,
              async ({ app }) => {
                const view = (
                  app.workspace.getLeavesOfType(
                    "zotero-annotation-view",
                  ) as AnnotationLeaf[]
                )[0]?.view;
                if (!view) return "null";
                await view.read;
                const grid =
                  view.contentEl.querySelector<HTMLElement>('[role="grid"]')!;
                let group = null;
                const cards = [];
                for (const node of grid?.querySelectorAll<HTMLElement>(
                  "[data-query-group], .zt-annot-card[data-zotero-annotation-key]",
                ) ?? []) {
                  if (node.hasAttribute("data-query-group")) {
                    group = node.getAttribute("data-query-group");
                    continue;
                  }
                  cards.push({
                    key: node.getAttribute("data-zotero-annotation-key"),
                    color: node.getAttribute("data-annot-color"),
                    group,
                  });
                }
                return JSON.stringify({
                  cards,
                  query: view.getState().query ?? null,
                });
              },
              undefined,
            );
            state = text === "null" ? null : (JSON.parse(text) as Sidebar);
            return state !== null && ready(state);
          },
          { timeout: 30_000, interval: 250 },
        )
        .toBe(true);
      return state!;
    };
    const expected = [...annotationKeys].sort();
    const before = await sidebarWhen(
      ({ cards }) =>
        JSON.stringify(cards.map(({ key }) => key).sort()) ===
        JSON.stringify(expected),
    );
    // A plain sidebar stands under no heading.
    expect(before.cards.every(({ group }) => group === null)).toBe(true);
    const colors = new Set(before.cards.map(({ color }) => color));
    expect(colors.size).toBeGreaterThan(1);

    // More options → Group by → Color, through Obsidian's own menu. A side
    // dock hides the view header, so the reader presses the header row's own
    // "More options".
    await obRun(
      run.vaultId,
      async ({ app, page }) => {
        const { press } = page;
        press(
          (
            app.workspace.getLeavesOfType(
              "zotero-annotation-view",
            ) as AnnotationLeaf[]
          )[0]?.view.contentEl.querySelector<HTMLElement>(
            "[data-annot-view-more-options]",
          )!,
          "More options",
        );
      },
      undefined,
    );

    await obRunUntil(
      run.vaultId,
      async (_context, { groupByLabel }) => {
        return !!Array.from(
          document.querySelectorAll<HTMLElement>(".menu .menu-item"),
        ).find(
          (item) =>
            item!.querySelector<HTMLElement>(".menu-item-title")
              ?.textContent === groupByLabel,
        );
      },
      { groupByLabel: run.m.annot_view_group_by() },
      { what: "the More options menu to offer the group by colour item" },
    );
    await obRun(
      run.vaultId,
      async ({ page }, { groupByLabel }) => {
        const { press } = page;
        const item = Array.from(
          document.querySelectorAll<HTMLElement>(".menu .menu-item"),
        ).find(
          (item) =>
            item!.querySelector<HTMLElement>(".menu-item-title")
              ?.textContent === groupByLabel,
        );
        item!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
        press(item, "Group by");
      },
      { groupByLabel: run.m.annot_view_group_by() },
    );
    await obRunUntil(
      run.vaultId,
      async (_context, { propertyColorLabel }) => {
        return !!Array.from(
          document.querySelectorAll<HTMLElement>(".menu .menu-item"),
        ).find(
          (item) =>
            item!.querySelector<HTMLElement>(".menu-item-title")
              ?.textContent === propertyColorLabel,
        );
      },
      { propertyColorLabel: run.m.query_view_property_color() },
      { what: "the More options menu to offer the colour property item" },
    );
    await obRun(
      run.vaultId,
      async ({ page }, { propertyColorLabel }) => {
        const { press } = page;
        press(
          Array.from(
            document.querySelectorAll<HTMLElement>(".menu .menu-item"),
          ).find(
            (item) =>
              item!.querySelector<HTMLElement>(".menu-item-title")
                ?.textContent === propertyColorLabel,
          ),
          "Color",
        );
      },
      { propertyColorLabel: run.m.query_view_property_color() },
    );

    const grouped = await sidebarWhen(({ cards }) =>
      cards.some(({ group }) => group !== null),
    );
    // The same cards, one group for each colour, each colour under one heading.
    expect(grouped.cards.map(({ key }) => key).sort()).toEqual(expected);
    const headings = new Map<string, string>();
    for (const { color, group } of grouped.cards) {
      expect(group).not.toBeNull();
      expect(headings.get(color) ?? group).toBe(group);
      headings.set(color, group!);
    }
    expect(new Set(headings.values()).size).toBe(colors.size);
    // The grouping is the sidebar's Query File, which its state keeps.
    expect(grouped.query).toContain("attachment == this.attachment");
    expect(grouped.query).toContain("colorName");

    // "Filter…" opens the Match editor of the sidebar's one view, without the
    // filter that names the followed Attachment. A side dock hides the view
    // header, so the reader presses the header row's own "More options".
    expect(
      await obRun(
        run.vaultId,
        async ({ app, page }) => {
          const { press } = page;
          press(
            (
              app.workspace.getLeavesOfType(
                "zotero-annotation-view",
              ) as AnnotationLeaf[]
            )[0]?.view.contentEl.querySelector<HTMLElement>(
              "[data-annot-view-more-options]",
            )!,
            "More options",
          );
          return "true";
        },
        undefined,
      ),
    ).toBe("true");
    await obRunUntil(
      run.vaultId,
      async (_context, { filterLabel }) => {
        return !!Array.from(
          document.querySelectorAll<HTMLElement>(".menu .menu-item"),
        ).find(
          (item) =>
            item!.querySelector<HTMLElement>(".menu-item-title")
              ?.textContent === filterLabel,
        );
      },
      { filterLabel: run.m.annot_view_filter() },
      { what: "the More options menu to offer the colour filter item" },
    );
    await obRun(
      run.vaultId,
      async ({ page }, { filterLabel }) => {
        const { press } = page;
        press(
          Array.from(
            document.querySelectorAll<HTMLElement>(".menu .menu-item"),
          ).find(
            (item) =>
              item!.querySelector<HTMLElement>(".menu-item-title")
                ?.textContent === filterLabel,
          ),
          "Filter",
        );
      },
      { filterLabel: run.m.annot_view_filter() },
    );

    await obRunUntil(
      run.vaultId,
      async (_context) => {
        const modal = document.querySelector<HTMLElement>(
          ".modal.zt-annot-filter-modal",
        )!;
        return modal
          ? {
              title:
                modal!.querySelector<HTMLElement>(".modal-title")
                  ?.textContent ?? null,
              sections: Array.from(
                modal!.querySelectorAll<HTMLElement>("[data-filter-section]"),
                (el) => el.getAttribute("data-filter-section"),
              ),
              text: modal!.textContent.includes("this.attachment"),
            }
          : null;
      },
      undefined,
      {
        ready: (value) =>
          isDeepStrictEqual(value, {
            title: run.m.annot_view_filter_title(),
            sections: ["view"],
            text: false,
          }),
        what: "the annotation filter modal to show only the view section and no attachment text",
      },
    );
    // In an expression condition of the dialog, Escape closes the completion
    // list, then the Signature Hint, and leaves the dialog open each time; a
    // list the typing opens over the hint closes first. Tab takes the
    // list's option and keeps focus in the field; the method it writes
    // brings its Signature Hint, which Escape closes, the dialog still open.
    // A key typed straight after Enter or Tab takes an option lands in the
    // field, which keeps focus (#1651). The condition goes again before the
    // eval answers.
    const escapes = await obRun(
      run.vaultId,
      async (
        { app, page },
        { addConditionLabel, removeConditionLabel, editExpressionLabel },
      ) => {
        const { press, until } = page;
        await using cleanup = new AsyncDisposableStack();
        const contents = (
          require("@electron/remote") as typeof import("@electron/remote")
        ).getCurrentWebContents();
        const key = async (keyCode: string) => {
          const up = new Promise<Event>((r) =>
            window.addEventListener("keyup", r, {
              once: true,
              capture: true,
            }),
          );
          contents.sendInputEvent({ type: "keyDown", keyCode });
          if (keyCode.length === 1)
            contents.sendInputEvent({ type: "char", keyCode });
          contents.sendInputEvent({ type: "keyUp", keyCode });
          await up;
        };
        const modal = () =>
          document.querySelector<HTMLElement>(".modal.zt-annot-filter-modal")!;
        const section = modal()!.querySelector<HTMLElement>(
          '[data-filter-section="view"]',
        )!;
        const before = section!.querySelectorAll<HTMLElement>(
          "[data-condition-row]",
        ).length;
        press(
          [...section!.querySelectorAll<HTMLButtonElement>("button")].find(
            (button) => button.textContent.trim() === addConditionLabel,
          ),
          "Add condition",
        );
        const row = await until(
          "new row",
          () =>
            section!.querySelectorAll<HTMLElement>("[data-condition-row]")[
              before
            ],
        );
        cleanup.defer(() => {
          const remove = modal()
            ?.querySelectorAll<HTMLElement>(
              '[data-filter-section="view"] [data-condition-row]',
            )
            [before]?.querySelector<HTMLElement>(
              `button[aria-label=${JSON.stringify(removeConditionLabel)}]`,
            )!;
          if (remove) press(remove, "Remove condition");
        });
        press(
          row.querySelector<HTMLElement>(
            `button[aria-label=${JSON.stringify(editExpressionLabel)}]`,
          )!,
          "Edit as expression",
        );
        const content = await until("expression field", () =>
          section!
            .querySelectorAll<HTMLElement>("[data-condition-row]")
            [before]?.querySelector<CodeMirrorElement>(".cm-content")!,
        );
        const editor = content.cmTile!.root!.view;
        window.focus();
        editor.focus();
        await until(
          "focus in the field",
          () => document.activeElement === content && document.hasFocus(),
          5000,
        );
        const type = (text: string) => {
          editor.dispatch({
            selection: { anchor: 0, head: editor.state.doc.length },
          });
          document.execCommand("insertText", false, text);
        };
        type("te");
        await until("list opens", () =>
          document.querySelector<HTMLElement>(".cm-tooltip-autocomplete")!,
        );
        await key("Escape");
        await until(
          "Escape closes the list",
          () =>
            !document.querySelector<HTMLElement>(".cm-tooltip-autocomplete")!,
        );
        const list = { dialog: !!modal() };
        if (!modal()) return { list };
        type("text.slice(1, ");
        await until("Signature Hint", () =>
          document.querySelector<HTMLElement>(".zt-signature-hint")!,
        );
        await new Promise((r) => setTimeout(r, 200));
        if (document.querySelector<HTMLElement>(".cm-tooltip-autocomplete")!) {
          await key("Escape");
          await until(
            "Escape closes the list over the hint",
            () =>
              !document.querySelector<HTMLElement>(".cm-tooltip-autocomplete")!,
          );
        }
        await key("Escape");
        await until(
          "Escape closes the hint",
          () => !document.querySelector<HTMLElement>(".zt-signature-hint")!,
        );
        const hint = { dialog: !!modal() };
        type("text.sli");
        await until("list opens", () =>
          document.querySelector<HTMLElement>(
            ".cm-tooltip-autocomplete li[aria-selected]",
          )!,
        );
        await new Promise((r) => setTimeout(r, 200));
        await key("Tab");
        await until(
          "Tab closes the list",
          () =>
            !document.querySelector<HTMLElement>(".cm-tooltip-autocomplete")!,
        );
        const tab = {
          hintClosed: false,
          doc: editor.state.doc.toString(),
          dialog: !!modal(),
          focus: document.activeElement === content,
        };
        await until("Signature Hint of the method", () =>
          document.querySelector<HTMLElement>(".zt-signature-hint")!,
        );
        await key("Escape");
        await until(
          "Escape closes the hint",
          () => !document.querySelector<HTMLElement>(".zt-signature-hint")!,
        );
        tab.hintClosed = !!modal();
        const saved = () =>
          ((
            app.workspace.getLeavesOfType(
              "zotero-annotation-view",
            ) as AnnotationLeaf[]
          )[0]?.view.getState().query as string) ?? "";
        const settled = () =>
          new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r)));
        const typed: Record<
          string,
          { doc: string; focus: boolean; dialog: boolean }
        > = {};
        for (const [name, keyCode] of [
          ["enter", "Enter"],
          ["tab", "Tab"],
        ] as const) {
          type("te");
          await until(`${name} list opens`, () =>
            document.querySelector<HTMLElement>(
              ".cm-tooltip-autocomplete li[aria-selected]",
            )!,
          );
          await new Promise((r) => setTimeout(r, 200));
          await key(keyCode);
          await key(".");
          await until(`${name} saves the typed text`, () =>
            saved()
              .split(String.fromCharCode(10))
              .some((line) => /text[.]["']?$/.test(line.trimEnd())),
          );
          await settled();
          typed[name] = {
            doc: editor.state.doc.toString(),
            focus: document.activeElement === content,
            dialog: !!modal(),
          };
          for (
            let left = 5;
            document.querySelector<HTMLElement>(
              ".cm-tooltip-autocomplete, .zt-signature-hint",
            )!;
            left--
          ) {
            if (left === 0)
              throw new Error(`Escape leaves a popup open after ${name}`);
            await key("Escape");
          }
        }
        return { list, hint, tab, typed };
      },
      {
        addConditionLabel: run.m.workbench_match_add_condition(),
        removeConditionLabel: run.m.workbench_match_remove_condition(),
        editExpressionLabel: run.m.workbench_match_edit_as_expression(),
      },
    );
    expect(escapes).toEqual({
      list: { dialog: true },
      tab: {
        doc: "text.slice()",
        dialog: true,
        focus: true,
        hintClosed: true,
      },
      hint: { dialog: true },
      typed: {
        enter: { doc: "text.", focus: true, dialog: true },
        tab: { doc: "text.", focus: true, dialog: true },
      },
    });
    await obRun(
      run.vaultId,
      async (_context) => {
        const target = document.activeElement ?? document.body;
        target.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Escape",
            code: "Escape",
            bubbles: true,
          }),
        );
      },
      undefined,
    );
    // No menu or dialog stays over the window for the cases after this one.
    await obRunUntil(
      run.vaultId,
      async (_context) => {
        return document.querySelectorAll<HTMLElement>(".menu, .modal-container")
          .length;
      },
      undefined,
      {
        ready: (value) => value === 0,
        what: "the menus and modal containers to clear from the window",
      },
    );
  }, 120000);

  it("saves the sidebar filtered by one colour as a Query File, and a Literature Note that embeds it shows its Annotations of that colour", async () => {
    const savedPath = "query-files/Saved colour.zotquery";
    const notePath = `literatures/${annotationItem.literatureNoteName ?? annotationItem.key}.md`;
    const layout = await obRun(
      run.vaultId,
      async ({ app }) => {
        return JSON.stringify(app.workspace.getLayout());
      },
      undefined,
    );
    const noteText = await obRun(
      run.vaultId,
      async ({ app }, { notePath }) => {
        return await app.vault.read(app.vault.getFileByPath(notePath)!);
      },
      { notePath },
    );

    /**
     * Opens the colour Chooser, ticks the row of `color` (or "Clear selected
     * colors" for `null`), and closes the Chooser.
     */
    const pickColor = (color: string | null) =>
      obRun(
        run.vaultId,
        async ({ app, page }, { color, labels }) => {
          const el = (
            app.workspace.getLeavesOfType(
              "zotero-annotation-view",
            ) as AnnotationLeaf[]
          )[0]?.view.containerEl;
          const trigger = Array.from(
            el?.querySelectorAll<HTMLButtonElement>("button[aria-label]") ?? [],
          ).find(
            (button) =>
              button.getAttribute("aria-label") === labels.trigger ||
              button.getAttribute("aria-label")!.startsWith(labels.active),
          );
          if (!trigger) return "no chooser";
          page.press(trigger, "colour Chooser");
          const list = await page.until("colour list opens", () => {
            const list = Array.from(
              document.querySelectorAll<HTMLElement>('[role="listbox"]'),
            ).find(
              (list) =>
                document.getElementById(list.getAttribute("aria-labelledby")!)
                  ?.textContent === labels.list,
            );
            return list?.checkVisibility() ? list : null;
          });
          const row = Array.from(
            list.querySelectorAll<HTMLElement>('[role="option"]'),
          ).find((option) =>
            color === null
              ? option.textContent === labels.clear
              : option
                  .querySelector<HTMLElement>('[style*="--zt-swatch-color"]')
                  ?.style.getPropertyValue("--zt-swatch-color")
                  .trim()
                  .toLowerCase() === color.toLowerCase(),
          );
          if (row) {
            page.press(row, "colour row");
            await page.until("colour filter applies", () =>
              color === null
                ? trigger.getAttribute("aria-label") === labels.trigger
                : row.getAttribute("aria-selected") === "true",
            );
          }
          (document.activeElement ?? document.body).dispatchEvent(
            new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
          );
          return row ? "picked" : "no row";
        },
        {
          color,
          labels: {
            trigger: run.m.annot_view_filter_color_trigger(),
            active: run.m.annot_view_filter_color_trigger_active({
              colors: "",
            }),
            list: run.m.annot_view_filter_color_list(),
            clear: run.m.annot_view_filter_color_clear(),
          },
        },
      );
    let picked = false;
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      // The colour filter is saved for the Item; clearing it takes it back.
      if (picked) await pickColor(null);
      await obRun(
        run.vaultId,
        async ({ app }, { layout, notePath, noteText, savedPath }) => {
          await app.workspace.changeLayout(JSON.parse(layout));
          await app.vault.modify(app.vault.getFileByPath(notePath)!, noteText);
          const saved = app.vault.getFileByPath(savedPath)!;
          if (saved) await app.vault.delete(saved);
        },
        { layout, notePath, noteText, savedPath },
      );
    });
    await obRun(
      run.vaultId,
      async ({ app }, { annotationAttachmentPath }) => {
        const file = app.vault.getFileByPath(annotationAttachmentPath)!;
        const leaf = app.workspace.getLeaf("tab");
        await leaf.openFile(file);
        app.workspace.setActiveLeaf(leaf, { focus: true });
        app.commands.executeCommandById("zotlit:open-annot-view");
        app.commands.executeCommandById("zotlit:annot-view-follow-active-tab");
      },
      { annotationAttachmentPath: annotationAttachment.path! },
    );

    const expected = [...annotationKeys].sort();
    await obRunUntil(
      run.vaultId,
      async ({ app }) => {
        const view = (
          app.workspace.getLeavesOfType(
            "zotero-annotation-view",
          ) as AnnotationLeaf[]
        )[0]?.view;
        if (!view) return "null";
        await view.read;
        return [
          ...view.contentEl.querySelectorAll<HTMLElement>(
            ".zt-annot-card[data-zotero-annotation-key]",
          ),
        ]
          .map((n) => n.getAttribute("data-zotero-annotation-key"))
          .sort();
      },
      undefined,
      {
        ready: (value) => isDeepStrictEqual(value, expected),
        tries: 120,
        what: "the Annotation View cards to list the expected colour filtered keys",
      },
    );

    // Filter the sidebar by the colour of the Fixture's first Annotation.
    const color = attachmentAnnotations[0]!.color;
    const ofColor = attachmentAnnotations
      .filter((annotation) => annotation.color === color)
      .map(({ key }) => key)
      .sort();
    expect(ofColor.length).toBeGreaterThan(0);
    expect(ofColor.length).toBeLessThan(expected.length);
    expect(await pickColor(color)).toBe("picked");
    picked = true;
    await obRunUntil(
      run.vaultId,
      async ({ app }) => {
        const view = (
          app.workspace.getLeavesOfType(
            "zotero-annotation-view",
          ) as AnnotationLeaf[]
        )[0]?.view;
        if (!view) return "null";
        await view.read;
        return [
          ...view.contentEl.querySelectorAll<HTMLElement>(
            ".zt-annot-card[data-zotero-annotation-key]",
          ),
        ]
          .map((n) => n.getAttribute("data-zotero-annotation-key"))
          .sort();
      },
      undefined,
      {
        ready: (value) => isDeepStrictEqual(value, ofColor),
        tries: 80,
        what: "the Annotation View cards to list the expected colour keys",
      },
    );

    // More options → "Save as query file…", through Obsidian's own menu. A
    // side dock hides the view header, so the reader presses the header
    // row's own "More options".
    expect(
      await obRun(
        run.vaultId,
        async ({ app, page }) => {
          const { press } = page;
          const button = press(
            (
              app.workspace.getLeavesOfType(
                "zotero-annotation-view",
              ) as AnnotationLeaf[]
            )[0]?.view.contentEl.querySelector<HTMLElement>(
              "[data-annot-view-more-options]",
            )!,
            "More options",
          );
          return {
            label: button.getAttribute("aria-label"),
          };
        },
        undefined,
      ),
    ).toEqual({ label: run.m.annot_view_more_tooltip() });

    await obRunUntil(
      run.vaultId,
      async (_context, { saveQueryLabel }) => {
        return !!Array.from(
          document.querySelectorAll<HTMLElement>(".menu .menu-item"),
        ).find(
          (item) =>
            item!.querySelector<HTMLElement>(".menu-item-title")
              ?.textContent === saveQueryLabel,
        );
      },
      { saveQueryLabel: run.m.annot_view_save_as_query_file() },
      { what: "the More options menu to offer the save query item" },
    );
    await obRun(
      run.vaultId,
      async ({ page }, { saveQueryLabel }) => {
        const { press } = page;
        press(
          Array.from(
            document.querySelectorAll<HTMLElement>(".menu .menu-item"),
          ).find(
            (item) =>
              item!.querySelector<HTMLElement>(".menu-item-title")
                ?.textContent === saveQueryLabel,
          ),
          "Save as query file",
        );
      },
      { saveQueryLabel: run.m.annot_view_save_as_query_file() },
    );

    // The dialog asks the name, the folder, and which records the file shows.

    const dialog = (await obRun(
      run.vaultId,
      async (_context) => {
        const modal = document.querySelector<HTMLElement>(
          ".modal.zt-save-query-file-modal",
        )!;
        return modal
          ? {
              title:
                modal!.querySelector<HTMLElement>(".modal-title")
                  ?.textContent ?? null,
              fields: [
                ...modal!.querySelectorAll<HTMLElement>("[data-save-field]"),
              ].map((n) => n.getAttribute("data-save-field")),
              records: [
                ...modal!.querySelectorAll<HTMLInputElement>(
                  "[data-save-records]",
                ),
              ].map((n) => ({
                value: n.getAttribute("data-save-records"),
                label: n.closest("label")!.textContent,
                checked: n.checked,
              })),
            }
          : null;
      },
      undefined,
    )) as {
      title: string;
      fields: string[];
      records: { value: string; label: string; checked: boolean }[];
    } | null;
    expect(dialog).toMatchObject({
      title: run.m.annot_view_save_title(),
      fields: ["name", "folder"],
      records: [
        {
          value: "this-item",
          label: run.m.annot_view_save_records_this_item(),
          checked: true,
        },
        {
          value: "note-item",
          label: expect.stringContaining(
            run.m.annot_view_save_records_note_item(),
          ),
          checked: false,
        },
      ],
    });
    await obRun(
      run.vaultId,
      async ({ page }) => {
        const { press } = page;
        const modal = document.querySelector<HTMLElement>(
          ".modal.zt-save-query-file-modal",
        )!;
        const set = (field: string, value: string) => {
          const input = modal!.querySelector<HTMLInputElement>(
            `[data-save-field="${field}"]`,
          )!;
          input!.value = value;
          input!.dispatchEvent(new Event("input", { bubbles: true }));
        };
        set("name", "Saved colour");
        set("folder", "query-files");
        press(
          modal!
            .querySelector<HTMLInputElement>('[data-save-records="note-item"]')!
            .closest("label")!,
          "note-item records",
        );
        press(
          modal!.querySelector<HTMLElement>(
            ".modal-button-container button.mod-cta",
          )!,
          "Save",
        );
      },
      undefined,
    );

    // The file opens in a tab, where `this` has no value.

    await obRunUntil(
      run.vaultId,
      async ({ app }, { savedPath }) => {
        const view = app.workspace.getMostRecentLeaf()?.view as
          | import("../../../apps/obsidian/src/views/query-view/file-view.ts").QueryFileView
          | undefined;
        if (
          view?.getViewType() !== "zotlit-query-file" ||
          view.file?.path !== savedPath
        )
          return "null";
        await view.query.settled;
        return {
          diagnostic:
            view.contentEl
              .querySelector<HTMLElement>("[data-query-diagnostic]")
              ?.getAttribute("data-query-diagnostic") ?? null,
          cards:
            view.contentEl.querySelectorAll<HTMLElement>(".zt-annot-card")
              .length,
        };
      },
      { savedPath },
      {
        ready: (value) =>
          isDeepStrictEqual(value, { diagnostic: "unbound-context", cards: 0 }),
        tries: 120,
        what: "the saved Query File to report the unbound-context diagnostic with no cards",
      },
    );
    const saved = await obRun(
      run.vaultId,
      async ({ app }, { savedPath }) => {
        return await app.vault.read(app.vault.getFileByPath(savedPath)!);
      },
      { savedPath },
    );
    expect(saved).toMatch(/^filters: item == this\.item$/m);
    expect(saved).toMatch(/^ {4}filters: color/m);

    // Embedded in the Item's Literature Note, it shows that note's
    // Annotations of the colour.
    await obRun(
      run.vaultId,
      async ({ app }, { notePath, updatedNoteText }) => {
        const file = app.vault.getFileByPath(notePath)!;
        await app.vault.modify(file, updatedNoteText);
        const leaf = app.workspace.getLeaf("tab");
        await leaf.openFile(file, { state: { mode: "preview" } });
        app.workspace.setActiveLeaf(leaf, { focus: true });
      },
      {
        notePath,
        updatedNoteText: noteText.replace(
          /^(---\n[\s\S]*?\n---\n)/,
          "$1\n![[Saved colour.zotquery]]\n\n",
        ),
      },
    );
    const savedEmbed = await revealQueryView(run.vaultId, notePath, {
      embed: "Saved colour.zotquery",
    });
    await readQueryViewUntil(
      run.vaultId,
      async ({ page }, { savedEmbed }) => {
        const el = await page.revealQueryView(savedEmbed);
        return {
          cards: [
            ...el.querySelectorAll(
              ".zt-annot-card[data-zotero-annotation-key]",
            ),
          ]
            .map((node) => node.getAttribute("data-zotero-annotation-key"))
            .sort(),
          diagnostic:
            el
              .querySelector("[data-query-diagnostic]")
              ?.getAttribute("data-query-diagnostic") ?? null,
        };
      },
      { savedEmbed },
      {
        ready: ({ cards }) => JSON.stringify(cards) === JSON.stringify(ofColor),
        what: "Query File embed",
        tries: 120,
      },
    );
  }, 180000);
});
