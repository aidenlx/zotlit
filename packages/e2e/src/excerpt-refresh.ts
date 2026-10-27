import assert from "node:assert/strict";
import type { WorkspaceLeaf } from "obsidian";

import type { E2eServices } from "@zotlit/obsidian/e2e";

import type { AnnotationView } from "@/views/annot-view/view";

import { EFFECT_MODULE_PATH } from "./effect-module.ts";
import { obRun, obRunUntil } from "./obsidian-cli.ts";

interface ExcerptRefreshTrial {
  service: E2eServices["excerptImage"];
  original: E2eServices["excerptImage"]["resolve"];
  stored: E2eServices["excerptImage"]["stored"];
  recover: boolean;
  calls: number;
  completed: number;
  leaf: WorkspaceLeaf | null;
  before?: number;
  inputBefore?: string;
}
declare module "./page-helpers.ts" {
  interface PageScratch {
    __zotlitExcerptRefreshTrial?: ExcerptRefreshTrial;
  }
}

/** Exercise the real Refresh gesture and subscribed card after a resolver failure. */
export async function verifyExcerptRefresh(vaultId: string): Promise<void> {
  assert.equal(
    await obRun(
      vaultId,
      ({ page }) => page.scratch.__zotlitExcerptRefreshTrial === undefined,
    ),
    true,
  );
  await using cleanup = new AsyncDisposableStack();
  cleanup.defer(async () => {
    await obRun(vaultId, ({ page }) => {
      const state = page.scratch.__zotlitExcerptRefreshTrial;
      if (state) {
        state.service.resolve = state.original;
        state.service.stored = state.stored;
        state.leaf?.detach();
        delete page.scratch.__zotlitExcerptRefreshTrial;
      }
    });
  });
  // The vault keeps its device-local excerpt store across tests, and an
  // earlier test's card can still hold this Annotation's image. The trial
  // starts from a device that holds nothing for it: no stored image, and no
  // live display read.
  await obRun(
    vaultId,
    async ({ app, zotlit, page }, { effectPath }) => {
      const { Effect } = require(effectPath) as typeof import("@/lib/effect");
      const services = zotlit.services;
      const service = services.excerptImage;
      const original = service.resolve;
      const stored = service.stored;
      const state: ExcerptRefreshTrial = {
        service,
        original,
        stored,
        recover: false,
        calls: 0,
        completed: 0,
        leaf: null,
      };
      page.scratch.__zotlitExcerptRefreshTrial = state;
      service.stored = (request) =>
        Effect.suspend(() => {
          if (request.annotation.key === "4PE492KU")
            return Effect.succeed(null);
          return stored(request);
        });
      service.resolve = (request) =>
        Effect.gen(function* () {
          if (request.annotation.key !== "4PE492KU")
            return yield* original(request);
          state.calls++;
          if (!state.recover) {
            state.completed++;
            return { kind: "unavailable" } as const;
          }
          const result = yield* original(request);
          state.completed++;
          return result;
        });
      await services.bridge.runPromise(services.excerptDisplay.clear);
      state.leaf = app.workspace.getLeaf("tab");
      await state.leaf.setViewState({
        type: "zotero-annotation-view",
        state: {
          followMode: "pinned",
          previousMode: "active-tab",
          pinnedItemKey: "RUGIER24",
        },
        active: true,
      });
      await app.workspace.revealLeaf(state.leaf);
    },
    { effectPath: EFFECT_MODULE_PATH },
  );
  await obRunUntil(
    vaultId,
    ({ page }) => {
      const state = page.scratch.__zotlitExcerptRefreshTrial!;
      const card = state.leaf!.view.containerEl.querySelector(
        '[data-zotero-annotation-key="4PE492KU"]',
      );
      return (
        state.completed > 0 &&
        !!card &&
        !card.querySelector("img") &&
        !card.querySelector('[aria-busy="true"]')
      );
    },
    undefined,
    { what: "the real card to show the injected unavailable result" },
  );
  await obRun(vaultId, ({ page }) => {
    const state = page.scratch.__zotlitExcerptRefreshTrial!;
    const view = state.leaf!.view as AnnotationView;
    state.before = state.calls;
    state.inputBefore = JSON.stringify({
      source: view.snapshot.annotationSource,
      annotation: view.snapshot.annotations!.find((a) => a.key === "4PE492KU"),
    });
    state.recover = true;
    view.gestures!.onRefresh();
  });
  await obRunUntil(
    vaultId,
    ({ page }) => {
      const state = page.scratch.__zotlitExcerptRefreshTrial!;
      const view = state.leaf!.view as AnnotationView;
      const image = view.containerEl.querySelector<HTMLImageElement>(
        '[data-zotero-annotation-key="4PE492KU"] img',
      );
      const inputAfter = JSON.stringify({
        source: view.snapshot.annotationSource,
        annotation: view.snapshot.annotations!.find(
          (a) => a.key === "4PE492KU",
        ),
      });
      return (
        state.inputBefore === inputAfter &&
        state.calls > state.before! &&
        !!image?.complete &&
        image.naturalWidth > 0 &&
        image.src.startsWith("blob:")
      );
    },
    undefined,
    {
      what: "the Refresh action to resolve again and replace unavailable with a decoded excerpt",
    },
  );
}
