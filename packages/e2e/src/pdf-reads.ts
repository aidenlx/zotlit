// Real PDF navigation, with the ledger and rendered Recent order as observers.
import { DatabaseSync } from "node:sqlite";
import { expect } from "vitest";

import { obRun, obRunUntil } from "./obsidian-cli.ts";
import { cli } from "./obsidian-cli.ts";
import type { PagePdfView, FileExplorerView } from "./page-notes-types.ts";

const path = "attachments/rougier-2014.pdf";
const itemKey = "RUGIER24";
const attachmentKey = "RGRPDF24";

// Failure modes: an open route misses its parent; restoration counts as a read;
// page renders count as turns; close is missed; a standalone PDF records a Use.
export async function verifyPdfReads(
  vaultId: string,
  databasePath: string,
  reloadWindow: () => Promise<void>,
) {
  const saved = await obRun(
    vaultId,
    async ({ app, zotlit }) => {
      return JSON.stringify({
        layout: app.workspace.getLayout(),
        settings: zotlit.services.bridge.runSync(
          zotlit.services.settings.current,
        ),
        ledger: app.loadLocalStorage("zotlit-use-ledger") ?? null,
      });
    },
    undefined,
  );
  using db = new DatabaseSync(databasePath);
  const attachment = db
    .prepare(
      "SELECT itemID,parentItemID FROM itemAttachments JOIN items USING(itemID) WHERE key=?",
    )
    .get(attachmentKey) as { itemID: number; parentItemID: number };
  await using cleanup = new AsyncDisposableStack();
  cleanup.defer(async () => {
    const restored = await obRun(
      vaultId,
      async ({ app, zotlit }, { saved }) => {
        app.workspace.requestActiveLeafEvents.run();
        const oldServices = zotlit.services;
        await app.plugins.disablePlugin("zotlit");
        await oldServices.pdfAnnotationEditor[Symbol.asyncDispose]();
        for (let i = 0; i < 200 && !oldServices.bridge.closed(); i++)
          await new Promise((r) => setTimeout(r, 25));
        if (!oldServices.bridge.closed())
          throw new Error("The ZotLit services did not close");
        app.saveLocalStorage("zotlit-use-ledger", JSON.parse(saved).ledger);
        await app.plugins.enablePlugin("zotlit");
        return JSON.stringify(zotlit.services.useLedger.current);
      },
      { saved },
    );
    expect(JSON.parse(restored)).toEqual(JSON.parse(saved).ledger ?? {});
  });
  cleanup.defer(async () => {
    db.prepare("UPDATE itemAttachments SET parentItemID=? WHERE itemID=?").run(
      attachment.parentItemID,
      attachment.itemID,
    );
    await obRun(
      vaultId,
      async ({ app, zotlit }, { savedJson }) => {
        const s = zotlit.services;
        (
          app.workspace.getLeavesOfType(
            "pdf",
          ) as (import("obsidian").WorkspaceLeaf & {
            view: PagePdfView;
          })[]
        ).forEach((l) => l.detach());
        const saved = JSON.parse(savedJson);
        s.bridge.runSync(
          s.settings.update({
            "library.document": saved.settings["library.document"] ?? null,
          }),
        );
        await s.bridge.runPromise(s.settings.flush);
        await app.workspace.changeLayout(saved.layout);
        await s.zoteroReads.refresh();
      },
      { savedJson: saved },
    );
  });
  await obRun(
    vaultId,
    async ({ app, zotlit, page }) => {
      const { until } = page;
      const s = zotlit.services;
      (
        app.workspace.getLeavesOfType(
          "pdf",
        ) as (import("obsidian").WorkspaceLeaf & {
          view: PagePdfView;
        })[]
      ).forEach((l) => l.detach());
      (
        app.workspace.getLeavesOfType(
          "zotlit-library",
        ) as (import("obsidian").WorkspaceLeaf & {
          view: import("../../../apps/obsidian/src/views/library/view.ts").LibraryView;
        })[]
      ).forEach((l) => l.detach());
      s.bridge.runSync(s.settings.update({ "library.document": null }));
      await s.bridge.runPromise(s.settings.flush);
      app.commands.executeCommandById("zotlit:open-library-view");
      await until(
        "Recent",
        () =>
          (
            app.workspace.getLeavesOfType(
              "zotlit-library",
            ) as (import("obsidian").WorkspaceLeaf & {
              view: import("../../../apps/obsidian/src/views/library/view.ts").LibraryView;
            })[]
          )[0]?.view.query,
      );
    },
    undefined,
  );

  await obRun(
    vaultId,
    async ({ app, zotlit }, { itemId }) => {
      const s = zotlit.services;
      app.workspace.protocolHandler.handlers.get("zotlit/open-attachment")!({
        action: "zotlit/open-attachment",
        item: itemId,
        "source-id": s.zoteroPref.sourceId!,
      });
    },
    { itemId: String(attachment.itemID) },
  );
  await obRun(
    vaultId,
    async ({ app, zotlit, page }, { notePath, attachmentKey }) => {
      const { until } = page;
      const s = zotlit.services;
      await until(
        "PDF and resolved Attachment",
        () => {
          const leaf = (
            app.workspace.getLeavesOfType(
              "pdf",
            ) as (import("obsidian").WorkspaceLeaf & {
              view: PagePdfView;
            })[]
          ).find((l) => l.view.file?.path === notePath);
          return (
            (leaf?.view.viewer?.child?.pdfViewer?.pdfViewer?.pagesCount ?? 0) >
              0 &&
            leaf!.view.viewer.child.getPage(1)?.pdfPage &&
            s.pdfAnnotationEditor.bindings.find((b) => b.filePath === notePath)
              ?.session?.target?.attachmentKey === attachmentKey
          );
        },
        20000,
      );
    },
    { notePath: path, attachmentKey },
  );
  expect(
    (
      await obRun(
        vaultId,
        async ({ zotlit }) => {
          return Object.fromEntries(
            Object.entries(zotlit.services.useLedger.current).map(
              ([key, value]) =>
                [key, { ...value, instant: value.instant.toString() }] as const,
            ),
          );
        },
        undefined,
      )
    )[itemKey]?.kind,
  ).toBe("read");
  await obRunUntil(
    vaultId,
    async ({ app }) => {
      const view = (
        app.workspace.getLeavesOfType(
          "zotlit-library",
        ) as (import("obsidian").WorkspaceLeaf & {
          view: import("../../../apps/obsidian/src/views/library/view.ts").LibraryView;
        })[]
      )[0]!.view;
      await view.query.settled;
      return [
        ...view.contentEl.querySelectorAll<HTMLElement>(
          "[data-query-papers-row]",
        ),
      ].map((n) => n.getAttribute("data-query-papers-row"));
    },
    undefined,
    {
      what: "PDF read first in Recent",
      ready: (value) =>
        value !== null && ((keys) => keys[0]! === itemKey)(value),
    },
  );
  const reason = await obRun(
    vaultId,
    async ({ app }) => {
      const row = (
        app.workspace.getLeavesOfType(
          "zotlit-library",
        ) as (import("obsidian").WorkspaceLeaf & {
          view: import("../../../apps/obsidian/src/views/library/view.ts").LibraryView;
        })[]
      )[0]!.view.contentEl.querySelector<HTMLElement>(
        '[data-query-papers-row="RUGIER24"]',
      )!;
      return row.querySelector<HTMLElement>("[data-query-papers-title]")!
        .parentElement!.lastElementChild!.textContent;
    },
    undefined,
  );
  expect(reason).toContain("read ");
  expect(reason.endsWith("in Obsidian")).toBe(true);
  await obRun(
    vaultId,
    async ({ app, page }) => {
      const { until } = page;

      app.commands.executeCommandById("zotlit:note-quick-switcher");
      await until("PDF parent first in quick switcher", () =>
        activeDocument
          .querySelector<HTMLElement>(".prompt .suggestion-item")
          ?.textContent.includes("Ten Simple Rules for Better Figures"),
      );
      activeDocument.querySelector<HTMLElement>(".prompt input")!.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          code: "Escape",
          keyCode: 27,
          which: 27,
          bubbles: true,
        }),
      );
    },
    undefined,
  );
  const firstRead = (
    await obRun(
      vaultId,
      async ({ zotlit }) => {
        return Object.fromEntries(
          Object.entries(zotlit.services.useLedger.current).map(
            ([key, value]) =>
              [key, { ...value, instant: value.instant.toString() }] as const,
          ),
        );
      },
      undefined,
    )
  )[itemKey]!;
  // A real page transition reaches PDF.js's pagechanging event; rendering and
  // immediate turns stay inside the five-minute limit established by open.
  await obRun(
    vaultId,
    async ({ app, page }) => {
      const { until } = page;

      const view = (
        app.workspace.getLeavesOfType(
          "pdf",
        ) as (import("obsidian").WorkspaceLeaf & {
          view: PagePdfView;
        })[]
      )[0]!.view;
      const reader = view.viewer.child;
      page.scratch.pageChanges = 0;
      reader.on("pagechanging", () => page.scratch.pageChanges!++);
      reader.applySubpath("#page=2");
      await until("real page change", () => page.scratch.pageChanges! > 0);
    },
    undefined,
  );
  expect(
    (
      await obRun(
        vaultId,
        async ({ zotlit }) => {
          return Object.fromEntries(
            Object.entries(zotlit.services.useLedger.current).map(
              ([key, value]) =>
                [key, { ...value, instant: value.instant.toString() }] as const,
            ),
          );
        },
        undefined,
      )
    )[itemKey],
  ).toEqual(firstRead);
  await cli([`vault=${vaultId}`, "plugin:reload", "id=zotlit"]);
  await obRun(
    vaultId,
    async ({ app, zotlit, page }, { notePath, attachmentKey }) => {
      const { until } = page;
      const s = zotlit.services;
      await until(
        "PDF and resolved Attachment",
        () => {
          const leaf = (
            app.workspace.getLeavesOfType(
              "pdf",
            ) as (import("obsidian").WorkspaceLeaf & {
              view: PagePdfView;
            })[]
          ).find((l) => l.view.file?.path === notePath);
          return (
            (leaf?.view.viewer?.child?.pdfViewer?.pdfViewer?.pagesCount ?? 0) >
              0 &&
            leaf!.view.viewer.child.getPage(1)?.pdfPage &&
            s.pdfAnnotationEditor.bindings.find((b) => b.filePath === notePath)
              ?.session?.target?.attachmentKey === attachmentKey
          );
        },
        20000,
      );
    },
    { notePath: path, attachmentKey },
  );
  expect(
    (
      await obRun(
        vaultId,
        async ({ zotlit }) => {
          return Object.fromEntries(
            Object.entries(zotlit.services.useLedger.current).map(
              ([key, value]) =>
                [key, { ...value, instant: value.instant.toString() }] as const,
            ),
          );
        },
        undefined,
      )
    )[itemKey],
  ).toEqual(firstRead);
  await reloadWindow();
  await obRun(
    vaultId,
    async ({ app, zotlit, page }, { notePath, attachmentKey }) => {
      const { until } = page;
      const s = zotlit.services;
      await until(
        "PDF and resolved Attachment",
        () => {
          const leaf = (
            app.workspace.getLeavesOfType(
              "pdf",
            ) as (import("obsidian").WorkspaceLeaf & {
              view: PagePdfView;
            })[]
          ).find((l) => l.view.file?.path === notePath);
          return (
            (leaf?.view.viewer?.child?.pdfViewer?.pdfViewer?.pagesCount ?? 0) >
              0 &&
            leaf!.view.viewer.child.getPage(1)?.pdfPage &&
            s.pdfAnnotationEditor.bindings.find((b) => b.filePath === notePath)
              ?.session?.target?.attachmentKey === attachmentKey
          );
        },
        20000,
      );
    },
    { notePath: path, attachmentKey },
  );
  expect(
    (
      await obRun(
        vaultId,
        async ({ zotlit }) => {
          return Object.fromEntries(
            Object.entries(zotlit.services.useLedger.current).map(
              ([key, value]) =>
                [key, { ...value, instant: value.instant.toString() }] as const,
            ),
          );
        },
        undefined,
      )
    )[itemKey],
  ).toEqual(firstRead);
  await obRun(
    vaultId,
    async ({ app }) => {
      const reader = (
        app.workspace.getLeavesOfType(
          "pdf",
        ) as (import("obsidian").WorkspaceLeaf & {
          view: PagePdfView;
        })[]
      )[0]!.view.viewer.child;
      const pdfPage = reader.getPage(
        reader.pdfViewer.pdfViewer.currentPageNumber,
      );
      pdfPage!.reset();
      await pdfPage!.draw();
    },
    undefined,
  );
  expect(
    (
      await obRun(
        vaultId,
        async ({ zotlit }) => {
          return Object.fromEntries(
            Object.entries(zotlit.services.useLedger.current).map(
              ([key, value]) =>
                [key, { ...value, instant: value.instant.toString() }] as const,
            ),
          );
        },
        undefined,
      )
    )[itemKey],
  ).toEqual(firstRead);
  // The restored reader may turn pages later. A fresh plugin has no page
  // throttle history, so this real transition proves the subscription records.
  await obRun(
    vaultId,
    async ({ app, zotlit, page }, { itemKey, firstInstant }) => {
      const { until } = page;
      const s = zotlit.services;
      const reader = (
        app.workspace.getLeavesOfType(
          "pdf",
        ) as (import("obsidian").WorkspaceLeaf & {
          view: PagePdfView;
        })[]
      )[0]!.view.viewer.child;
      reader.applySubpath(
        reader.pdfViewer.pdfViewer.currentPageNumber === 1
          ? "#page=2"
          : "#page=1",
      );
      await until(
        "page read",
        () => s.useLedger.get(itemKey)?.instant.toString() !== firstInstant,
      );
    },
    { itemKey, firstInstant: firstRead.instant },
  );
  const pageRead = (
    await obRun(
      vaultId,
      async ({ zotlit }) => {
        return Object.fromEntries(
          Object.entries(zotlit.services.useLedger.current).map(
            ([key, value]) =>
              [key, { ...value, instant: value.instant.toString() }] as const,
          ),
        );
      },
      undefined,
    )
  )[itemKey]!;
  await obRun(
    vaultId,
    async ({ app }) => {
      (
        app.workspace.getLeavesOfType(
          "pdf",
        ) as (import("obsidian").WorkspaceLeaf & {
          view: PagePdfView;
        })[]
      ).forEach((l) => l.detach());
      app.workspace.requestActiveLeafEvents.run();
    },
    undefined,
  );
  expect(
    (
      await obRun(
        vaultId,
        async ({ zotlit }) => {
          return Object.fromEntries(
            Object.entries(zotlit.services.useLedger.current).map(
              ([key, value]) =>
                [key, { ...value, instant: value.instant.toString() }] as const,
            ),
          );
        },
        undefined,
      )
    )[itemKey]?.instant,
  ).not.toBe(pageRead.instant);
  const closed = (
    await obRun(
      vaultId,
      async ({ zotlit }) => {
        return Object.fromEntries(
          Object.entries(zotlit.services.useLedger.current).map(
            ([key, value]) =>
              [key, { ...value, instant: value.instant.toString() }] as const,
          ),
        );
      },
      undefined,
    )
  )[itemKey]!;
  await obRun(
    vaultId,
    async ({ app, page }, { path }) => {
      const { until } = page;

      const leaf = (
        app.workspace.getLeavesOfType(
          "file-explorer",
        ) as (import("obsidian").WorkspaceLeaf & {
          view: FileExplorerView;
        })[]
      )[0]!;
      app.workspace.leftSplit.expand();
      await app.workspace.revealLeaf(leaf);
      leaf.view.revealInFolder(app.vault.getFileByPath(path)!);
      const row = await until(
        "PDF file explorer row",
        () => leaf.view.fileItems[path]?.selfEl,
      );
      row.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    },
    { path },
  );
  await obRun(
    vaultId,
    async ({ app, zotlit, page }, { notePath, attachmentKey }) => {
      const { until } = page;
      const s = zotlit.services;
      await until(
        "PDF and resolved Attachment",
        () => {
          const leaf = (
            app.workspace.getLeavesOfType(
              "pdf",
            ) as (import("obsidian").WorkspaceLeaf & {
              view: PagePdfView;
            })[]
          ).find((l) => l.view.file?.path === notePath);
          return (
            (leaf?.view.viewer?.child?.pdfViewer?.pdfViewer?.pagesCount ?? 0) >
              0 &&
            leaf!.view.viewer.child.getPage(1)?.pdfPage &&
            s.pdfAnnotationEditor.bindings.find((b) => b.filePath === notePath)
              ?.session?.target?.attachmentKey === attachmentKey
          );
        },
        20000,
      );
    },
    { notePath: path, attachmentKey },
  );
  expect(
    (
      await obRun(
        vaultId,
        async ({ zotlit }) => {
          return Object.fromEntries(
            Object.entries(zotlit.services.useLedger.current).map(
              ([key, value]) =>
                [key, { ...value, instant: value.instant.toString() }] as const,
            ),
          );
        },
        undefined,
      )
    )[itemKey]?.instant,
  ).not.toBe(closed.instant);
  await obRun(
    vaultId,
    async ({ app }) => {
      (
        app.workspace.getLeavesOfType(
          "pdf",
        ) as (import("obsidian").WorkspaceLeaf & {
          view: PagePdfView;
        })[]
      ).forEach((l) => l.detach());
      app.workspace.requestActiveLeafEvents.run();
    },
    undefined,
  );
  // Turn the Fixture Attachment into a standalone one, then reload the plugin
  // to resolve it from the actual database rather than an old held path index.
  db.prepare("UPDATE itemAttachments SET parentItemID=NULL WHERE itemID=?").run(
    attachment.itemID,
  );
  await cli([`vault=${vaultId}`, "plugin:reload", "id=zotlit"]);
  const beforeStandalone = await obRun(
    vaultId,
    async ({ zotlit }) => {
      return Object.fromEntries(
        Object.entries(zotlit.services.useLedger.current).map(
          ([key, value]) =>
            [key, { ...value, instant: value.instant.toString() }] as const,
        ),
      );
    },
    undefined,
  );
  await obRun(
    vaultId,
    async ({ app }, { path }) => {
      await app.workspace.openLinkText(path, "", true);
    },
    { path },
  );
  await obRun(
    vaultId,
    async ({ app, zotlit, page }, { notePath, attachmentKey }) => {
      const { until } = page;
      const s = zotlit.services;
      await until(
        "PDF and resolved Attachment",
        () => {
          const leaf = (
            app.workspace.getLeavesOfType(
              "pdf",
            ) as (import("obsidian").WorkspaceLeaf & {
              view: PagePdfView;
            })[]
          ).find((l) => l.view.file?.path === notePath);
          return (
            (leaf?.view.viewer?.child?.pdfViewer?.pdfViewer?.pagesCount ?? 0) >
              0 &&
            leaf!.view.viewer.child.getPage(1)?.pdfPage &&
            s.pdfAnnotationEditor.bindings.find((b) => b.filePath === notePath)
              ?.session?.target?.attachmentKey === attachmentKey
          );
        },
        20000,
      );
    },
    { notePath: path, attachmentKey },
  );
  expect(
    await obRun(
      vaultId,
      async ({ zotlit }, { path }) => {
        return zotlit.services.pdfAnnotationEditor.bindings.find(
          (b) => b.filePath === path,
        )?.session.target;
      },
      { path },
    ),
  ).toMatchObject({ attachmentKey, itemKey: null });
  await obRun(
    vaultId,
    async ({ app }) => {
      (
        app.workspace.getLeavesOfType(
          "pdf",
        ) as (import("obsidian").WorkspaceLeaf & {
          view: PagePdfView;
        })[]
      )[0]!.view.viewer.child.applySubpath("#page=2");
    },
    undefined,
  );
  await obRun(
    vaultId,
    async ({ app }) => {
      (
        app.workspace.getLeavesOfType(
          "pdf",
        ) as (import("obsidian").WorkspaceLeaf & {
          view: PagePdfView;
        })[]
      ).forEach((l) => l.detach());
      app.workspace.requestActiveLeafEvents.run();
    },
    undefined,
  );
  expect(
    await obRun(
      vaultId,
      async ({ zotlit }) => {
        return Object.fromEntries(
          Object.entries(zotlit.services.useLedger.current).map(
            ([key, value]) =>
              [key, { ...value, instant: value.instant.toString() }] as const,
          ),
        );
      },
      undefined,
    ),
  ).toEqual(beforeStandalone);
}
