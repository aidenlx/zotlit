import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { WorkspaceLeaf, MarkdownView } from "obsidian";
import { describe, expect, it } from "vitest";

import { ATTACHMENTS } from "@zotlit/scripts/fixture";

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
import * as suite from "./e2e-run-suite-helpers.ts";
import { obRun, obRunUntil } from "./obsidian-cli.ts";
import { readUntil, waitFor } from "./obsidian-cli.ts";
import type { LibraryTabs } from "./page-library-types.ts";
import type {} from "./page-library-types.ts";

describe.skipIf(!reachable)("End-to-end Run", () => {
  registerEndToEndRunHooks();

  it("shows the selected row's Reading Card with its seeded fields, abstract and, once opened, Annotation Cards under the Editing Capability, runs the row menu's actions from its buttons, opens its Annotations in the sidebar, shows it over the list on a narrow pane on a click or Space and puts it away on Escape, keeps a double click on the row for the PDF, selects the row the keyboard enters the list at, shows it beside a wide list as the arrow keys move, and hides it with no selection and while Zotero's data folder is missing", async () => {
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
      .toSorted((a, b) => a.key.localeCompare(b.key!));
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

    // No row is selected: the card is out of view.
    expect(
      await obRun(
        run.vaultId,
        async ({ app, page }, { paperKey }) => {
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
          const row = (key: string) =>
            el.querySelector<HTMLElement>(`[data-query-item-row="${key}"]`);
          await until("rows", () => row(paperKey), 10000);
          const part = (name: string) =>
            card!.querySelector<HTMLElement>(`[data-library-card-${name}]`)
              ?.textContent ?? null;
          return JSON.stringify(
            card!.checkVisibility()
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
                    .toSorted((a, b) => a.key!.localeCompare(b.key!)),
                }
              : null,
          );
        },
        { paperKey: paper.key },
      ),
    ).toBe("null");

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
                .toSorted((a, b) => a.key!.localeCompare(b.key!)),
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

    // A narrow pane shows the card over the list, and a wide one beside it;
    // the row stays selected.

    cleanup.defer(async () => {
      await obRun(
        run.vaultId,
        async ({ page }) => {
          delete page.scratch.zotlitE2EBeside;
        },
        undefined,
      );
    });
    expect(
      await obRun(
        run.vaultId,
        async (
          { app, page },
          { positionInput, condition, choice, enabled },
        ) => {
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

          app.workspace.rightSplit.collapse();
          const beside = (page.scratch.zotlitE2EBeside ??=
            app.workspace.createLeafBySplit(leaf!, "vertical"));
          (leaf!.parent as LibraryTabs).setDimension(positionInput);
          (beside.parent as LibraryTabs).setDimension(condition);
          await until(
            `card ${choice} the list at ${el.clientWidth}px`,
            () =>
              card!.checkVisibility() &&
              (getComputedStyle(card!).position === "absolute") === enabled,
            5000,
          );
          return {
            card: card!.checkVisibility(),
            over: getComputedStyle(card!).position === "absolute",
            selected:
              el
                .querySelector<HTMLElement>(
                  "[data-query-item-row][data-selected]",
                )
                ?.getAttribute("data-query-item-row") ?? null,
          };
        },
        {
          positionInput: 30,
          condition: 100 - 30,
          choice: "over",
          enabled: true,
        },
      ),
    ).toEqual({
      card: true,
      over: true,
      selected: paper.key,
    });
    // Its close button puts it away; the row stays selected and takes the
    // focus back.
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
          };
        },
        undefined,
      ),
    ).toEqual({ selected: paper.key, focused: paper.key });
    // The arrow keys move the selection and leave the list uncovered; Space
    // on the selected row opens its card over the list, and Escape on the
    // row puts it away.
    /** Press `key` where the focus is; report once the card shows or hides. */

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
          el.querySelector<HTMLElement>("[data-library-card]");

          const keys = [
            ...el.querySelectorAll<HTMLElement>("[data-query-item-row]"),
          ].map((n) => n.getAttribute("data-query-item-row")!);
          return keys[keys.indexOf(key) + 1] ?? null;
        },
        { key: key },
      )) as string;
    // Over the list, a click waits out a double click before it opens the
    // card.
    await obRun(
      run.vaultId,
      async ({ app, page }, { paperKey }) => {
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
        const row = (key: string) =>
          el.querySelector<HTMLElement>(`[data-query-item-row="${key}"]`);
        press(row(paperKey), "paper row");
        await until("card", () => card!.checkVisibility());
      },
      { paperKey: paper.key },
    );
    const next = await rowAfter(paper.key);
    expect(next).not.toBeNull();
    expect(
      await obRun(
        run.vaultId,
        async ({ app, page }, { arrowDown, choice, enabled }) => {
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

          activeDocument.activeElement!.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: arrowDown,
              bubbles: true,
              cancelable: true,
            }),
          );
          await until(
            `card ${choice}`,
            () => card!.checkVisibility() === enabled,
          );
          return {
            card: card!.checkVisibility(),
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
          };
        },
        { arrowDown: "ArrowDown", choice: "hides", enabled: false },
      ),
    ).toEqual({
      card: false,
      selected: next,
      focused: next,
    });
    expect(
      await obRun(
        run.vaultId,
        async ({ app, page }, { text, choice, enabled }) => {
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

          activeDocument.activeElement!.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: text,
              bubbles: true,
              cancelable: true,
            }),
          );
          await until(
            `card ${choice}`,
            () => card!.checkVisibility() === enabled,
          );
          return {
            card: card!.checkVisibility(),
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
          };
        },
        { text: " ", choice: "shows", enabled: true },
      ),
    ).toEqual({
      card: true,
      selected: next,
      focused: next,
    });
    expect(
      await obRun(
        run.vaultId,
        async ({ app, page }, { escape, choice, enabled }) => {
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

          activeDocument.activeElement!.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: escape,
              bubbles: true,
              cancelable: true,
            }),
          );
          await until(
            `card ${choice}`,
            () => card!.checkVisibility() === enabled,
          );
          return {
            card: card!.checkVisibility(),
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
          };
        },
        { escape: "Escape", choice: "hides", enabled: false },
      ),
    ).toEqual({
      card: false,
      selected: next,
      focused: next,
    });
    // A double click on the paper's row, by the pointer, where the card
    // goes over the list, opens its PDF: the first click leaves the row
    // uncovered for the second.
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
          el.querySelector<HTMLElement>("[data-library-card]");
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
    // The keyboard that enters the list at its first row selects it, with
    // no card, so Space opens its card. Selecting the node again lets go of
    // the selection.
    const entered = (await obRun(
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
    )) as {
      card: boolean;
      selected: string;
      focused: string | null;
      first: string;
    };
    expect(entered).toEqual({
      card: false,
      selected: entered.first,
      focused: entered.first,
      first: entered.first,
    });
    expect(
      await obRun(
        run.vaultId,
        async ({ app, page }, { text, choice, enabled }) => {
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

          activeDocument.activeElement!.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: text,
              bubbles: true,
              cancelable: true,
            }),
          );
          await until(
            `card ${choice}`,
            () => card!.checkVisibility() === enabled,
          );
          return {
            card: card!.checkVisibility(),
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
          };
        },
        { text: " ", choice: "shows", enabled: true },
      ),
    ).toEqual({
      card: true,
      selected: entered.first,
      focused: entered.first,
    });
    expect(
      await obRun(
        run.vaultId,
        async ({ app, page }, { escape, choice, enabled }) => {
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

          activeDocument.activeElement!.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: escape,
              bubbles: true,
              cancelable: true,
            }),
          );
          await until(
            `card ${choice}`,
            () => card!.checkVisibility() === enabled,
          );
          return {
            card: card!.checkVisibility(),
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
          };
        },
        { escape: "Escape", choice: "hides", enabled: false },
      ),
    ).toMatchObject({
      card: false,
    });
    // Back to the card of the row after the paper.
    await obRun(
      run.vaultId,
      async ({ app, page }, { next }) => {
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
        const row = (key: string) =>
          el.querySelector<HTMLElement>(`[data-query-item-row="${key}"]`);
        press(row(next), "row after the paper");
        await until("card", () => card!.checkVisibility());
      },
      { next: next },
    );
    // ↑ goes back to the paper and puts its card away; a wide pane shows
    // the card of the selected row beside the list.
    expect(
      await obRun(
        run.vaultId,
        async ({ app, page }, { arrowUp, choice, enabled }) => {
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

          activeDocument.activeElement!.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: arrowUp,
              bubbles: true,
              cancelable: true,
            }),
          );
          await until(
            `card ${choice}`,
            () => card!.checkVisibility() === enabled,
          );
          return {
            card: card!.checkVisibility(),
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
          };
        },
        { arrowUp: "ArrowUp", choice: "hides", enabled: false },
      ),
    ).toEqual({
      card: false,
      selected: paper.key,
      focused: paper.key,
    });
    expect(
      await obRun(
        run.vaultId,
        async (
          { app, page },
          { positionInput, condition, choice, enabled },
        ) => {
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

          app.workspace.rightSplit.collapse();
          const beside = (page.scratch.zotlitE2EBeside ??=
            app.workspace.createLeafBySplit(leaf!, "vertical"));
          (leaf!.parent as LibraryTabs).setDimension(positionInput);
          (beside.parent as LibraryTabs).setDimension(condition);
          await until(
            `card ${choice} the list at ${el.clientWidth}px`,
            () =>
              card!.checkVisibility() &&
              (getComputedStyle(card!).position === "absolute") === enabled,
            5000,
          );
          return {
            card: card!.checkVisibility(),
            over: getComputedStyle(card!).position === "absolute",
            selected:
              el
                .querySelector<HTMLElement>(
                  "[data-query-item-row][data-selected]",
                )
                ?.getAttribute("data-query-item-row") ?? null,
          };
        },
        {
          positionInput: 90,
          condition: 100 - 90,
          choice: "beside",
          enabled: false,
        },
      ),
    ).toEqual({
      card: true,
      over: false,
      selected: paper.key,
    });
    // Beside a wide list the card follows the arrow keys.
    expect(
      await obRun(
        run.vaultId,
        async ({ app, page }, { arrowDown, choice, enabled }) => {
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

          activeDocument.activeElement!.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: arrowDown,
              bubbles: true,
              cancelable: true,
            }),
          );
          await until(
            `card ${choice}`,
            () => card!.checkVisibility() === enabled,
          );
          return {
            card: card!.checkVisibility(),
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
          };
        },
        { arrowDown: "ArrowDown", choice: "shows", enabled: true },
      ),
    ).toEqual({
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
    // goes.
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
          const part = (name: string) =>
            card!.querySelector<HTMLElement>(`[data-library-card-${name}]`)
              ?.textContent ?? null;
          return JSON.stringify(
            card!.checkVisibility()
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
                    .toSorted((a, b) => a.key!.localeCompare(b.key!)),
                }
              : null,
          );
        },
        undefined,
      ),
    ).toBe("null");
  }, 180000);
});
