import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { FileSystemAdapter, PDFFileView } from "obsidian";
import { expect } from "vitest";

import {
  ANNOTATIONS,
  ATTACHMENTS,
  ITEMS,
  NOTES,
} from "@zotlit/scripts/fixture";
// Real Obsidian acceptance for the excerpt behaviours this release added: a
// crop that reuses the document an open reader already holds, the note import
// that reuses what that crop produced, the fallback to detached rendering once
// the reader is gone, and the card that goes on painting its previous image
// while a saved edit's pixels are rendered and published.
//
// Every claim here is read out of the running app: the renderer's own
// diagnostics count the PDF work, the Annotation View's card is the surface
// that paints and releases an image, and the write path is the repository the
// cards themselves call.
import type { FixtureAnnotation } from "@zotlit/scripts/fixture";

import type { ExcerptRequest } from "@/services/excerpt-image/contract";
import type { AnnotationView } from "@/views/annot-view/view";

import { obRun, obRunUntil } from "./obsidian-cli.ts";
import type { ExcerptImportState } from "./page-excerpt-types.ts";

/** The Fixture Attachment the reader opens and every excerpt here resolves. */
const attachment = ATTACHMENTS.find(({ key }) => key === "RGRPDF24")!;
/** Its vault-relative path, the one the Fixture Vault's reader opens. */
const vaultPath = attachment.path;
/** The Item it hangs off: the Item whose literature note the import case writes. */
const item = ITEMS.find(({ itemID }) => itemID === attachment.parentItemID)!;
/** Every Fixture Annotation the Attachment carries. */
const annotations = ANNOTATIONS.filter(
  ({ parentItemID }) => parentItemID === attachment.itemID,
);
/**
 * The Annotations the note template embeds: the two types Zotero keeps an
 * excerpt cache image for, and so the ones an import resolves.
 */
const embedded = annotations.filter(({ type }) => type === 3 || type === 4);
/**
 * The one ink Annotation the colour filter isolates: an ink crop paints its
 * colour into the image, so it is the one a saved edit's pixels move, and no
 * other Fixture Annotation on this Attachment carries its colour.
 */
const target = annotations.find(
  (annotation): annotation is Extract<FixtureAnnotation, { type: 4 }> =>
    annotation.type === 4 &&
    annotations.filter((other) => other.color === annotation.color).length ===
      1,
)!;
/**
 * The Fixture Note whose pasted images are the target Attachment's own
 * Annotations — the one an import resolves the target Annotation through.
 */
const noteItem = NOTES.find(
  (candidate) =>
    candidate.libraryID === attachment.libraryID &&
    candidate.note.includes(target.key),
)!;
/** The colour a saved pixel edit moves the target to. */
const editedColor = "#2ea8e5";
/** The comment a saved metadata edit leaves, and the empty string that clears it. */
const editedComment = "Saved-edit acceptance";

interface Loads {
  borrowed: number;
  detached: number;
  fileOpens: number;
  documentLoads: number;
}

interface RendererDiagnostics {
  loads: Loads;
  phase: string;
  jobActive: boolean;
  fileOpen: boolean;
  documentOpen: boolean;
  renderTaskActive: boolean;
}

/** What the renderer did between two diagnostics instants, per load kind. */
function loadsBetween(
  before: RendererDiagnostics,
  after: RendererDiagnostics,
): Loads {
  return {
    borrowed: after.loads.borrowed - before.loads.borrowed,
    detached: after.loads.detached - before.loads.detached,
    fileOpens: after.loads.fileOpens - before.loads.fileOpens,
    documentLoads: after.loads.documentLoads - before.loads.documentLoads,
  };
}

/**
 * Run one cleanup step, retrying once: the Obsidian CLI child is occasionally
 * killed under load — a known flake of this suite — and a step that never ran
 * would leave the vault changed. A step that still fails warns instead of
 * masking the case's own failure.
 */
async function cleanupStep(step: () => Promise<void>): Promise<void> {
  try {
    await step();
  } catch {
    try {
      await step();
    } catch (error) {
      console.warn(
        `Excerpt acceptance cleanup step failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

/**
 * What the app is showing while a note import has not settled: the modals on
 * screen, the Notices it raised, and the files the import has written so far.
 */
async function importState(vaultId: string): Promise<string> {
  return obRun(
    vaultId,
    async ({ app, page: helpers }) => {
      return JSON.stringify({
        settled: helpers.scratch.__zotlitExcerptImport?.settled ?? null,
        error: helpers.scratch.__zotlitExcerptImport?.error ?? null,
        modals: Array.from(
          document.querySelectorAll(".modal-container .modal"),
        ).map((element) => (element.textContent ?? "").slice(0, 300)),
        notices: Array.from(document.querySelectorAll(".notice")).map(
          (element) => (element.textContent ?? "").slice(0, 200),
        ),
        imported: app.vault
          .getFiles()
          .map((file) => file.path)
          .filter((path) => path.includes("zotlit")),
      });
    },
    undefined,
  ).catch((error: unknown) => `import state unavailable: ${String(error)}`);
}

/**
 * The app's own settlement of the note import this case starts — the authority
 * every observation of it follows.
 *
 * An import writes a note and its assets, and the CLI child's deadline is not
 * that work's lifetime: a poll that expires, or a child killed under load, is an
 * observation failure rather than a signal that the in-app work stopped. The
 * cleanup steps below delete the import's completion state, close the dialogs it
 * uses, and restore the settings and the note it overwrote, so none of them may
 * start beside a write still in flight (`policies/test-timing.md`). Every path —
 * this case's own observation and each cleanup step — goes through the one wait
 * this returns, so a settlement the app reported is observed once however the
 * case ends.
 *
 * A settlement the app has reported is cached; a *failed observation* is not,
 * because a child killed under load says nothing about the app's own work. The
 * next caller asks the app again, which is what lets a cleanup step restore the
 * note and the settings once the CLI answers.
 */
function importSettlement(vaultId: string): () => Promise<void> {
  let asked: Promise<void> | null = null;
  return () =>
    (asked ??= settleImport(vaultId).catch((error: unknown) => {
      asked = null;
      throw error;
    }));
}

/**
 * Poll the import to settlement, answering the overwrite confirm as it asks.
 *
 * The confirm and the settlement are observed in one poll, because the confirm
 * is what holds the settlement back: the Fixture Vault's own Imported Note makes
 * the import ask before it overwrites, and it stays unsettled until that dialog
 * is answered. A phase that only watched for settlement first would spend its
 * whole bound failing to see one, and the import's measured completion — which
 * starts before it asks — would carry that wait as if it were the import's own
 * cost.
 */
async function settleImport(vaultId: string): Promise<void> {
  try {
    await obRunUntil(
      vaultId,
      async ({ page: helpers }) => {
        const button = document.querySelector<HTMLButtonElement>(
          ".modal-container .modal .modal-button-container button.mod-destructive",
        );
        // Answers the overwrite confirm the import may raise: setup the phase
        // waits through, not the press it measures.
        if (button) button.click();
        return !!helpers.scratch.__zotlitExcerptImport?.settled;
      },
      undefined,
      {
        tries: 240,
        what: "the excerpt import to settle after any overwrite confirm",
      },
    );
  } catch (error) {
    throw new Error(
      `the note import did not settle: ${await importState(vaultId)}`,
      { cause: error },
    );
  }
}

/** Install the object-URL probe, so a card's publication is observable. */
async function installUrlProbe(vaultId: string): Promise<void> {
  expect(
    await obRun(
      vaultId,
      async ({ page: helpers }) => {
        if (helpers.scratch.__zotlitExcerptUrlProbe)
          throw new Error("The URL probe is already installed");
        const create = URL.createObjectURL.bind(URL);
        const revoke = URL.revokeObjectURL.bind(URL);
        const state = {
          create,
          revoke,
          created: [] as string[],
          revoked: [] as string[],
        };
        URL.createObjectURL = (blob) => {
          const url = create(blob);
          state.created.push(url);
          return url;
        };
        URL.revokeObjectURL = (url) => {
          state.revoked.push(url);
          return revoke(url);
        };
        helpers.scratch.__zotlitExcerptUrlProbe = state;
        return true;
      },
      undefined,
    ),
  ).toBe(true);
}

/** Take the object-URL probe away, restoring both browser APIs as they were. */
async function removeUrlProbe(vaultId: string): Promise<void> {
  await obRun(
    vaultId,
    async ({ page: helpers }) => {
      const state = helpers.scratch.__zotlitExcerptUrlProbe!;
      if (!state) return;
      URL.createObjectURL = state.create;
      URL.revokeObjectURL = state.revoke;
      delete helpers.scratch.__zotlitExcerptUrlProbe;
    },
    undefined,
  );
}

/**
 * What the renderer's own Node view reports for its process, or the error that
 * reading it raised: Electron's `process.getProcessMemoryInfo()` is a Chromium
 * probe this environment answers with `null`, while `process.memoryUsage()` is
 * the renderer process's own Node measurement.
 */
export async function verifyReaderBackedExcerpts(
  vaultId: string,
): Promise<void> {
  const m = await import("@obsidian-messages");
  const layout = await obRun(
    vaultId,
    async ({ app }) => {
      return JSON.stringify(app.workspace.getLayout());
    },
    undefined,
  );
  const basePath = await obRun(
    vaultId,
    async ({ app }) => {
      return (app.vault.adapter as FileSystemAdapter).getBasePath();
    },
    undefined,
  );
  // The runtime the evidence below is against, read from the app itself.
  const runtime = await obRun(
    vaultId,
    async () => {
      const versions = process.versions;
      return {
        userAgent: navigator.userAgent,
        electron: versions.electron ?? null,
        chrome: versions.chrome ?? null,
        node: versions.node,
      };
    },
    undefined,
  );
  const existingFiles = new Set(
    await obRun(
      vaultId,
      async ({ app }) => {
        return app.vault.getFiles().map((file) => file.path);
      },
      undefined,
    ),
  );
  // The colour filter pressed below is saved per Item in vault localStorage,
  // and every later view pinned to the Item opens with it. The view that
  // holds the swatch is gone by cleanup time, so the saved value is put back
  // as it was found, not released through the swatch.
  const filterKey = JSON.stringify(`zotlit-annot-filter-${item.key}`);
  const savedFilter = await obRun(
    vaultId,
    async ({ app }, { storageKey }) => {
      return JSON.stringify(app.loadLocalStorage(storageKey) ?? null);
    },
    { storageKey: JSON.parse(filterKey) },
  );
  await using cleanup = new AsyncDisposableStack();
  // Disposal is LIFO, so these read bottom to top: the saved filter goes back
  // last of all, once the layout no longer holds a view that could save it.
  cleanup.defer(() =>
    cleanupStep(async () => {
      await obRun(
        vaultId,
        async ({ app }, { storageKey, storageValue }) => {
          app.saveLocalStorage(storageKey, storageValue);
        },
        {
          storageKey: JSON.parse(filterKey),
          storageValue: JSON.parse(savedFilter),
        },
      );
    }),
  );
  cleanup.defer(() =>
    cleanupStep(async () => {
      await obRun(
        vaultId,
        async ({ app }, { layout }) => {
          await app.workspace.changeLayout(JSON.parse(layout!));
        },
        { layout },
      );
    }),
  );

  // ── A reader-backed crop ────────────────────────────────────────────────
  // The Attachment opens in the reader the Fixture Annotations live on, with
  // no Annotation View to demand anything: the one resolution measured here is
  // therefore the only PDF work the renderer can be doing.
  expect(
    await obRun(
      vaultId,
      async ({ app, zotlit }, { vaultPath }) => {
        for (const leaf of app.workspace.getLeavesOfType(
          "zotero-annotation-view",
        ))
          leaf.detach();
        await zotlit.services.bridge.runPromise(
          zotlit.services.excerptImage.clear,
        );
        const file = app.vault.getFileByPath(vaultPath!);
        if (!file)
          throw new Error("The Fixture PDF is not in the Fixture Vault");
        const leaf = app.workspace.getLeaf("tab");
        await leaf.openFile(file);
        app.workspace.setActiveLeaf(leaf, { focus: true });
        return true;
      },
      { vaultPath },
    ),
  ).toBe(true);
  await obRunUntil(
    vaultId,
    async ({ app, zotlit }, { vaultPath, pageNumber }) => {
      const state = JSON.parse(
        (function () {
          const leaves = app.workspace.getLeavesOfType("pdf");
          const leaf = leaves.find(
            (candidate) =>
              (candidate.view as PDFFileView).file?.path === vaultPath,
          );
          const page = leaf?.view.containerEl.querySelector(
            `.page[data-page-number="${pageNumber}"]`,
          );
          const canvas = page?.querySelector("canvas");
          return JSON.stringify({
            leaves: leaves.length,
            page: !!page,
            canvas: !!canvas && canvas.width > 0 && canvas.height > 0,
            borrowed: !!zotlit.services.bridge.runSync(
              zotlit.services.pdfAnnotationEditor.borrowDocument(
                (app.vault.adapter as FileSystemAdapter).getFullPath(
                  vaultPath!,
                ),
              ),
            ),
          });
        })(),
      );
      return state.page && state.canvas && state.borrowed;
    },
    { vaultPath, pageNumber: target.position.pageIndex + 1 },
    {
      tries: 80,
      what: "the PDF page to render with a sized canvas and a borrowed document",
    },
  );
  const held = await obRun(
    vaultId,
    async ({ app, zotlit }, { vaultPath, pageNumber }) => {
      const leaves = app.workspace.getLeavesOfType("pdf");
      const leaf = leaves.find(
        (candidate) => (candidate.view as PDFFileView).file?.path === vaultPath,
      );
      const page = leaf?.view.containerEl.querySelector(
        `.page[data-page-number="${pageNumber}"]`,
      );
      const canvas = page?.querySelector("canvas");
      return {
        leaves: leaves.length,
        page: !!page,
        canvas: !!canvas && canvas.width > 0 && canvas.height > 0,
        borrowed: !!zotlit.services.bridge.runSync(
          zotlit.services.pdfAnnotationEditor.borrowDocument(
            (app.vault.adapter as FileSystemAdapter).getFullPath(vaultPath!),
          ),
        ),
      };
    },
    { vaultPath, pageNumber: target.position.pageIndex + 1 },
  );
  expect(held).toMatchObject({ page: true, canvas: true, borrowed: true });

  const borrowed = await obRun(
    vaultId,
    async (
      { app, zotlit },
      { attachmentKey, libraryId, vaultPath, targetKey },
    ) => {
      const services = zotlit.services;
      const list = await services.bridge.runPromise(
        services.annotationRepository.read(attachmentKey),
      );
      if (!list) throw new Error("The Fixture Attachment has no Annotations");
      const requestFor = (key: string) => {
        const annotation = list.annotations.find(
          (candidate) => candidate.key === key,
        );
        if (!annotation)
          throw new Error(`The Fixture holds no Annotation ${key}`);
        return {
          annotation,
          source: list.source,
          sourceScope: services.bridge.runSync(services.zoteroPref.current)
            .dataDir,
          attachmentKey: annotation.parentKey,
          libraryID: libraryId,
          pdfPath: (app.vault.adapter as FileSystemAdapter).getFullPath(
            vaultPath!,
          ),
          zoteroPngPath: require("path").join(
            services.bridge.runSync(services.zoteroPref.current).dataDir,
            "cache",
            "library",
            `${key}.png`,
          ),
        };
      };
      const service = services.excerptImage;
      const request = requestFor(targetKey);
      await zotlit.services.bridge.runPromise(service.clear);
      const before = (() => {
        const snapshot =
          zotlit.services.excerptImage.rendererDiagnostics!.snapshot();
        return {
          loads: snapshot.loads,
          phase: snapshot.phase,
          jobActive: snapshot.jobActive,
          fileOpen: snapshot.fileOpen,
          documentOpen: snapshot.documentOpen,
          renderTaskActive: snapshot.renderTaskActive,
        };
      })();
      const outcome = await zotlit.services.bridge.runPromise(
        service.resolve(request),
      );
      const after = (() => {
        const snapshot =
          zotlit.services.excerptImage.rendererDiagnostics!.snapshot();
        return {
          loads: snapshot.loads,
          phase: snapshot.phase,
          jobActive: snapshot.jobActive,
          fileOpen: snapshot.fileOpen,
          documentOpen: snapshot.documentOpen,
          renderTaskActive: snapshot.renderTaskActive,
        };
      })();
      return {
        before,
        after,
        outcome:
          outcome.kind === "available"
            ? {
                kind: outcome.kind,
                provenance: outcome.provenance,
                sha256: require("crypto")
                  .createHash("sha256")
                  .update(outcome.bytes)
                  .digest("hex"),
              }
            : { kind: outcome.kind },
        pixels:
          outcome.kind === "available"
            ? await (async (bytes, mimeType) => {
                const bitmap = await createImageBitmap(
                  new Blob([new Uint8Array(bytes)], { type: mimeType }),
                );
                let canvas;
                try {
                  canvas = document.createElement("canvas");
                  canvas.width = bitmap.width;
                  canvas.height = bitmap.height;
                  const context = canvas.getContext("2d");
                  if (!context)
                    throw new Error("Excerpt pixel canvas unavailable");
                  context.drawImage(bitmap, 0, 0);
                  const data = context.getImageData(
                    0,
                    0,
                    bitmap.width,
                    bitmap.height,
                  ).data;
                  return {
                    width: bitmap.width,
                    height: bitmap.height,
                    pixels: require("crypto")
                      .createHash("sha256")
                      .update(new Uint8Array(data.buffer))
                      .digest("hex"),
                  };
                } finally {
                  if (canvas) {
                    canvas.width = 0;
                    canvas.height = 0;
                  }
                  bitmap.close();
                }
              })(outcome.bytes, outcome.format.mimeType)
            : null,
      };
    },
    {
      attachmentKey: attachment.key,
      libraryId: attachment.libraryID,
      vaultPath,
      targetKey: target.key,
    },
  );
  expect(borrowed.outcome).toMatchObject({
    kind: "available",
    provenance: "rendered",
  });
  expect(borrowed.outcome.sha256).toMatch(/^[0-9a-f]{64}$/);
  // The crop the reader's document produced, decoded once: the fallback below
  // compares the detached crop's own pixels against these.
  expect(borrowed.pixels).toMatchObject({
    width: expect.any(Number),
    height: expect.any(Number),
    pixels: expect.stringMatching(/^[0-9a-f]{64}$/),
  });
  expect(borrowed.pixels!.width).toBeGreaterThan(0);
  // The whole claim: one crop, drawn from a document this renderer never
  // opened and never loaded.
  expect(loadsBetween(borrowed.before, borrowed.after)).toEqual({
    borrowed: 1,
    detached: 0,
    fileOpens: 0,
    documentLoads: 0,
  });
  expect(borrowed.after).toMatchObject({
    phase: "idle",
    jobActive: false,
    fileOpen: false,
    documentOpen: false,
    renderTaskActive: false,
  });
  // The reader keeps its document, its page, and its own rendering of it.
  expect(
    await obRun(
      vaultId,
      async ({ app, zotlit }, { vaultPath, pageNumber }) => {
        const leaves = app.workspace.getLeavesOfType("pdf");
        const leaf = leaves.find(
          (candidate) =>
            (candidate.view as PDFFileView).file?.path === vaultPath,
        );
        const page = leaf?.view.containerEl.querySelector(
          `.page[data-page-number="${pageNumber}"]`,
        );
        const canvas = page?.querySelector("canvas");
        return {
          leaves: leaves.length,
          page: !!page,
          canvas: !!canvas && canvas.width > 0 && canvas.height > 0,
          borrowed: !!zotlit.services.bridge.runSync(
            zotlit.services.pdfAnnotationEditor.borrowDocument(
              (app.vault.adapter as FileSystemAdapter).getFullPath(vaultPath!),
            ),
          ),
        };
      },
      { vaultPath, pageNumber: target.position.pageIndex + 1 },
    ),
  ).toEqual(held);

  // ── The note import reuses that image ───────────────────────────────────
  // The Fixture Vault already holds the Imported Note for the Fixture Note that
  // pastes the target Annotation's own image, so this import asks before it
  // overwrites — and rendering annotations as templates is what makes it
  // resolve those Annotations through the excerpt service the cards share.
  const importedNote = await obRun(
    vaultId,
    async ({ app, zotlit }, { noteItemKey }) => {
      const services = zotlit.services;
      await services.bridge.runPromise(services.noteIndex.whenIndexed);
      const file = services.bridge.runSync(
        services.noteIndex.getImportedNoteByNoteKey(noteItemKey),
      )[0];
      if (!file)
        throw new Error(
          `The Fixture Vault holds no Imported Note for ${noteItemKey}`,
        );
      return { path: file.path, source: await app.vault.read(file) };
    },
    { noteItemKey: noteItem.key },
  );
  const templateBinding = await obRun(
    vaultId,
    async ({ zotlit }) => {
      const { settings, bridge } = zotlit.services;
      return {
        enabled: bridge.runSync(settings.current)["note.default-profile"]
          .bindings["note.import-annotations-as-template"],
      };
    },
    undefined,
  );
  const settleImport = importSettlement(vaultId);
  // The import overwrites a note the Fixture wrote and turns a setting on, so
  // both go back the way they were found — once the import has settled, so no
  // step here writes beside it.
  cleanup.defer(() =>
    cleanupStep(async () => {
      await settleImport();
      await obRun(
        vaultId,
        async ({ app }, { importedNotePath, source }) => {
          const file = app.vault.getFileByPath(importedNotePath!);
          if (file) await app.vault.modify(file, source);
        },
        { importedNotePath: importedNote.path, source: importedNote.source },
      );
    }),
  );
  cleanup.defer(() =>
    cleanupStep(async () => {
      await settleImport();
      await obRun(
        vaultId,
        async ({ zotlit }, { enabled }) => {
          zotlit.services.bridge.runSync(
            zotlit.services.settings.updateDefaultLiteratureNoteProfileBindings(
              { "note.import-annotations-as-template": enabled },
            ),
          );
        },
        { enabled: templateBinding.enabled },
      );
    }),
  );

  // The import writes a note's assets, which this case must not leave in the
  // shared Fixture Vault. Registered against the files that exist now and
  // resolved at disposal, so a failure anywhere between here and the assertions
  // below — including the import's own start — still cleans up after itself.
  // Disposal is LIFO, so this runs after the settlement waits registered above.
  cleanup.defer(() =>
    cleanupStep(async () => {
      await settleImport();
      const known = JSON.stringify([...existingFiles]);
      await obRun(
        vaultId,
        async ({ app }, { knownKeys }) => {
          const known = new Set(knownKeys);
          for (const file of app.vault.getFiles()) {
            if (!known.has(file.path)) await app.vault.delete(file);
          }
        },
        { knownKeys: JSON.parse(known) },
      );
    }),
  );

  // Every excerpt the note template embeds resolves against the open reader
  // first, so the cache stands for them when the import runs.
  const prepared = await obRun(
    vaultId,
    async ({ app, zotlit }, { attachmentKey, libraryId, vaultPath }) => {
      const services = zotlit.services;
      const list = await services.bridge.runPromise(
        services.annotationRepository.read(attachmentKey),
      );
      if (!list) throw new Error("The Fixture Attachment has no Annotations");
      const requestFor = (key: string) => {
        const annotation = list.annotations.find(
          (candidate) => candidate.key === key,
        );
        if (!annotation)
          throw new Error(`The Fixture holds no Annotation ${key}`);
        return {
          annotation,
          source: list.source,
          sourceScope: services.bridge.runSync(services.zoteroPref.current)
            .dataDir,
          attachmentKey: annotation.parentKey,
          libraryID: libraryId,
          pdfPath: (app.vault.adapter as FileSystemAdapter).getFullPath(
            vaultPath!,
          ),
          zoteroPngPath: require("path").join(
            services.bridge.runSync(services.zoteroPref.current).dataDir,
            "cache",
            "library",
            `${key}.png`,
          ),
        };
      };
      const service = services.excerptImage;
      const keys = list.annotations
        .filter(
          (annotation) =>
            annotation.type === "image" || annotation.type === "ink",
        )
        .map((annotation) => annotation.key);
      const outcomes = [];
      for (const key of keys) {
        const outcome = await zotlit.services.bridge.runPromise(
          service.resolve(requestFor(key)),
        );
        outcomes.push({
          key,
          kind: outcome.kind,
          sha256:
            outcome.kind === "available"
              ? require("crypto")
                  .createHash("sha256")
                  .update(outcome.bytes)
                  .digest("hex")
              : null,
        });
      }
      return { keys, outcomes };
    },
    {
      attachmentKey: attachment.key,
      libraryId: attachment.libraryID,
      vaultPath,
    },
  );
  expect(prepared.keys.slice().sort()).toEqual(
    embedded.map(({ key }) => key).sort(),
  );
  expect(prepared.outcomes.map(({ kind }) => kind)).toEqual(
    embedded.map(() => "available"),
  );
  expect(prepared.outcomes.find(({ key }) => key === target.key)?.sha256).toBe(
    borrowed.outcome.sha256,
  );

  // The import leaves state and, when it asks, a confirm behind; both go — and
  // both wait for the app's settlement first, so this step can never delete the
  // state the import is still publishing under.
  cleanup.defer(() =>
    cleanupStep(async () => {
      await settleImport();
      // Teardown closes whatever modal is left, not a reader's press.
      await obRun(
        vaultId,
        async ({ page: helpers }) => {
          delete helpers.scratch.__zotlitExcerptImport;
          for (const button of document.querySelectorAll<HTMLElement>(
            ".modal-container .modal .modal-close-button",
          ))
            button.click();
        },
        undefined,
      );
    }),
  );
  // The import writes a note and its assets, which outlive the CLI's own child
  // deadline, so it runs as the app's own job and reports its own settlement,
  // completion time, and the memory its renderer process held around it.
  expect(
    await obRun(
      vaultId,
      async ({ zotlit, page: helpers }, { itemID }) => {
        const services = zotlit.services;
        const memory = () => {
          try {
            const value = process.memoryUsage();
            return {
              rss: value.rss,
              heapUsed: value.heapUsed,
              heapTotal: value.heapTotal,
            };
          } catch (error) {
            return String(error);
          }
        };
        services.bridge.runSync(
          services.settings.updateDefaultLiteratureNoteProfileBindings({
            "note.import-annotations-as-template": true,
          }),
        );
        const state: ExcerptImportState =
          (helpers.scratch.__zotlitExcerptImport = {
            settled: false,
            startedAt: performance.now(),
            settledAt: null,
            before: (() => {
              const snapshot =
                zotlit.services.excerptImage.rendererDiagnostics!.snapshot();
              return {
                loads: snapshot.loads,
                phase: snapshot.phase,
                jobActive: snapshot.jobActive,
                fileOpen: snapshot.fileOpen,
                documentOpen: snapshot.documentOpen,
                renderTaskActive: snapshot.renderTaskActive,
              };
            })(),
            memoryBefore: memory(),
            memoryAfter: null,
            after: null,
            result: null,
            error: null,
          });
        await services.bridge.runPromise(services.noteIndex.whenIndexed);
        void services.batchImport
          .runBatchImport("note", [itemID])
          .then(
            (result) => {
              state.after = (() => {
                const snapshot =
                  zotlit.services.excerptImage.rendererDiagnostics!.snapshot();
                return {
                  loads: snapshot.loads,
                  phase: snapshot.phase,
                  jobActive: snapshot.jobActive,
                  fileOpen: snapshot.fileOpen,
                  documentOpen: snapshot.documentOpen,
                  renderTaskActive: snapshot.renderTaskActive,
                };
              })();
              state.result = result;
            },
            (error) => {
              state.after = (() => {
                const snapshot =
                  zotlit.services.excerptImage.rendererDiagnostics!.snapshot();
                return {
                  loads: snapshot.loads,
                  phase: snapshot.phase,
                  jobActive: snapshot.jobActive,
                  fileOpen: snapshot.fileOpen,
                  documentOpen: snapshot.documentOpen,
                  renderTaskActive: snapshot.renderTaskActive,
                };
              })();
              state.error = error?.stack ?? String(error);
            },
          )
          .finally(() => {
            state.memoryAfter = memory();
            state.settledAt = performance.now();
            state.settled = true;
          });
        return true;
      },
      { itemID: noteItem.itemID },
    ),
  ).toBe(true);
  await settleImport();
  const imported = await obRun(
    vaultId,
    async ({ page: helpers }) => {
      const state = helpers.scratch.__zotlitExcerptImport;
      if (!state) throw new Error("The note import state is gone");
      if (state.error) throw new Error(state.error);
      const value = {
        before: state.before,
        after: state.after,
        result: state.result,
        elapsedMs: state.settledAt! - state.startedAt,
        memoryBefore: state.memoryBefore,
        memoryAfter: state.memoryAfter,
      };
      delete helpers.scratch.__zotlitExcerptImport;
      return value;
    },
    undefined,
  );
  expect(imported.result).toMatchObject({ outcome: "single" });
  expect(imported.elapsedMs).toBeGreaterThan(0);
  // Reuse, not a second rendering: the import draws no crop at all, opens no
  // PDF file, and loads no PDF document.
  expect(loadsBetween(imported.before, imported.after!)).toEqual({
    borrowed: 0,
    detached: 0,
    fileOpens: 0,
    documentLoads: 0,
  });
  // What the import wrote, for the assertions below: the files the vault holds
  // now that it did not hold when the case started. Their removal is registered
  // above, before the import could create any.
  const written = (
    await obRun(
      vaultId,
      async ({ app }) => {
        return app.vault.getFiles().map((file) => file.path);
      },
      undefined,
    )
  ).filter((path) => !existingFiles.has(path));
  // The durable asset carries the reader-backed bytes, so the image the import
  // links and the crop that preceded it are one image.
  const assets = written.filter((path) =>
    path.split("/").at(-1)!.startsWith("zotlit-excerpt-"),
  );
  const digests = await Promise.all(
    assets.map(async (path) =>
      createHash("sha256")
        .update(await readFile(join(basePath, path)))
        .digest("hex"),
    ),
  );
  const published = assets.filter(
    (_path, index) => digests[index] === borrowed.outcome.sha256,
  );
  expect(published).toHaveLength(1);
  const overwritten = await readFile(
    join(basePath, importedNote.path),
    "utf-8",
  );
  expect(overwritten).not.toBe(importedNote.source);
  expect(overwritten).toContain(published[0]!.split("/").at(-1)!);

  // ── The reader goes, the demand stays ───────────────────────────────────
  // Pinned to the Item, the card outlives the reader it was following; the
  // colour filter leaves the one card whose pixels this case can tell apart,
  // so the fallback below is one resolution and one publication.
  await obRun(
    vaultId,
    async ({ app }) => {
      app.commands.executeCommandById("zotlit:open-annot-view");
    },
    undefined,
  );
  await obRunUntil(
    vaultId,
    async (
      { app, page: helpers },
      {
        itemKey,
        filterTriggerLabel,
        activeTriggerPrefix,
        colorListLabel,
        expectedColor,
      },
    ) => {
      const leaf = app.workspace.getLeavesOfType("zotero-annotation-view")[0];
      if (!leaf) return "no view";
      const state = (leaf.view as AnnotationView).snapshot;
      if (state.followMode !== "pinned" || state.pinnedItemKey !== itemKey)
        await leaf.setViewState({
          type: "zotero-annotation-view",
          state: {
            followMode: "pinned",
            previousMode: "active-tab",
            pinnedItemKey: itemKey,
          },
          active: true,
        });
      const { press, until } = helpers;
      try {
        const root = leaf.view.containerEl;
        const trigger = Array.from(
          root.querySelectorAll<HTMLButtonElement>("button[aria-label]"),
        ).find(
          (button) =>
            button.getAttribute("aria-label") === filterTriggerLabel ||
            button.getAttribute("aria-label")!.startsWith(activeTriggerPrefix),
        );
        if (!trigger) return "no colour Chooser";
        press(trigger, "colour Chooser");
        const list = await until("colour list opens", () => {
          const list = Array.from(
            root.ownerDocument.querySelectorAll<HTMLElement>(
              '[role="listbox"]',
            ),
          ).find(
            (list) =>
              root.ownerDocument.getElementById(
                list.getAttribute("aria-labelledby")!,
              )?.textContent === colorListLabel,
          );
          return list?.checkVisibility() ? list : null;
        });
        const row = Array.from(
          list.querySelectorAll<HTMLElement>('[role="option"]'),
        ).find(
          (option) =>
            option
              .querySelector<HTMLElement>('[style*="--zt-swatch-color"]')
              ?.style.getPropertyValue("--zt-swatch-color")
              .trim()
              .toLowerCase() === expectedColor,
        );
        if (!row) return "no swatch";
        if (row.getAttribute("aria-selected") !== "true") {
          press(row, "colour row");
          await until(
            "colour filter applies",
            () => row.getAttribute("aria-selected") === "true",
          );
        }
        (
          root.ownerDocument.activeElement ?? root.ownerDocument.body
        ).dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
        return "demanded";
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    },
    {
      itemKey: item.key,
      filterTriggerLabel: m.annot_view_filter_color_trigger(),
      activeTriggerPrefix: m.annot_view_filter_color_trigger_active({
        colors: "",
      }),
      colorListLabel: m.annot_view_filter_color_list(),
      expectedColor: target.color.toLowerCase(),
    },
    {
      ready: (value) => value === "demanded",
      tries: 80,
      what: "the Annotation View to pin the Item, list the expected color and leave the target Annotation's card alone",
    },
  );
  await obRunUntil(
    vaultId,
    async ({ app }) => {
      const cards = Array.from(
        new Set(
          Array.from(
            app.workspace
              .getLeavesOfType("zotero-annotation-view")[0]!
              .view.containerEl.querySelectorAll(
                ".zt-annot-card[data-zotero-annotation-key]",
              ),
          ).map((card) => card.getAttribute("data-zotero-annotation-key")),
        ),
      );
      return cards;
    },
    undefined,
    {
      ready: (value) => isDeepStrictEqual(value, [target.key]),
      tries: 80,
      what: "the Annotation View to list the expected annotation card keys",
    },
  );
  await obRunUntil(
    vaultId,
    async ({ app }, { cardSelector }) => {
      return !!(() => {
        const image = app.workspace
          .getLeavesOfType("zotero-annotation-view")
          .map((leaf) => leaf.view.containerEl.querySelector(cardSelector))
          .find(Boolean)
          ?.querySelector("img");
        return (
          image &&
          image.complete &&
          image.naturalWidth > 0 &&
          image.src.startsWith("blob:")
        );
      })();
    },
    {
      cardSelector: `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(target.key)}]`,
    },
    {
      tries: 80,
      what: "the card image to finish loading as a blob URL",
    },
  );

  cleanup.defer(() =>
    cleanupStep(async () => {
      await obRun(
        vaultId,
        async ({ zotlit }) => {
          zotlit.services.excerptImage.rendererDiagnostics!.release();
        },
        undefined,
      );
    }),
  );
  cleanup.defer(() => removeUrlProbe(vaultId));
  await installUrlProbe(vaultId);
  const demand = await obRun(
    vaultId,
    async ({ app, zotlit, page: helpers }, { cardSelector }) => {
      const state = helpers.scratch.__zotlitExcerptUrlProbe!;
      const image = app.workspace
        .getLeavesOfType("zotero-annotation-view")
        .map((leaf) => leaf.view.containerEl.querySelector(cardSelector))
        .find(Boolean)
        ?.querySelector("img");
      return {
        src: image?.src ?? null,
        decoded: !!(image && image.complete && image.naturalWidth > 0),
        created: state.created.slice(),
        revoked: state.revoked.slice(),
        diagnostics: (() => {
          const snapshot =
            zotlit.services.excerptImage.rendererDiagnostics!.snapshot();
          return {
            loads: snapshot.loads,
            phase: snapshot.phase,
            jobActive: snapshot.jobActive,
            fileOpen: snapshot.fileOpen,
            documentOpen: snapshot.documentOpen,
            renderTaskActive: snapshot.renderTaskActive,
          };
        })(),
      };
    },
    {
      cardSelector: `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(target.key)}]`,
    },
  );
  expect(demand.src).toMatch(/^blob:/);
  expect(demand.revoked).toEqual([]);

  // The reader closes while the card still demands its excerpt, and the card's
  // own Refresh gesture asks for those pixels again: with no reader to borrow
  // from, the resolution reads the file. Held inside that load, the card's
  // behaviour while the replacement runs is observable rather than a race.
  expect(
    await obRun(
      vaultId,
      async ({ zotlit }) => {
        zotlit.services.excerptImage.rendererDiagnostics!.hold(
          "document-loading",
        );
        return true;
      },
      undefined,
    ),
  ).toBe(true);
  expect(
    await obRun(
      vaultId,
      async ({ app, zotlit }) => {
        await zotlit.services.bridge.runPromise(
          zotlit.services.excerptImage.clear,
        );
        for (const leaf of app.workspace.getLeavesOfType("pdf")) leaf.detach();
        return true;
      },
      undefined,
    ),
  ).toBe(true);
  await obRunUntil(
    vaultId,
    async ({ app, zotlit }, { vaultPath }) => {
      return (
        app.workspace.getLeavesOfType("pdf").length === 0 &&
        !zotlit.services.bridge.runSync(
          zotlit.services.pdfAnnotationEditor.borrowDocument(
            (app.vault.adapter as FileSystemAdapter).getFullPath(vaultPath!),
          ),
        )
      );
    },
    { vaultPath },
    {
      tries: 40,
      what: "the PDF tabs to close and release the borrowed PDF document",
    },
  );
  expect(
    await obRun(
      vaultId,
      async ({ app }) => {
        (
          app.workspace.getLeavesOfType("zotero-annotation-view")[0]!
            .view as AnnotationView
        ).gestures!.onRefresh();
        return true;
      },
      undefined,
    ),
  ).toBe(true);
  await obRunUntil(
    vaultId,
    async ({ zotlit }) => {
      const state = (() => {
        const snapshot =
          zotlit.services.excerptImage.rendererDiagnostics!.snapshot();
        return {
          loads: snapshot.loads,
          phase: snapshot.phase,
          jobActive: snapshot.jobActive,
          fileOpen: snapshot.fileOpen,
          documentOpen: snapshot.documentOpen,
          renderTaskActive: snapshot.renderTaskActive,
        };
      })();
      return state.phase === "document-loading" && state.jobActive;
    },
    undefined,
    {
      tries: 80,
      what: "the excerpt renderer to start loading the document",
    },
  );
  const replacing = await obRun(
    vaultId,
    async ({ app, zotlit, page: helpers }, { cardSelector }) => {
      const state = helpers.scratch.__zotlitExcerptUrlProbe!;
      const image = app.workspace
        .getLeavesOfType("zotero-annotation-view")
        .map((leaf) => leaf.view.containerEl.querySelector(cardSelector))
        .find(Boolean)
        ?.querySelector("img");
      return {
        src: image?.src ?? null,
        decoded: !!(image && image.complete && image.naturalWidth > 0),
        created: state.created.slice(),
        revoked: state.revoked.slice(),
        diagnostics: (() => {
          const snapshot =
            zotlit.services.excerptImage.rendererDiagnostics!.snapshot();
          return {
            loads: snapshot.loads,
            phase: snapshot.phase,
            jobActive: snapshot.jobActive,
            fileOpen: snapshot.fileOpen,
            documentOpen: snapshot.documentOpen,
            renderTaskActive: snapshot.renderTaskActive,
          };
        })(),
      };
    },
    {
      cardSelector: `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(target.key)}]`,
    },
  );
  expect(replacing).toMatchObject({
    src: demand.src,
    decoded: true,
    created: demand.created,
    revoked: [],
  });

  await obRun(
    vaultId,
    async ({ zotlit }) => {
      zotlit.services.excerptImage.rendererDiagnostics!.release();
    },
    undefined,
  );
  // The one request these pixels answer never changed, so the fallback's crop is
  // the reader's crop: its decoded pixels must equal the borrowed crop's, at the
  // same size. That is the parity the two routes' shared cache publication
  // depends on, and it is read off the card that paints it.
  //
  // The wait is on the replacement *landing* rather than on a URL changing,
  // because a card that keeps the URL of an unchanged image has published just
  // as truly as one that allocated a fresh URL: what it must show is the crop,
  // with either the URL it held and no work left, or a fresh URL painted while
  // the previous image's was released.
  await obRunUntil(
    vaultId,
    async (
      { app, zotlit, page: helpers },
      {
        cardSelector,
        pixelsWidth,
        pixelsHeight,
        pixelData,
        createdLength,
        imageSrc,
      },
    ) => {
      const pixels = JSON.parse(
        await (async () => {
          const image = app.workspace
            .getLeavesOfType("zotero-annotation-view")
            .map((leaf) => leaf.view.containerEl.querySelector(cardSelector))
            .find(Boolean)
            ?.querySelector("img");
          if (!image || !image.complete || image.naturalWidth === 0)
            return JSON.stringify(null);
          const canvas = document.createElement("canvas");
          canvas.width = image.naturalWidth;
          canvas.height = image.naturalHeight;
          try {
            const context = canvas.getContext("2d");
            if (!context) throw new Error("Card pixel canvas unavailable");
            context.drawImage(image, 0, 0);
            const data = context.getImageData(
              0,
              0,
              canvas.width,
              canvas.height,
            ).data;
            return JSON.stringify({
              width: canvas.width,
              height: canvas.height,
              pixels: require("crypto")
                .createHash("sha256")
                .update(new Uint8Array(data.buffer))
                .digest("hex"),
            });
          } finally {
            canvas.width = 0;
            canvas.height = 0;
          }
        })(),
      );
      if (
        !pixels ||
        pixels.width !== pixelsWidth ||
        pixels.height !== pixelsHeight ||
        pixels.pixels !== pixelData
      )
        return false;
      const state = helpers.scratch.__zotlitExcerptUrlProbe!;
      const image = app.workspace
        .getLeavesOfType("zotero-annotation-view")
        .map((leaf) => leaf.view.containerEl.querySelector(cardSelector))
        .find(Boolean)
        ?.querySelector("img");
      const diagnostics = (() => {
        const snapshot =
          zotlit.services.excerptImage.rendererDiagnostics!.snapshot();
        return {
          loads: snapshot.loads,
          phase: snapshot.phase,
          jobActive: snapshot.jobActive,
          fileOpen: snapshot.fileOpen,
          documentOpen: snapshot.documentOpen,
          renderTaskActive: snapshot.renderTaskActive,
        };
      })();
      if (
        state.created.length === createdLength &&
        image!.src === imageSrc &&
        !diagnostics.jobActive &&
        diagnostics.phase === "idle"
      )
        return true;
      return (
        state.created.length > createdLength &&
        image!.src === state.created[state.created.length - 1] &&
        state.revoked.includes(imageSrc!)
      );
    },
    {
      cardSelector: `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(target.key)}]`,
      pixelsWidth: borrowed.pixels!.width,
      pixelsHeight: borrowed.pixels!.height,
      pixelData: borrowed.pixels!.pixels,
      createdLength: demand.created.length,
      imageSrc: demand.src,
    },
    {
      tries: 80,
      what: "the card image to show the expected cropped pixels and URL",
    },
  );
  const replaced = await obRun(
    vaultId,
    async ({ app, zotlit, page: helpers }, { cardSelector }) => {
      const state = helpers.scratch.__zotlitExcerptUrlProbe!;
      const image = app.workspace
        .getLeavesOfType("zotero-annotation-view")
        .map((leaf) => leaf.view.containerEl.querySelector(cardSelector))
        .find(Boolean)
        ?.querySelector("img");
      return {
        src: image?.src ?? null,
        decoded: !!(image && image.complete && image.naturalWidth > 0),
        created: state.created.slice(),
        revoked: state.revoked.slice(),
        diagnostics: (() => {
          const snapshot =
            zotlit.services.excerptImage.rendererDiagnostics!.snapshot();
          return {
            loads: snapshot.loads,
            phase: snapshot.phase,
            jobActive: snapshot.jobActive,
            fileOpen: snapshot.fileOpen,
            documentOpen: snapshot.documentOpen,
            renderTaskActive: snapshot.renderTaskActive,
          };
        })(),
      };
    },
    {
      cardSelector: `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(target.key)}]`,
    },
  );
  // URL lifetime, not an allocation count: the previous URL stayed usable while
  // the replacement ran (the card painted it, and nothing revoked it), and once
  // the new image is shown the card either keeps that URL — the pixels did not
  // move — or holds a fresh one it allocated and released the previous. What it
  // must never do is paint a URL it released, or orphan the one it replaced.
  const allocated = replaced.created.slice(demand.created.length);
  if (replaced.src === demand.src) {
    expect(allocated, "an unchanged URL needs no new allocation").toEqual([]);
    expect(replaced.revoked).not.toContain(replaced.src);
  } else {
    expect(replaced.src).toBe(allocated.at(-1));
    expect(
      replaced.revoked.filter((url) => url === demand.src),
      "the replaced image's URL is released exactly as the new one is shown",
    ).toHaveLength(1);
  }
  expect(replaced.src).toMatch(/^blob:/);
  expect(replaced.diagnostics).toMatchObject({
    jobActive: false,
    renderTaskActive: false,
  });
  expect(loadsBetween(demand.diagnostics, replaced.diagnostics)).toEqual({
    borrowed: 0,
    detached: 1,
    fileOpens: 1,
    documentLoads: 1,
  });
  console.info("Reader-backed excerpt evidence", {
    runtime,
    sha256: borrowed.outcome.sha256,
    borrowed: loadsBetween(borrowed.before, borrowed.after),
    pixels: borrowed.pixels,
    import: {
      outcome: imported.result!.outcome,
      write:
        imported.result!.outcome === "single"
          ? imported.result!.write
          : undefined,
      note: importedNote.path,
      loads: loadsBetween(imported.before, imported.after!),
      // The Fixture corpus's only excerpt-bearing note, imported warm: how long
      // the app took to settle it, and the memory its renderer process held
      // around it (`process.getProcessMemoryInfo()` answers null here, so the
      // renderer's own Node view is what this record has).
      elapsedMs: imported.elapsedMs,
      memoryBefore: imported.memoryBefore,
      memoryAfter: imported.memoryAfter,
      prepared: prepared.outcomes.length,
    },
    asset: published[0],
    detachedFallback: {
      loads: loadsBetween(demand.diagnostics, replaced.diagnostics),
      pixels: borrowed.pixels,
      url: {
        painted: replaced.src,
        previous: demand.src,
        reused: replaced.src === demand.src,
      },
    },
  });
}

/** One excerpt of a multi-PDF batch: a crop on one page of one real PDF. */
export interface MultiPdfExcerpt {
  /** The Fixture Attachment the PDF belongs to, so each PDF keeps its own key. */
  readonly attachmentKey: string;
  /** Host path of the PDF, resolved by the caller (vault- or Zotero-rooted). */
  readonly pdfPath: string;
  readonly pageIndex: number;
  readonly rect: readonly [number, number, number, number];
}

/** One request of a measured batch, with what the renderer did for it. */
interface BatchRequest {
  attachmentKey: string;
  /** What the app took to settle this request, crop and decode included. */
  ms: number;
  kind: string;
  provenance?: string;
  bytes?: number;
  sha256?: string;
  loads: Loads;
}

/**
 * The renderer process's own memory, sampled as each request of the batch
 * settles: the peak over the batch rather than a window before and after it.
 * `private` is Electron's `process.getProcessMemoryInfo()`, which this
 * environment answers inconsistently, so its answers are counted; the Node
 * numbers come from the renderer's own `process.memoryUsage()`.
 */
interface BatchMemoryPeak {
  samples: number;
  node: { rss: number; heapUsed: number; heapTotal: number };
  electron: { answers: number; nulls: number; private: number };
}

interface MultiPdfBatch {
  coldMs: number;
  warmMs: number;
  cold: BatchRequest[];
  warm: BatchRequest[];
  memory: BatchMemoryPeak;
  excerpts: { attachmentKey: string; pdfPath: string }[];
}

/** One pass over the batch, as one CLI call reports it. */
interface BatchChunk {
  ms: number;
  requests: BatchRequest[];
  memory: BatchMemoryPeak;
}

/**
 * One multi-PDF excerpt batch through the production service, measured in the
 * running app: every request asks for a crop of its own real PDF, cold and then
 * warm, and the renderer's own counters say what the PDF work cost.
 *
 * This is the one measurement the Node harness behind
 * `docs/excerpt-image-queue-measurements.md` cannot take: its PDF work is a
 * stand-in charging modelled load and crop times, so its multi-PDF rows are
 * corpus properties plus modelled delays rather than what Chromium and PDF.js
 * do. The corpus here is the Fixture's own PDFs — several documents, not one —
 * and the numbers are the app's.
 *
 * It is a measurement, not a pixel oracle: the crops are asserted to resolve
 * with real bytes and to be served from the cache warm, while their pixels are
 * `verifyExcerptRendering`'s business, against PDFs whose generated geometry it
 * carries oracles for.
 */
export async function verifyMultiPdfExcerptBatch(
  vaultId: string,
  excerpts: readonly MultiPdfExcerpt[],
): Promise<void> {
  const pdfs = new Set(excerpts.map(({ attachmentKey }) => attachmentKey));
  // One call per pass, so a pass is contiguous in the app: no CLI child spawns
  // between two requests of it, and the deadline is the app's own work rather
  // than the 15 s that bounds one question. A pass over several PDFs is one
  // measurement, and a machine under load must not turn it into a failure.
  const measurePass = (): Promise<BatchChunk> =>
    obRun(
      vaultId,
      async ({ zotlit }, { excerpts }) => {
        const service = zotlit.services.excerptImage;
        const sampleMemory = () => {
          try {
            const value = process.memoryUsage();
            return {
              rss: value.rss,
              heapUsed: value.heapUsed,
              heapTotal: value.heapTotal,
            };
          } catch (error) {
            return String(error);
          }
        };
        const request = (
          excerpt: MultiPdfExcerpt,
          index: number,
        ): ExcerptRequest => ({
          annotation: {
            key: `MULTIPDF${String(index).padStart(2, "0")}`,
            parentKey: excerpt.attachmentKey,
            type: "image",
            color: "#ff0000",
            comment: null,
            text: null,
            pageLabel: String(excerpt.pageIndex + 1),
            tags: [],
            version: null,
            sortIndex: "",
            lock: null,
            position: {
              kind: "pdf-rects",
              pageIndex: excerpt.pageIndex,
              rects: [[...excerpt.rect]],
            },
          },
          source: { kind: "zotero-local-api", serverID: "excerpt-acceptance" },
          sourceScope: "excerpt-acceptance",
          attachmentKey: excerpt.attachmentKey,
          libraryID: 1,
          pdfPath: excerpt.pdfPath,
          zoteroPngPath: null,
        });
        const memory = {
          samples: 0,
          node: { rss: 0, heapUsed: 0, heapTotal: 0 },
          electron: { answers: 0, nulls: 0, private: 0 },
        };
        const observeMemory = async () => {
          const value = sampleMemory();
          if (typeof value !== "string") {
            memory.samples += 1;
            memory.node.rss = Math.max(memory.node.rss, value.rss);
            memory.node.heapUsed = Math.max(
              memory.node.heapUsed,
              value.heapUsed,
            );
            memory.node.heapTotal = Math.max(
              memory.node.heapTotal,
              value.heapTotal,
            );
          }
          // Electron's own probe is the unreliable one: it answers null, and it
          // has been seen to leave a promise pending for fifteen seconds. It is
          // bounded here and awaited outside the request's own timing, so a
          // probe that never answers costs the record a sample, not a time.
          const deadline =
            Promise.withResolvers<Electron.ProcessMemoryInfo | null>();
          setTimeout(() => deadline.resolve(null), 1000);
          const info = await Promise.race([
            process.getProcessMemoryInfo().catch(() => null),
            deadline.promise,
          ]);
          if (info && Number.isFinite(info.private)) {
            memory.electron.answers += 1;
            memory.electron.private = Math.max(
              memory.electron.private,
              info.private,
            );
          } else {
            memory.electron.nulls += 1;
          }
        };
        const answers: {
          attachmentKey: string;
          ms: number;
          before: RendererDiagnostics;
          after: RendererDiagnostics;
          outcome: {
            kind: string;
            provenance?: string;
            bytes?: number;
            sha256?: string;
          };
        }[] = [];
        let ms = 0;
        for (const [index, excerpt] of excerpts.entries()) {
          const before = (() => {
            const snapshot =
              zotlit.services.excerptImage.rendererDiagnostics!.snapshot();
            return {
              loads: snapshot.loads,
              phase: snapshot.phase,
              jobActive: snapshot.jobActive,
              fileOpen: snapshot.fileOpen,
              documentOpen: snapshot.documentOpen,
              renderTaskActive: snapshot.renderTaskActive,
            };
          })();
          const requestStarted = performance.now();
          const outcome = await zotlit.services.bridge.runPromise(
            service.resolve(request(excerpt, index)),
          );
          const settled = performance.now() - requestStarted;
          const after = (() => {
            const snapshot =
              zotlit.services.excerptImage.rendererDiagnostics!.snapshot();
            return {
              loads: snapshot.loads,
              phase: snapshot.phase,
              jobActive: snapshot.jobActive,
              fileOpen: snapshot.fileOpen,
              documentOpen: snapshot.documentOpen,
              renderTaskActive: snapshot.renderTaskActive,
            };
          })();
          await observeMemory();
          ms += settled;
          answers.push({
            attachmentKey: excerpt.attachmentKey,
            ms: settled,
            before,
            after,
            outcome:
              outcome.kind === "available"
                ? {
                    kind: outcome.kind,
                    provenance: outcome.provenance,
                    bytes: outcome.bytes.length,
                    sha256: require("crypto")
                      .createHash("sha256")
                      .update(outcome.bytes)
                      .digest("hex"),
                  }
                : { kind: outcome.kind },
          });
        }
        const flatten = (entry: (typeof answers)[number]) => ({
          attachmentKey: entry.attachmentKey,
          ms: entry.ms,
          ...entry.outcome,
          loads: {
            borrowed: entry.after.loads.borrowed - entry.before.loads.borrowed,
            detached: entry.after.loads.detached - entry.before.loads.detached,
            fileOpens:
              entry.after.loads.fileOpens - entry.before.loads.fileOpens,
            documentLoads:
              entry.after.loads.documentLoads -
              entry.before.loads.documentLoads,
          },
        });
        return { ms, requests: answers.map(flatten), memory };
      },
      { excerpts },
      {
        timeoutMs: // Five minutes: every request here settles in well under a second on an
          // idle machine, so anything near this bound is the machine, not the batch.
          300000,
      },
    );

  // The app's own readiness first: a vault just opened is still indexing, and a
  // measurement taken across that is the app's startup, not the queue's batch.
  await obRun(
    vaultId,
    async ({ zotlit }) => {
      const services = zotlit.services;
      await services.bridge.runPromise(services.noteIndex.whenIndexed);
      await services.bridge.runPromise(services.excerptImage.clear);
    },
    undefined,
    {
      timeoutMs: // The index of a freshly opened Fixture Vault is the one thing here that
        // legitimately outlasts a single CLI call's default deadline.
        300000,
    },
  );
  const cold = await measurePass();
  const warm = await measurePass();
  const batch: MultiPdfBatch = {
    coldMs: cold.ms,
    warmMs: warm.ms,
    cold: cold.requests,
    warm: warm.requests,
    memory: {
      samples: cold.memory.samples + warm.memory.samples,
      node: {
        rss: Math.max(cold.memory.node.rss, warm.memory.node.rss),
        heapUsed: Math.max(
          cold.memory.node.heapUsed,
          warm.memory.node.heapUsed,
        ),
        heapTotal: Math.max(
          cold.memory.node.heapTotal,
          warm.memory.node.heapTotal,
        ),
      },
      electron: {
        answers: cold.memory.electron.answers + warm.memory.electron.answers,
        nulls: cold.memory.electron.nulls + warm.memory.electron.nulls,
        private: Math.max(
          cold.memory.electron.private,
          warm.memory.electron.private,
        ),
      },
    },
    excerpts: excerpts.map(({ attachmentKey, pdfPath }) => ({
      attachmentKey,
      pdfPath,
    })),
  };
  // The batch's own numbers, emitted as soon as they exist: the record in
  // `docs/excerpt-image-queue-measurements.md` cites them, and the assertions
  // below are what make them the shape of a passing run. Serialized, because
  // the numbers are nested and a console that collapses them records nothing.
  console.info(
    "Multi-PDF excerpt batch evidence",
    JSON.stringify(batch, null, 2),
  );

  expect(pdfs.size).toBeGreaterThan(1);
  expect(batch.excerpts).toHaveLength(excerpts.length);
  const coldLoads: Loads = {
    borrowed: 0,
    detached: 0,
    fileOpens: 0,
    documentLoads: 0,
  };
  for (const { loads } of batch.cold)
    for (const kind of Object.keys(coldLoads) as (keyof Loads)[])
      coldLoads[kind] += loads[kind];
  for (const [index, entry] of batch.cold.entries()) {
    expect(
      entry,
      `cold request ${index} of the multi-PDF batch must render its own PDF`,
    ).toMatchObject({
      kind: "available",
      provenance: "rendered",
      loads: { borrowed: 0, detached: 1 },
    });
    expect(entry.bytes).toBeGreaterThan(0);
    expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
  }
  // Every PDF is opened once per excerpt and no more, with each open loaded and
  // no double work: an excerpt is one crop of one document. The queue's
  // residency is shared between concurrent work, so a pass of sequential
  // requests pays a load each — the numbers below record that rather than
  // assuming a retention the app does not promise.
  expect(coldLoads).toEqual({
    borrowed: 0,
    detached: excerpts.length,
    fileOpens: excerpts.length,
    documentLoads: excerpts.length,
  });
  // The warm pass is pure cache: the same pixels for no PDF work at all.
  for (const [index, entry] of batch.warm.entries()) {
    expect(entry).toMatchObject({
      provenance: "cache",
      sha256: batch.cold[index]!.sha256,
      loads: { borrowed: 0, detached: 0, fileOpens: 0, documentLoads: 0 },
    });
  }
  expect(batch.warmMs).toBeLessThan(batch.coldMs);
  // A measurement, not a benchmark: a pass this long means something in it
  // stalled — the failures this case is here to report, rather than a slow
  // machine, since every request above settles in tens of milliseconds.
  expect(batch.coldMs).toBeLessThan(60_000);
  expect(batch.memory.samples).toBe(2 * excerpts.length);
  expect(batch.memory.node.rss).toBeGreaterThan(0);
}

/**
 * A saved edit's pixels: the card that shows an Annotation goes on painting
 * the image of the record that stood before the write while the replacement
 * resolves, then publishes the new pixels and releases the previous object URL.
 * A metadata-only edit says nothing at all and keeps the same image.
 *
 * A confirmed write needs Zotero's Local API, so this runs where the Attachment
 * is writable — the Paired Run — and skips where it is not.
 *
 * The write this case verifies lands on the Annotation, but the question of
 * whether one may land is about the **Attachment**: the repository indexes its
 * verified database sources by Attachment, so `capabilityFor` answers
 * `read-only`/`server-changed` for any key it holds no source for — an
 * Annotation's own key among them — even where the Attachment it belongs to is
 * writable. Asking with the Annotation key therefore skipped every assertion
 * below in every run, whatever the Attachment allowed.
 */
export async function verifySavedEditDisplay(
  vaultId: string,
  context: { skip: (note?: string) => void },
): Promise<void> {
  const card = await obRun(
    vaultId,
    async ({ zotlit }, { attachmentKey, targetKey }) => {
      const { annotationRepository: repository, bridge } = zotlit.services;
      const list = await bridge.runPromise(repository.read(attachmentKey));
      const record =
        list?.annotations?.find((annotation) => annotation.key === targetKey) ??
        null;
      const capability = bridge.runSync(
        repository.capabilityFor(attachmentKey),
      );
      return {
        capability:
          capability.kind === "cooldown"
            ? {
                kind: capability.kind,
                retryAfter: String(capability.retryAfter.toJSON()),
              }
            : capability,
        record: record && { color: record.color, comment: record.comment },
      };
    },
    { attachmentKey: attachment.key, targetKey: target.key },
  );
  if (card.capability.kind !== "writable") {
    context.skip(
      `a confirmed write needs a writable Attachment; this one is ${JSON.stringify(card.capability)}`,
    );
    return;
  }
  expect(card.record).not.toBeNull();
  await obRunUntil(
    vaultId,
    async ({ app }, { cardSelector }) => {
      return !!(() => {
        const image = app.workspace
          .getLeavesOfType("zotero-annotation-view")
          .map((leaf) => leaf.view.containerEl.querySelector(cardSelector))
          .find(Boolean)
          ?.querySelector("img");
        return (
          image &&
          image.complete &&
          image.naturalWidth > 0 &&
          image.src.startsWith("blob:")
        );
      })();
    },
    {
      cardSelector: `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(target.key)}]`,
    },
    {
      tries: 80,
      what: "the card image to finish loading as a blob URL on the later check",
    },
  );
  // The derived cache is keyed by what the pixels depend on, not by version, so
  // an earlier run's edit left the edited colour's image cached, and the edit
  // would be served from it without the replacement rendering held below.
  await obRun(
    vaultId,
    async ({ zotlit }) => {
      await zotlit.services.bridge.runPromise(
        zotlit.services.excerptImage.clear,
      );
    },
    undefined,
  );

  await using cleanup = new AsyncDisposableStack();
  cleanup.defer(() =>
    cleanupStep(async () => {
      await obRun(
        vaultId,
        async ({ zotlit }) => {
          zotlit.services.excerptImage.rendererDiagnostics!.release();
        },
        undefined,
      );
    }),
  );
  cleanup.defer(() => removeUrlProbe(vaultId));
  // The Fixture Annotation goes back to the record it was read with, so the
  // saved edit leaves the Library as it found it. An empty comment is how a
  // comment is cleared, so a null one is restored as written.
  cleanup.defer(() =>
    cleanupStep(async () => {
      await obRun(
        vaultId,
        async ({ zotlit }, { targetKey, commentText, colorValue }) => {
          const repository = zotlit.services.annotationRepository,
            bridge = zotlit.services.bridge;
          const comment = await bridge.runPromise(
            repository.patchComment(targetKey, commentText),
          );
          if (comment.kind !== "idle")
            throw new Error("The saved comment was not restored");
          const color = await bridge.runPromise(
            repository.patchColor(targetKey, colorValue),
          );
          if (color.kind !== "idle")
            throw new Error("The saved colour was not restored");
        },
        {
          targetKey: target.key,
          commentText: card.record!.comment ?? "",
          colorValue: card.record!.color ?? editedColor,
        },
      );
    }),
  );
  await installUrlProbe(vaultId);
  const before = await obRun(
    vaultId,
    async ({ app, zotlit, page: helpers }, { cardSelector }) => {
      const state = helpers.scratch.__zotlitExcerptUrlProbe!;
      const image = app.workspace
        .getLeavesOfType("zotero-annotation-view")
        .map((leaf) => leaf.view.containerEl.querySelector(cardSelector))
        .find(Boolean)
        ?.querySelector("img");
      return {
        src: image?.src ?? null,
        decoded: !!(image && image.complete && image.naturalWidth > 0),
        created: state.created.slice(),
        revoked: state.revoked.slice(),
        diagnostics: (() => {
          const snapshot =
            zotlit.services.excerptImage.rendererDiagnostics!.snapshot();
          return {
            loads: snapshot.loads,
            phase: snapshot.phase,
            jobActive: snapshot.jobActive,
            fileOpen: snapshot.fileOpen,
            documentOpen: snapshot.documentOpen,
            renderTaskActive: snapshot.renderTaskActive,
          };
        })(),
      };
    },
    {
      cardSelector: `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(target.key)}]`,
    },
  );
  expect(before.src).toMatch(/^blob:/);
  // The record a note import or a batch resolution captures while it runs, taken
  // here as the edit arrives: it is resolved again after the edit has answered,
  // and the store's latest reference must still name the edit.
  const staleSnapshot = await obRun(
    vaultId,
    async (
      { app, zotlit, page: helpers },
      { attachmentKey, libraryId, vaultPath, targetKey },
    ) => {
      const services = zotlit.services;
      const list = await services.bridge.runPromise(
        services.annotationRepository.read(attachmentKey),
      );
      if (!list) throw new Error("The Fixture Attachment has no Annotations");
      const requestFor = (key: string) => {
        const annotation = list.annotations.find(
          (candidate) => candidate.key === key,
        );
        if (!annotation)
          throw new Error(`The Fixture holds no Annotation ${key}`);
        return {
          annotation,
          source: list.source,
          sourceScope: services.bridge.runSync(services.zoteroPref.current)
            .dataDir,
          attachmentKey: annotation.parentKey,
          libraryID: libraryId,
          pdfPath: (app.vault.adapter as FileSystemAdapter).getFullPath(
            vaultPath!,
          ),
          zoteroPngPath: require("path").join(
            services.bridge.runSync(services.zoteroPref.current).dataDir,
            "cache",
            "library",
            `${key}.png`,
          ),
        };
      };
      const request = requestFor(targetKey);
      helpers.scratch.__zotlitExcerptStale = request;
      return {
        version: request.annotation.version ?? null,
        color: request.annotation.color ?? null,
      };
    },
    {
      attachmentKey: attachment.key,
      libraryId: attachment.libraryID,
      vaultPath,
      targetKey: target.key,
    },
  );
  expect(staleSnapshot.color).toBe(card.record!.color);
  expect(
    staleSnapshot.version,
    "the Fixture Annotations must carry a version for saved order to be an order",
  ).not.toBeNull();
  // What the card paints now, decoded: the edit's own replacement is compared
  // against it, so a fresh URL over the old pixels cannot pass.
  const beforePixels = await obRun(
    vaultId,
    async ({ app }, { cardSelector }) => {
      const image = app.workspace
        .getLeavesOfType("zotero-annotation-view")
        .map((leaf) => leaf.view.containerEl.querySelector(cardSelector))
        .find(Boolean)
        ?.querySelector("img");
      if (!image || !image.complete || image.naturalWidth === 0) return null;
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      try {
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Card pixel canvas unavailable");
        context.drawImage(image, 0, 0);
        const data = context.getImageData(
          0,
          0,
          canvas.width,
          canvas.height,
        ).data;
        return {
          width: canvas.width,
          height: canvas.height,
          pixels: require("crypto")
            .createHash("sha256")
            .update(new Uint8Array(data.buffer))
            .digest("hex"),
        };
      } finally {
        canvas.width = 0;
        canvas.height = 0;
      }
    },
    {
      cardSelector: `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(target.key)}]`,
    },
  );
  expect(beforePixels?.pixels).toMatch(/^[0-9a-f]{64}$/);

  // A colour edit moves an ink Annotation's pixels, so the card's image is
  // replaced. Held inside the crop that replacement needs, the previous image
  // is observable on screen rather than inferred from timing.
  expect(
    await obRun(
      vaultId,
      async ({ zotlit }) => {
        zotlit.services.excerptImage.rendererDiagnostics!.hold(
          "page-rendering",
        );
        return true;
      },
      undefined,
    ),
  ).toBe(true);
  const saved = await obRun(
    vaultId,
    async ({ zotlit }, { targetKey, editedColor }) => {
      const outcome = await zotlit.services.bridge.runPromise(
        zotlit.services.annotationRepository.patchColor(targetKey, editedColor),
      );
      return { kind: outcome.kind };
    },
    { targetKey: target.key, editedColor },
  );
  expect(saved).toMatchObject({ kind: "idle" });
  await obRunUntil(
    vaultId,
    async ({ zotlit }) => {
      const state = (() => {
        const snapshot =
          zotlit.services.excerptImage.rendererDiagnostics!.snapshot();
        return {
          loads: snapshot.loads,
          phase: snapshot.phase,
          jobActive: snapshot.jobActive,
          fileOpen: snapshot.fileOpen,
          documentOpen: snapshot.documentOpen,
          renderTaskActive: snapshot.renderTaskActive,
        };
      })();
      return state.phase === "page-rendering" && state.jobActive;
    },
    undefined,
    {
      tries: 80,
      what: "the excerpt renderer to reach the page-rendering phase",
    },
  );
  const held = await obRun(
    vaultId,
    async ({ app, zotlit, page: helpers }, { cardSelector }) => {
      const state = helpers.scratch.__zotlitExcerptUrlProbe!;
      const image = app.workspace
        .getLeavesOfType("zotero-annotation-view")
        .map((leaf) => leaf.view.containerEl.querySelector(cardSelector))
        .find(Boolean)
        ?.querySelector("img");
      return {
        src: image?.src ?? null,
        decoded: !!(image && image.complete && image.naturalWidth > 0),
        created: state.created.slice(),
        revoked: state.revoked.slice(),
        diagnostics: (() => {
          const snapshot =
            zotlit.services.excerptImage.rendererDiagnostics!.snapshot();
          return {
            loads: snapshot.loads,
            phase: snapshot.phase,
            jobActive: snapshot.jobActive,
            fileOpen: snapshot.fileOpen,
            documentOpen: snapshot.documentOpen,
            renderTaskActive: snapshot.renderTaskActive,
          };
        })(),
      };
    },
    {
      cardSelector: `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(target.key)}]`,
    },
  );
  expect(held).toMatchObject({
    src: before.src,
    decoded: true,
    created: before.created,
    revoked: [],
  });

  await obRun(
    vaultId,
    async ({ zotlit }) => {
      zotlit.services.excerptImage.rendererDiagnostics!.release();
    },
    undefined,
  );
  await obRunUntil(
    vaultId,
    async ({ app }, { cardSelector, beforeImageSrc }) => {
      return (
        !!(() => {
          const image = app.workspace
            .getLeavesOfType("zotero-annotation-view")
            .map((leaf) => leaf.view.containerEl.querySelector(cardSelector))
            .find(Boolean)
            ?.querySelector("img");
          return (
            image &&
            image.complete &&
            image.naturalWidth > 0 &&
            image.src.startsWith("blob:")
          );
        })() &&
        app.workspace
          .getLeavesOfType("zotero-annotation-view")
          .map((leaf) => leaf.view.containerEl.querySelector(cardSelector))
          .find(Boolean)
          ?.querySelector("img")!.src !== beforeImageSrc
      );
    },
    {
      cardSelector: `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(target.key)}]`,
      beforeImageSrc: before.src,
    },
    {
      tries: 80,
      what: "the card image to load a new blob URL instead of the one before",
    },
  );
  const edited = await obRun(
    vaultId,
    async ({ app, zotlit, page: helpers }, { cardSelector }) => {
      const state = helpers.scratch.__zotlitExcerptUrlProbe!;
      const image = app.workspace
        .getLeavesOfType("zotero-annotation-view")
        .map((leaf) => leaf.view.containerEl.querySelector(cardSelector))
        .find(Boolean)
        ?.querySelector("img");
      return {
        src: image?.src ?? null,
        decoded: !!(image && image.complete && image.naturalWidth > 0),
        created: state.created.slice(),
        revoked: state.revoked.slice(),
        diagnostics: (() => {
          const snapshot =
            zotlit.services.excerptImage.rendererDiagnostics!.snapshot();
          return {
            loads: snapshot.loads,
            phase: snapshot.phase,
            jobActive: snapshot.jobActive,
            fileOpen: snapshot.fileOpen,
            documentOpen: snapshot.documentOpen,
            renderTaskActive: snapshot.renderTaskActive,
          };
        })(),
      };
    },
    {
      cardSelector: `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(target.key)}]`,
    },
  );
  // URL ownership, not an allocation count: the card paints a URL it allocated
  // to show the edited image, that URL is still live, and every URL it
  // superseded — the image before the edit, and any temporary it allocated and
  // did not keep — is released. A refactor is free to allocate more than one.
  const allocated = edited.created.slice(before.created.length);
  const revoked = edited.revoked.slice(before.revoked.length);
  expect(allocated).toContain(edited.src);
  expect(revoked).not.toContain(edited.src);
  expect(revoked).toContain(before.src);
  for (const url of allocated)
    if (url !== edited.src) expect(revoked).toContain(url);
  expect(
    loadsBetween(before.diagnostics, edited.diagnostics).detached +
      loadsBetween(before.diagnostics, edited.diagnostics).borrowed,
  ).toBeGreaterThan(0);
  // The replacement publishes pixels, not just a URL: what the card paints now
  // is the image the saved record resolves to, and it is not the image the
  // pre-edit record resolved to.
  const editedPixels = await obRun(
    vaultId,
    async ({ app }, { cardSelector }) => {
      const image = app.workspace
        .getLeavesOfType("zotero-annotation-view")
        .map((leaf) => leaf.view.containerEl.querySelector(cardSelector))
        .find(Boolean)
        ?.querySelector("img");
      if (!image || !image.complete || image.naturalWidth === 0) return null;
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      try {
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Card pixel canvas unavailable");
        context.drawImage(image, 0, 0);
        const data = context.getImageData(
          0,
          0,
          canvas.width,
          canvas.height,
        ).data;
        return {
          width: canvas.width,
          height: canvas.height,
          pixels: require("crypto")
            .createHash("sha256")
            .update(new Uint8Array(data.buffer))
            .digest("hex"),
        };
      } finally {
        canvas.width = 0;
        canvas.height = 0;
      }
    },
    {
      cardSelector: `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(target.key)}]`,
    },
  );
  const resolved = await obRun(
    vaultId,
    async (
      { app, zotlit },
      { attachmentKey, libraryId, vaultPath, targetKey },
    ) => {
      const services = zotlit.services;
      const list = await services.bridge.runPromise(
        services.annotationRepository.read(attachmentKey),
      );
      if (!list) throw new Error("The Fixture Attachment has no Annotations");
      const requestFor = (key: string) => {
        const annotation = list.annotations.find(
          (candidate) => candidate.key === key,
        );
        if (!annotation)
          throw new Error(`The Fixture holds no Annotation ${key}`);
        return {
          annotation,
          source: list.source,
          sourceScope: services.bridge.runSync(services.zoteroPref.current)
            .dataDir,
          attachmentKey: annotation.parentKey,
          libraryID: libraryId,
          pdfPath: (app.vault.adapter as FileSystemAdapter).getFullPath(
            vaultPath!,
          ),
          zoteroPngPath: require("path").join(
            services.bridge.runSync(services.zoteroPref.current).dataDir,
            "cache",
            "library",
            `${key}.png`,
          ),
        };
      };
      const outcome = await services.bridge.runPromise(
        services.excerptImage.resolve(requestFor(targetKey)),
      );
      return {
        pixels:
          outcome.kind === "available"
            ? await (async (bytes, mimeType) => {
                const bitmap = await createImageBitmap(
                  new Blob([new Uint8Array(bytes)], { type: mimeType }),
                );
                let canvas;
                try {
                  canvas = document.createElement("canvas");
                  canvas.width = bitmap.width;
                  canvas.height = bitmap.height;
                  const context = canvas.getContext("2d");
                  if (!context)
                    throw new Error("Excerpt pixel canvas unavailable");
                  context.drawImage(bitmap, 0, 0);
                  const data = context.getImageData(
                    0,
                    0,
                    bitmap.width,
                    bitmap.height,
                  ).data;
                  return {
                    width: bitmap.width,
                    height: bitmap.height,
                    pixels: require("crypto")
                      .createHash("sha256")
                      .update(new Uint8Array(data.buffer))
                      .digest("hex"),
                  };
                } finally {
                  if (canvas) {
                    canvas.width = 0;
                    canvas.height = 0;
                  }
                  bitmap.close();
                }
              })(outcome.bytes, outcome.format.mimeType)
            : null,
      };
    },
    {
      attachmentKey: attachment.key,
      libraryId: attachment.libraryID,
      vaultPath,
      targetKey: target.key,
    },
  );
  expect(editedPixels).toMatchObject({
    width: expect.any(Number),
    height: expect.any(Number),
    pixels: expect.stringMatching(/^[0-9a-f]{64}$/),
  });
  expect(editedPixels!.pixels).not.toBe(beforePixels!.pixels);
  expect(editedPixels).toEqual(resolved.pixels);

  // A comment moves no pixels: the record's own image stands, no crop runs, and
  // the card keeps the very URL it paints from.
  const idle = await obRun(
    vaultId,
    async ({ zotlit }, { targetKey, editedComment }) => {
      const { annotationRepository: repository, bridge } = zotlit.services;
      const before = (() => {
        const snapshot =
          zotlit.services.excerptImage.rendererDiagnostics!.snapshot();
        return {
          loads: snapshot.loads,
          phase: snapshot.phase,
          jobActive: snapshot.jobActive,
          fileOpen: snapshot.fileOpen,
          documentOpen: snapshot.documentOpen,
          renderTaskActive: snapshot.renderTaskActive,
        };
      })();
      const outcome = await bridge.runPromise(
        repository.patchComment(targetKey, editedComment),
      );
      const after = (() => {
        const snapshot =
          zotlit.services.excerptImage.rendererDiagnostics!.snapshot();
        return {
          loads: snapshot.loads,
          phase: snapshot.phase,
          jobActive: snapshot.jobActive,
          fileOpen: snapshot.fileOpen,
          documentOpen: snapshot.documentOpen,
          renderTaskActive: snapshot.renderTaskActive,
        };
      })();
      return { before, after, outcome: { kind: outcome.kind } };
    },
    { targetKey: target.key, editedComment },
  );
  expect(idle.outcome).toMatchObject({ kind: "idle" });
  await obRunUntil(
    vaultId,
    async ({ app }, { editedComment }) => {
      return app.workspace
        .getLeavesOfType("zotero-annotation-view")
        .some((leaf) =>
          leaf.view.containerEl.textContent?.includes(editedComment),
        );
    },
    { editedComment },
    {
      tries: 80,
      what: "the Annotation View to show the edited comment text",
    },
  );
  const unchanged = await obRun(
    vaultId,
    async ({ app, zotlit, page: helpers }, { cardSelector }) => {
      const state = helpers.scratch.__zotlitExcerptUrlProbe!;
      const image = app.workspace
        .getLeavesOfType("zotero-annotation-view")
        .map((leaf) => leaf.view.containerEl.querySelector(cardSelector))
        .find(Boolean)
        ?.querySelector("img");
      return {
        src: image?.src ?? null,
        decoded: !!(image && image.complete && image.naturalWidth > 0),
        created: state.created.slice(),
        revoked: state.revoked.slice(),
        diagnostics: (() => {
          const snapshot =
            zotlit.services.excerptImage.rendererDiagnostics!.snapshot();
          return {
            loads: snapshot.loads,
            phase: snapshot.phase,
            jobActive: snapshot.jobActive,
            fileOpen: snapshot.fileOpen,
            documentOpen: snapshot.documentOpen,
            renderTaskActive: snapshot.renderTaskActive,
          };
        })(),
      };
    },
    {
      cardSelector: `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(target.key)}]`,
    },
  );
  expect(unchanged).toMatchObject({
    src: edited.src,
    created: edited.created,
    revoked: [before.src],
  });
  expect(loadsBetween(idle.before, idle.after)).toEqual({
    borrowed: 0,
    detached: 0,
    fileOpens: 0,
    documentLoads: 0,
  });

  // ── A captured older request, resolved after the saved edit ─────────────
  // A note import or a batch resolution holds the record as it was when the
  // batch started. This one is resolved now that the edit has already answered,
  // and it must not become the Annotation's latest image: the reference a
  // remount seeds from names the latest *saved* record, not the latest answer.
  const superseded = await obRun(
    vaultId,
    async (
      { app, zotlit, page: helpers },
      { attachmentKey, libraryId, vaultPath, targetKey },
    ) => {
      const services = zotlit.services;
      const list = await services.bridge.runPromise(
        services.annotationRepository.read(attachmentKey),
      );
      if (!list) throw new Error("The Fixture Attachment has no Annotations");
      const requestFor = (key: string) => {
        const annotation = list.annotations.find(
          (candidate) => candidate.key === key,
        );
        if (!annotation)
          throw new Error(`The Fixture holds no Annotation ${key}`);
        return {
          annotation,
          source: list.source,
          sourceScope: services.bridge.runSync(services.zoteroPref.current)
            .dataDir,
          attachmentKey: annotation.parentKey,
          libraryID: libraryId,
          pdfPath: (app.vault.adapter as FileSystemAdapter).getFullPath(
            vaultPath!,
          ),
          zoteroPngPath: require("path").join(
            services.bridge.runSync(services.zoteroPref.current).dataDir,
            "cache",
            "library",
            `${key}.png`,
          ),
        };
      };
      const request = helpers.scratch.__zotlitExcerptStale;
      if (!request) throw new Error("The pre-edit snapshot is gone");
      const before = (() => {
        const snapshot =
          zotlit.services.excerptImage.rendererDiagnostics!.snapshot();
        return {
          loads: snapshot.loads,
          phase: snapshot.phase,
          jobActive: snapshot.jobActive,
          fileOpen: snapshot.fileOpen,
          documentOpen: snapshot.documentOpen,
          renderTaskActive: snapshot.renderTaskActive,
        };
      })();
      const outcome = await services.bridge.runPromise(
        services.excerptImage.resolve(request),
      );
      const after = (() => {
        const snapshot =
          zotlit.services.excerptImage.rendererDiagnostics!.snapshot();
        return {
          loads: snapshot.loads,
          phase: snapshot.phase,
          jobActive: snapshot.jobActive,
          fileOpen: snapshot.fileOpen,
          documentOpen: snapshot.documentOpen,
          renderTaskActive: snapshot.renderTaskActive,
        };
      })();
      const current = requestFor(targetKey);
      const reference = await services.bridge.runPromise(
        services.excerptImage.stored(current),
      );
      delete helpers.scratch.__zotlitExcerptStale;
      return {
        version: request.annotation.version ?? null,
        currentVersion: current.annotation.version ?? null,
        before,
        after,
        outcome:
          outcome.kind === "available"
            ? {
                kind: outcome.kind,
                provenance: outcome.provenance,
                pixels: await (async (bytes, mimeType) => {
                  const bitmap = await createImageBitmap(
                    new Blob([new Uint8Array(bytes)], { type: mimeType }),
                  );
                  let canvas;
                  try {
                    canvas = document.createElement("canvas");
                    canvas.width = bitmap.width;
                    canvas.height = bitmap.height;
                    const context = canvas.getContext("2d");
                    if (!context)
                      throw new Error("Excerpt pixel canvas unavailable");
                    context.drawImage(bitmap, 0, 0);
                    const data = context.getImageData(
                      0,
                      0,
                      bitmap.width,
                      bitmap.height,
                    ).data;
                    return {
                      width: bitmap.width,
                      height: bitmap.height,
                      pixels: require("crypto")
                        .createHash("sha256")
                        .update(new Uint8Array(data.buffer))
                        .digest("hex"),
                    };
                  } finally {
                    if (canvas) {
                      canvas.width = 0;
                      canvas.height = 0;
                    }
                    bitmap.close();
                  }
                })(outcome.bytes, outcome.format.mimeType),
              }
            : { kind: outcome.kind, pixels: null },
        stored:
          reference && reference.kind === "available"
            ? await (async (bytes, mimeType) => {
                const bitmap = await createImageBitmap(
                  new Blob([new Uint8Array(bytes)], { type: mimeType }),
                );
                let canvas;
                try {
                  canvas = document.createElement("canvas");
                  canvas.width = bitmap.width;
                  canvas.height = bitmap.height;
                  const context = canvas.getContext("2d");
                  if (!context)
                    throw new Error("Excerpt pixel canvas unavailable");
                  context.drawImage(bitmap, 0, 0);
                  const data = context.getImageData(
                    0,
                    0,
                    bitmap.width,
                    bitmap.height,
                  ).data;
                  return {
                    width: bitmap.width,
                    height: bitmap.height,
                    pixels: require("crypto")
                      .createHash("sha256")
                      .update(new Uint8Array(data.buffer))
                      .digest("hex"),
                  };
                } finally {
                  if (canvas) {
                    canvas.width = 0;
                    canvas.height = 0;
                  }
                  bitmap.close();
                }
              })(reference.bytes, reference.format.mimeType)
            : null,
      };
    },
    {
      attachmentKey: attachment.key,
      libraryId: attachment.libraryID,
      vaultPath,
      targetKey: target.key,
    },
  );
  expect(superseded.outcome.kind).toBe("available");
  expect(
    superseded.version!,
    "the captured snapshot must predate the saved edit",
  ).toBeLessThan(superseded.currentVersion!);
  // The snapshot really carries the superseded pixels, so what the store keeps
  // is a decision rather than the same image twice.
  expect(superseded.outcome.pixels!.pixels).toBe(beforePixels!.pixels);
  expect(superseded.outcome.pixels!.pixels).not.toBe(editedPixels!.pixels);
  // The latest reference is the saved edit's image, not the answer that arrived
  // last — this is what a card seeds from.
  expect(
    superseded.stored?.pixels,
    "the store's latest reference must still name the saved edit's pixels",
  ).toBe(editedPixels!.pixels);

  // ── What a remount shows ────────────────────────────────────────────────
  // Reopening the view drops its cards and mounts them again, which is the
  // surface a restart shows: the card seeds from that reference, and what it
  // paints must be the saved edit's pixels.
  const viewState = await obRun(
    vaultId,
    async ({ app }) => {
      const leaves = app.workspace.getLeavesOfType("zotero-annotation-view");
      if (leaves.length === 0)
        throw new Error("The Annotation View is not open");
      const state = leaves[0]!.getViewState();
      for (const leaf of leaves) leaf.detach();
      return { state: JSON.stringify(state) };
    },
    undefined,
  );
  expect(
    await obRun(
      vaultId,
      async ({ app }, { state }) => {
        const leaf = app.workspace.getLeaf("tab");
        await leaf.setViewState(
          Object.assign({}, JSON.parse(state), { active: true }),
        );
        return true;
      },
      { state: viewState.state },
    ),
  ).toBe(true);
  await obRunUntil(
    vaultId,
    async ({ app }, { cardSelector }) => {
      return !!(() => {
        const image = app.workspace
          .getLeavesOfType("zotero-annotation-view")
          .map((leaf) => leaf.view.containerEl.querySelector(cardSelector))
          .find(Boolean)
          ?.querySelector("img");
        return (
          image &&
          image.complete &&
          image.naturalWidth > 0 &&
          image.src.startsWith("blob:")
        );
      })();
    },
    {
      cardSelector: `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(target.key)}]`,
    },
    {
      tries: 80,
      what: "the card image to finish loading as a blob URL on the final check",
    },
  );
  const remounted = await obRun(
    vaultId,
    async ({ app }, { cardSelector }) => {
      const image = app.workspace
        .getLeavesOfType("zotero-annotation-view")
        .map((leaf) => leaf.view.containerEl.querySelector(cardSelector))
        .find(Boolean)
        ?.querySelector("img");
      if (!image || !image.complete || image.naturalWidth === 0) return null;
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      try {
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Card pixel canvas unavailable");
        context.drawImage(image, 0, 0);
        const data = context.getImageData(
          0,
          0,
          canvas.width,
          canvas.height,
        ).data;
        return {
          width: canvas.width,
          height: canvas.height,
          pixels: require("crypto")
            .createHash("sha256")
            .update(new Uint8Array(data.buffer))
            .digest("hex"),
        };
      } finally {
        canvas.width = 0;
        canvas.height = 0;
      }
    },
    {
      cardSelector: `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(target.key)}]`,
    },
  );
  expect(
    remounted?.pixels,
    "a remount paints the saved edit's pixels, never the superseded answer's",
  ).toBe(editedPixels!.pixels);

  console.info("Saved-edit display evidence", {
    annotation: target.key,
    color: { from: card.record!.color, to: editedColor },
    objectUrl: {
      painted: before.src,
      edited: edited.src,
      revoked: edited.revoked,
    },
    pixels: {
      painted: beforePixels!.pixels,
      edited: editedPixels!.pixels,
      superseded: superseded.outcome.pixels!.pixels,
      stored: superseded.stored?.pixels ?? null,
      remounted: remounted?.pixels ?? null,
    },
    superseded: {
      version: superseded.version,
      currentVersion: superseded.currentVersion,
      provenance: superseded.outcome.provenance ?? null,
      loads: loadsBetween(superseded.before, superseded.after),
    },
  });
}
