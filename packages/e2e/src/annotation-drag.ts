// Real Annotation View drag insertion across main and pop-out windows.
import { expect } from "vitest";

import { annotationPreparationModule } from "./annotation-preparation.ts";
import { obRun, obRunUntil } from "./obsidian-cli.ts";
import type {
  DragTrial,
  MarkdownLeaf,
  AnnotationLeaf,
} from "./page-notes-types.ts";

export async function verifyAnnotationDrag(
  vaultId: string,
  sourceHost: "main" | "popout",
  targetHost: "main" | "popout",
) {
  const effectPath = await annotationPreparationModule();
  try {
    await obRun(
      vaultId,
      async (
        { app, zotlit, page },
        { __typedArg0, __typedArg1, __typedArg2, __typedArg3, __typedArg4 },
      ) => {
        const s = (page.scratch.__zotlitDragTrial = {
          layout: app.workspace.getLayout(),
          mainWin: (
            app.workspace.rootSplit as import("obsidian").WorkspaceRoot & {
              containerEl: HTMLElement;
            }
          ).containerEl.win,
        } as DragTrial);
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
        const file =
          app.vault.getFileByPath(__typedArg1)! ??
          (await app.vault.create(__typedArg2, "LEFT RIGHT"));
        s.file = file;
        s.targetLeaf = app.workspace.getLeaf("tab") as MarkdownLeaf;
        await s.targetLeaf.openFile(file);
        if (__typedArg3 === "popout")
          app.workspace.moveLeafToPopout(s.targetLeaf);
        s.editor = s.targetLeaf.view.editor;
        s.editor.setValue("LEFT RIGHT");
        s.viewLeaf = app.workspace.getRightLeaf(false) as AnnotationLeaf;
        await s.viewLeaf.setViewState({
          type: "zotero-annotation-view",
          state: { followMode: "pinned", pinnedItemKey: "RUGIER24" },
        });
        if (__typedArg4 === "popout")
          app.workspace.moveLeafToPopout(s.viewLeaf);
        s.view = s.viewLeaf.view;
        await s.view.read;
        app.workspace.setActiveLeaf(s.viewLeaf, { focus: true });
        page.resetAnnotationPreparation(s);
        return String(true);
      },
      {
        __typedArg0: effectPath,
        __typedArg1: `Drag-${sourceHost}-${targetHost}.md`,
        __typedArg2: `Drag-${sourceHost}-${targetHost}.md`,
        __typedArg3: targetHost,
        __typedArg4: sourceHost,
      },
    );
    expect(
      await ((options: { expected: string; tries?: number }) =>
        obRunUntil(
          vaultId,
          async ({ page }) => {
            return String(
              String(
                !!page.scratch.__zotlitDragTrial!.view.contentEl.querySelector<HTMLElement>(
                  '[data-zotero-annotation-key="FDRFQ7C2"] [draggable]',
                ),
              ),
            );
          },
          undefined,
          {
            ready: (value) => value === options.expected,
            tries: options.tries,
            what: "annotation-drag.ts:34",
          },
        ).then(
          () => true,
          () => false,
        ))({ expected: "true" }),
    ).toBe(true);
    // The unrelated drop enters through CodeMirror's DOM input handler. The
    // tagged drop enters at Obsidian's editor-drop event, the plugin's public
    // consumer boundary, so core focus handling cannot activate the target.
    const native = JSON.parse(
      await obRun(
        vaultId,
        async ({ app, page }) => {
          const s = page.scratch.__zotlitDragTrial!;
          const card = s.view.contentEl.querySelector<HTMLElement>(
            '[data-zotero-annotation-key="FDRFQ7C2"]',
          );
          s.button = card!.querySelector<HTMLElement>("[draggable]")!;
          s.sourceWin = s.button.ownerDocument.defaultView!;
          s.targetWin = s.editor.cm.dom.ownerDocument.defaultView!;
          s.transfer = new s.sourceWin.DataTransfer();
          const start = new s.sourceWin.DragEvent("dragstart", {
            bubbles: true,
            cancelable: true,
            dataTransfer: s.transfer,
          });
          s.assetsBeforeStart = app.vault
            .getFiles()
            .filter((f) => f.name.startsWith("zotlit-excerpt-")).length;
          s.sourceWin.focus();
          app.workspace.setActiveLeaf(s.viewLeaf, { focus: true });
          s.button.dispatchEvent(start);
          s.assetsAfterStart = app.vault
            .getFiles()
            .filter((f) => f.name.startsWith("zotlit-excerpt-")).length;
          s.prepareCallsAfterStart = s.prepareCalls;
          s.activeAtStart = app.workspace.activeLeaf === s.viewLeaf;
          s.nativeAssetsBefore = app.vault
            .getFiles()
            .filter((f) => f.name.startsWith("zotlit-excerpt-")).length;
          const rect = s.editor.cm.coordsAtPos(0);
          if (!rect) throw new Error("Native drop coordinates unavailable");
          s.nativeCoords = {
            x: Math.floor(rect.left + 1),
            y: Math.floor((rect.top + rect.bottom) / 2),
          };
          s.nativePosition = s.editor.cm.posAtCoords(s.nativeCoords);
          s.nativeTransfer = new s.targetWin.DataTransfer();
          s.nativeTransfer.setData("text/plain", "NATIVE");
          const nativeDrop = new s.targetWin.DragEvent("drop", {
            bubbles: true,
            cancelable: true,
            dataTransfer: s.nativeTransfer,
            clientX: s.nativeCoords.x,
            clientY: s.nativeCoords.y,
          });
          s.editor.cm.contentDOM.dispatchEvent(nativeDrop);
          const result = {
            afterUndo: "",
            value: s.editor.getValue(),
            position: s.nativePosition,
            prepareCalls: s.prepareCalls,
            assetCount: app.vault
              .getFiles()
              .filter((f) => f.name.startsWith("zotlit-excerpt-")).length,
            assetsBefore: s.nativeAssetsBefore,
          };
          s.editor.undo();
          result.afterUndo = s.editor.getValue();
          s.sourceWin.focus();
          app.workspace.setActiveLeaf(s.viewLeaf, { focus: true });
          return String(JSON.stringify(result));
        },
        undefined,
      ),
    ) as {
      value: string;
      position: number;
      prepareCalls: number;
      assetCount: number;
      assetsBefore: number;
      afterUndo: string;
    };
    const nativeBaseline = "LEFT RIGHT";
    expect(native.value).toBe(
      `${nativeBaseline.slice(0, native.position)}NATIVE${nativeBaseline.slice(native.position)}`,
    );
    expect(native.prepareCalls).toBe(0);
    expect(native.assetCount).toBe(native.assetsBefore);
    expect(native.afterUndo).toBe("LEFT RIGHT");
    await obRun(
      vaultId,
      async ({ app, page }) => {
        const s = page.scratch.__zotlitDragTrial!;
        s.sourceWin.focus();
        app.workspace.setActiveLeaf(s.viewLeaf, { focus: true });
        return String(true);
      },
      undefined,
    );
    await obRun(
      vaultId,
      async ({ app, page }) => {
        const s = page.scratch.__zotlitDragTrial!;
        const original = s.editor.cm.posAtCoords.bind(s.editor.cm);
        s.posAtCoords = original;
        s.coordinateCalls = [];
        s.editor.cm.posAtCoords = new Proxy(original, {
          apply: (
            target,
            receiver: typeof s.editor.cm,
            args: [coords: { x: number; y: number }, precise?: false],
          ) => {
            const [coords, precise] = args;
            const position =
              precise === false ? target(coords, false) : target(coords);
            s.coordinateCalls.push({ coords, position });
            return position;
          },
        });
        const rect = s.editor.cm.coordsAtPos(5);
        if (!rect) throw new Error("Drop coordinates unavailable");
        s.expectedCoords = {
          x: Math.floor(rect.left + 1),
          y: Math.floor((rect.top + rect.bottom) / 2),
        };
        s.directPosition = original(s.expectedCoords, false);
        const drop = new s.targetWin.DragEvent("drop", {
          bubbles: true,
          cancelable: true,
          dataTransfer: s.transfer,
          clientX: s.expectedCoords.x,
          clientY: s.expectedCoords.y,
        });
        app.workspace.trigger("editor-drop", drop, s.editor, s.targetLeaf.view);
        s.dropPrevented = drop.defaultPrevented;
        return String(true);
      },
      undefined,
    );
    expect(
      await ((options: { expected: string; tries?: number }) =>
        obRunUntil(
          vaultId,
          async ({ page }) => {
            return String(
              String(page.scratch.__zotlitDragTrial!.prepareCalls === 1),
            );
          },
          undefined,
          {
            ready: (value) => value === options.expected,
            tries: options.tries,
            what: "annotation-drag.ts:95",
          },
        ).then(
          () => true,
          () => false,
        ))({
        expected: "true",
      }),
    ).toBe(true);
    const capture = JSON.parse(
      await obRun(
        vaultId,
        async ({ app, page }) => {
          return String(
            JSON.stringify({
              sourceMain:
                page.scratch.__zotlitDragTrial!.sourceWin ===
                page.scratch.__zotlitDragTrial!.mainWin,
              targetMain:
                page.scratch.__zotlitDragTrial!.targetWin ===
                page.scratch.__zotlitDragTrial!.mainWin,
              separate:
                page.scratch.__zotlitDragTrial!.sourceWin !==
                page.scratch.__zotlitDragTrial!.targetWin,
              noAsset:
                page.scratch.__zotlitDragTrial!.assetsAfterStart ===
                page.scratch.__zotlitDragTrial!.assetsBeforeStart,
              prepareCallsAfterStart:
                page.scratch.__zotlitDragTrial!.prepareCallsAfterStart,
              activeAtStart: page.scratch.__zotlitDragTrial!.activeAtStart,
              activeAfterCapture:
                app.workspace.activeLeaf ===
                page.scratch.__zotlitDragTrial!.viewLeaf,
              targetInactive:
                app.workspace.activeLeaf !==
                page.scratch.__zotlitDragTrial!.targetLeaf,
              dropPrevented: page.scratch.__zotlitDragTrial!.dropPrevented,
              calls: page.scratch.__zotlitDragTrial!.coordinateCalls,
              expected: page.scratch.__zotlitDragTrial!.expectedCoords,
              directPosition: page.scratch.__zotlitDragTrial!.directPosition,
              notePath: page.scratch.__zotlitDragTrial!.options!.notePath,
            }),
          );
        },
        undefined,
      ),
    ) as {
      sourceMain: boolean;
      targetMain: boolean;
      separate: boolean;
      noAsset: boolean;
      prepareCallsAfterStart: number;
      activeAtStart: boolean;
      activeAfterCapture: boolean;
      targetInactive: boolean;
      dropPrevented: boolean;
      calls: { coords: { x: number; y: number }; position: number }[];
      expected: { x: number; y: number };
      directPosition: number;
      notePath: string;
    };
    expect(capture).toMatchObject({
      sourceMain: sourceHost === "main",
      targetMain: targetHost === "main",
      separate: sourceHost !== targetHost || sourceHost === "popout",
      noAsset: true,
      prepareCallsAfterStart: 0,
      activeAtStart: true,
      activeAfterCapture: true,
      targetInactive: true,
      dropPrevented: true,
      notePath: `Drag-${sourceHost}-${targetHost}.md`,
    });
    expect(capture.directPosition).toBeGreaterThanOrEqual(0);
    expect(capture.directPosition).toBeLessThanOrEqual("LEFT RIGHT".length);
    expect(capture.calls).toContainEqual({
      coords: capture.expected,
      position: capture.directPosition,
    });
    await obRun(
      vaultId,
      async ({ page }) => {
        page.scratch.__zotlitDragTrial!.editor.cm.dispatch({
          changes: { from: 0, insert: "user " },
        });
        page.scratch.__zotlitDragTrial!.release();
        return String(true);
      },
      undefined,
    );
    expect(
      await ((options: { expected: string; tries?: number }) =>
        obRunUntil(
          vaultId,
          async ({ page }) => {
            return String(
              String(page.scratch.__zotlitDragTrial!.finished === 1),
            );
          },
          undefined,
          {
            ready: (value) => value === options.expected,
            tries: options.tries,
            what: "annotation-drag.ts:142",
          },
        ).then(
          () => true,
          () => false,
        ))({
        expected: "true",
      }),
    ).toBe(true);
    expect(
      await obRun(
        vaultId,
        async ({ app, page }) => {
          return String(
            String(
              app.workspace.activeLeaf ===
                page.scratch.__zotlitDragTrial!.viewLeaf &&
                app.workspace.activeLeaf !==
                  page.scratch.__zotlitDragTrial!.targetLeaf,
            ),
          );
        },
        undefined,
      ),
    ).toBe("true");
    expect(
      await ((options: { expected: string; tries?: number }) =>
        obRunUntil(
          vaultId,
          async ({ page }) => {
            return String(
              String(
                page.scratch
                  .__zotlitDragTrial!.editor.getValue()
                  .includes("![[zotlit-excerpt-"),
              ),
            );
          },
          undefined,
          {
            ready: (value) => value === options.expected,
            tries: options.tries,
            what: "annotation-drag.ts:153",
          },
        ).then(
          () => true,
          () => false,
        ))({ expected: "true" }),
    ).toBe(true);
    const text = JSON.parse(
      await obRun(
        vaultId,
        async ({ page }) => {
          return String(
            JSON.stringify(page.scratch.__zotlitDragTrial!.editor.getValue()),
          );
        },
        undefined,
      ),
    ) as string;
    expect(text).toContain("![[zotlit-excerpt-");
    expect(text.split("FDRFQ7C2")).toHaveLength(2);
    // The one mention of the Annotation is its Durable Annotation Link.
    expect(text).toContain(
      "Page [2](zotero://open/library/items/RGRPDF24?annotation=FDRFQ7C2&page=2)",
    );
    // The default template cites the Rougier paper, at the page, after the quote.
    expect(text).toContain(" [@rougierTenSimpleRules2014, {p. 2}]");
    expect(text).not.toContain("file://");
    // The callout stands as its own block, even where the drop splits a line.
    const prefix = "LEFT RIGHT".slice(0, capture.directPosition);
    const suffix = "LEFT RIGHT".slice(capture.directPosition);
    expect(text.slice(0, text.indexOf("> [!note]"))).toBe(`user ${prefix}\n\n`);
    if (suffix) expect(text.endsWith(`\n\n${suffix}`)).toBe(true);
    expect(
      await ((options: { expected: string; tries?: number }) =>
        obRunUntil(
          vaultId,
          async ({ page }) => {
            return String(
              String(
                Array.from(
                  page.scratch.__zotlitDragTrial!.editor.cm.dom.querySelectorAll<HTMLImageElement>(
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
            what: "annotation-drag.ts:177",
          },
        ).then(
          () => true,
          () => false,
        ))({ expected: "true" }),
    ).toBe(true);
    await obRun(
      vaultId,
      async ({ page }) => {
        page.scratch.__zotlitDragTrial!.editor.undo();
        return String(true);
      },
      undefined,
    );
    expect(
      await obRun(
        vaultId,
        async ({ page }) => {
          return String(page.scratch.__zotlitDragTrial!.editor.getValue());
        },
        undefined,
      ),
    ).toBe("user LEFT RIGHT");
  } finally {
    await obRun(
      vaultId,
      async ({ app, page }) => {
        const s = page.scratch.__zotlitDragTrial!;
        if (!s) return String(true);
        try {
          page.restoreAnnotationPreparation(s);
          if (s.link) app.fileManager.generateMarkdownLink = s.link;
          if (s.editor?.cm && s.posAtCoords)
            s.editor.cm.posAtCoords = s.posAtCoords;
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
            delete page.scratch.__zotlitDragTrial;
          }
        }
        return String(true);
      },
      undefined,
    );
  }
}
