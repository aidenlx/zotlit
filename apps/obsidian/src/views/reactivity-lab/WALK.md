# Reactivity Lab walk-through scripts

PROTOTYPE (proto/view-reactivity). Run each with
`packages/scripts/scripts/obsidian-cli.ts --no-throttle --js <file> vault=<id>`
from the repo root, after `walk.js` (it installs `window.__lab`). Set the tab
first with `--code 'window.__labTab="atom"'` (or `zustand`, `jotai`).
Run them one at a time: parallel runs drive the same leaf.

## walk.js

```js
// Shared helpers, installed on window for the later --code calls.
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const T = "zotlit-reactivity-lab";
  const lab = () => app.workspace.getLeavesOfType(T)[0];
  const text = (leaf) => leaf?.view.contentEl.innerText.replace(/\n+/g, " | ");
  const openNote = async (path) => {
    const main =
      app.workspace.getLeavesOfType("markdown")[0] ??
      app.workspace.getLeaf(false);
    await main.openFile(app.vault.getAbstractFileByPath(path));
    app.workspace.setActiveLeaf(main, { focus: true });
  };
  const tab = (leaf, name) =>
    [...leaf.view.contentEl.querySelectorAll("button")]
      .find((b) => b.textContent === name)
      .click();
  window.__lab = { wait, lab, text, openNote, tab, T };

  await openNote("literatures/wangMutationalClinicalSpectrum2020a.md");
  if (!lab()) {
    const right = app.workspace.getRightLeaf(false);
    await right.setViewState({ type: T, active: false });
  }
  await lab().loadIfDeferred();
  await wait(1500);
  return text(lab());
})();
```

## scenario.js

```js
// Runs the same script on the tab named in window.__labTab; returns probe deltas.
(async () => {
  const { wait, lab, text, openNote, tab } = window.__lab;
  const name = window.__labTab;
  const A = "literatures/wangMutationalClinicalSpectrum2020a.md";
  const B = "literatures/yinClinicopathologicalFeaturesMutational2021.md";
  const C = "tools-for-thought.md"; // no key
  const leaf = lab();
  const el = leaf.view.contentEl;
  const probe = () => {
    const m = el.innerText.match(
      /live citedBy subscriptions: (\d+) · opened total: (\d+) · late callbacks: (\d+)/,
    );
    return { live: +m[1], opened: +m[2], late: +m[3] };
  };
  const out = {};
  await openNote(A);
  tab(leaf, "none");
  await wait(300);
  const base = probe();
  tab(leaf, name);
  await wait(800);
  const rel = () => {
    const p = probe();
    return {
      live: p.live,
      opened: p.opened - base.opened,
      late: p.late - base.late,
    };
  };
  out.mount = rel();

  // 1. Same key, new path: rename A and back.
  const file = app.vault.getAbstractFileByPath(A);
  await app.vault.rename(file, "literatures/renamed-wang.md");
  await wait(600);
  out.afterRenameText = /active: literatures\/renamed-wang\.md/.test(
    el.innerText,
  );
  out.rename = rel();
  await app.vault.rename(file, A);
  await wait(600);

  // 2. Rapid key switches A → B → C → A, no waits between.
  const before = rel().opened;
  await openNote(B);
  await openNote(C);
  await openNote(A);
  await wait(1200);
  out.rapid = { ...rel(), openedDuringRapid: rel().opened - before };
  out.showsA =
    /key: WANGMT22/.test(el.innerText) && /2 notes/.test(el.innerText);

  // 3. Setting write from a handler: pending, then flipped value.
  const read = () =>
    app.plugins.plugins.zotlit.settingTab.getControlValue(
      "citation.at-trigger",
    );
  const v0 = read();
  [...el.querySelectorAll("button")]
    .find((b) => b.textContent === "Toggle")
    .click();
  await wait(100);
  out.pendingShown = /Saving…/.test(el.innerText);
  await wait(900);
  out.flipped = read() === !v0 && el.innerText.includes(`at-trigger = ${!v0}`);
  [...el.querySelectorAll("button")]
    .find((b) => b.textContent === "Toggle")
    .click();
  await wait(1000);
  out.restored = read() === v0;

  // 4. One-shot async read.
  [...el.querySelectorAll("button")]
    .find((b) => b.textContent === "Read cited by")
    .click();
  await wait(100);
  out.onceLoading = /loading…/.test(
    el.innerText.split("One-shot read")[1].split("Cited by")[0],
  );
  await wait(2500);
  out.onceText = el.innerText.split("Read cited by")[1].split("\n")[0].trim();

  // 5. View-local state: filter and collapse.
  const input = el.querySelector('input[type="search"]');
  input.value = "parity";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await wait(200);
  out.filtered = el.querySelectorAll("li").length;
  el.querySelector("li a").click();
  await wait(200);
  out.collapsed = el.querySelector("li").textContent.startsWith("▸");

  // 6. Teardown by unmount.
  tab(leaf, "none");
  await wait(1000);
  out.afterUnmount = rel();
  out.text = text(leaf).slice(0, 400);
  return JSON.stringify(out);
})();
```

## two-leaves.js

```js
// Two lab leaves on the same tab: shared subscriptions and per-leaf UI state.
(async () => {
  const { wait, openNote, T } = window.__lab;
  const pick = (leaf, name) =>
    [...leaf.view.contentEl.querySelectorAll("button")]
      .find((b) => b.textContent === name)
      .click();
  await openNote("literatures/wangMutationalClinicalSpectrum2020a.md");
  let leaves = app.workspace.getLeavesOfType(T);
  if (leaves.length < 2) {
    const second = app.workspace.getLeaf("split");
    await second.setViewState({ type: T, active: false });
    leaves = app.workspace.getLeavesOfType(T);
  }
  for (const leaf of leaves) await leaf.loadIfDeferred();
  const out = {};
  for (const name of ["atom", "zustand", "jotai"]) {
    for (const leaf of leaves) pick(leaf, "none");
    await wait(1000);
    for (const leaf of leaves) pick(leaf, name);
    await wait(1000);
    const [a, b] = leaves.map((l) => l.view.contentEl);
    const input = a.querySelector('input[type="search"]');
    input.value = "parity";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await wait(300);
    out[name] = {
      live: +a.innerText.match(/live citedBy subscriptions: (\d+)/)[1],
      leafA: a.querySelectorAll("li").length,
      leafB: b.querySelectorAll("li").length,
      leafBSearch: b.querySelector('input[type="search"]').value,
    };
  }
  for (const leaf of leaves) pick(leaf, "none");
  await wait(1000);
  out.afterAll = +leaves[0].view.contentEl.innerText.match(
    /live citedBy subscriptions: (\d+)/,
  )[1];
  leaves[1].detach();
  return JSON.stringify(out);
})();
```

## disable.js

```js
// Disable the plugin while the lab is open on window.__labTab and notes switch.
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const T = "zotlit-reactivity-lab";
  const name = window.__labTab;
  const notes = [
    "literatures/wangMutationalClinicalSpectrum2020a.md",
    "literatures/yinClinicopathologicalFeaturesMutational2021.md",
    "literatures/wittNebulinRegulatesThin2006.md",
  ];
  const main = app.workspace.getLeavesOfType("markdown")[0];
  let leaf = app.workspace.getLeavesOfType(T)[0];
  if (!leaf) {
    leaf = app.workspace.getRightLeaf(false);
    await leaf.setViewState({ type: T, active: false });
  }
  await leaf.loadIfDeferred();
  await wait(500);
  [...leaf.view.contentEl.querySelectorAll("button")]
    .find((b) => b.textContent === name)
    .click();
  await wait(800);
  const probe = globalThis.__zotlitLabProbe;
  const before = probe.get();
  // Switch notes without waiting, and disable in the middle.
  let stop = false;
  const switching = (async () => {
    for (let i = 0; !stop; i++) {
      await main.openFile(app.vault.getAbstractFileByPath(notes[i % 3]));
      app.workspace.setActiveLeaf(main, { focus: false });
      await wait(40);
    }
  })();
  await wait(700);
  await app.plugins.disablePlugin("zotlit");
  await wait(150);
  stop = true;
  await switching;
  await wait(2000);
  const after = probe.get();
  await app.plugins.enablePlugin("zotlit");
  await wait(2500);
  return JSON.stringify({
    name,
    live: after.live,
    lateCallbacks: after.lateCallbacks - before.lateCallbacks,
    openedDuringRun: after.opened - before.opened,
    lastLog: after.log.slice(0, 5),
  });
})();
```
