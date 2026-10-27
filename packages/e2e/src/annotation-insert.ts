import { mkdir } from "node:fs/promises";
import { join } from "node:path";
// Real Annotation View menu insertion in the main window and a pop-out editor.
import { expect } from "vitest";

import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";

import { annotationPreparationModule } from "./annotation-preparation.ts";
import { obRun, obRunUntil } from "./obsidian-cli.ts";
import { cli } from "./obsidian-cli.ts";
import type {
  InsertTrial,
  MarkdownLeaf,
  AnnotationLeaf,
} from "./page-notes-types.ts";

export async function verifyAnnotationInsert(
  vaultId: string,
  host: "main" | "popout",
) {
  const effectPath = await annotationPreparationModule();
  try {
    await obRun(
      vaultId,
      async (
        { app, zotlit, page },
        { effectPath, hostNotePath, otherNotePath, host },
      ) => {
        const s = (page.scratch.__zotlitInsertTrial = {
          layout: app.workspace.getLayout(),
        } as InsertTrial);
        const services = zotlit.services;
        s.services = services;
        await page.installAnnotationPreparation(services, s, effectPath);
        s.link = app.fileManager.generateMarkdownLink;
        app.fileManager.generateMarkdownLink = new Proxy(s.link, {
          apply: (
            target,
            receiver: import("obsidian").FileManager,
            args: Parameters<
              import("obsidian").FileManager["generateMarkdownLink"]
            >,
          ) => {
            const [file] = args;
            if (
              file.name?.startsWith("zotlit-excerpt-") &&
              !app.vault.getFileByPath(file.path)!
            )
              throw new Error(
                "Excerpt link rendered before vault registration",
              );
            return Reflect.apply(target, receiver, args);
          },
        });
        s.importEnabled = services.bridge.runSync(services.settings.current)[
          "attachment.import"
        ];
        services.bridge.runSync(
          services.settings.update({ "attachment.import": true }),
        );
        for (const leaf of app.workspace.getLeavesOfType("pdf")) leaf.detach();
        const file =
          app.vault.getFileByPath(hostNotePath)! ??
          (await app.vault.create(hostNotePath, "before TARGET after"));
        s.file = file;
        s.otherFile =
          app.vault.getFileByPath(otherNotePath)! ??
          (await app.vault.create(otherNotePath, "other editor"));
        s.leaf = app.workspace.getLeaf("tab") as MarkdownLeaf;
        await s.leaf.openFile(file);
        if (host === "popout") app.workspace.moveLeafToPopout(s.leaf);
        const viewLeaf = app.workspace.getRightLeaf(false) as AnnotationLeaf;
        s.viewLeaf = viewLeaf;
        await viewLeaf.setViewState({
          type: "zotero-annotation-view",
          state: { followMode: "pinned", pinnedItemKey: "RUGIER24" },
        });
        s.view = viewLeaf.view;
        await s.view.read;
        s.assets = app.vault
          .getFiles()
          .filter((f) => f.name.startsWith("zotlit-excerpt-")).length;
      },
      {
        effectPath,
        hostNotePath: `Insert-${host}.md`,
        otherNotePath: `Insert-other-${host}.md`,
        host,
      },
    );
    await obRunUntil(
      vaultId,
      async ({ page }) => {
        return !!page.scratch.__zotlitInsertTrial!.view.snapshot.annotations?.some(
          (a) => a.key === "FDRFQ7C2",
        );
      },
      undefined,
      {
        what: "annotation FDRFQ7C2 to appear in the insert trial view snapshot",
      },
    );
    expect(
      await obRun(
        vaultId,
        async ({ page }) => {
          return (
            page.scratch.__zotlitInsertTrial!.leaf.view.editor.cm.dom
              .ownerDocument.defaultView === window
          );
        },
        undefined,
      ),
    ).toBe(host === "main");
    await obRunUntil(
      vaultId,
      async ({ page }) => {
        return !!page.scratch.__zotlitInsertTrial!.leaf.view.editor?.cm?.dom
          .isConnected;
      },
      undefined,
      { what: "the insert trial editor to attach to the DOM" },
    );
    expect(
      await obRun(
        vaultId,
        async ({ app, page }) => {
          return (
            app.vault
              .getFiles()
              .filter((f) => f.name.startsWith("zotlit-excerpt-")).length ===
            page.scratch.__zotlitInsertTrial!.assets
          );
        },
        undefined,
      ),
    ).toBe(true);
    // The cards render once the read lands, a frame after the snapshot.
    await obRunUntil(
      vaultId,
      async ({ page }) => {
        return !!page.scratch.__zotlitInsertTrial!.view.contentEl.querySelector<HTMLElement>(
          '.zt-annot-card[data-zotero-annotation-key="FDRFQ7C2"] [aria-label="More options"]',
        );
      },
      undefined,
      { what: "the More options button on the annotation card FDRFQ7C2" },
    );
    for (const mode of [
      "success",
      "ink",
      "supersede",
      "edit",
      "escape",
      "switch",
      "disabled",
      "close",
    ] as const) {
      await obRun(
        vaultId,
        async ({ app, page }, { mode, host }) => {
          const s = page.scratch.__zotlitInsertTrial!;
          s.editor = s.leaf.view.editor;
          s.editor.setValue("before TARGET after");
          s.editor.setSelection({ line: 0, ch: 7 }, { line: 0, ch: 13 });
          await app.workspace.revealLeaf(s.viewLeaf);
          await app.workspace.revealLeaf(s.leaf);
          s.leaf.getContainer().focus();
          app.workspace.setActiveLeaf(s.leaf, { focus: true });
          page.resetAnnotationPreparation(s);
          s.services.bridge.runSync(
            s.services.settings.update({
              "attachment.import": mode !== "disabled",
            }),
          );
          const annotation = s.view.snapshot.annotations!.find(
            (annotation) =>
              annotation.key === (mode === "ink" ? "TYY6Z6ZF" : "FDRFQ7C2"),
          )!;
          if (mode === "success" && host === "main") {
            const button = s.view.contentEl.querySelector<HTMLElement>(
              '.zt-annot-card[data-zotero-annotation-key="FDRFQ7C2"] [aria-label="More options"]',
            );
            if (!button) throw new Error("Annotation card menu missing");
            button.scrollIntoView({ block: "center", behavior: "instant" });
            await page.stands(button, "card More options");
            const rect = button.getBoundingClientRect();
            const wc = (
              s.view.contentEl.win as Window & {
                electronWindow: { webContents: import("electron").WebContents };
              }
            ).electronWindow.webContents;
            const point = {
              x: Math.round(rect.x + rect.width / 2),
              y: Math.round(rect.y + rect.height / 2),
            };
            wc.sendInputEvent({ type: "mouseMove", ...point });
            wc.sendInputEvent({
              type: "mouseDown",
              button: "left",
              clickCount: 1,
              ...point,
            });
            wc.sendInputEvent({
              type: "mouseUp",
              button: "left",
              clickCount: 1,
              ...point,
            });
            await page.until(
              "Mouse did not move focus to the sidebar",
              () => !app.workspace.activeEditor?.editor,
            );
          } else {
            const button =
              s.view.contentEl.querySelector<HTMLButtonElement>("button")!;
            s.view.gestures!.onMoreOptions(page.menuEvent(button), annotation);
          }
          const menu = Array.from(
            s.view.contentEl.doc.querySelectorAll<HTMLElement>(".menu-item"),
          ).find((el) => el.textContent.trim() === "Insert into note");
          if (!menu || menu.classList.contains("is-disabled"))
            throw new Error("Insert menu unavailable");
          page.press(menu, "Insert into note");
        },
        { mode, host },
      );
      await obRunUntil(
        vaultId,
        async ({ page }) => {
          return page.scratch.__zotlitInsertTrial!.started;
        },
        undefined,
        { what: "the insert trial to start" },
      );
      await obRun(
        vaultId,
        ({ app, page }, { mode }) => {
          const s = page.scratch.__zotlitInsertTrial!;
          if (mode === "edit") {
            s.editor.cm.dispatch({ changes: { from: 0, insert: "user " } });
            s.editor.setCursor({ line: 0, ch: 0 });
          }
          if (mode === "supersede") {
            s.view.gestures!.onMoreOptions(
              page.menuEvent(
                s.view.contentEl.querySelector<HTMLButtonElement>("button")!,
              ),
              s.view.snapshot.annotations!.find((a) => a.key === "FDRFQ7C2")!,
            );
            page.press(
              Array.from(
                s.view.contentEl.doc.querySelectorAll<HTMLElement>(
                  ".menu-item",
                ),
              ).find((el) => el.textContent.trim() === "Insert into note"),
              "Insert into note",
            );
          }
          if (mode === "escape") {
            const win = s.editor.cm.dom.ownerDocument.defaultView!;
            win.dispatchEvent(
              new win.KeyboardEvent("keydown", {
                key: "Escape",
                bubbles: true,
              }),
            );
          }
          if (mode === "switch") {
            s.other = app.workspace.getLeaf("tab");
            void s.other.openFile(s.otherFile).then(() => {
              app.workspace.setActiveLeaf(s.other!, { focus: true });
              s.release();
            });
            return;
          }
          if (mode === "close") s.leaf.detach();
          s.release();
        },
        { mode },
      );
      await obRunUntil(
        vaultId,
        async ({ page }, { expectedFinished }) => {
          return (
            page.scratch.__zotlitInsertTrial!.finished === expectedFinished
          );
        },
        { expectedFinished: mode === "supersede" ? 2 : 1 },
        { what: "the insert trial finished flag to match the expected value" },
      );
      if (mode !== "escape" && mode !== "switch" && mode !== "close") {
        await obRunUntil(
          vaultId,
          async ({ page }, { expectedMarker }) => {
            return page.scratch
              .__zotlitInsertTrial!.editor.getValue()
              .includes(expectedMarker);
          },
          {
            expectedMarker:
              mode === "disabled" ? "[Zotero](zotero://" : "zotlit-excerpt-",
          },
          { what: "the editor to contain the expected annotation marker" },
        );
      }
      const text =
        mode === "close"
          ? await obRun(
              vaultId,
              async ({ app, page }) => {
                return await app.vault.read(
                  page.scratch.__zotlitInsertTrial!.file,
                );
              },
              undefined,
            )
          : ((await obRun(
              vaultId,
              async ({ page }) => {
                return page.scratch.__zotlitInsertTrial!.editor.getValue();
              },
              undefined,
            )) as string);
      if (mode === "escape" || mode === "switch" || mode === "close") {
        expect(text).toBe("before TARGET after");
      } else if (mode === "disabled") {
        // The placeholder points back with the Durable Annotation Link.
        expect(text).toContain(
          "[Zotero](zotero://open/library/items/RGRPDF24?annotation=FDRFQ7C2&page=2)",
        );
        expect(text).not.toContain("file://");
        expect(text).not.toContain("![[");
      } else {
        expect(text).toContain("![[");
        expect(text).toContain("zotlit-excerpt-");
        // The default template cites the Rougier paper, at the Annotation's
        // page, after the embedded excerpt.
        expect(text).toMatch(
          /\]\] \[@rougierTenSimpleRules2014, \{p\. \d+\}\]/,
        );
        expect(text.split("zotlit-excerpt-")).toHaveLength(2);
        await obRunUntil(
          vaultId,
          async ({ page }) => {
            return Array.from(
              page.scratch.__zotlitInsertTrial!.editor.cm.dom.querySelectorAll<HTMLImageElement>(
                "img",
              ),
            ).some(
              (img) =>
                img.src.includes("zotlit-excerpt-") &&
                img.complete &&
                img.naturalWidth > 0,
            );
          },
          undefined,
          {
            what: "the excerpt image to finish loading in the insert trial editor",
          },
        );
        expect(
          text.startsWith(mode === "edit" ? "user before " : "before "),
        ).toBe(true);
        if (mode === "success") {
          const folder = join(
            await getWorkspaceRoot(import.meta.dirname),
            ".scratch/e2e-screenshots",
          );
          await mkdir(folder, { recursive: true });
          await cli([
            `vault=${vaultId}`,
            "dev:screenshot",
            `path=${join(folder, `1175-${host}.png`)}`,
          ]);
        }
        await obRun(
          vaultId,
          async ({ page }) => {
            page.scratch.__zotlitInsertTrial!.editor.undo();
          },
          undefined,
        );
        expect(
          await obRun(
            vaultId,
            async ({ page }) => {
              return page.scratch.__zotlitInsertTrial!.editor.getValue();
            },
            undefined,
          ),
        ).toBe(
          mode === "edit" ? "user before TARGET after" : "before TARGET after",
        );
      }
      if (mode === "switch")
        await obRun(
          vaultId,
          async ({ page }) => {
            page.scratch.__zotlitInsertTrial!.other!.detach();
          },
          undefined,
        );
    }
  } finally {
    await obRun(
      vaultId,
      async ({ app, page }) => {
        const s = page.scratch.__zotlitInsertTrial!;
        if (!s) return;
        try {
          page.restoreAnnotationPreparation(s);
          if (s.link) app.fileManager.generateMarkdownLink = s.link;
          if (s.importEnabled !== undefined)
            s.services.bridge.runSync(
              s.services.settings.update({
                "attachment.import": s.importEnabled,
              }),
            );
        } finally {
          try {
            if (s.layout) await app.workspace.changeLayout(s.layout);
          } finally {
            delete page.scratch.__zotlitInsertTrial;
          }
        }
      },
      undefined,
    );
  }
}
