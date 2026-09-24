import assert from "node:assert/strict";

import { obEval, obEvalUntil } from "./obsidian-cli.ts";

/** Exercise the real Refresh gesture and subscribed card after a resolver failure. */
export async function verifyExcerptRefresh(vaultId: string): Promise<void> {
  const probe = "window.__zotlitExcerptRefreshTrial";
  assert.equal(await obEval(vaultId, `String(${probe} === undefined)`), "true");
  await using cleanup = new AsyncDisposableStack();
  cleanup.defer(async () => {
    await obEval(
      vaultId,
      `(() => {
      const state = ${probe};
      if (state) { state.service.resolve = state.original; state.service.stored = state.stored; state.leaf?.detach(); delete ${probe}; }
      return true;
    })()`,
    );
  });
  // The Development Vault keeps its device-local excerpt store across runs, and
  // an earlier test's card can still hold this Annotation's image. The trial
  // starts from a device that holds nothing for it: no stored image, and no
  // live display read.
  await obEval(
    vaultId,
    `(async () => {
      const services = app.plugins.plugins.zotlit.services;
      const service = services.excerptImage;
      const original = service.resolve;
      const stored = service.stored;
      const state = ${probe} = { service, original, stored, recover: false, calls: 0, completed: 0, leaf: null };
      service.stored = async function(request) {
        if (request.annotation.key === "4PE492KU") return null;
        return stored.call(this, request);
      };
      service.resolve = async function(request, signal) {
        if (request.annotation.key !== "4PE492KU") return original.call(this, request, signal);
        state.calls++;
        if (!state.recover) { state.completed++; return { kind: "unavailable" }; }
        const result = await original.call(this, request, signal);
        state.completed++;
        return result;
      };
      services.excerptDisplay.clear();
      state.leaf = app.workspace.getLeaf("tab");
      await state.leaf.setViewState({ type: "zotero-annotation-view", state: { followMode: "pinned", previousMode: "active-tab", pinnedItemKey: "RUGIER24" }, active: true });
      await app.workspace.revealLeaf(state.leaf);
      return true;
    })()`,
  );
  assert.equal(
    await obEvalUntil(
      vaultId,
      `String((() => {
      const state = ${probe};
      const card = state.leaf.view.containerEl.querySelector('[data-zotero-annotation-key="4PE492KU"]');
      return state.completed > 0 && !!card && !card.querySelector("img") && !card.querySelector('[aria-busy="true"]');
    })())`,
      { expected: "true" },
    ),
    true,
    "the real card must show the injected unavailable result",
  );
  await obEval(
    vaultId,
    `(() => {
      const state = ${probe};
      state.before = state.calls;
      state.inputBefore = JSON.stringify({ source: state.leaf.view.snapshot.annotationSource, annotation: state.leaf.view.snapshot.annotations.find(a => a.key === "4PE492KU") });
      state.recover = true;
      state.leaf.view.gestures.onRefresh();
      return true;
    })()`,
  );
  assert.equal(
    await obEvalUntil(
      vaultId,
      `String((() => {
      const state = ${probe};
      const image = state.leaf.view.containerEl.querySelector('[data-zotero-annotation-key="4PE492KU"] img');
      const inputAfter = JSON.stringify({ source: state.leaf.view.snapshot.annotationSource, annotation: state.leaf.view.snapshot.annotations.find(a => a.key === "4PE492KU") });
      return state.inputBefore === inputAfter && state.calls > state.before && image?.complete && image.naturalWidth > 0 && image.src.startsWith("blob:");
    })())`,
      { expected: "true" },
    ),
    true,
    "the actual Refresh action must resolve again and replace unavailable with a decoded excerpt",
  );
}
