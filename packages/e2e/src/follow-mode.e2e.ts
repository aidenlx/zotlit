import { readFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { discardFixture, getFixtureLayout } from "@zotlit/scripts/fixture";

import type { AnnotationView } from "@/views/annot-view/view";

import { prepareRunWindow } from "./background-throttling.ts";
import { reachable } from "./e2e-run-fixture.ts";
import { annotationAttachment, workspaceRoot } from "./e2e-run-fixture.ts";
import { registerEndToEndRunHooks, run } from "./e2e-run-lifecycle.ts";
import { obRun, obRunUntil } from "./obsidian-cli.ts";
import { cliCommand } from "./obsidian-cli.ts";
import { clearVault, e2eVaultDir, vaultScript } from "./vault-script.ts";

describe.skipIf(!reachable)("End-to-end Run", () => {
  registerEndToEndRunHooks();

  it("renders the header menu's Follow Mode entries inside the popup's own box", async () => {
    // An earlier case leaves the settings modal open over the workspace.
    await obRun(
      run.vaultId,
      async ({ app }) => {
        app.setting.close();
        var type = "zotero-annotation-view";
        var leaf = app.workspace.getLeavesOfType(type)[0];
        if (!leaf) {
          leaf = app.workspace.getRightLeaf(false)!;
          await leaf.setViewState({ type: type, active: true });
        }
        void app.workspace.revealLeaf(leaf!);
        return String(true);
      },
      undefined,
    );
    await obRunUntil(
      run.vaultId,
      async ({ app }) => {
        return !!(
          app.workspace.getLeavesOfType("zotero-annotation-view")[0]?.view as
            | AnnotationView
            | undefined
        )?.contentEl.querySelector("button.zt-annot-header");
      },
      undefined,
      { what: "the Annotation View header menu button to render" },
    );
    await obRun(
      run.vaultId,
      async ({ app, page }) => {
        const { press, stands } = page;
        press(
          await stands(
            (
              app.workspace.getLeavesOfType("zotero-annotation-view")[0]
                ?.view as AnnotationView | undefined
            )?.contentEl.querySelector<HTMLElement>("button.zt-annot-header"),
            "Annotation View header",
          ),
          "Annotation View header",
        );
        return String(true);
      },
      undefined,
    );
    await obRunUntil(
      run.vaultId,
      async ({ app }) => {
        return !!(
          app.workspace.getLeavesOfType("zotero-annotation-view")[0]?.view as
            | AnnotationView
            | undefined
        )?.contentEl.doc.querySelector(".menu");
      },
      undefined,
      { what: "the header menu popup to open in the Annotation View document" },
    );

    const report = JSON.parse(
      await obRun(
        run.vaultId,
        async ({ app }) => {
          var popup = (
            app.workspace.getLeavesOfType("zotero-annotation-view")[0]?.view as
              | AnnotationView
              | undefined
          )?.contentEl.doc.querySelector<HTMLElement>(".menu")!;
          var box = popup.getBoundingClientRect();
          var anchor = (
            app.workspace.getLeavesOfType("zotero-annotation-view")[0]?.view as
              | AnnotationView
              | undefined
          )?.contentEl
            .querySelector<HTMLElement>("button.zt-annot-header")!
            .getBoundingClientRect()!;
          var items = Array.from(popup.querySelectorAll(".menu-item"));
          return JSON.stringify({
            labels: items.map(function (item) {
              return item.textContent!.trim();
            }),
            covered: items.filter(function (item) {
              var rect = item.getBoundingClientRect();
              return (
                rect.height > 0 &&
                rect.top >= box.top - 1 &&
                rect.bottom <= box.bottom + 1
              );
            }).length,
            belowTriggerBy: Math.round(box.top - anchor.bottom),
            overlapsTriggerX:
              box.left < anchor.right && box.right > anchor.left,
          });
        },
        undefined,
      ),
    ) as {
      labels: string[];
      covered: number;
      belowTriggerBy: number;
      overlapsTriggerX: boolean;
    };

    // The two modes lead under their heading, always in this order. The pin's
    // row is followed by a reason line whenever this vault has nothing to pin,
    // so what comes after them is asserted by presence rather than by position.
    expect(report.labels.slice(0, 3)).toEqual([
      run.m.annot_view_header_menu_label(),
      run.m.annot_view_mode_active_tab(),
      run.m.annot_view_mode_zotero_reader(),
    ]);
    expect(report.labels).toContain(run.m.annot_view_pin_choose_item());
    // The assertion this test exists for: every entry the menu holds sits
    // inside the box the menu draws, so none is clipped out of sight.
    expect(report.covered).toBe(report.labels.length);
    // And it hangs off the button that opened it, rather than off a pointer
    // position the button never supplied. Which of the button's edges it lines
    // up with is Obsidian's call — it right-aligns a menu that would otherwise
    // overflow — so the assertion is that the two overlap at all.
    expect(report.belowTriggerBy).toBe(2);
    expect(report.overlapsTriggerX).toBe(true);

    // A second press closes it. The press is itself what dismisses an open
    // menu, so a trigger that does not check for that reopens the menu it just
    // closed and the menu never appears to shut.
    await obRun(
      run.vaultId,
      async ({ app, page }) => {
        const { press, stands } = page;
        press(
          await stands(
            (
              app.workspace.getLeavesOfType("zotero-annotation-view")[0]
                ?.view as AnnotationView | undefined
            )?.contentEl.querySelector<HTMLElement>("button.zt-annot-header"),
            "Annotation View header",
          ),
          "Annotation View header",
        );
        return String(true);
      },
      undefined,
    );
    await obRunUntil(
      run.vaultId,
      async ({ app }) => {
        return (
          (
            app.workspace.getLeavesOfType("zotero-annotation-view")[0]?.view as
              | AnnotationView
              | undefined
          )?.contentEl.doc.querySelector(".menu") === null
        );
      },
      undefined,
      { what: "the header menu popup to close" },
    );

    await obRun(
      run.vaultId,
      async ({ app }) => {
        var doc = (
          app.workspace.getLeavesOfType("zotero-annotation-view")[0]?.view as
            | AnnotationView
            | undefined
        )?.contentEl.doc!;
        doc.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
        app.workspace.detachLeavesOfType("zotero-annotation-view");
        return String(true);
      },
      undefined,
    );
  });

  it("answers zotlit:annotation-image with Zotero's PNG and a rendered ink PNG without an open reader", async () => {
    // Other cases rebuild the shared Fixture for disposable vaults. Keep this
    // database's linked PDF paths tied to the vault this case owns.
    const imageFixture = getFixtureLayout(
      join(workspaceRoot, ".scratch", "e2e-annotation-image-fixture"),
    );
    const imageVaultPath = e2eVaultDir(workspaceRoot, "annotation-image-vault");
    const imageVaultScript = vaultScript(workspaceRoot, imageFixture.root);
    await clearVault(imageVaultScript, imageVaultPath);
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await imageVaultScript(["remove", imageVaultPath, "--purge"]);
      await discardFixture(imageFixture);
    });
    const created = await imageVaultScript(["create", imageVaultPath]);
    const imageVaultId = created.stdout.trim().split("\n")[0]!.trim();
    await prepareRunWindow(imageVaultId);
    await obRun(
      imageVaultId,
      async ({ app, zotlit }) => {
        app.workspace.detachLeavesOfType("pdf");
        app.workspace.detachLeavesOfType("zotero-annotation-view");
        await zotlit.services.bridge.runPromise(
          zotlit.services.excerptImage.clear,
        );
        return String(true);
      },
      undefined,
    );
    const imageKey = "FDRFQ7C2";
    const inkKey = "TYY6Z6ZF";
    const cacheDirectory = join(imageFixture.dataDir, "cache", "library");
    const imagePath = join(cacheDirectory, `${imageKey}.png`);
    const inkCachePath = join(cacheDirectory, `${inkKey}.png`);
    const pdfPath = join(imageVaultPath, annotationAttachment.path!);
    const answer = async (key: string) =>
      JSON.parse(
        await cliCommand(imageVaultId, "zotlit:annotation-image", {
          args: { key },
          timeoutMs: 60_000,
        }),
      ) as {
        ok: boolean;
        command: string;
        key: string;
        format: string;
        provenance: string;
        path: string;
      };
    // A local PDF missing on this device exercises the service's Zotero fallback.
    await rename(pdfPath, `${pdfPath}.image-test`);
    try {
      const cached = await answer(imageKey);
      expect(cached).toMatchObject({
        ok: true,
        command: "zotlit:annotation-image",
        key: imageKey,
        format: "png",
        provenance: "zotero",
        path: imagePath,
      });
      expect((await readFile(cached.path)).subarray(0, 8)).toEqual(
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      );
    } finally {
      await rename(`${pdfPath}.image-test`, pdfPath);
    }
    await rename(inkCachePath, `${inkCachePath}.image-test`);
    try {
      const rendered = await answer(inkKey);
      expect(rendered, JSON.stringify(rendered)).toMatchObject({
        ok: true,
        key: inkKey,
        format: "png",
        provenance: "rendered",
      });
      expect(rendered.path).toContain("zotlit-excerpts");
      expect((await readFile(rendered.path)).subarray(0, 8)).toEqual(
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      );
      const dimensions = JSON.parse(
        await obRun(
          imageVaultId,
          async (_context, { renderedPath }) => {
            const bytes = (
              require("node:fs") as typeof import("node:fs")
            ).readFileSync(renderedPath);
            const bitmap = await createImageBitmap(
              new Blob([bytes], { type: "image/png" }),
            );
            const result = { width: bitmap.width, height: bitmap.height };
            bitmap.close();
            return JSON.stringify(result);
          },
          { renderedPath: rendered.path },
        ),
      ) as { width: number; height: number };
      expect(dimensions.width).toBeGreaterThan(0);
      expect(dimensions.height).toBeGreaterThan(0);
      const reused = await answer(inkKey);
      expect(reused).toMatchObject({
        ok: true,
        provenance: "cache",
        path: rendered.path,
      });
    } finally {
      await rename(`${inkCachePath}.image-test`, inkCachePath);
    }
  }, 120_000);
});
