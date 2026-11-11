// The shared harness of the docs walks: each walk is one docs lesson, run as
// its reader would through the real apps. See packages/e2e/AGENTS.md, "Docs
// walks".

import { prepareRunWindow } from "@e2e/background-throttling.ts";
import { clearNotices, cli, obRun } from "@e2e/obsidian-cli.ts";
import { openPairedEnvironment } from "@e2e/paired-environment.ts";
import { openZoteroRdp } from "@e2e/paired-zotero.ts";
import type { ZoteroRdp } from "@e2e/paired-zotero.ts";
import { execFile } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";

const execFileAsync = promisify(execFile);

declare module "../page-helpers.ts" {
  interface PageScratch {
    /** Each notice text shown since {@link watchNotices} last reset it. */
    docsWalkNotices?: string[];
    docsWalkNoticeObserver?: MutationObserver;
  }
}

/**
 * Record the text of every notice the window shows from now on, for
 * {@link readNotices} and for page callbacks that read
 * `page.scratch.docsWalkNotices`. A second call empties the record.
 */
export async function watchNotices(vaultId: string): Promise<void> {
  await obRun(vaultId, ({ page }) => {
    const { scratch } = page;
    scratch.docsWalkNotices = [];
    if (scratch.docsWalkNoticeObserver) return;
    scratch.docsWalkNoticeObserver = new MutationObserver(() => {
      const seen = (scratch.docsWalkNotices ??= []);
      for (const n of document.querySelectorAll(".notice")) {
        const t = n.textContent;
        if (!seen.includes(t)) seen.push(t);
      }
    });
    scratch.docsWalkNoticeObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
  });
}

/** Every notice text {@link watchNotices} recorded, in the order shown. */
export function readNotices(vaultId: string): Promise<string[]> {
  return obRun(vaultId, ({ page }) => page.scratch.docsWalkNotices ?? []);
}

/** `DOCS_WALK_CAPTURE=1` turns a walk's planned shots into docs images. */
export function captureRequested(): boolean {
  return process.env.DOCS_WALK_CAPTURE === "1";
}

export interface DocsWalkOptions {
  /** The docs page's slug; names the layout folder and the capture folder. */
  slug: string;
  /** The folder under `apps/docs/public/img/` that receives the images. */
  collection: string;
  /** @default "demo" */
  vaultCase?: string;
  /**
   * The window size every capture is taken at, in points. A screen shorter
   * than `height` caps it, so keep it within a laptop screen.
   * @default { width: 1440, height: 860 }
   */
  window?: { width: number; height: number };
}

/** One open walk: a Paired Run on its Vault Case and its capture tools. */
export interface DocsWalk extends AsyncDisposable {
  vaultId: string;
  /** Paired Zotero's parent process, for the reader's steps in Zotero. */
  zotero: ZoteroRdp;
  /**
   * Save the Obsidian window as the layer `layer`, without the notices on
   * screen. Does nothing unless the run captures.
   */
  capture(layer: string): Promise<void>;
  /**
   * Compose the image `name` into the docs. The layout
   * `<slug>.layouts/<name>.json` beside the walk places the layers by name
   * (`"src": "<layer>.png"`); without one, the layer `name` becomes one
   * centred window. Does nothing unless the run captures.
   */
  compose(name: string): Promise<void>;
}

interface Layout {
  layers: { src: string }[];
}

/**
 * Open a walk: a new Fixture on its Vault Case, a new vault on it, and a
 * Paired Zotero with its Local API open, all disposed with the walk.
 */
export async function openDocsWalk(
  options: DocsWalkOptions,
): Promise<DocsWalk> {
  const root = await getWorkspaceRoot(import.meta.dirname);
  const { width, height } = options.window ?? { width: 1440, height: 860 };
  await using stack = new AsyncDisposableStack();
  const environment = stack.use(
    await openPairedEnvironment(root, {
      name: "docs-walk",
      vaultCase: options.vaultCase ?? "demo",
    }),
  );
  const { vaultId } = environment;
  await prepareRunWindow(vaultId);
  await obRun(vaultId, ({ app }) => {
    app.vault.setConfig("nativeMenus", false);
  });
  await obRun(
    vaultId,
    (_, size) => {
      (
        require("@electron/remote") as {
          getCurrentWindow(): { setSize(width: number, height: number): void };
        }
      )
        .getCurrentWindow()
        .setSize(size.width, size.height);
    },
    { width, height },
  );
  const zotero = stack.use(await openZoteroRdp(environment.debuggerPort));

  const captures = join(root, ".scratch", "docs-walks", options.slug);
  const layouts = join(import.meta.dirname, `${options.slug}.layouts`);
  const images = join(
    root,
    "apps",
    "docs",
    "public",
    "img",
    options.collection,
  );

  const owned = stack.move();
  return {
    vaultId,
    zotero,
    async capture(layer) {
      if (!captureRequested()) return;
      await mkdir(captures, { recursive: true });
      // A notice is transient: the walk asserts it, the image leaves it out.
      await clearNotices(vaultId);
      // A capture taken in the frame after a change can show the old DOM.
      await obRun(
        vaultId,
        () =>
          new Promise<void>((r) =>
            requestAnimationFrame(() => requestAnimationFrame(() => r())),
          ),
      );
      await cli([
        `vault=${vaultId}`,
        "dev:screenshot",
        `path=${join(captures, `${layer}.png`)}`,
      ]);
    },
    async compose(name) {
      if (!captureRequested()) return;
      const layoutFile = join(layouts, `${name}.json`);
      const layout: Layout = await access(layoutFile).then(
        async () => JSON.parse(await readFile(layoutFile, "utf8")) as Layout,
        () => ({ layers: [{ src: `${name}.png` }] }),
      );
      // compose.mjs resolves each layer from the layout file, so the resolved
      // copy sits beside the captures.
      const resolved = join(captures, `${name}.layout.json`);
      await writeFile(resolved, JSON.stringify(layout, null, 2));
      await mkdir(images, { recursive: true });
      await execFileAsync(
        process.execPath,
        [
          join(root, ".agents", "skills", "docs-screenshot", "compose.mjs"),
          join(images, `${name}.webp`),
          resolved,
        ],
        { windowsHide: true },
      );
    },
    [Symbol.asyncDispose]: () => owned.disposeAsync(),
  };
}
