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

## view-features.js

Self-contained; opens its own lab leaf on the Atom tab.

```js
// View features on the Atom tab: saved state, save requests, header action,
// pane menu, view Scope, per-leaf isolation, model release on close.
(async () => {
  const wait = (ms) => new Promise((r) => window.setTimeout(r, ms));
  const T = "zotlit-reactivity-lab";
  const out = {};
  const main = app.workspace.getLeavesOfType("markdown")[0] ?? app.workspace.getLeaf(false);
  await main.openFile(app.vault.getAbstractFileByPath("literatures/wangMutationalClinicalSpectrum2020a.md"));
  for (const l of app.workspace.getLeavesOfType(T)) l.detach();
  const leaf = app.workspace.getLeaf("split");
  await leaf.setViewState({ type: T, active: true });
  await wait(1500);
  const view = () => leaf.view;
  const el = () => view().contentEl;
  const registry = view().deps.registry;

  // Count save requests.
  let saves = 0;
  const original = app.workspace.requestSaveLayout;
  app.workspace.requestSaveLayout = function (...args) { saves++; return original.apply(this, args); };

  // 1. Filter typed in React → saved state.
  const input = el().querySelector('input[type="search"]');
  input.value = "parity";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await wait(300);
  // 2. Header action click → sort flips; icon label follows.
  const action = view().containerEl.querySelector('.view-action[aria-label^="Sort"]');
  out.actionLabelBefore = action?.getAttribute("aria-label");
  action.click();
  await wait(300);
  out.actionLabelAfter = action.getAttribute("aria-label");
  out.flavorShowsSort = /sort: count/.test(el().innerText);
  out.viewState = leaf.getViewState().state;
  out.saveRequests = saves;

  // 3. Pane menu reads the model; its item writes it.
  view().containerEl.querySelector('.view-action[aria-label="More options"]').click();
  await wait(400);
  const menuEl = document.querySelector(".menu");
  const rows = [...menuEl.querySelectorAll(".menu-item")];
  out.menuItems = rows
    .map((r) => ({ title: r.innerText.trim(), checked: r.querySelector(".menu-item-icon.mod-checked, .mod-checked") != null || r.classList.contains("mod-checked"), disabled: r.classList.contains("is-disabled") }))
    .filter((i) => /Sort by|Clear filter/.test(i.title));
  rows.find((r) => r.innerText.trim() === "Clear filter").click();
  await wait(400);
  out.afterClearInput = el().querySelector('input[type="search"]').value;
  input.value = "parity";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await wait(300);

  // 4. View Scope: Obsidian pushes it while the leaf is active.
  app.workspace.setActiveLeaf(leaf, { focus: true });
  await wait(300);
  out.scopeIsActive = app.keymap.getRootScope ? undefined : undefined;
  out.viewScopeOnStack = app.keymap.scope === view().scope;
  const handler = view().scope.keys.find((k) => k.key?.toLowerCase() === "s");
  out.scopeKey = handler ? `${handler.modifiers}+${handler.key}` : null;
  handler.func(new KeyboardEvent("keydown"), handler);
  await wait(300);
  out.sortAfterHotkey = registry.get(view().model.layout).sort;

  // 5. Round trip: rebuild the view from its saved state.
  const savedBefore = leaf.getViewState().state;
  await leaf.rebuildView();
  await wait(1200);
  out.rebuilt = {
    sameInstance: false,
    savedBefore,
    layout: registry.get(view().model.layout),
    inputValue: el().querySelector('input[type="search"]')?.value,
  };

  // 6. Two leaves: separate models.
  const second = app.workspace.getLeaf("split");
  await second.setViewState({ type: T, active: false });
  await second.loadIfDeferred();
  await wait(1200);
  out.secondLeaf = {
    layout: registry.get(second.view.model.layout),
    inputValue: second.view.contentEl.querySelector('input[type="search"]')?.value,
  };

  // 7. Close: model atoms leave the registry after the idle TTL.
  const layoutAtom = second.view.model.layout;
  const has = () => [...registry.getNodes().keys()].includes(layoutAtom);
  out.secondModelInRegistry = has();
  second.detach();
  await wait(1200);
  out.secondModelAfterClose = has();

  app.workspace.requestSaveLayout = original;
  out.ephemeral = leaf.getEphemeralState();
  return JSON.stringify(out, null, 1);
})()
```

## disable-seat.js

Select the seat first: `app.saveLocalStorage("zotlit-lab-registry-seat", "layer")` (or `null`), then disable and enable the plugin.

```js
// Registry seat walk: disable the plugin while the lab's Atom tab is open and
// notes switch. Records the order of view close, plugin.register callbacks and
// registry dispose, plus errors and subscriptions left after dispose.
(async () => {
  const wait = (ms) => new Promise((r) => window.setTimeout(r, ms));
  const T = "zotlit-reactivity-lab";
  const notes = [
    "literatures/wangMutationalClinicalSpectrum2020a.md",
    "literatures/yinClinicopathologicalFeaturesMutational2021.md",
    "literatures/wittNebulinRegulatesThin2006.md",
  ];
  const seat = app.loadLocalStorage("zotlit-lab-registry-seat") ?? "register";
  let main = app.workspace.getLeavesOfType("markdown")[0];
  if (!main) main = app.workspace.getLeaf(true);
  await main.openFile(app.vault.getAbstractFileByPath(notes[0]));
  let leaf = app.workspace.getLeavesOfType(T)[0];
  if (!leaf) {
    leaf = app.workspace.getRightLeaf(false);
    await leaf.setViewState({ type: T, active: false });
  }
  await leaf.loadIfDeferred();
  await wait(800);
  const probe = globalThis.__zotlitLabProbe;
  const t0 = performance.now();
  const order = [];
  const at = (line) => order.push(`${Math.round(performance.now() - t0)}ms ${line}`);
  const note = probe.note;
  probe.note = (line) => { at(line); note(line); };
  const errors = [];
  const consoleError = console.error;
  console.error = (...args) => { errors.push(args.map(String).join(" ").slice(0, 200)); consoleError(...args); };
  const onUnload = app.plugins.plugins.zotlit.onunload;
  app.plugins.plugins.zotlit.onunload = function (...args) { at("onunload start"); const r = onUnload.apply(this, args); at("onunload end"); return r; };

  const before = probe.get();
  let stop = false;
  const switching = (async () => {
    for (let i = 0; !stop; i++) {
      await main.openFile(app.vault.getAbstractFileByPath(notes[i % 3]));
      await wait(40);
    }
  })();
  await wait(700);
  at("disablePlugin call");
  await app.plugins.disablePlugin("zotlit");
  at("disablePlugin settled");
  const atDisable = probe.get();
  await wait(150);
  stop = true;
  await switching;
  await wait(2000);
  const after = probe.get();
  probe.note = note;
  console.error = consoleError;
  await app.plugins.enablePlugin("zotlit");
  await wait(2500);
  return JSON.stringify({
    seat,
    order,
    liveAtDisableSettled: atDisable.live,
    liveAfter: after.live,
    lateCallbacks: after.lateCallbacks - before.lateCallbacks,
    openedAfterDisable: after.opened - atDisable.opened,
    errors,
    reenabled: !!app.plugins.plugins.zotlit?.services,
  }, null, 1);
})()
```

## scope-focus.js

Needs real OS focus on the Obsidian window.

```js
// View Scope walk with real OS focus: does Obsidian push view.scope when the
// lab leaf is active, and does a trusted Mod+Shift+S reach its handler?
(async () => {
  const wait = (ms) => new Promise((r) => window.setTimeout(r, ms));
  const T = "zotlit-reactivity-lab";
  const remote = require("@electron/remote");
  const win = remote.getCurrentWindow();
  const wc = remote.getCurrentWebContents();
  const press = async () => {
    const modifiers = ["meta", "shift"];
    wc.sendInputEvent({ type: "keyDown", keyCode: "S", modifiers });
    wc.sendInputEvent({ type: "keyUp", keyCode: "S", modifiers });
    await wait(300);
  };
  win.focus();
  await wait(500);
  const out = { hasFocus: document.hasFocus() };

  const main = app.workspace.getLeavesOfType("markdown")[0];
  let leaf = app.workspace.getLeavesOfType(T)[0];
  if (!leaf) {
    leaf = app.workspace.getRightLeaf(false);
    await leaf.setViewState({ type: T, active: false });
  }
  await leaf.loadIfDeferred();
  await wait(500);
  const view = leaf.view;
  const registry = view.deps.registry;
  const sort = () => registry.get(view.model.layout).sort;

  // Lab leaf active: its Scope should be the current keymap scope.
  app.workspace.setActiveLeaf(leaf, { focus: true });
  await wait(400);
  out.labActive = {
    activeIsLab: app.workspace.activeLeaf === leaf,
    // The window's base scope hands each key to cb(): the active leaf's view.scope.
    scopeIsView: app.keymap.getWindowStack(window).scope.cb?.() === view.scope,
    sortBefore: sort(),
  };
  await press();
  out.labActive.sortAfterKey = sort();
  await press();
  out.labActive.sortAfterSecondKey = sort();

  // Note leaf active: cb() returns the note's scope; the key must not reach the lab.
  app.workspace.setActiveLeaf(main, { focus: true });
  await wait(400);
  out.noteActive = {
    scopeIsView: app.keymap.getWindowStack(window).scope.cb?.() === view.scope,
    sortBefore: sort(),
  };
  await press();
  out.noteActive.sortAfterKey = sort();
  out.hasFocusAtEnd = document.hasFocus();
  return JSON.stringify(out, null, 1);
})()
```

## family.js

Three lab leaves: one follows the active note, two are pinned. Needs a fresh plugin load (probe counters start at zero).

```js
// Atom.family keyed by leaf input: three lab leaves, one following the active
// note and two pinned. Counts live citedBy subscriptions per key after each
// step, then checks saved state and the checkCallback command on this view.
(async () => {
  const wait = (ms) => new Promise((r) => window.setTimeout(r, ms));
  const T = "zotlit-reactivity-lab";
  const CMD = "zotlit:reactivity-lab-toggle-sort";
  const notes = [
    "literatures/wangMutationalClinicalSpectrum2020a.md",
    "literatures/yinClinicopathologicalFeaturesMutational2021.md",
    "literatures/wittNebulinRegulatesThin2006.md",
  ];
  for (const l of app.workspace.getLeavesOfType(T)) l.detach();
  let main = app.workspace.getLeavesOfType("markdown")[0];
  if (!main) main = app.workspace.getLeaf(true);
  const show = async (path) => {
    await main.openFile(app.vault.getAbstractFileByPath(path));
    app.workspace.setActiveLeaf(main, { focus: true });
    await wait(1000);
  };
  const openLab = async () => {
    const leaf = app.workspace.getLeaf("split");
    await leaf.setViewState({ type: T, active: false });
    await leaf.loadIfDeferred();
    await wait(800);
    return leaf;
  };
  const header = (leaf) => {
    const text = leaf.view.contentEl.innerText;
    return {
      pin: /pin: (\S+)/.exec(text)?.[1],
      citedBy: /Cited by (loading…|\d+ notes)/.exec(text)?.[1],
    };
  };

  await show(notes[0]);
  const L1 = await openLab();
  const registry = L1.view.deps.registry;
  const probe = globalThis.__zotlitLabProbe;
  // Every probe line, in order, from here on.
  const events = [];
  let lastSeq = 0;
  const unsubscribe = probe.subscribe(() => {
    for (const line of [...probe.get().log].reverse()) {
      const seq = Number(/^#(\d+)/.exec(line)?.[1]);
      if (seq > lastSeq) { lastSeq = seq; events.push(line.replace(/^#\d+ /, "")); }
    }
  });
  const liveByKey = () => {
    const live = {};
    for (const e of events) {
      const m = /^(open|close) citedBy\((.+)\)$/.exec(e);
      if (m) live[m[2]] = (live[m[2]] ?? 0) + (m[1] === "open" ? 1 : -1);
    }
    return Object.fromEntries(Object.entries(live).filter(([, n]) => n !== 0));
  };
  const pin = (leaf, key) =>
    registry.update(leaf.view.model.layout, (l) => ({ ...l, pin: key }));

  // Keys of the three notes, read from the following leaf.
  const keys = [];
  for (const n of notes) {
    await show(n);
    keys.push(/key: (\S+)/.exec(L1.view.contentEl.innerText)?.[1]);
  }
  const [K1, K2, K3] = keys;
  await show(notes[0]);
  await wait(800);
  const out = { keys };
  const base = { ...liveByKey() };
  const step = (name) => {
    out[name] = {
      liveTotal: probe.get().live,
      liveByKey: liveByKey(),
      L1: header(L1), L2: header(L2), L3: header(L3),
    };
  };
  out.baseline = { liveTotal: probe.get().live, liveByKeyFromEvents: base };

  // A. L1 follows n1 (K1); L2 pins K2; L3 pins K1 → expect K1:1, K2:1.
  const L2 = await openLab();
  pin(L2, K2);
  const L3 = await openLab();
  pin(L3, K1);
  await wait(1000);
  step("A_follow_K1_pin_K2_pin_K1");

  // B. L3 → K3 → expect K1 (L1), K2, K3.
  pin(L3, K3);
  await wait(1000);
  step("B_L3_to_K3");

  // C. Active note → n2 (K2): L1 joins L2 on K2; K1 loses its last reader.
  await show(notes[1]);
  await wait(500);
  step("C_active_to_K2");

  // D. Saved state: L2's pin survives a rebuild.
  out.D_saved = { stateBefore: L2.getViewState().state.pin };
  await L2.rebuildView();
  await wait(1200);
  out.D_saved.pinAfterRebuild = registry.get(L2.view.model.layout).pin;
  out.D_saved.header = header(L2);
  out.D_saved.liveByKey = liveByKey();

  // E. checkCallback: offered only with a lab leaf active, acts on that leaf.
  const command = app.commands.findCommand(CMD);
  const sorts = () => [L1, L2, L3].map((l) => registry.get(l.view.model.layout).sort);
  app.workspace.setActiveLeaf(main, { focus: true });
  await wait(300);
  out.E_command = { noteActive: { offered: command.checkCallback(true), ran: app.commands.executeCommandById(CMD), sorts: sorts() } };
  app.workspace.setActiveLeaf(L3, { focus: true });
  await wait(300);
  out.E_command.L3Active = { offered: command.checkCallback(true), ran: app.commands.executeCommandById(CMD), sorts: sorts() };

  // F. Close L2 and L3: only L1 on K2 is left.
  L2.detach();
  L3.detach();
  await wait(1200);
  out.F_after_close = { liveTotal: probe.get().live, liveByKey: liveByKey() };
  out.lateCallbacks = probe.get().lateCallbacks;
  out.events = events;
  unsubscribe();
  return JSON.stringify(out, null, 1);
})()
```
