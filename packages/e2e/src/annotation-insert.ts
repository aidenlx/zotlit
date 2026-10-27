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
        {
          __typedArg0,
          __typedArg1,
          __typedArg2,
          __typedArg3,
          __typedArg4,
          __typedArg5,
        },
      ) => {
        const s = (page.scratch.__zotlitInsertTrial = {
          layout: app.workspace.getLayout(),
        } as InsertTrial);
        const services = zotlit.services;
        s.services = services;
        await page.installAnnotationPreparation(services, s, __typedArg0);
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
          app.vault.getFileByPath(__typedArg1)! ??
          (await app.vault.create(__typedArg2, "before TARGET after"));
        s.file = file;
        s.otherFile =
          app.vault.getFileByPath(__typedArg3)! ??
          (await app.vault.create(__typedArg4, "other editor"));
        s.leaf = app.workspace.getLeaf("tab") as MarkdownLeaf;
        await s.leaf.openFile(file);
        if (__typedArg5 === "popout") app.workspace.moveLeafToPopout(s.leaf);
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
        return String(true);
      },
      {
        __typedArg0: effectPath,
        __typedArg1: `Insert-${host}.md`,
        __typedArg2: `Insert-${host}.md`,
        __typedArg3: `Insert-other-${host}.md`,
        __typedArg4: `Insert-other-${host}.md`,
        __typedArg5: host,
      },
    );
    expect(
      await ((options: { expected: string; tries?: number }) =>
        obRunUntil(
          vaultId,
          async ({ page }) => {
            return String(
              String(
                !!page.scratch.__zotlitInsertTrial!.view.snapshot.annotations?.some(
                  (a) => a.key === "FDRFQ7C2",
                ),
              ),
            );
          },
          undefined,
          {
            ready: (value) => value === options.expected,
            tries: options.tries,
            what: "annotation-insert.ts:43",
          },
        ).then(
          () => true,
          () => false,
        ))({ expected: "true" }),
    ).toBe(true);
    expect(
      await obRun(
        vaultId,
        async ({ page }) => {
          return String(
            String(
              page.scratch.__zotlitInsertTrial!.leaf.view.editor.cm.dom
                .ownerDocument.defaultView === window,
            ),
          );
        },
        undefined,
      ),
    ).toBe(String(host === "main"));
    expect(
      await ((options: { expected: string; tries?: number }) =>
        obRunUntil(
          vaultId,
          async ({ page }) => {
            return String(
              String(
                !!page.scratch.__zotlitInsertTrial!.leaf.view.editor?.cm?.dom
                  .isConnected,
              ),
            );
          },
          undefined,
          {
            ready: (value) => value === options.expected,
            tries: options.tries,
            what: "annotation-insert.ts:56",
          },
        ).then(
          () => true,
          () => false,
        ))({ expected: "true" }),
    ).toBe(true);
    expect(
      await obRun(
        vaultId,
        async ({ app, page }) => {
          return String(
            String(
              app.vault
                .getFiles()
                .filter((f) => f.name.startsWith("zotlit-excerpt-")).length ===
                page.scratch.__zotlitInsertTrial!.assets,
            ),
          );
        },
        undefined,
      ),
    ).toBe("true");
    // The cards render once the read lands, a frame after the snapshot.
    expect(
      await ((options: { expected: string; tries?: number }) =>
        obRunUntil(
          vaultId,
          async ({ page }) => {
            return String(
              String(
                !!page.scratch.__zotlitInsertTrial!.view.contentEl.querySelector<HTMLElement>(
                  '.zt-annot-card[data-zotero-annotation-key="FDRFQ7C2"] [aria-label="More options"]',
                ),
              ),
            );
          },
          undefined,
          {
            ready: (value) => value === options.expected,
            tries: options.tries,
            what: "annotation-insert.ts:70",
          },
        ).then(
          () => true,
          () => false,
        ))({ expected: "true" }),
    ).toBe(true);
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
      expect(
        await ((options: { expected: string; tries?: number }) =>
          obRunUntil(
            vaultId,
            async ({ page }) => {
              return String(String(page.scratch.__zotlitInsertTrial!.started));
            },
            undefined,
            {
              ready: (value) => value === options.expected,
              tries: options.tries,
              what: "annotation-insert.ts:113",
            },
          ).then(
            () => true,
            () => false,
          ))({
          expected: "true",
        }),
      ).toBe(true);
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
      expect(
        await ((options: { expected: string; tries?: number }) =>
          obRunUntil(
            vaultId,
            async ({ page }, { __typedArg0 }) => {
              return String(
                String(
                  page.scratch.__zotlitInsertTrial!.finished === __typedArg0,
                ),
              );
            },
            { __typedArg0: mode === "supersede" ? 2 : 1 },
            {
              ready: (value) => value === options.expected,
              tries: options.tries,
              what: "annotation-insert.ts:128",
            },
          ).then(
            () => true,
            () => false,
          ))({
          expected: "true",
        }),
      ).toBe(true);
      if (mode !== "escape" && mode !== "switch" && mode !== "close") {
        expect(
          await ((options: { expected: string; tries?: number }) =>
            obRunUntil(
              vaultId,
              async ({ page }, { __typedArg0 }) => {
                return String(
                  String(
                    page.scratch
                      .__zotlitInsertTrial!.editor.getValue()
                      .includes(__typedArg0),
                  ),
                );
              },
              {
                __typedArg0:
                  mode === "disabled"
                    ? "[Zotero](zotero://"
                    : "zotlit-excerpt-",
              },
              {
                ready: (value) => value === options.expected,
                tries: options.tries,
                what: "annotation-insert.ts:138",
              },
            ).then(
              () => true,
              () => false,
            ))({ expected: "true" }),
        ).toBe(true);
      }
      const text =
        mode === "close"
          ? await obRun(
              vaultId,
              async ({ app, page }) => {
                return String(
                  await app.vault.read(page.scratch.__zotlitInsertTrial!.file),
                );
              },
              undefined,
            )
          : (JSON.parse(
              await obRun(
                vaultId,
                async ({ page }) => {
                  return String(
                    JSON.stringify(
                      page.scratch.__zotlitInsertTrial!.editor.getValue(),
                    ),
                  );
                },
                undefined,
              ),
            ) as string);
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
        expect(
          await ((options: { expected: string; tries?: number }) =>
            obRunUntil(
              vaultId,
              async ({ page }) => {
                return String(
                  String(
                    Array.from(
                      page.scratch.__zotlitInsertTrial!.editor.cm.dom.querySelectorAll<HTMLImageElement>(
                        "img",
                      ),
                    ).some(
                      (img) =>
                        img.src.includes("zotlit-excerpt-") &&
                        img.complete &&
                        img.naturalWidth > 0,
                    ),
                  ),
                );
              },
              undefined,
              {
                ready: (value) => value === options.expected,
                tries: options.tries,
                what: "annotation-insert.ts:173",
              },
            ).then(
              () => true,
              () => false,
            ))({ expected: "true" }),
        ).toBe(true);
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
            return String(true);
          },
          undefined,
        );
        expect(
          await obRun(
            vaultId,
            async ({ page }) => {
              return String(
                page.scratch.__zotlitInsertTrial!.editor.getValue(),
              );
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
            return String(true);
          },
          undefined,
        );
    }
  } finally {
    await obRun(
      vaultId,
      async ({ app, page }) => {
        const s = page.scratch.__zotlitInsertTrial!;
        if (!s) return String(true);
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
        return String(true);
      },
      undefined,
    );
  }
}
