import { isDeepStrictEqual } from "node:util";
import { describe, expect, it } from "vitest";

import { ATTACHMENTS, ITEMS, LIBRARIES, NOTES } from "@zotlit/scripts/fixture";

import { annotationOpenKeys } from "./annotation-open-subpath.ts";
import { reachable } from "./e2e-run-fixture.ts";
import {
  annotationAttachment,
  booksProfile,
  booksProfileTargetItem,
  positionDocumentItem,
} from "./e2e-run-fixture.ts";
import { registerEndToEndRunHooks, run } from "./e2e-run-lifecycle.ts";
import { pressPromptKey, selectSuggestion } from "./e2e-run-note-helpers.ts";
import type { ItemQueryReport } from "./e2e-run-query-types.ts";
import { obRun } from "./obsidian-cli.ts";
import { obRunUntil } from "./obsidian-cli.ts";
import { cliCommand, waitFor } from "./obsidian-cli.ts";
import { raiseWindow } from "./reader-gestures.ts";
describe.skipIf(!reachable)("End-to-end Run", () => {
  registerEndToEndRunHooks();

  it("switches a Fixture Query File view to Items and the Table, expands an Item into its Attachments, Annotations and Child Notes, and creates a Literature Note from its column", async () => {
    const path = "query-files/Reading annotations.zotquery";
    const layout = await obRun(
      run.vaultId,
      async ({ app }) => {
        return JSON.stringify(app.workspace.getLayout());
      },
      undefined,
    );
    const original = await obRun(
      run.vaultId,
      async ({ app }, { path }) => {
        return await app.vault.read(app.vault.getFileByPath(path)!);
      },
      { path },
    );
    const created: string[] = [];
    await using cleanup = new AsyncDisposableStack();
    // The tab closes before the text goes back, so no pending save of the
    // tab writes over it.
    cleanup.defer(async () => {
      // Teardown closes a popover a failed step left open; not a reader's press.
      await obRun(
        run.vaultId,
        async ({ app }, { filePath, original, created, layout }) => {
          for (const popup of activeDocument.querySelectorAll<HTMLElement>(
            "[popover]:popover-open",
          ))
            popup.hidePopover();
          for (const leaf of app.workspace.getLeavesOfType("zotlit-query-file"))
            leaf.detach();
          await app.vault.modify(app.vault.getFileByPath(filePath)!, original);
          for (const path of created) {
            const file = app.vault.getFileByPath(path)!;
            if (file) await app.vault.delete(file);
          }
          await app.workspace.changeLayout(JSON.parse(layout));
        },
        { filePath: path, original, created, layout },
      );
    });

    await obRun(
      run.vaultId,
      async ({ app }, { path }) => {
        const leaf = app.workspace.getLeaf("tab");
        await leaf.openFile(app.vault.getFileByPath(path)!);
        app.workspace.setActiveLeaf(leaf, { focus: true });
      },
      { path },
    );
    await obRunUntil(
      run.vaultId,
      async ({ app }) => {
        const view = app.workspace.getMostRecentLeaf()!.view;
        if (view.getViewType() !== "zotlit-query-file") return "none";
        await (view as import("@/views/query-view/file-view").QueryFileView)
          .query.settled;
        return (
          (
            view as import("obsidian").ItemView
          ).contentEl.querySelectorAll<HTMLElement>(".zt-annot-card").length > 0
        );
      },
      undefined,
      {
        what: "the expanded Item in the Query File view to list its annotation cards",
      },
    );
    /** What the Table shows once its query settled. */

    interface Table {
      header: string[];
      /** Every row of the Table in screen order, as its kind and key. */
      rows: [string, string][];
      items: string[];
      attachments: string[];
      annotations: string[];
      childNotes: [string, string][];
      notes: Record<string, string>;
      create: string[];
    }
    const tableWhen = async (ready: (table: Table) => boolean) => {
      let table: Table | null = null;
      const settled = await waitFor(async () => {
        table = JSON.parse(
          await obRun(
            run.vaultId,
            async ({ app }, { expectedPath }) => {
              const view = app.workspace.getMostRecentLeaf()!.view;
              if (
                view.getViewType() !== "zotlit-query-file" ||
                (view as import("obsidian").FileView).file?.path !==
                  expectedPath
              )
                return "null";
              await (
                view as import("@/views/query-view/file-view").QueryFileView
              ).query.settled;
              const el = (view as import("obsidian").ItemView).contentEl;
              const keys = (kind: string) =>
                [
                  ...el.querySelectorAll<HTMLTableRowElement>(
                    `[data-query-table-row="${kind}"]`,
                  ),
                ].map((n) => n.getAttribute("data-query-key"));
              return JSON.stringify({
                header: [
                  ...el.querySelectorAll<HTMLTableCellElement>(
                    "[data-query-table] thead th",
                  ),
                ].map((n) => n.textContent),
                rows: [
                  ...el.querySelectorAll<HTMLTableRowElement>(
                    "[data-query-table-row]",
                  ),
                ].map((n) => [
                  n.getAttribute("data-query-table-row"),
                  n.getAttribute("data-query-key"),
                ]),
                items: keys("item"),
                attachments: keys("attachment"),
                annotations: keys("annotation"),
                childNotes: [
                  ...el.querySelectorAll<HTMLTableRowElement>(
                    '[data-query-table-row="note"]',
                  ),
                ].map((n) => [n.getAttribute("data-query-key"), n.textContent]),
                notes: Object.fromEntries(
                  [
                    ...el.querySelectorAll<HTMLElement>("[data-query-note]"),
                  ].map((n) => [
                    n
                      .closest<HTMLTableRowElement>("tr")!
                      .getAttribute("data-query-key"),
                    n.getAttribute("data-query-note"),
                  ]),
                ),
                create: [
                  ...el.querySelectorAll<HTMLElement>(
                    "[data-query-create-note]",
                  ),
                ].map((n) => n.getAttribute("data-query-create-note")),
              });
            },
            { expectedPath: path },
          ),
        ) as Table | null;
        return table !== null && ready(table);
      }, 120);
      if (!settled)
        throw new Error(`Query File Table: ${JSON.stringify(table)}`);
      return table!;
    };
    const query = async (args: Record<string, string>) => {
      const report = JSON.parse(
        await cliCommand(run.vaultId, "zotlit:query", { args }),
      ) as ItemQueryReport;
      expect(report.ok).toBe(true);
      return report.rows!;
    };

    // Configure view switches the view's rows to Items. The Layout picker
    // then offers the layouts of Items, with the Table chosen. The grouping
    // by Item, which Items lack, stays in the file, and the view says it does
    // not use it.
    await obRun(
      run.vaultId,
      async ({ app }) => {
        (
          app.workspace.getMostRecentLeaf()!.view as import("obsidian").ItemView
        ).contentEl
          .querySelector<HTMLElement>("[data-query-view-menu]")!
          .dispatchEvent(
            new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
          );
      },
      undefined,
    );
    // The Configure view page this view's menu opened.

    await obRunUntil(
      run.vaultId,
      async (_context, { expectedValue }) => {
        return (
          activeDocument
            .querySelector<HTMLElement>(
              "[data-query-view-list]:popover-open [data-chooser-page]",
            )
            ?.querySelector<HTMLInputElement>("[data-query-view-name]")
            ?.value === expectedValue
        );
      },
      { expectedValue: "All annotations" },
      {
        what: "the view name field in the Configure view page to show the expected name",
      },
    );
    await obRun(
      run.vaultId,
      async (_context) => {
        const select = activeDocument
          .querySelector<HTMLElement>(
            "[data-query-view-list]:popover-open [data-chooser-page]",
          )!
          .querySelector<HTMLSelectElement>("[data-query-view-dataset]")!;
        select!.value = "items";
        select!.dispatchEvent(new Event("change", { bubbles: true }));
      },
      undefined,
    );
    await obRunUntil(
      run.vaultId,
      async (_context) => {
        return [
          ...activeDocument
            .querySelector<HTMLElement>(
              "[data-query-view-list]:popover-open [data-chooser-page]",
            )!
            .querySelectorAll<HTMLOptionElement>(
              "[data-query-view-layout] option",
            ),
        ].map((n) => [n.textContent, n.selected]);
      },
      undefined,
      {
        ready: (value) =>
          isDeepStrictEqual(value, [
            [run.m.query_view_layout_table(), true],
            [run.m.query_view_layout_list(), false],
            [run.m.query_view_layout_cards(), false],
            [run.m.query_view_layout_papers(), false],
          ]),
        what: "the view layout options in the Configure view page to select Table",
      },
    );
    await obRunUntil(
      run.vaultId,
      async ({ app }) => {
        return (
          app.workspace.getMostRecentLeaf()!.view as import("obsidian").ItemView
        ).contentEl.querySelector<HTMLElement>("[data-query-unused]")
          ?.textContent;
      },
      undefined,
      {
        ready: (value) =>
          value ===
          run.m.query_view_unused({
            dataset: run.m.query_view_dataset_items(),
            properties: run.m.query_view_property_parent_item(),
          }),
        what: "the unused properties line in the Query File view to match the expected text",
      },
    );
    await obRun(
      run.vaultId,
      async ({ page: pageHelpers }) => {
        const { press } = pageHelpers;
        press(
          activeDocument
            .querySelector<HTMLElement>(
              "[data-query-view-list]:popover-open [data-chooser-page]",
            )!
            .querySelector<HTMLElement>("[data-chooser-page-close]")!,
          "Close",
        );
      },
      undefined,
    );
    // The view saves as a Table of Items, and keeps its grouping.
    await obRunUntil(
      run.vaultId,
      async ({ app }, { path, expectedBlock }) => {
        const text = await app.vault.read(app.vault.getFileByPath(path)!);
        const first = text.split("name: Figures")[0];
        return first!.includes(expectedBlock) && first!.includes("groupBy");
      },
      {
        path,
        expectedBlock:
          "  - type: table\n    name: All annotations\n    from: items\n",
      },
      {
        what: "the saved Query File to contain the Table of Items block with its grouping",
      },
    );

    // The rows are the Items ZotLit Query gives for the view, in its order.
    const items = await query({
      from: "items",
      fields: "title",
      limit: "100",
    });
    const shown = await tableWhen((table) => table.items.length > 0);
    expect(shown.items).toEqual(items.map((row) => row.indexedKey));
    expect(shown.header.at(-1)).toBe(run.m.query_view_table_literature_note());

    // The Item expands into its Attachments, and an Attachment with
    // Annotations into those Annotations, as ZotLit Query lists them.
    const item = ITEMS.find(
      ({ itemID }) => itemID === annotationAttachment.parentItemID,
    )!.key;
    const attachments = await query({
      from: "attachments",
      filter: `item.indexedKey == "${item}"`,
      fields: "title",
      limit: "all",
    });
    const annotations = await query({
      from: "annotations",
      filter: `attachment.indexedKey == "${annotationAttachment.key}"`,
      fields: "text,pageIndex",
      sort: "sortIndex",
      limit: "all",
    });
    expect(annotations.length).toBeGreaterThan(0);
    const click = (selector: string) =>
      obRun(
        run.vaultId,
        async ({ app, page: pageHelpers }, { selector }) => {
          const { press } = pageHelpers;
          press(
            (
              app.workspace.getMostRecentLeaf()!
                .view as import("obsidian").ItemView
            ).contentEl.querySelector<HTMLElement>(selector)!,
            selector,
          );
          return String(true);
        },
        { selector },
      );
    await click(`[data-query-expand="item:${item}"]`);
    await tableWhen((table) => table.attachments.length === attachments.length);
    await click(`[data-query-expand="attachment:${annotationAttachment.key}"]`);
    const expanded = await tableWhen(
      (table) => table.annotations.length === annotations.length,
    );
    expect(expanded.attachments).toEqual(
      attachments.map((row) => row.indexedKey),
    );
    expect(expanded.annotations).toEqual(
      annotations.map((row) => row.indexedKey),
    );

    // An Attachment link opens the PDF in Obsidian's reader as an Obsidian
    // link does: a Cmd/Ctrl click and a middle click each in a new tab, so
    // the Table stays open in its own.
    // A new tab takes the focus from the Table, so the links are read off
    // the Query File's own leaf.

    /** A click on `el` with the buttons and keys `init` names, as an eval statement. */

    const pdfName = annotationAttachment.path!.split("/").pop()!;

    const before = await obRun(
      run.vaultId,
      async ({ app }, { pdfName }) => {
        return app.workspace
          .getLeavesOfType("pdf")
          .filter(
            (l) =>
              (l.view as import("obsidian").FileView).file?.name === pdfName,
          ).length;
      },
      { pdfName },
    );
    await obRun(
      run.vaultId,
      async ({ app }, { annotationAttachmentKey }) => {
        {
          const el = (
            app.workspace.getLeavesOfType("zotlit-query-file")[0]!
              .view as import("obsidian").ItemView
          ).contentEl.querySelector<HTMLTableRowElement>(
            `[data-query-table-row="attachment"][data-query-key="${annotationAttachmentKey}"] [data-query-open="attachment"]`,
          )!;
          el!.dispatchEvent(
            new el!.ownerDocument.defaultView!.MouseEvent("click", {
              bubbles: true,
              cancelable: true,
              button: 0,
              metaKey: process.platform === "darwin",
              ctrlKey: process.platform !== "darwin",
            }),
          );
        }
      },
      { annotationAttachmentKey: annotationAttachment.key },
    );
    await obRunUntil(
      run.vaultId,
      async ({ app }, { pdfName }) => {
        return app.workspace
          .getLeavesOfType("pdf")
          .filter(
            (l) =>
              (l.view as import("obsidian").FileView).file?.name === pdfName,
          ).length;
      },
      { pdfName },
      {
        ready: (value) => value === before + 1,
        what: "the PDF tab for the attachment to open one more time",
      },
    );
    await obRun(
      run.vaultId,
      async ({ app }, { annotationAttachmentKey }) => {
        {
          const el = (
            app.workspace.getLeavesOfType("zotlit-query-file")[0]!
              .view as import("obsidian").ItemView
          ).contentEl.querySelector<HTMLTableRowElement>(
            `[data-query-table-row="attachment"][data-query-key="${annotationAttachmentKey}"] [data-query-open="attachment"]`,
          )!;
          el!.dispatchEvent(
            new el!.ownerDocument.defaultView!.MouseEvent("auxclick", {
              bubbles: true,
              cancelable: true,
              button: 1,
            }),
          );
        }
      },
      { annotationAttachmentKey: annotationAttachment.key },
    );
    await obRunUntil(
      run.vaultId,
      async ({ app }, { pdfName }) => {
        return app.workspace
          .getLeavesOfType("pdf")
          .filter(
            (l) =>
              (l.view as import("obsidian").FileView).file?.name === pdfName,
          ).length;
      },
      { pdfName },
      {
        ready: (value) => value === before + 2,
        what: "the PDF tab for the attachment to open a second time",
      },
    );
    expect(
      await obRun(
        run.vaultId,
        async ({ app }) => {
          return app.workspace.getLeavesOfType("zotlit-query-file").length;
        },
        undefined,
      ),
    ).toBe(1);

    // An Annotation link opens the PDF at the Annotation's page, with the
    // Annotation Anchor that lands on its mark.
    const anchored = annotations.find(
      (row) => typeof row.values.pageIndex === "number",
    )!;
    expect(anchored, "an Annotation has a PDF page").toBeDefined();
    expect(
      await obRun(
        run.vaultId,
        async ({ app, page }, { key }) =>
          await page.annotationOpenSubpath(() => {
            const el = (
              app.workspace.getLeavesOfType("zotlit-query-file")[0]!
                .view as import("obsidian").ItemView
            ).contentEl.querySelector<HTMLElement>(
              `[data-query-table-row="annotation"][data-query-key="${key}"] [data-query-open="annotation"]`,
            )!;
            el.dispatchEvent(
              new (
                el.ownerDocument.defaultView as Window & typeof globalThis
              ).MouseEvent("auxclick", {
                bubbles: true,
                cancelable: true,
                button: 1,
              }),
            );
          }),
        { key: anchored.indexedKey },
      ),
    ).toEqual(
      annotationOpenKeys({
        page: (anchored.values.pageIndex as number) + 1,
        annotation: anchored.indexedKey,
        attachment: annotationAttachment.key,
      }),
    );

    await obRun(
      run.vaultId,
      async ({ app }) => {
        app.workspace.setActiveLeaf(
          app.workspace.getLeavesOfType("zotlit-query-file")[0]!,
          { focus: true },
        );
      },
      undefined,
    );

    // An Attachment Obsidian's reader cannot host, such as a web snapshot,
    // opens in Zotero's reader through its Zotero link.
    const snapshot = ATTACHMENTS.find(({ key }) => key === "HTMLSNAP")!;
    expect(snapshot.parentItemID).toBe(positionDocumentItem.itemID);
    await click(`[data-query-expand="item:${positionDocumentItem.key}"]`);
    await tableWhen((table) => table.attachments.includes(snapshot.key));
    expect(
      await obRun(
        run.vaultId,
        async ({ app, page: pageHelpers }, { snapshotKey }) => {
          const { press, until } = pageHelpers;
          const native = window.open;
          let opened: string | null = null;
          window.open = (url) => {
            opened = String(url);
            return null;
          };
          try {
            press(
              (
                app.workspace.getLeavesOfType("zotlit-query-file")[0]!
                  .view as import("obsidian").ItemView
              ).contentEl.querySelector<HTMLTableRowElement>(
                `[data-query-table-row="attachment"][data-query-key="${snapshotKey}"] [data-query-open="attachment"]`,
              )!,
              "snapshot link",
            );
            return await until(
              "Zotero opens the snapshot",
              () => opened,
              10000,
            );
          } finally {
            window.open = native;
          }
        },
        { snapshotKey: snapshot.key },
      ),
    ).toBe(`zotero://open/library/items/${snapshot.key}`);

    // An Item with Child Notes expands into them with their titles; its
    // trashed Child Note stays out.
    const noted = ITEMS.find(({ itemID }) => itemID === 1)!.key;
    const live = NOTES.filter(
      (note) => note.parentItemID === 1 && !note.trashed,
    );
    expect(
      NOTES.some((note) => note.parentItemID === 1 && note.trashed),
      "the Fixture Item has a trashed Child Note",
    ).toBe(true);
    await click(`[data-query-expand="item:${noted}"]`);
    const withNotes = await tableWhen(
      (table) => table.childNotes.length === live.length,
    );
    expect(withNotes.childNotes).toEqual(
      live.map((note) => [note.key, note.title]),
    );

    // An Item with both Attachments and a Child Note lists its notes after
    // its Attachments.
    const both = ITEMS.find(({ itemID }) => itemID === 57)!;
    const bothNotes = NOTES.filter(
      (note) => note.parentItemID === both.itemID && !note.trashed,
    );
    const bothAttachments = await query({
      from: "attachments",
      filter: `item.indexedKey == "${both.key}"`,
      fields: "title",
      limit: "all",
    });
    expect(bothNotes.length, "the Fixture Item has a Child Note").toBe(1);
    expect(
      bothAttachments.length,
      "the Fixture Item has Attachments",
    ).toBeGreaterThan(0);
    await click(`[data-query-expand="item:${both.key}"]`);
    const childRows = (table: Table) => {
      const start = table.rows.findIndex(
        ([kind, key]) => kind === "item" && key === both.key,
      );
      const end = table.rows.findIndex(
        ([kind], index) => index > start && kind === "item",
      );
      return table.rows.slice(start + 1, end === -1 ? undefined : end);
    };
    const withBoth = await tableWhen(
      (table) =>
        childRows(table).length === bothAttachments.length + bothNotes.length,
    );
    expect(childRows(withBoth)).toEqual([
      ...bothAttachments.map((row) => ["attachment", row.indexedKey]),
      ...bothNotes.map((note) => ["note", note.key]),
    ]);

    // "Create" asks for a Profile where more than one fits; the new
    // Literature Note, made with the Profile chosen, then shows as a link in
    // the column.
    const book = shown.create.find(
      (key) =>
        key === booksProfileTargetItem.key ||
        key.startsWith(`${booksProfileTargetItem.key}g`),
    )!;
    expect(book, "the Item has no Literature Note yet").toBeDefined();
    await click(`[data-query-create-note="${book}"]`);
    expect(await selectSuggestion(run.vaultId, booksProfile.label)).toContain(
      booksProfile.label,
    );
    await pressPromptKey(run.vaultId, "Enter");
    const linked = await tableWhen((table) => book in table.notes);
    created.push(linked.notes[book]!);
    expect(linked.create).not.toContain(book);
    expect(linked.notes[book]).toMatch(/^books\//);
    expect(
      await obRun(
        run.vaultId,
        async ({ app }, { notePath }) => {
          return String(
            app.metadataCache.getFileCache(app.vault.getFileByPath(notePath!)!)
              ?.frontmatter?.["zotero-key"],
          );
        },
        { notePath: linked.notes[book] },
      ),
    ).toBe(book);
  }, 180000);

  // Vault properties of Items edit in place in the Table, with trusted
  // input: a click anywhere in a cell, an empty one too, enters edit; focus
  // that leaves a list editor from an item commits it; the first edit of a
  // row with no note creates it; a vault sort and filter run (#1531).
  it("edits vault properties in the Table with real input, creates a note on a first edit, and sorts and filters by them", async () => {
    const path = "query-files/Vault properties.zotquery";
    // Two My Library Items that tie on their date, each with its seeded
    // Literature Note, and a Lab Archive Item with no note.
    const [tieFirst, tieSecond] = [11, 12].map(
      (itemID) => ITEMS.find((item) => item.itemID === itemID)!.key,
    ) as [string, string];
    const lab = LIBRARIES.find(({ libraryID }) => libraryID === 3)!;
    const fresh = `${ITEMS.find((item) => item.itemID === 9)!.key}g${lab.groupID}`;
    const notePath = (key: string) => `literatures/${key}.md`;
    const keys = JSON.stringify([tieFirst, tieSecond, fresh]);
    const viewText = (extra: string) =>
      `${[
        "views:",
        "  - type: table",
        "    name: Vault properties",
        "    from: items",
        "    filters:",
        "      and:",
        `        - '${keys}.contains(indexedKey)'`,
        extra,
        "    order:",
        "      - title",
        "      - vault.zt-status",
        "      - vault.zt-done",
        "      - vault.zt-projects",
        "      - vault.zt-rank",
        "      - vault.zt-due",
        "",
      ]
        .filter((line) => line !== "")
        .join("\n")}\n`;
    const layout = await obRun(
      run.vaultId,
      async ({ app }) => {
        return JSON.stringify(app.workspace.getLayout());
      },
      undefined,
    );
    const seeded = [notePath(tieFirst), notePath(tieSecond)];
    const originals = (await obRun(
      run.vaultId,
      async ({ app }, { seeded }) => {
        return await Promise.all(
          seeded.map((path) => app.vault.read(app.vault.getFileByPath(path)!)),
        );
      },
      { seeded },
    )) as string[];
    const created: string[] = [path];
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obRun(
        run.vaultId,
        async ({ app }, { created, originals, seeded, layout }) => {
          for (const leaf of app.workspace.getLeavesOfType("zotlit-query-file"))
            leaf.detach();
          for (const path of created) {
            const file = app.vault.getFileByPath(path)!;
            if (file) await app.vault.delete(file);
          }
          for (const [at, path] of seeded.entries())
            await app.vault.modify(
              app.vault.getFileByPath(path)!,
              originals[at]!,
            );
          await app.workspace.changeLayout(JSON.parse(layout));
        },
        { created, originals, seeded, layout },
      );
    });
    await obRun(
      run.vaultId,
      async (
        { app },
        { firstNotePath, secondNotePath, newFilePath, newFileContent },
      ) => {
        const set = (
          path: string,
          props: Record<string, string | number | boolean | string[]>,
        ) =>
          app.fileManager.processFrontMatter(
            app.vault.getFileByPath(path)!,
            (fm) => Object.assign(fm, props),
          );
        await set(firstNotePath, {
          "zt-status": "unread",
          "zt-done": false,
          "zt-projects": ["a"],
          "zt-rank": 1,
          "zt-due": "2024-05-01",
        });
        await set(secondNotePath, { "zt-done": true, "zt-rank": 2 });
        await app.vault.create(newFilePath, newFileContent);
      },
      {
        firstNotePath: notePath(tieFirst),
        secondNotePath: notePath(tieSecond),
        newFilePath: path,
        newFileContent: viewText(""),
      },
    );

    let indexed = "";
    expect(
      await waitFor(async () => {
        indexed = await obRun(
          run.vaultId,
          async ({ app, zotlit }, { tieFirst, tieSecond }) => {
            return JSON.stringify(
              [tieFirst, tieSecond].map((key) => [
                key,
                zotlit.services.bridge
                  .runSync(zotlit.services.noteIndex.getNotesByItemKey(key))
                  .map((file) => file.path),
                app.metadataCache.getCache(`literatures/${key}.md`)
                  ?.frontmatter?.["zt-rank"] ?? null,
              ]),
            );
          },
          { tieFirst, tieSecond },
        );
        return (JSON.parse(indexed) as [string, string[], unknown][]).every(
          ([key, paths, rank]) =>
            paths.join() === notePath(key) && rank !== null,
        );
      }),
      indexed,
    ).toBe(true);
    await obRun(
      run.vaultId,
      async ({ app }, { path }) => {
        const leaf = app.workspace.getLeaf("tab");
        await leaf.openFile(app.vault.getFileByPath(path)!);
        app.workspace.setActiveLeaf(leaf, { focus: true });
      },
      { path },
    );
    await raiseWindow(run.vaultId);

    /** The rows of the Table, and the state and text of each vault cell. */

    interface Table {
      rows: string[];
      editing: boolean;
      cells: Record<string, string>;
    }
    const tableWhen = async (ready: (table: Table) => boolean) => {
      let table: Table | null = null;
      const settled = await waitFor(async () => {
        table = JSON.parse(
          await obRun(
            run.vaultId,
            async ({ app }) => {
              const view =
                app.workspace.getLeavesOfType("zotlit-query-file")[0]!.view;
              if (!view) return "null";
              await (
                view as import("@/views/query-view/file-view").QueryFileView
              ).query.settled;
              const el = (view as import("obsidian").ItemView).contentEl;
              return JSON.stringify({
                rows: [
                  ...el.querySelectorAll<HTMLTableRowElement>(
                    '[data-query-table-row="item"]',
                  ),
                ].map((n) => n.getAttribute("data-query-key")),
                editing: !!el.querySelector<HTMLInputElement>(
                  "[data-query-vault-input]",
                )!,
                cells: Object.fromEntries(
                  [
                    ...el.querySelectorAll<HTMLElement>(
                      "[data-query-vault-cell]",
                    ),
                  ].map((n) => [
                    `${n.closest<HTMLTableRowElement>("tr")!.getAttribute("data-query-key")}/${n.getAttribute("data-query-vault-name")}`,
                    n.textContent,
                  ]),
                ),
              });
            },
            undefined,
          ),
        ) as Table | null;
        return table !== null && ready(table);
      }, 80);
      if (!settled) throw new Error(`Vault Table: ${JSON.stringify(table)}`);
      return table!;
    };
    await tableWhen((table) => table.rows.length === 3);
    const frontmatter = async (path: string) =>
      (await obRun(
        run.vaultId,
        async ({ app }, { path }) => {
          return (
            app.metadataCache.getFileCache(app.vault.getFileByPath(path)!)
              ?.frontmatter ?? null
          );
        },
        { path },
      )) as Record<string, unknown> | null;
    const frontmatterWhen = async (
      path: string,
      ready: (properties: Record<string, unknown>) => boolean,
    ) => {
      let properties: Record<string, unknown> | null = null;
      const settled = await waitFor(async () => {
        properties = await frontmatter(path);
        return properties !== null && ready(properties);
      }, 80);
      if (!settled)
        throw new Error(`${path} frontmatter: ${JSON.stringify(properties)}`);
      return properties!;
    };

    /** A trusted click, of the `button` given, at the centre of the element `target` evaluates to. */
    const click = async (
      target: {
        key?: string;
        name?: string;
        part?: string;
        menuLabel?: string;
      },
      button: "left" | "right" = "left",
    ) =>
      expect(
        await obRun(
          run.vaultId,
          ({ app }, { target: { key, name, part, menuLabel }, button }) => {
            const cell = (
              app.workspace.getLeavesOfType("zotlit-query-file")[0]!
                .view as import("obsidian").ItemView
            ).contentEl.querySelector<HTMLElement>(
              `[data-query-key="${key}"] [data-query-vault-cell][data-query-vault-name="${name}"]`,
            )!;
            const target = menuLabel
              ? [
                  ...activeDocument.querySelectorAll<HTMLElement>(
                    "body > .menu .menu-item",
                  ),
                ].find((entry) => entry.textContent === menuLabel)
              : part === "td"
                ? cell?.closest<HTMLElement>("td")!
                : part
                  ? cell?.querySelector<HTMLElement>(part)!
                  : cell;
            if (!target) return "missing";
            target.scrollIntoView({
              block: "center",
              inline: "nearest",
              behavior: "instant",
            });
            const rect = target.getBoundingClientRect();
            const zoom = (
              require("electron") as { webFrame: { getZoomFactor(): number } }
            ).webFrame.getZoomFactor();
            const x = Math.round((rect.left + rect.width / 2) * zoom),
              y = Math.round((rect.top + rect.height / 2) * zoom);
            const contents = (
              require("@electron/remote") as {
                getCurrentWebContents(): {
                  sendInputEvent(event: object): void;
                };
              }
            ).getCurrentWebContents();
            contents.sendInputEvent({ type: "mouseMove", x, y });
            contents.sendInputEvent({
              type: "mouseDown",
              x,
              y,
              button,
              clickCount: 1,
            });
            contents.sendInputEvent({
              type: "mouseUp",
              x,
              y,
              button,
              clickCount: 1,
            });
            return "clicked";
          },
          { target, button },
        ),
      ).toBe("clicked");
    /** A trusted key press, with the modifiers held. */
    const key = async (keyCode: string, modifiers: string[] = []) =>
      obRun(
        run.vaultId,
        async (_context, { keyCode, modifiers }) => {
          const contents = require("@electron/remote").getCurrentWebContents();
          contents.sendInputEvent({
            type: "keyDown",
            keyCode: keyCode,
            modifiers: modifiers,
          });
          contents.sendInputEvent({
            type: "keyUp",
            keyCode: keyCode,
            modifiers: modifiers,
          });
          return String(true);
        },
        { keyCode, modifiers },
      );
    /** Text typed into the focused field, as the keyboard types it. */
    const typeText = async (text: string) =>
      obRun(
        run.vaultId,
        async (_context, { text }) => {
          require("@electron/remote").getCurrentWebContents().insertText(text);
          return String(true);
        },
        { text },
      );

    // An empty cell is a click target across the whole cell, so the first
    // value of a property goes in with one click (bug A).
    await click({ key: tieSecond, name: "zt-status", part: "td" });
    await obRunUntil(
      run.vaultId,
      async (_context) => {
        return (
          activeDocument.activeElement?.matches("[data-query-vault-input]") ??
          false
        );
      },
      undefined,
      { what: "the vault property input in the Table to take focus" },
    );
    await typeText("to-read");
    await key("Enter");
    await frontmatterWhen(
      notePath(tieSecond),
      (properties) => properties["zt-status"] === "to-read",
    );

    // A cell edits its value in place, its first line where it was at rest,
    // for each type of property (#1531).
    /**
     * The top of the first line of a vault cell, from the top of its row: of
     * its first item for a list, of the field's content box for a field
     * (and a date at rest, a native field too), else of its first text.
     */

    /** Open the edit of the cell `name`, and compare its first line with the cell's at rest. */
    const sameLine = async (name: string) => {
      const restLine = await obRun(
        run.vaultId,
        async ({ app }, { tieFirst, name }) => {
          const el = (
            app.workspace.getLeavesOfType("zotlit-query-file")[0]!
              .view as import("obsidian").ItemView
          ).contentEl.querySelector<HTMLElement>(
            `[data-query-key="${tieFirst}"] [data-query-vault-cell][data-query-vault-name="${name}"]`,
          )!;
          const row = el!
            .closest<HTMLTableRowElement>("tr")!
            .getBoundingClientRect().top;
          const editor = el!.querySelector<HTMLElement>(
            "[data-query-vault-editor]",
          )!;
          const chip = (editor ?? el)!.querySelector<HTMLElement>(
            "[data-query-vault-chip]",
          )!;
          if (chip) return chip.getBoundingClientRect().top - row;
          const field = editor
            ? editor.querySelector<HTMLInputElement>("textarea,input")!
            : el!.querySelector<HTMLElement>("[data-query-vault-date]")!;
          if (field) {
            const style = getComputedStyle(field);
            return (
              field.getBoundingClientRect().top +
              Number.parseFloat(style.borderTopWidth) +
              Number.parseFloat(style.paddingTop) -
              row
            );
          }
          const walker = activeDocument.createTreeWalker(
            el!,
            NodeFilter.SHOW_TEXT,
            { acceptNode: (n) => (n.textContent!.trim() ? 1 : 3) },
          );
          const text = walker.nextNode();
          const range = activeDocument.createRange();
          range.selectNodeContents(text!);
          const rect = range.getClientRects()[0];
          return (
            rect!.top -
            (Number.parseFloat(
              getComputedStyle(text!.parentElement!).lineHeight,
            ) -
              rect!.height) /
              2 -
            row
          );
        },
        { tieFirst, name },
      );
      await click({ key: tieFirst, name });
      await obRunUntil(
        run.vaultId,
        async (_context) => {
          return (
            activeDocument.activeElement?.matches("[data-query-vault-input]") ??
            false
          );
        },
        undefined,
        {
          what: "the vault property input in the Table to take focus after the first edit",
        },
      );
      const editLine = await obRun(
        run.vaultId,
        async ({ app }, { tieFirst, name }) => {
          const el = (
            app.workspace.getLeavesOfType("zotlit-query-file")[0]!
              .view as import("obsidian").ItemView
          ).contentEl.querySelector<HTMLElement>(
            `[data-query-key="${tieFirst}"] [data-query-vault-cell][data-query-vault-name="${name}"]`,
          )!;
          const row = el!
            .closest<HTMLTableRowElement>("tr")!
            .getBoundingClientRect().top;
          const editor = el!.querySelector<HTMLElement>(
            "[data-query-vault-editor]",
          )!;
          const chip = (editor ?? el)!.querySelector<HTMLElement>(
            "[data-query-vault-chip]",
          )!;
          if (chip) return chip.getBoundingClientRect().top - row;
          const field = editor
            ? editor.querySelector<HTMLInputElement>("textarea,input")!
            : el!.querySelector<HTMLElement>("[data-query-vault-date]")!;
          if (field) {
            const style = getComputedStyle(field);
            return (
              field.getBoundingClientRect().top +
              Number.parseFloat(style.borderTopWidth) +
              Number.parseFloat(style.paddingTop) -
              row
            );
          }
          const walker = activeDocument.createTreeWalker(
            el!,
            NodeFilter.SHOW_TEXT,
            { acceptNode: (n) => (n.textContent!.trim() ? 1 : 3) },
          );
          const text = walker.nextNode();
          const range = activeDocument.createRange();
          range.selectNodeContents(text!);
          const rect = range.getClientRects()[0];
          return (
            rect!.top -
            (Number.parseFloat(
              getComputedStyle(text!.parentElement!).lineHeight,
            ) -
              rect!.height) /
              2 -
            row
          );
        },
        { tieFirst, name },
      );
      expect(
        Math.abs(editLine - restLine),
        `${name}: first line ${restLine} at rest, ${editLine} editing`,
      ).toBeLessThan(0.5);
    };
    // A number, a date and a list, each left unchanged: Escape closes the
    // suggestions of a list first, then ends the edit, writing nothing.
    expect(
      await obRun(
        run.vaultId,
        async ({ app }, { propertyNames, tieFirst }) => {
          return propertyNames
            .map((name) =>
              (
                app.workspace.getLeavesOfType("zotlit-query-file")[0]!
                  .view as import("obsidian").ItemView
              ).contentEl
                .querySelector<HTMLElement>(
                  `[data-query-key="${tieFirst}"] [data-query-vault-name="${name}"]`,
                )
                ?.getAttribute("data-query-vault-type"),
            )
            .join();
        },
        { propertyNames: ["zt-rank", "zt-due", "zt-projects"], tieFirst },
      ),
    ).toBe("number,date,multitext");
    for (const name of ["zt-rank", "zt-due", "zt-projects"]) {
      await sameLine(name);
      await key("Escape");
      try {
        await obRunUntil(
          run.vaultId,
          async (_context) => {
            return !!activeDocument.querySelector<HTMLElement>(
              "[data-query-vault-editor]",
            )!;
          },
          undefined,
          {
            ready: (value) => value === false,
            tries: 5,
            what: "the vault property editor in the Table to close",
          },
        );
        continue;
      } catch {
        // The first Escape ended a text edit; a second one closes the editor.
      }
      await key("Escape");
      await obRunUntil(
        run.vaultId,
        async (_context) => {
          return !!activeDocument.querySelector<HTMLElement>(
            "[data-query-vault-editor]",
          )!;
        },
        undefined,
        {
          ready: (value) => value === false,
          what: "the vault property editor in the Table to close after the edit commits",
        },
      );
    }
    await sameLine("zt-status");
    // The vault's values for the property show as the edit starts, before
    // a key is typed, as in a Bases cell (#1531): those that match the text.
    await obRunUntil(
      run.vaultId,
      async (_context) => {
        return [
          ...activeDocument.querySelectorAll<HTMLElement>(
            ".suggestion-container .suggestion-item",
          ),
        ]
          .map((item) => item.textContent)
          .join("|");
      },
      undefined,
      {
        ready: (value) => value === "unread",
        what: "the vault value suggestions to list only the matching unread value",
      },
    );
    // The field's text, selected, is replaced by what is typed; it matches
    // vault values, and Shift+Enter keeps the text over the highlighted one.
    await obRun(
      run.vaultId,
      async (_context) => {
        (activeDocument.activeElement as HTMLInputElement).select();
      },
      undefined,
    );
    await typeText("read");
    await key("Enter", ["shift"]);
    await frontmatterWhen(
      notePath(tieFirst),
      (properties) => properties["zt-status"] === "read",
    );

    // A checkbox toggles with one click on it.
    await click({
      key: tieFirst,
      name: "zt-done",
      part: "[data-query-vault-checkbox]",
    });
    await frontmatterWhen(
      notePath(tieFirst),
      (properties) => properties["zt-done"] === true,
    );

    // A list commits when focus leaves the editor from an item, as a click
    // outside the Table takes it (bug B). Backspace in the empty field
    // selects the last item, as in a Bases list cell.
    await click({ key: tieFirst, name: "zt-projects" });
    await obRunUntil(
      run.vaultId,
      async (_context) => {
        return (
          activeDocument.activeElement?.matches("[data-query-vault-input]") ??
          false
        );
      },
      undefined,
      { what: "the vault property input in the Table to take focus again" },
    );
    await typeText("c");
    await key("Enter");
    await key("Backspace");

    await obRunUntil(
      run.vaultId,
      async (_context) => {
        return (
          activeDocument.activeElement?.matches(
            '[data-query-vault-chip="c"]',
          ) ?? false
        );
      },
      undefined,
      { what: "the vault property chip labelled c to take focus" },
    );
    // While the pill's menu stands it holds the keys: Delete removes no
    // item, and Escape hides the menu alone, its Scope above the menu's own
    // (#1668). The next Escape is the pill's, which gives focus to the field.
    await key("F10", ["shift"]);

    await obRunUntil(
      run.vaultId,
      async (_context) => {
        return !!activeDocument.querySelector<HTMLElement>("body > .menu")!;
      },
      undefined,
      { what: "the vault value menu to open in the document body" },
    );
    expect(
      await obRun(
        run.vaultId,
        async ({ page: pageHelpers }) => {
          return await pageHelpers.menuReady();
        },
        undefined,
      ),
    ).toBe("ready");
    await key("Delete");
    expect(
      await obRun(
        run.vaultId,
        async ({ app }, { tieFirst }) => {
          return (
            !!(
              app.workspace.getLeavesOfType("zotlit-query-file")[0]!
                .view as import("obsidian").ItemView
            ).contentEl
              .querySelector<HTMLElement>(
                `[data-query-key="${tieFirst}"] [data-query-vault-cell][data-query-vault-name="zt-projects"]`,
              )!
              .querySelector<HTMLElement>('[data-query-vault-chip="c"]')! &&
            !!activeDocument.querySelector<HTMLElement>("body > .menu")!
          );
        },
        { tieFirst },
      ),
    ).toBe(true);
    await key("Escape");
    await obRunUntil(
      run.vaultId,
      async (_context) => {
        return !!activeDocument.querySelector<HTMLElement>("body > .menu")!;
      },
      undefined,
      {
        ready: (value) => value === false,
        what: "the vault value menu to close",
      },
    );
    expect(
      await obRun(
        run.vaultId,
        async (_context) => {
          return (
            activeDocument.activeElement?.matches(
              '[data-query-vault-chip="c"]',
            ) ?? false
          );
        },
        undefined,
      ),
    ).toBe(true);
    await key("Escape");
    await obRunUntil(
      run.vaultId,
      async (_context) => {
        return (
          activeDocument.activeElement?.matches("[data-query-vault-input]") ??
          false
        );
      },
      undefined,
      { what: "the vault property input to take focus after the menu closes" },
    );
    await key("Backspace");
    await obRunUntil(
      run.vaultId,
      async (_context) => {
        return (
          activeDocument.activeElement?.matches(
            '[data-query-vault-chip="c"]',
          ) ?? false
        );
      },
      undefined,
      {
        what: "the vault property chip labelled c to take focus after the menu closes",
      },
    );
    // A chip edits in place from its menu, as in a Bases list cell: a
    // right click opens it, Edit makes the chip's text a field, and a comma
    // stays inside the item.
    await click(
      {
        key: tieFirst,
        name: "zt-projects",
        part: '[data-query-vault-chip="c"]',
      },
      "right",
    );

    await obRunUntil(
      run.vaultId,
      async (_context, { chipLabel }) => {
        return !![
          ...activeDocument.querySelectorAll<HTMLElement>(
            "body > .menu .menu-item",
          ),
        ].find((entry) => entry.textContent === chipLabel);
      },
      { chipLabel: run.m.query_view_vault_chip_edit() },
      { what: "the vault value menu to offer the chip label as an item" },
    );
    expect(
      await obRun(
        run.vaultId,
        async ({ page: pageHelpers }) => {
          return await pageHelpers.menuReady();
        },
        undefined,
      ),
    ).toBe("ready");
    await click({ menuLabel: run.m.query_view_vault_chip_edit() });
    await obRunUntil(
      run.vaultId,
      async (_context) => {
        return (
          activeDocument.activeElement?.matches(
            "[data-query-vault-chip-input]",
          ) ?? false
        );
      },
      undefined,
      { what: "the vault chip input to take focus" },
    );
    await typeText(", d");
    await obRunUntil(
      run.vaultId,
      async (_context) => {
        const focused = activeDocument.activeElement;
        return focused?.matches("[data-query-vault-chip-input]")
          ? (focused as HTMLInputElement).value
          : null;
      },
      undefined,
      {
        ready: (value) => value === "c, d",
        what: "the vault chip input to hold the expected typed value",
      },
    );
    await key("Enter");
    await obRunUntil(
      run.vaultId,
      async (_context) => {
        return (
          activeDocument.activeElement?.matches(
            '[data-query-vault-chip="c, d"]',
          ) ?? false
        );
      },
      undefined,
      { what: "the vault property chip labelled c, d to take focus" },
    );
    // A click on an empty spot of the view, outside the Table.
    expect(
      await obRun(
        run.vaultId,
        async ({ app }) => {
          const el = (
            app.workspace.getLeavesOfType("zotlit-query-file")[0]!
              .view as import("obsidian").ItemView
          ).contentEl;
          const table = el.querySelector<HTMLElement>("[data-query-table]")!;
          const box = el.getBoundingClientRect();
          let x = 0,
            y = 0,
            found = false;
          for (let dy = 8; dy < box.height && !found; dy += 8)
            for (let dx = 8; dx < box.width && !found; dx += 16) {
              x = box.left + dx;
              y = box.bottom - dy;
              const hit = activeDocument.elementFromPoint(x, y);
              found =
                !!hit &&
                el.contains(hit) &&
                !table!.contains(hit) &&
                !hit.closest<HTMLInputElement>(
                  "button,input,select,a,[role],[tabindex],[popover]",
                )!;
            }
          if (!found) return "no empty space";
          const zoom = require("electron").webFrame.getZoomFactor();
          const point = { x: Math.round(x * zoom), y: Math.round(y * zoom) };
          const contents = require("@electron/remote").getCurrentWebContents();
          contents.sendInputEvent({ type: "mouseMove", ...point });
          contents.sendInputEvent({
            type: "mouseDown",
            button: "left",
            clickCount: 1,
            ...point,
          });
          contents.sendInputEvent({
            type: "mouseUp",
            button: "left",
            clickCount: 1,
            ...point,
          });
          return "clicked";
        },
        undefined,
      ),
    ).toBe("clicked");
    await frontmatterWhen(notePath(tieFirst), (properties) =>
      ["a", "c, d"].every((item) =>
        (properties["zt-projects"] as string[] | undefined)?.includes(item),
      ),
    );
    await tableWhen((table) => !table.editing);

    // The first edit of a row with no note creates the note, then writes
    // the value to it.
    await click({ key: fresh, name: "zt-status", part: "td" });
    await obRunUntil(
      run.vaultId,
      async (_context) => {
        return (
          activeDocument.activeElement?.matches("[data-query-vault-input]") ??
          false
        );
      },
      undefined,
      {
        what: "the vault property input in the Query Table to take keyboard focus",
      },
    );
    await typeText("queued");
    await key("Enter");
    // Where several Profiles fit the Item, the prompt asks; its first
    // choice takes it.
    let createdPath: string | null = null;
    expect(
      await waitFor(async () => {
        const found = await obRun(
          run.vaultId,
          async ({ zotlit }, { fresh }) => {
            const note = zotlit.services.bridge.runSync(
              zotlit.services.noteIndex.getNotesByItemKey(fresh),
            )[0];
            if (note) return note.path;
            const prompt =
              activeDocument.querySelector<HTMLInputElement>(".prompt input")!;
            if (prompt)
              prompt.dispatchEvent(
                new (activeWindow as Window & typeof globalThis).KeyboardEvent(
                  "keydown",
                  {
                    key: "Enter",
                    code: "Enter",
                    keyCode: 13,
                    which: 13,
                    bubbles: true,
                  },
                ),
              );
            return "none";
          },
          { fresh },
        );
        if (found !== "none") createdPath = found;
        return found !== "none";
      }, 80),
    ).toBe(true);
    created.push(createdPath!);
    await frontmatterWhen(
      createdPath!,
      (properties) => properties["zt-status"] === "queued",
    );

    // A vault filter keeps the Items whose note passes it, and a vault sort
    // breaks the tie of their dates: the higher rank first.
    await obRun(
      run.vaultId,
      async ({ app }, { path, viewYaml }) => {
        await app.vault.modify(app.vault.getFileByPath(path)!, viewYaml);
      },
      {
        path,
        viewYaml: viewText(
          [
            "        - 'vault[\"zt-done\"] == true'",
            "    sort:",
            "      - property: date",
            "        direction: ASC",
            "      - property: vault.zt-rank",
            "        direction: DESC",
          ].join("\n"),
        ),
      },
    );
    const sorted = await tableWhen(
      (table) =>
        table.rows.length === 2 &&
        table.rows.join() === [tieSecond, tieFirst].join(),
    );
    expect(sorted.rows).toEqual([tieSecond, tieFirst]);
  }, 180000);

  // A List or Cards view of Items gathers its rows by a grouping whose
  // fields it does not show, as the Table does (#1495).
  it("groups a List and Cards view of Items by item type, Collection and tag, as the Table does", async () => {
    const layout = await obRun(
      run.vaultId,
      async ({ app }) => {
        return JSON.stringify(app.workspace.getLayout());
      },
      undefined,
    );
    const paths: string[] = [];
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obRun(
        run.vaultId,
        async ({ app }, { paths, layout }) => {
          for (const leaf of app.workspace.getLeavesOfType("zotlit-query-file"))
            leaf.detach();
          for (const path of paths) {
            const file = app.vault.getFileByPath(path)!;
            if (file) await app.vault.delete(file);
          }
          await app.workspace.changeLayout(JSON.parse(layout));
        },
        { paths, layout },
      );
    });
    const itemTypes = [
      "Book",
      "Book Section",
      "Conference Paper",
      "Journal Article",
      "Letter",
      "Preprint",
      "Thesis",
    ];
    const none = run.m.query_view_group_none();
    const cases: {
      name: string;
      type: "list" | "cards" | "table";
      group: string;
      order?: string[];
      headings: string[];
      unused?: string;
    }[] = [
      {
        name: "List by item type",
        type: "list",
        group: "itemType",
        order: ["title"],
        headings: itemTypes,
      },
      {
        name: "Cards by Collection",
        type: "cards",
        group: "collections[]",
        headings: [
          "Personal only",
          "Personal only/Personal child",
          "Shared key",
          none,
        ],
      },
      {
        name: "List by tag",
        type: "list",
        group: "tags[]",
        headings: [
          "fixture-core",
          "methodology",
          "read-later",
          "research-practice",
          "visualization",
          none,
        ],
      },
      {
        name: "List by tag showing tags",
        type: "list",
        group: "tags[]",
        order: ["title", "tags"],
        headings: [
          "fixture-core",
          "methodology",
          "read-later",
          "research-practice",
          "visualization",
          none,
        ],
        unused: run.m.query_view_unshown({
          dataset: run.m.query_view_dataset_items(),
          properties: run.m.query_view_property_tag(),
        }),
      },
      {
        name: "Table by item type",
        type: "table",
        group: "itemType",
        order: ["title"],
        headings: itemTypes,
      },
    ];
    for (const { name, type, group, order, unused, headings } of cases) {
      const path = `query-files/${name}.zotquery`;
      paths.push(path);
      const text = [
        "views:",
        `  - type: ${type}`,
        `    name: ${name}`,
        "    from: items",
        "    groupBy:",
        `      property: ${group}`,
        "      direction: ASC",
        ...(order ? ["    order:", ...order.map((p) => `      - ${p}`)] : []),
        "    limit: 100",
        "",
      ].join("\n");
      await obRun(
        run.vaultId,
        async ({ app }, { path, text }) => {
          const file = await app.vault.create(path, text);
          const leaf = app.workspace.getLeaf("tab");
          await leaf.openFile(file);
          app.workspace.setActiveLeaf(leaf, { focus: true });
        },
        { path, text },
      );

      let shown: {
        rows: number;
        headings: string[];
        unused: string | null;
      } | null = null;
      const settled = await waitFor(async () => {
        shown = JSON.parse(
          await obRun(
            run.vaultId,
            async ({ app }, { expectedPath }) => {
              const view = app.workspace.getMostRecentLeaf()!.view;
              if (
                view.getViewType() !== "zotlit-query-file" ||
                (view as import("obsidian").FileView).file?.path !==
                  expectedPath
              )
                return "null";
              await (
                view as import("@/views/query-view/file-view").QueryFileView
              ).query.settled;
              const el = (view as import("obsidian").ItemView).contentEl;
              return JSON.stringify({
                rows: el.querySelectorAll<HTMLTableRowElement>(
                  '[data-query-row], [data-query-table-row="item"]',
                ).length,
                headings: [
                  ...el.querySelectorAll<HTMLElement>("[data-query-group]"),
                ].map((n) => n.textContent),
                unused:
                  el.querySelector<HTMLElement>("[data-query-unused]")
                    ?.textContent ?? null,
              });
            },
            { expectedPath: path },
          ),
        ) as typeof shown;
        return shown !== null && shown.rows > 0;
      }, 120);
      if (!settled) throw new Error(`${name}: ${JSON.stringify(shown)}`);
      expect({ name, ...shown! }).toMatchObject({
        name,
        headings,
        unused: unused ?? null,
      });
    }
  }, 180000);
});
