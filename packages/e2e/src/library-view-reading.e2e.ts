import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { WorkspaceLeaf, MarkdownView, WorkspaceSidedock } from "obsidian";
import { describe, expect, it } from "vitest";

import { ATTACHMENTS, ITEMS } from "@zotlit/scripts/fixture";

import type { AnnotationView as AnnotView } from "@/views/annot-view/view";
import type { LibraryView } from "@/views/library/view";

import { reachable } from "./e2e-run-fixture.ts";
import {
  MY_LIBRARY_DOCUMENT,
  annotationAttachment,
  annotationItem,
  attachmentAnnotations,
  e2eFixture,
} from "./e2e-run-fixture.ts";
import { activeTab, pdfOpened } from "./e2e-run-helpers.ts";
import type { ActiveTab } from "./e2e-run-helpers.ts";
import { registerEndToEndRunHooks, run } from "./e2e-run-lifecycle.ts";
import { pressPromptKey, selectSuggestion } from "./e2e-run-note-helpers.ts";
import * as suite from "./e2e-run-suite-helpers.ts";
import { obRun, obRunUntil } from "./obsidian-cli.ts";
import { readUntil, waitFor } from "./obsidian-cli.ts";
import type { LibraryTabs } from "./page-library-types.ts";
import type {} from "./page-library-types.ts";

describe.skipIf(!reachable)("End-to-end Run", () => {
  registerEndToEndRunHooks();

  it("shows the selected row's Reading Card with its seeded fields, abstract and, once opened, Annotation Cards under the Editing Capability, runs the row menu's actions from its buttons, opens its Annotations in the sidebar, shows it under the tree and the list on a narrow pane and beside a wide list, turns it on and off from the Details button and Space and off from its close button, while a click and the arrow keys only select and Escape leaves it as it is, keeps a double click on the row for the PDF, selects the row the keyboard enters the list at, says what fills it with no selection, and hides it while Zotero's data folder is missing", async () => {
    const snapshot = await obRun(
      run.vaultId,
      async ({ app, zotlit }) => {
        return JSON.stringify({
          layout: app.workspace.getLayout(),
          document:
            zotlit.services.bridge.runSync(zotlit.services.settings.current)[
              "library.document"
            ] ?? null,
          dataDir: zotlit.services.bridge.runSync(
            zotlit.services.zoteroPref.current,
          ).dataDirOverride,
        });
      },
      undefined,
    );
    const notePath = "Reading Card citations.md";
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obRun(
        run.vaultId,
        async ({ app, zotlit }, { snapshot, notepath }) => {
          const saved = JSON.parse(snapshot);
          zotlit.services.bridge.runSync(
            zotlit.services.zoteroPref.setDataDir(saved.dataDir),
          );
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

    // The seed's oracle: the paper, its one PDF, and the Annotations on it.
    const paper = annotationItem;
    const abstract = paper.fields?.abstractNote;
    expect(abstract).toBeTruthy();
    const pdfs = ATTACHMENTS.filter(
      ({ parentItemID }) => parentItemID === paper.itemID,
    );
    expect(pdfs.map(({ key }) => key)).toEqual([annotationAttachment.key]);
    const seededCards = attachmentAnnotations
      .map(({ key, color, pageLabel, comment }) => ({
        key,
        color,
        page: run.m.annot_view_page({ page: pageLabel }),
        comment,
      }))
      .toSorted((a, b) => a.key.localeCompare(b.key));
    const authors = paper.creators
      .filter(({ creatorType }) => creatorType === "author")
      .map(({ firstName, lastName }) => `${firstName} ${lastName}`);

    // The Library View on My Library, wide enough for the card, and a note
    // to cite into that was active last.
    await suite.wideWindow(cleanup);
    await obRun(
      run.vaultId,
      async ({ app, zotlit, page }, { myLibraryDocument, notepath }) => {
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
        const file =
          app.vault.getFileByPath(notepath) ??
          (await app.vault.create(notepath, "CITE "));
        const note = app.workspace.getLeaf("tab");
        await note.openFile(file);
        app.workspace.setActiveLeaf(note, { focus: true });
        (note.view as MarkdownView).editor.setCursor({
          line: 0,
          ch: "CITE ".length,
        });
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
      },
      { myLibraryDocument: MY_LIBRARY_DOCUMENT, notepath: notePath },
    );
    /** Run `script` with the Library View's tab active, `el` its content and `card` its Reading Card pane. */

    /** What the card shows, `null` while it is out of view. */

    // No row is selected: the card asks for a paper over one quiet line
    // that counts the node's papers passing each Reading State facet, in
    // the tree's order, and leaves out a facet no paper passes.
    const noPaper = await obRun(
      run.vaultId,
      async ({ app, page }, { paperKey }) => {
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
        const card = el.querySelector<HTMLElement>("[data-library-card]");
        await until(
          "rows",
          () => el.querySelector(`[data-query-item-row="${paperKey}"]`),
          10000,
        );
        const empty = await until("empty card", () =>
          card!.querySelector<HTMLElement>("[data-library-card-empty]"),
        );
        const stats = await until(
          "paper counts",
          () => empty.querySelector<HTMLElement>("[data-library-card-stats]"),
          10000,
        );
        return {
          shown: card!.checkVisibility(),
          prompt: empty.querySelector("p")?.textContent ?? null,
          stats: [
            ...stats.querySelectorAll<HTMLElement>("[data-library-card-stat]"),
          ].map((stat) => stat.getAttribute("data-library-card-stat")),
          counts: [
            ...stats.querySelectorAll<HTMLElement>("[data-library-card-stat]"),
          ].map((stat) => Number(stat.textContent.match(/\d+$/)?.[0])),
          selected: el.querySelector("[data-query-item-row][data-selected]")
            ? "row"
            : null,
        };
      },
      { paperKey: paper.key },
    );
    expect(noPaper).toMatchObject({
      shown: true,
      prompt: run.m.library_view_card_empty(),
      selected: null,
    });
    const order = ["unread", "annotated", "has-note", "pdf"];
    expect(noPaper.stats.length).toBeGreaterThan(0);
    expect(noPaper.stats).toEqual(
      order.filter((name) => noPaper.stats.includes(name)),
    );
    for (const count of noPaper.counts) expect(count).toBeGreaterThan(0);

    // A click on the paper's row shows its card with a preview of its
    // Annotations: the first two quoted, the count of each colour, and "See
    // all", with no Annotation Card drawn.
    expect(
      await obRun(
        run.vaultId,
        async ({ app, page }, { paperKey }) => {
          const { press, until } = page;
          const leaf = (
            app.workspace.getLeavesOfType(
              "zotlit-library",
            ) as (WorkspaceLeaf & { view: LibraryView })[]
          )[0];
          await app.workspace.revealLeaf(leaf!);
          app.workspace.setActiveLeaf(leaf!, { focus: true });
          await leaf!.view.query.settled;
          const el = leaf!.view.contentEl;
          const card = el.querySelector<HTMLElement>("[data-library-card]");
          const row = (key: string) =>
            el.querySelector<HTMLElement>(`[data-query-item-row="${key}"]`);
          press(row(paperKey), "paper row");
          await until(
            "card",
            () =>
              card!.checkVisibility() &&
              card!.querySelector<HTMLElement>(
                '[data-library-card-toggle="annotations"]',
              ),
            10000,
          );
          await leaf!.view.card.settled;
          const toggle = card!.querySelector<HTMLElement>(
            '[data-library-card-toggle="annotations"]',
          );
          return {
            toggle: toggle!.textContent,
            expanded: toggle!.getAttribute("aria-expanded"),
            cards: card!.querySelectorAll<HTMLElement>(".zt-annot-card").length,
            quotes: card!.querySelectorAll<HTMLElement>(
              "[data-library-card-quote]",
            ).length,
            colours: [
              ...card!.querySelectorAll<HTMLElement>(
                "[data-library-card-colour]",
              ),
            ].reduce(
              (sum, n) => sum + Number(n.textContent.split(": ").at(-1)),
              0,
            ),
          };
        },
        { paperKey: paper.key },
      ),
    ).toEqual({
      toggle: run.m.library_view_card_see_all({ count: seededCards.length }),
      expanded: "false",
      cards: 0,
      quotes: Math.min(2, seededCards.length),
      colours: seededCards.length,
    });
    // Opened, the card shows the seeded fields and abstract, the row menu's
    // actions, and its Annotations as cards.
    const shown = (await obRun(
      run.vaultId,
      async ({ app, page }, { seededCardsLength }) => {
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
        const card = el.querySelector<HTMLElement>("[data-library-card]");

        press(
          card!.querySelector<HTMLElement>(
            '[data-library-card-toggle="annotations"]',
          ),
          "Annotations",
        );
        await until(
          "cards",
          () =>
            card!.querySelectorAll<HTMLElement>(".zt-annot-card").length >=
            seededCardsLength,
          10000,
        );
        await leaf!.view.card.settled;
        const part = (name: string) =>
          card!.querySelector<HTMLElement>(`[data-library-card-${name}]`)
            ?.textContent ?? null;
        return card!.checkVisibility()
          ? {
              title: part("title"),
              creators: part("creators"),
              venue: part("venue"),
              citationKey: part("citekey"),
              abstract: part("abstract"),
              actions: [
                ...card!.querySelectorAll<HTMLElement>(
                  "[data-library-card-action]",
                ),
              ].map((b) => b.textContent || b.getAttribute("aria-label")),
              cards: [
                ...card!.querySelectorAll<HTMLElement>(
                  ".zt-annot-card[data-zotero-annotation-key]",
                ),
              ]
                .map((n) => ({
                  key: n.getAttribute("data-zotero-annotation-key")!,
                  color: n.getAttribute("data-annot-color"),
                  page:
                    n.querySelector<HTMLElement>(".zt-annot-page-chip")
                      ?.textContent ?? null,
                  text: n.textContent,
                }))
                .toSorted((a, b) => a.key.localeCompare(b.key)),
            }
          : null;
      },
      { seededCardsLength: seededCards.length },
    )) as {
      title: string;
      creators: string;
      venue: string;
      citationKey: string;
      abstract: string;
      actions: string[];
      cards: { key: string; color: string; page: string; text: string }[];
    };
    expect({
      title: shown.title,
      creators: shown.creators,
      venue: shown.venue,
      citationKey: shown.citationKey,
      abstract: shown.abstract,
      actions: shown.actions,
    }).toEqual({
      title: paper.title,
      // The authors in full, and the Venue with the year.
      creators: authors.join(", "),
      venue: `${paper.venue} · ${paper.date}`,
      citationKey: paper.citationKey,
      abstract,
      // Two buttons; the rest of the row menu under More, and the sidebar
      // as an icon.
      actions: [
        run.m.library_view_menu_open_pdf(),
        run.m.library_view_menu_open_note(),
        run.m.library_view_card_more(),
        run.m.library_view_card_open_in_annot_view(),
      ],
    });
    expect(
      shown.cards.map(({ key, color, page }) => ({ key, color, page })),
    ).toEqual(
      seededCards.map(({ key, color, page }) => ({ key, color, page })),
    );
    // Each card shows its seeded comment.
    const commented = seededCards.filter(({ comment }) => comment);
    expect(commented.length).toBeGreaterThan(0);
    expect(
      commented.map(({ key, comment }) =>
        shown.cards.find((card) => card.key === key)!.text.includes(comment!),
      ),
    ).toEqual(commented.map(() => true));

    // With Zotero closed the Editing Capability is read-only: each card's
    // colour and tag verbs, and any comment field it shows, say they are
    // blocked, as in the sidebar.
    expect(
      JSON.parse(
        await obRun(
          run.vaultId,
          async ({ app, zotlit }, { annotationAttachmentKey }) => {
            const leaf = (
              app.workspace.getLeavesOfType(
                "zotlit-library",
              ) as (WorkspaceLeaf & { view: LibraryView })[]
            )[0];
            await app.workspace.revealLeaf(leaf!);
            app.workspace.setActiveLeaf(leaf!, { focus: true });
            await leaf!.view.query.settled;
            const el = leaf!.view.contentEl;
            const card = el.querySelector<HTMLElement>("[data-library-card]");

            return JSON.stringify({
              capability: zotlit.services.bridge.runSync(
                zotlit.services.annotationRepository.capabilityFor(
                  annotationAttachmentKey,
                ),
              ),
              blocked:
                [
                  ...card!.querySelectorAll<HTMLElement>(".zt-annot-card"),
                ].every(
                  (n) =>
                    n.querySelectorAll<HTMLElement>(
                      ".clickable-icon[data-blocked]",
                    ).length >= 2,
                ) &&
                [
                  ...card!.querySelectorAll<HTMLElement>(
                    ".zt-annot-comment-field[role=textbox]",
                  ),
                ].every((f) => f.hasAttribute("data-blocked")),
            });
          },
          { annotationAttachmentKey: annotationAttachment.key },
        ),
      ),
    ).toEqual({
      capability: { kind: "read-only", reason: "zotero-unavailable" },
      blocked: true,
    });

    // The buttons do what the row menu does: Insert citation, from the More
    // menu, into the note active last, Open literature note, Open PDF.
    const active = () => activeTab(run.vaultId);
    const activeWhen = (ready: (shown: ActiveTab) => boolean) =>
      readUntil(active, ready, { what: "Active tab", tries: 60 });
    await obRun(
      run.vaultId,
      async ({ app, page }, { libraryViewMenuInsertCitationLabel }) => {
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
        const card = el.querySelector<HTMLElement>("[data-library-card]");

        press(
          card!.querySelector<HTMLElement>('[data-library-card-action="more"]'),
          "More actions",
        );
        const item = await until("Insert citation", () =>
          [
            ...activeDocument.querySelectorAll<HTMLElement>(".menu .menu-item"),
          ].find(
            (n) =>
              n.querySelector<HTMLElement>(".menu-item-title")?.textContent ===
              libraryViewMenuInsertCitationLabel,
          ),
        );
        press(item, "Insert citation");
      },
      {
        libraryViewMenuInsertCitationLabel:
          run.m.library_view_menu_insert_citation(),
      },
    );
    expect(
      await waitFor(async () =>
        (
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
          )
        ).includes(`@${paper.citationKey}`),
      ),
    ).toBe(true);
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
        await leaf!.view.query.settled;
        const el = leaf!.view.contentEl;
        const card = el.querySelector<HTMLElement>("[data-library-card]");

        press(
          card!.querySelector<HTMLElement>('[data-library-card-action="note"]'),
          "Open literature note",
        );
      },
      undefined,
    );
    // Open PDF opens in the tab the note opened in, once that open is done.
    expect(
      await activeWhen(
        (state) =>
          state.type === "markdown" &&
          state.key === paper.key &&
          !state.opening,
      ),
    ).toMatchObject({ key: paper.key });
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
        await leaf!.view.query.settled;
        const el = leaf!.view.contentEl;
        const card = el.querySelector<HTMLElement>("[data-library-card]");

        press(
          card!.querySelector<HTMLElement>('[data-library-card-action="pdf"]'),
          "Open PDF",
        );
      },
      undefined,
    );
    await pdfOpened(run.vaultId, annotationAttachment.path!);

    // "Open in the annotation view" pins the paper in the sidebar Annotation View, which
    // lists its cards.
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
        await leaf!.view.query.settled;
        const el = leaf!.view.contentEl;
        const card = el.querySelector<HTMLElement>("[data-library-card]");

        press(
          card!.querySelector<HTMLElement>(
            '[data-library-card-action="sidebar"]',
          ),
          "Open in the annotation view",
        );
      },
      undefined,
    );
    await obRunUntil(
      run.vaultId,
      async ({ app }) => {
        const view = (
          app.workspace.getLeavesOfType(
            "zotero-annotation-view",
          ) as (WorkspaceLeaf & { view: AnnotView })[]
        )[0]?.view;
        if (!view) return "none";
        await view.read;
        return {
          pinned: view.getState().pinnedItemKey as string,
          cards: [
            ...view.contentEl.querySelectorAll<HTMLElement>(
              ".zt-annot-card[data-zotero-annotation-key]",
            ),
          ]
            .map((n) => n.getAttribute("data-zotero-annotation-key")!)
            .toSorted(),
        };
      },
      undefined,
      {
        ready: (value) =>
          isDeepStrictEqual(value, {
            pinned: paper.key,
            cards: seededCards.map(({ key }) => key),
          }),
        tries: 120,
        what: "the Annotation View to pin the PDF and list its seeded cards",
      },
    );

    // A narrow pane shows the card under the tree and the list, across the
    // whole pane, and a wide one beside the list; the row stays selected.
    cleanup.defer(async () => {
      await obRun(
        run.vaultId,
        async ({ page }) => {
          delete page.scratch.zotlitE2EBeside;
        },
        undefined,
      );
    });
    /** Give the Library View's tab `share` percent of the window; report where its card shows. */
    const placeCard = (share: number, below: boolean) =>
      obRun(
        run.vaultId,
        async ({ app, page }, { positionInput, condition, enabled }) => {
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
          const card = el.querySelector<HTMLElement>("[data-library-card]");
          const shell = el.querySelector<HTMLElement>("[data-library-shell]");
          // Under a narrow list the card spans the whole shell, under the
          // tree and the list together.
          const spans = () =>
            Math.abs(
              card!.getBoundingClientRect().width -
                shell!.getBoundingClientRect().width,
            ) < 2;
          // The sidebar closes over a moment; the tab's share of the window
          // sets the shell's width once it has closed.
          app.workspace.rightSplit.collapse();
          await until(
            "the right sidebar closed",
            () =>
              (
                app.workspace.rightSplit as WorkspaceSidedock & {
                  containerEl: HTMLElement;
                }
              ).containerEl.getBoundingClientRect().width === 0,
            5000,
          );
          const beside = (page.scratch.zotlitE2EBeside ??=
            app.workspace.createLeafBySplit(leaf!, "vertical"));
          (leaf!.parent as LibraryTabs).setDimension(positionInput);
          (beside.parent as LibraryTabs).setDimension(condition);
          await until(
            `card ${enabled ? "under" : "beside"} the list at ${el.clientWidth}px`,
            () => card!.checkVisibility() && spans() === enabled,
            5000,
          );
          return {
            card: card!.checkVisibility(),
            below: spans(),
            selected:
              el
                .querySelector<HTMLElement>(
                  "[data-query-item-row][data-selected]",
                )
                ?.getAttribute("data-query-item-row") ?? null,
          };
        },
        { positionInput: share, condition: 100 - share, enabled: below },
      );
    expect(await placeCard(30, true)).toEqual({
      card: true,
      below: true,
      selected: paper.key,
    });
    /** How the card lays out its parts: its width, and whether its first two sit side by side. */
    const cardColumns = () =>
      obRun(
        run.vaultId,
        async ({ app }) => {
          const card = (
            app.workspace.getLeavesOfType(
              "zotlit-library",
            ) as (WorkspaceLeaf & {
              view: LibraryView;
            })[]
          )[0]!.view.contentEl.querySelector<HTMLElement>(
            "[data-library-card]",
          );
          const columns = card!.querySelector<HTMLElement>(
            "[data-library-card-columns]",
          );
          const [one, two] = [...columns!.children].map((part) =>
            part.getBoundingClientRect(),
          );
          return {
            width: Math.round(card!.getBoundingClientRect().width),
            display: getComputedStyle(columns!).display,
            sideBySide: !!one && !!two && two.left > one.right,
          };
        },
        undefined,
      );
    // Under the list at 42rem wide or more, the card sets its parts in two
    // columns, side by side: half of the 1600px window is that wide and
    // still under 56rem, where the card moves beside the list.
    expect(await placeCard(50, true)).toMatchObject({ below: true });
    const twoColumns = await cardColumns();
    expect(twoColumns.width).toBeGreaterThanOrEqual(672);
    expect(twoColumns).toMatchObject({ display: "grid", sideBySide: true });
    expect(await placeCard(30, true)).toMatchObject({ below: true });
    /** Press the Details button; report once the card is `shown` and the button says so. */
    const pressDetails = (shown: boolean) =>
      obRun(
        run.vaultId,
        async ({ app, page }, { enabled }) => {
          const { press, until } = page;
          const leaf = (
            app.workspace.getLeavesOfType(
              "zotlit-library",
            ) as (WorkspaceLeaf & { view: LibraryView })[]
          )[0];
          await app.workspace.revealLeaf(leaf!);
          app.workspace.setActiveLeaf(leaf!, { focus: true });
          await leaf!.view.query.settled;
          const el = leaf!.view.contentEl;
          const card = el.querySelector<HTMLElement>("[data-library-card]");
          const toggle = () =>
            el.querySelector<HTMLElement>("[data-library-details-toggle]");
          press(toggle(), "Details");
          await until(
            `card ${enabled ? "shows" : "hides"} with the Details button ${enabled ? "pressed" : "released"}`,
            () =>
              card!.checkVisibility() === enabled &&
              toggle()?.getAttribute("aria-pressed") === String(enabled),
          );
          return {
            card: card!.checkVisibility(),
            pressed: toggle()!.getAttribute("aria-pressed"),
            selected:
              el
                .querySelector<HTMLElement>(
                  "[data-query-item-row][data-selected]",
                )
                ?.getAttribute("data-query-item-row") ?? null,
          };
        },
        { enabled: shown },
      );
    /** Click the row `key`; report once it is selected and the card is `shown`. */
    const clickRow = (key: string, shown: boolean) =>
      obRun(
        run.vaultId,
        async ({ app, page }, { rowKey, enabled }) => {
          const { press, until } = page;
          const leaf = (
            app.workspace.getLeavesOfType(
              "zotlit-library",
            ) as (WorkspaceLeaf & { view: LibraryView })[]
          )[0];
          await app.workspace.revealLeaf(leaf!);
          app.workspace.setActiveLeaf(leaf!, { focus: true });
          await leaf!.view.query.settled;
          const el = leaf!.view.contentEl;
          const card = el.querySelector<HTMLElement>("[data-library-card]");
          const row = el.querySelector<HTMLElement>(
            `[data-query-item-row="${rowKey}"]`,
          );
          press(row, `row ${rowKey}`);
          await until(
            `row ${rowKey} selected with the card ${enabled ? "shown" : "hidden"}`,
            () =>
              row!.hasAttribute("data-selected") &&
              card!.checkVisibility() === enabled,
          );
          return {
            card: card!.checkVisibility(),
            selected:
              el
                .querySelector<HTMLElement>(
                  "[data-query-item-row][data-selected]",
                )
                ?.getAttribute("data-query-item-row") ?? null,
          };
        },
        { rowKey: key, enabled: shown },
      );
    /** Press `key` where the focus is; report once `selected` is the selected row and the card is `shown`. */
    const keyOnList = (key: string, selected: string, shown: boolean) =>
      obRun(
        run.vaultId,
        async ({ app, page }, { keyName, selectedKey, enabled }) => {
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
          const card = el.querySelector<HTMLElement>("[data-library-card]");
          const selectedRow = () =>
            el
              .querySelector<HTMLElement>(
                "[data-query-item-row][data-selected]",
              )
              ?.getAttribute("data-query-item-row") ?? null;
          activeDocument.activeElement!.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: keyName,
              bubbles: true,
              cancelable: true,
            }),
          );
          await until(
            `card ${enabled ? "shown" : "hidden"} with row ${selectedKey} selected`,
            () =>
              card!.checkVisibility() === enabled &&
              selectedRow() === selectedKey,
          );
          return {
            card: card!.checkVisibility(),
            selected: selectedRow(),
            focused:
              activeDocument.activeElement?.getAttribute(
                "data-query-item-row",
              ) ?? null,
          };
        },
        { keyName: key, selectedKey: selected, enabled: shown },
      );
    /** The row after `key` on screen. */
    const rowAfter = async (key: string) =>
      (await obRun(
        run.vaultId,
        async ({ app }, { key }) => {
          const leaf = (
            app.workspace.getLeavesOfType(
              "zotlit-library",
            ) as (WorkspaceLeaf & { view: LibraryView })[]
          )[0];
          await app.workspace.revealLeaf(leaf!);
          app.workspace.setActiveLeaf(leaf!, { focus: true });
          await leaf!.view.query.settled;
          const el = leaf!.view.contentEl;
          const keys = [
            ...el.querySelectorAll<HTMLElement>("[data-query-item-row]"),
          ].map((n) => n.getAttribute("data-query-item-row")!);
          return keys[keys.indexOf(key) + 1] ?? null;
        },
        { key: key },
      )) as string;
    const next = await rowAfter(paper.key);
    expect(next).not.toBeNull();

    // Its close button turns the details off; the row stays selected and
    // takes the focus back, and the Details button is released.
    expect(
      await obRun(
        run.vaultId,
        async ({ app, page }) => {
          const { press, until } = page;
          const leaf = (
            app.workspace.getLeavesOfType(
              "zotlit-library",
            ) as (WorkspaceLeaf & { view: LibraryView })[]
          )[0];
          await app.workspace.revealLeaf(leaf!);
          app.workspace.setActiveLeaf(leaf!, { focus: true });
          await leaf!.view.query.settled;
          const el = leaf!.view.contentEl;
          const card = el.querySelector<HTMLElement>("[data-library-card]");

          press(
            card!.querySelector<HTMLElement>("[data-library-card-close]"),
            "Close",
          );
          await until("card hides", () => !card!.checkVisibility());
          return {
            selected:
              el
                .querySelector<HTMLElement>(
                  "[data-query-item-row][data-selected]",
                )
                ?.getAttribute("data-query-item-row") ?? null,
            focused:
              activeDocument.activeElement?.getAttribute(
                "data-query-item-row",
              ) ?? null,
            pressed:
              el
                .querySelector<HTMLElement>("[data-library-details-toggle]")
                ?.getAttribute("aria-pressed") ?? null,
          };
        },
        undefined,
      ),
    ).toEqual({ selected: paper.key, focused: paper.key, pressed: "false" });

    // On a narrow pane the Details button turns the card on and off, pressed
    // while it shows; with the details off a click on a row selects it and
    // shows no card.
    expect(await pressDetails(true)).toEqual({
      card: true,
      pressed: "true",
      selected: paper.key,
    });
    expect(await pressDetails(false)).toEqual({
      card: false,
      pressed: "false",
      selected: paper.key,
    });
    expect(await clickRow(next, false)).toEqual({
      card: false,
      selected: next,
    });
    expect(await pressDetails(true)).toEqual({
      card: true,
      pressed: "true",
      selected: next,
    });

    // With the details on, a click on a row shows its card, and the arrow
    // keys move the selection with the card still showing. Space on the
    // selected row turns the details off and on; Escape leaves them as
    // they are.
    expect(await clickRow(paper.key, true)).toEqual({
      card: true,
      selected: paper.key,
    });
    expect(await keyOnList("ArrowDown", next, true)).toEqual({
      card: true,
      selected: next,
      focused: next,
    });
    expect(await keyOnList(" ", next, false)).toEqual({
      card: false,
      selected: next,
      focused: next,
    });
    expect(await keyOnList(" ", next, true)).toEqual({
      card: true,
      selected: next,
      focused: next,
    });
    expect(await keyOnList("Escape", next, true)).toEqual({
      card: true,
      selected: next,
      focused: next,
    });
    // A double click on the paper's row, by the pointer, while the card
    // shows under the list, opens its PDF: the first click selects the row
    // and moves nothing.
    expect(
      await obRun(
        run.vaultId,
        async ({ app }, { paperKey }) => {
          const leaf = (
            app.workspace.getLeavesOfType(
              "zotlit-library",
            ) as (WorkspaceLeaf & { view: LibraryView })[]
          )[0];
          await app.workspace.revealLeaf(leaf!);
          app.workspace.setActiveLeaf(leaf!, { focus: true });
          await leaf!.view.query.settled;
          const el = leaf!.view.contentEl;
          const row = (key: string) =>
            el.querySelector<HTMLElement>(`[data-query-item-row="${key}"]`);
          const target = row(paperKey);
          target!.scrollIntoView({ block: "center", behavior: "instant" });
          const box = target!.getBoundingClientRect();
          const x = Math.round(box.right - 60),
            y = Math.round(box.top + box.height / 2);
          const hit = activeDocument.elementFromPoint(x, y);
          if (!target!.contains(hit) || hit!.closest<HTMLElement>("a, button"))
            throw new Error(
              `No plain part of the row at ${x},${y}: ${hit?.outerHTML.slice(0, 80)}`,
            );
          const zoom = require("electron").webFrame.getZoomFactor();
          const contents = require("@electron/remote").getCurrentWebContents();
          const at = {
            x: Math.round(x * zoom),
            y: Math.round(y * zoom),
            button: "left",
          };
          for (const clickCount of [1, 2]) {
            contents.sendInputEvent({ type: "mouseDown", ...at, clickCount });
            contents.sendInputEvent({ type: "mouseUp", ...at, clickCount });
          }
          return "double-clicked";
        },
        { paperKey: paper.key },
      ),
    ).toBe("double-clicked");
    await pdfOpened(run.vaultId, annotationAttachment.path!);
    // The keyboard that enters the list at its first row selects it, and
    // the card shows it. Selecting the node again lets go of the selection.
    const entered = await obRun(
      run.vaultId,
      async ({ app, page }) => {
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
        const card = el.querySelector<HTMLElement>("[data-library-card]");

        press(
          el.querySelector<HTMLElement>("[data-library-tree-toggle]"),
          "tree toggle",
        );
        press(
          await until("selected node", () =>
            el.querySelector<HTMLElement>(
              "[data-library-node][aria-selected=true]",
            ),
          ),
          "selected node",
        );
        await leaf!.view.searched;
        await leaf!.view.query.settled;
        await until(
          "no selection",
          () =>
            !el.querySelector<HTMLElement>(
              "[data-query-item-row][data-selected]",
            ),
        );
        const first = el.querySelector<HTMLElement>(
          '[data-query-item-row][tabindex="0"]',
        );
        first!.focus();
        await until("first row selected", () =>
          first!.hasAttribute("data-selected"),
        );
        return {
          card: card!.checkVisibility(),
          selected: el
            .querySelector<HTMLElement>("[data-query-item-row][data-selected]")!
            .getAttribute("data-query-item-row")!,
          focused:
            activeDocument.activeElement?.getAttribute("data-query-item-row") ??
            null,
          first: el
            .querySelector<HTMLElement>("[data-query-item-row]")!
            .getAttribute("data-query-item-row")!,
        };
      },
      undefined,
    );
    expect(entered).toEqual({
      card: true,
      selected: entered.first,
      focused: entered.first,
      first: entered.first,
    });
    // ↑ from the row after the paper goes back to the paper with its card;
    // a wide pane shows the card of the selected row beside the list.
    expect(await clickRow(next, true)).toEqual({
      card: true,
      selected: next,
    });
    expect(await keyOnList("ArrowUp", paper.key, true)).toEqual({
      card: true,
      selected: paper.key,
      focused: paper.key,
    });
    expect(await placeCard(90, false)).toEqual({
      card: true,
      below: false,
      selected: paper.key,
    });
    // Beside the list the card keeps one column.
    expect(await cardColumns()).toMatchObject({
      display: "flex",
      sideBySide: false,
    });
    // Beside a wide list the card follows the arrow keys.
    expect(await keyOnList("ArrowDown", next, true)).toEqual({
      card: true,
      selected: next,
      focused: next,
    });

    // While Zotero's data folder is missing the card goes with the list.
    const emptyDir = join(e2eFixture.root, "reading-card-not-found");
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
        return {
          missing:
            el.querySelector<HTMLElement>("[data-zotero-missing]") !== null,
          card: el
            .querySelector<HTMLElement>("[data-library-card]")!
            .checkVisibility(),
        };
      },
      undefined,
      {
        ready: (value) =>
          isDeepStrictEqual(value, { missing: true, card: false }),
        tries: 120,
        what: "the Library View missing-folder notice with the reading card hidden",
      },
    );
    await obRun(
      run.vaultId,
      async ({ zotlit }, { dataDir }) => {
        zotlit.services.bridge.runSync(
          zotlit.services.zoteroPref.setDataDir(dataDir),
        );
      },
      { dataDir: JSON.parse(snapshot).dataDir },
    );

    // Picking another node in the tree leaves no row selected, and the card
    // shows what fills it.
    expect(
      await obRun(
        run.vaultId,
        async ({ app, page }) => {
          const { press, until } = page;
          const leaf = (
            app.workspace.getLeavesOfType(
              "zotlit-library",
            ) as (WorkspaceLeaf & { view: LibraryView })[]
          )[0];
          await app.workspace.revealLeaf(leaf!);
          app.workspace.setActiveLeaf(leaf!, { focus: true });
          await leaf!.view.query.settled;
          const el = leaf!.view.contentEl;
          const card = el.querySelector<HTMLElement>("[data-library-card]");

          await until(
            "found",
            () =>
              el.querySelector<HTMLElement>("[data-zotero-missing]") === null,
            20000,
          );
          const recent = await until("recent", () =>
            el.querySelector<HTMLElement>("[data-library-node='[\"recent\"]']"),
          );
          if (!recent.checkVisibility())
            press(
              el.querySelector<HTMLElement>("[data-library-tree-toggle]"),
              "tree toggle",
            );
          press(recent, "Recent");
          await leaf!.view.searched;
          await leaf!.view.query.settled;
          const empty = await until("empty card", () =>
            card!.querySelector<HTMLElement>("[data-library-card-empty]"),
          );
          return {
            shown: card!.checkVisibility(),
            prompt: empty.querySelector("p")?.textContent ?? null,
            selected: el.querySelector("[data-query-item-row][data-selected]")
              ? "row"
              : null,
          };
        },
        undefined,
      ),
    ).toEqual({
      shown: true,
      prompt: run.m.library_view_card_empty(),
      selected: null,
    });
  }, 180000);

  it("shows a Literature Note's Item in the Library View from its command, the Cited By toolbar and a Library Link, and keeps the search when a link names no Item, with Zotero closed", async () => {
    const snapshot = await obRun(
      run.vaultId,
      ({ app, zotlit }) =>
        JSON.stringify({
          layout: app.workspace.getLayout(),
          document:
            zotlit.services.bridge.runSync(zotlit.services.settings.current)[
              "library.document"
            ] ?? null,
        }),
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
        { snapshot },
      );
    });
    const paper = annotationItem;
    const notePath = "literatures/rougierTenSimpleRules2014.md";
    /** Close the Library View, and open the note in the active tab. */
    const openNote = () =>
      obRun(
        run.vaultId,
        async ({ app }, { notepath }) => {
          for (const leaf of app.workspace.getLeavesOfType("zotlit-library"))
            leaf.detach();
          const leaf =
            app.workspace.getLeavesOfType("markdown")[0] ??
            app.workspace.getLeaf("tab");
          await leaf.openFile(app.vault.getFileByPath(notepath)!);
          app.workspace.setActiveLeaf(leaf, { focus: true });
        },
        { notepath: notePath },
      );
    /** Wait until the Library View selects the paper's row. */
    const shownInLibrary = (what: string) =>
      obRunUntil(
        run.vaultId,
        async ({ app }, { key }) => {
          const view = (
            app.workspace.getLeavesOfType(
              "zotlit-library",
            ) as (WorkspaceLeaf & {
              view: LibraryView;
            })[]
          )[0]?.view;
          if (!view?.query) return false;
          await view.query.settled;
          return view.selected.key === key;
        },
        { key: paper.key },
        { what },
      );

    // The command, on the active Literature Note.
    await openNote();
    expect(
      await obRun(run.vaultId, ({ app }) =>
        app.commands.executeCommandById("zotlit:show-in-library"),
      ),
    ).toBe(true);
    await shownInLibrary("the command shows the paper");

    // The Cited By toolbar, for the same note, open in the sidebar.
    await obRun(run.vaultId, async ({ app }) => {
      let leaf = app.workspace.getLeavesOfType("zotlit-cited-by")[0];
      if (!leaf) {
        leaf = app.workspace.getRightLeaf(false)!;
        await leaf.setViewState({ type: "zotlit-cited-by" });
      }
      await app.workspace.revealLeaf(leaf);
      await leaf.loadIfDeferred();
    });
    await openNote();
    await obRunUntil(
      run.vaultId,
      ({ app }) => {
        const button = app.workspace
          .getLeavesOfType("zotlit-cited-by")
          .map((leaf) =>
            leaf.view.containerEl?.querySelector<HTMLElement>(
              "[data-cited-by-show-in-library]",
            ),
          )
          .find(Boolean);
        button?.click();
        return !!button;
      },
      undefined,
      { what: "the Cited By toolbar's Show in Library button" },
    );
    await shownInLibrary("Cited By shows the paper");

    // The Library Link `zt.librarylink` writes, through Obsidian's handler.
    await openNote();
    await obRun(
      run.vaultId,
      ({ app }, { key }) => {
        app.workspace.protocolHandler.handlers.get("zotlit/show-in-library")!({
          action: "zotlit/show-in-library",
          "item-key": key,
        });
      },
      { key: paper.key },
    );
    await shownInLibrary("the Library Link shows the paper");

    // A link to an Item no Library holds keeps the search and says so.
    await obRun(run.vaultId, async ({ app }) => {
      const view = (
        app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
          view: LibraryView;
        })[]
      )[0]!.view;
      const input = view.contentEl.querySelector<HTMLInputElement>(
        "[data-library-search] input",
      )!;
      input.value = "figures";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await view.searched;
      await view.query.settled;
      app.workspace.protocolHandler.handlers.get("zotlit/show-in-library")!({
        action: "zotlit/show-in-library",
        "item-key": "QQQQQQQQ",
      });
    });
    expect(
      await obRunUntil(
        run.vaultId,
        ({ app }) => {
          const view = (
            app.workspace.getLeavesOfType(
              "zotlit-library",
            ) as (WorkspaceLeaf & {
              view: LibraryView;
            })[]
          )[0]!.view;
          return {
            search:
              view.contentEl.querySelector<HTMLInputElement>(
                "[data-library-search] input",
              )?.value ?? null,
            notice: [...activeDocument.querySelectorAll(".notice")].some((el) =>
              el.textContent?.includes("not found in your libraries"),
            ),
          };
        },
        undefined,
        {
          what: "the not-found notice",
          ready: (value) => value.notice,
        },
      ),
    ).toEqual({ search: "figures", notice: true });
  }, 180000);

  it("shows the Reading Card's Open PDF and Write literature note buttons without a scroll when a paper is selected under the setup steps in a 1440 × 860 window", async () => {
    const snapshot = await obRun(
      run.vaultId,
      ({ app, zotlit }) => {
        const settings = zotlit.services.bridge.runSync(
          zotlit.services.settings.current,
        );
        return JSON.stringify({
          layout: app.workspace.getLayout(),
          size: (
            require("@electron/remote") as {
              getCurrentWindow(): { getSize(): [number, number] };
            }
          )
            .getCurrentWindow()
            .getSize(),
          settings: {
            "library.document": settings["library.document"] ?? null,
            "welcome.dismissed": settings["welcome.dismissed"],
            "welcome.requested": settings["welcome.requested"],
          },
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
          bridge.runSync(settings.update(saved.settings));
          await bridge.runPromise(settings.flush);
          (
            require("@electron/remote") as {
              getCurrentWindow(): { setSize(w: number, h: number): void };
            }
          )
            .getCurrentWindow()
            .setSize(saved.size[0], saved.size[1]);
          await app.workspace.changeLayout(saved.layout);
        },
        { snapshot },
      );
    });
    // A first run (aidenlx/zotlit#1984): the setup steps show above a new
    // Library View, in the window the /learn course is recorded in.
    await obRun(
      run.vaultId,
      async ({ zotlit }) => {
        (
          require("@electron/remote") as {
            getCurrentWindow(): { setSize(w: number, h: number): void };
          }
        )
          .getCurrentWindow()
          .setSize(1440, 860);
        const { settings, bridge } = zotlit.services;
        bridge.runSync(
          settings.update({
            "library.document": null,
            "welcome.dismissed": false,
            "welcome.requested": true,
          }),
        );
        await bridge.runPromise(settings.flush);
      },
      undefined,
    );
    const shown = await obRun(
      run.vaultId,
      async ({ app, page }, { key, search }) => {
        for (const leaf of app.workspace.getLeavesOfType("zotlit-library"))
          leaf.detach();
        app.commands.executeCommandById("zotlit:open-library-view");
        const leaf = await page.until(
          "the Library View",
          () =>
            (
              app.workspace.getLeavesOfType(
                "zotlit-library",
              ) as (WorkspaceLeaf & {
                view: LibraryView;
              })[]
            )[0],
          30000,
        );
        const el = leaf.view.contentEl;
        await leaf.view.query.settled;
        await page.until(
          "the setup steps",
          () => el.querySelector("[data-welcome-step]"),
          10000,
        );
        const input = el.querySelector<HTMLInputElement>(
          "[data-library-search] input",
        )!;
        input.focus();
        input.value = search;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        await leaf.view.searched;
        await leaf.view.query.settled;
        page.press(
          await page.until(
            "the paper's row",
            () =>
              el.querySelector<HTMLElement>(`[data-query-item-row="${key}"]`),
            10000,
          ),
          "the paper's row",
        );
        const card = await page.until(
          "the Reading Card",
          () =>
            el.querySelector<HTMLElement>(
              '[data-library-card] [data-library-card-action="note"]',
            ) && el.querySelector<HTMLElement>("[data-library-card]"),
          10000,
        );
        await leaf.view.card.settled;
        const tab = el.getBoundingClientRect();
        return {
          width: window.innerWidth,
          height: window.innerHeight,
          stacked:
            card.getBoundingClientRect().top >=
            el.querySelector("[data-query-item-row]")!.getBoundingClientRect()
              .bottom,
          inView: Object.fromEntries(
            ["pdf", "note"].map((action) => {
              const button = card.querySelector<HTMLElement>(
                `[data-library-card-action="${action}"]`,
              )!;
              const b = button.getBoundingClientRect();
              return [action, b.top >= tab.top && b.bottom <= tab.bottom];
            }),
          ),
        };
      },
      {
        key: annotationItem.key,
        search: annotationItem.title.split(" ").slice(0, 3).join(" "),
      },
      { timeoutMs: 90000 },
    );
    expect(shown).toEqual({
      width: 1440,
      height: 860,
      // The tab is narrow, so the card sits under the list.
      stacked: true,
      inView: { pdf: true, note: true },
    });
  }, 180000);

  it("offers a PDF view's literature note only where its Zotero Attachment has a parent Item, writes the note from the header action through Profile selection for a PDF in Zotero storage, opens it beside the PDF, then names the action Open literature note, brings the same tab forward from the action, the command and More options, and names it Write literature note again once the note is gone", async () => {
    // A PDF in Zotero's storage folder, outside the vault, as a new user's are.
    const pdf = ATTACHMENTS.find(({ key }) => key === "IANPDF25")!;
    expect(pdf.linkMode).toBe("imported_file");
    const itemKey = ITEMS.find(
      ({ itemID }) => itemID === pdf.parentItemID,
    )!.key;
    // A PDF in the vault that no Zotero Attachment keeps.
    const loosePdf = "attachments/excerpt-acceptance/excerpt-rendering.pdf";
    const write = run.m.library_view_menu_write_note();
    const open = run.m.library_view_menu_open_note();
    const labels = [write, open];

    const saved = await obRun(
      run.vaultId,
      async ({ app }, { key }) => {
        const note = app.vault
          .getMarkdownFiles()
          .find(
            (file) =>
              app.metadataCache.getFileCache(file)?.frontmatter?.[
                "zotero-key"
              ] === key,
          )!;
        return {
          layout: JSON.stringify(app.workspace.getLayout()),
          path: note.path,
          source: await app.vault.read(note),
        };
      },
      { key: itemKey },
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obRun(
        run.vaultId,
        async ({ app }, { saved, key }) => {
          for (const file of app.vault.getMarkdownFiles())
            if (
              app.metadataCache.getFileCache(file)?.frontmatter?.[
                "zotero-key"
              ] === key
            )
              await app.vault.delete(file);
          await app.vault.create(saved.path, saved.source);
          await app.workspace.changeLayout(JSON.parse(saved.layout));
        },
        { saved, key: itemKey },
      );
    });

    // The PDF no Attachment keeps carries no control once it has resolved.
    await obRun(
      run.vaultId,
      async ({ app }, { path }) => {
        const leaf = app.workspace.getLeaf("tab");
        await leaf.openFile(app.vault.getFileByPath(path)!);
        app.workspace.setActiveLeaf(leaf, { focus: true });
      },
      { path: loosePdf },
    );
    expect(
      await obRunUntil(
        run.vaultId,
        async ({ app, zotlit }, { path, labels }) => {
          const leaf = app.workspace
            .getLeavesOfType("pdf")
            .find((leaf) => leaf.getViewState().state?.file === path)!;
          app.workspace.setActiveLeaf(leaf, { focus: true });
          const binding = zotlit.services.bridge.runSync(
            zotlit.services.pdfAnnotationEditor.bindingFor(leaf.view),
          );
          if (!binding || binding.attachment.kind === "pending") return null;
          const shown = [
            ...leaf.view.containerEl.querySelectorAll<HTMLElement>(
              ".view-action",
            ),
          ].filter(
            (el) =>
              labels.includes(el.getAttribute("aria-label") ?? "") &&
              el.style.display !== "none",
          ).length;
          // What the command palette asks before it lists the command.
          const command =
            app.commands.commands["zotlit:open-pdf-literature-note"]!
              .checkCallback!(true);
          return { kind: binding.attachment.kind, shown, command };
        },
        { path: loosePdf, labels },
        {
          what: "the loose PDF's binding to resolve",
          ready: (value) => value !== null,
        },
      ),
    ).toEqual({ kind: "unresolved", shown: 0, command: false });

    // The paper has no literature note yet, and its PDF is the only tab.
    await obRun(
      run.vaultId,
      async ({ app, zotlit }, { path, attachmentKey }) => {
        await app.vault.delete(app.vault.getFileByPath(path)!);
        const tab = app.workspace.getLeaf("tab");
        app.workspace.setActiveLeaf(tab, { focus: true });
        for (const leaf of [
          ...app.workspace.getLeavesOfType("pdf"),
          ...app.workspace.getLeavesOfType("markdown"),
        ])
          leaf.detach();
        // The PDF takes the empty tab, the active leaf.
        return await zotlit.services.bridge.runPromise(
          zotlit.services.targetOpener.open(
            { kind: "attachment", attachmentKey },
            false,
          ),
        );
      },
      { path: saved.path, attachmentKey: pdf.key },
    ).then((outcome) => expect(outcome).toEqual({ kind: "reader" }));

    /** The header action's label once it reads `expected`. */
    const actionLabel = (expected: string) =>
      actionLabelUntil(expected).catch(async (error: unknown) => {
        const state = await obRun(
          run.vaultId,
          async ({ app, zotlit }) => {
            return JSON.stringify(
              app.workspace.getLeavesOfType("pdf").map((leaf) => ({
                file: leaf.getViewState().state?.file,
                target:
                  zotlit.services.bridge.runSync(
                    zotlit.services.pdfAnnotationEditor.bindingFor(leaf.view),
                  )?.session.target ?? null,
                actions: [
                  ...leaf.view.containerEl.querySelectorAll<HTMLElement>(
                    ".view-action",
                  ),
                ].map((el) => [
                  el.getAttribute("aria-label"),
                  el.style.display,
                ]),
              })),
            );
          },
          undefined,
        );
        throw new Error(`PDF views: ${state}`, { cause: error });
      });
    const actionLabelUntil = (expected: string) =>
      obRunUntil(
        run.vaultId,
        async ({ app, zotlit }, { attachmentKey, labels }) => {
          const leaf = app.workspace
            .getLeavesOfType("pdf")
            .find(
              (leaf) =>
                zotlit.services.bridge.runSync(
                  zotlit.services.pdfAnnotationEditor.bindingFor(leaf.view),
                )?.session.target?.attachmentKey === attachmentKey,
            );
          const action = [
            ...(leaf?.view.containerEl.querySelectorAll<HTMLElement>(
              ".view-action",
            ) ?? []),
          ].find((el) => labels.includes(el.getAttribute("aria-label") ?? ""));
          return action && action.style.display !== "none"
            ? action.getAttribute("aria-label")
            : null;
        },
        { attachmentKey: pdf.key, labels },
        {
          what: `the PDF view's header action to read ${expected}`,
          ready: (label) => label === expected,
          tries: 120,
        },
      );
    /**
     * Makes the PDF view active, then runs `gesture` on it: a press of the
     * header action, the command, or the More options entry.
     */
    const onPdf = (gesture: "action" | "command" | "menu", label: string) =>
      obRun(
        run.vaultId,
        async ({ app, zotlit, page }, { attachmentKey, gesture, label }) => {
          const leaf = app.workspace
            .getLeavesOfType("pdf")
            .find(
              (leaf) =>
                zotlit.services.bridge.runSync(
                  zotlit.services.pdfAnnotationEditor.bindingFor(leaf.view),
                )?.session.target?.attachmentKey === attachmentKey,
            )!;
          app.workspace.setActiveLeaf(leaf, { focus: true });
          const { containerEl } = leaf.view;
          if (gesture === "command")
            return app.commands.executeCommandById(
              "zotlit:open-pdf-literature-note",
            );
          if (gesture === "action") {
            page.press(
              containerEl.querySelector<HTMLElement>(
                `.view-action[aria-label="${label}"]`,
              ),
              label,
            );
            return true;
          }
          page.press(
            containerEl.querySelector<HTMLElement>(
              '.view-action[aria-label="More options"]',
            ),
            "More options",
          );
          await page.menuReady();
          const entry = [
            ...activeDocument.body.querySelectorAll<HTMLElement>(
              ":scope > .menu .menu-item",
            ),
          ].find(
            (item) =>
              item.querySelector(".menu-item-title")?.textContent === label,
          );
          if (!entry) {
            activeDocument.body.dispatchEvent(
              new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
            );
            return false;
          }
          entry.click();
          return true;
        },
        { attachmentKey: pdf.key, gesture, label },
      );
    /**
     * The tabs that show the paper's note once one of them is active, which
     * the gesture before it causes: the PDF was active as it ran.
     */
    const panes = (what: string) =>
      obRunUntil(
        run.vaultId,
        async ({ app, zotlit }, { attachmentKey, key }) => {
          const pdfLeaf = app.workspace
            .getLeavesOfType("pdf")
            .find(
              (leaf) =>
                zotlit.services.bridge.runSync(
                  zotlit.services.pdfAnnotationEditor.bindingFor(leaf.view),
                )?.session.target?.attachmentKey === attachmentKey,
            )!;
          const notes = app.workspace
            .getLeavesOfType("markdown")
            .filter(
              (leaf) =>
                app.metadataCache.getCache(
                  String(leaf.getViewState().state?.file),
                )?.frontmatter?.["zotero-key"] === key,
            );
          if (!notes.includes(app.workspace.activeLeaf!)) return null;
          return {
            notes: notes.length,
            noteShown: notes.every((leaf) => leaf.view.containerEl.isShown()),
            besidePdf: notes.every((leaf) => leaf.parent !== pdfLeaf.parent),
            pdfShown: pdfLeaf.view.containerEl.isShown(),
          };
        },
        { attachmentKey: pdf.key, key: itemKey },
        { what, ready: (value) => value !== null, tries: 120 },
      );
    const oneNoteBeside = {
      notes: 1,
      noteShown: true,
      besidePdf: true,
      pdfShown: true,
    };

    expect(await actionLabel(write)).toBe(write);
    expect(await onPdf("action", write)).toBe(true);
    await selectSuggestion(run.vaultId, run.m.modal_profile_preselected());
    await pressPromptKey(run.vaultId, "Enter");
    expect(await panes("the written note to open beside the PDF")).toEqual(
      oneNoteBeside,
    );
    expect(await actionLabel(open)).toBe(open);

    // Each gesture brings the same tab forward and opens no other.
    expect(await onPdf("action", open)).toBe(true);
    expect(await panes("the action to bring the note forward")).toEqual(
      oneNoteBeside,
    );
    expect(await onPdf("command", open)).toBe(true);
    expect(await panes("the command to bring the note forward")).toEqual(
      oneNoteBeside,
    );
    expect(await onPdf("menu", open)).toBe(true);
    expect(await panes("More options to bring the note forward")).toEqual(
      oneNoteBeside,
    );

    // Once the note is gone, the action offers to write it again.
    await obRun(
      run.vaultId,
      async ({ app }, { key }) => {
        for (const file of app.vault.getMarkdownFiles())
          if (
            app.metadataCache.getFileCache(file)?.frontmatter?.[
              "zotero-key"
            ] === key
          )
            await app.vault.delete(file);
      },
      { key: itemKey },
    );
    expect(await actionLabel(write)).toBe(write);
  }, 180000);
});
