import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import {
  ANNOTATIONS,
  ATTACHMENTS,
  COLLECTIONS,
  DEMO_ITEMS,
  ITEMS,
  LIBRARIES,
  LIBRARY_SCOPE_SETTING_KEY,
  NOTES,
} from "@zotlit/scripts/fixture";
import type { FixtureItem } from "@zotlit/scripts/fixture";

import {
  annotationOpenKeys,
  annotationOpenSubpath,
} from "./annotation-open-subpath.ts";
import { prepareRunWindow } from "./background-throttling.ts";
import { reachable } from "./e2e-run-fixture.ts";
import {
  LIBRARY_HEADING,
  MY_LIBRARY_DOCUMENT,
  annotationAttachment,
  annotationItem,
  e2eFixture,
  e2eVaultPath,
  fixtureActivity,
  workspaceRoot,
} from "./e2e-run-fixture.ts";
import { registerEndToEndRunHooks, run } from "./e2e-run-lifecycle.ts";
import { signalDatabaseUpdated } from "./e2e-run-note-helpers.ts";
import * as suite from "./e2e-run-suite-helpers.ts";
import {
  cli,
  obEval,
  obEvalUntil,
  obJson,
  obReadUntil,
} from "./obsidian-cli.ts";
import { PAGE } from "./page-gestures.ts";
import { verifyPdfReads } from "./pdf-reads.ts";
import { verifyRecentUses } from "./recent-uses.ts";

describe.skipIf(!reachable)("End-to-end Run", () => {
  registerEndToEndRunHooks();

  it("opens the Library View from the ribbon and the command, lists My Library newest first, and keeps a sort change across a plugin reload, with Zotero closed", async () => {
    const layout = await obEval(
      run.vaultId,
      "JSON.stringify(app.workspace.getLayout())",
    );
    const stored = await obEval(
      run.vaultId,
      "JSON.stringify(app.plugins.plugins.zotlit.services.bridge.runSync(app.plugins.plugins.zotlit.services.settings.current)['library.document'])",
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obEval(
        run.vaultId,
        `(async()=>{const {settings,bridge}=app.plugins.plugins.zotlit.services;bridge.runSync(settings.update({'library.document':${stored}}));await bridge.runPromise(settings.flush);await app.workspace.changeLayout(JSON.parse(${JSON.stringify(layout)}));return true;})()`,
      );
    });
    // The view opens on My Library; a new view's Recent has a case of its own.
    await obEval(
      run.vaultId,
      `(async()=>{app.workspace.getLeavesOfType('zotlit-library').forEach(leaf=>leaf.detach());const {settings,bridge}=app.plugins.plugins.zotlit.services;bridge.runSync(settings.update({'library.document':${JSON.stringify(MY_LIBRARY_DOCUMENT)}}));await bridge.runPromise(settings.flush);return true;})()`,
    );

    /** What the Library View shows once its query settled, or `null` while no tab holds it. */
    const readLibrary = `(async()=>{const leaves=app.workspace.getLeavesOfType('zotlit-library');const view=leaves[0]?.view;if(!view?.query)return 'null';await view.query.settled;const el=view.contentEl;const state=view.query.state.getState();return JSON.stringify({leaves:leaves.length,active:app.workspace.getMostRecentLeaf()?.view.getViewType()??null,title:view.getDisplayText(),phase:state.phase,failure:state.failure?.diagnostic.code??null,count:el.querySelector('[data-query-count]')?.getAttribute('data-query-count')??null,rows:[...el.querySelectorAll('tr[data-query-table-row="item"], [data-query-papers-row]')].map(n=>n.getAttribute('data-query-key')??n.getAttribute('data-query-papers-row'))});})()`;
    interface Library {
      leaves: number;
      active: string | null;
      title: string;
      phase: string;
      failure: string | null;
      count: string | null;
      rows: string[];
    }
    const libraryWhen = (ready: (library: Library) => boolean) =>
      obReadUntil<Library>(run.vaultId, readLibrary, {
        ready,
        what: "Library View",
        tries: 120,
      });

    // The seed's My Library Items. Items modified at the same moment may
    // come in either order, so the rows are checked by key set and by the
    // modification time at each place.
    const personal = ITEMS.filter(
      ({ libraryID }) =>
        libraryID === LIBRARIES.find(({ type }) => type === "user")!.libraryID,
    );
    const modified = new Map(
      personal.map(({ key, dateModified }) => [key, dateModified]),
    );
    const times = (direction: 1 | -1) =>
      personal
        .map(({ dateModified }) => dateModified)
        .toSorted((a, b) => direction * a.localeCompare(b));
    const expectSeedOrder = (library: Library, direction: 1 | -1) => {
      expect(library.count).toBe(String(personal.length));
      expect(library.rows.toSorted()).toEqual(
        personal.map(({ key }) => key).toSorted(),
      );
      expect(library.rows.map((key) => modified.get(key))).toEqual(
        times(direction),
      );
    };

    // The ribbon icon opens the view in a main-area tab, on My Library as
    // Papers, newest change first. No Zotero answers this vault.
    await obEval(
      run.vaultId,
      `(()=>{${PAGE}press(document.querySelector(${JSON.stringify(`.side-dock-ribbon-action[aria-label="${run.m.command_open_library_view_name()}"]`)}),'Library View ribbon icon');return true;})()`,
    );
    /** Whether the Layout drew every row the count names. */
    const drawn = (library: Library) =>
      library.phase === "ready" &&
      library.count !== null &&
      library.rows.length === Number(library.count);
    const opened = await libraryWhen(drawn);
    expect(opened).toMatchObject({
      leaves: 1,
      active: "zotlit-library",
      title: run.m.library_view_name(),
      failure: null,
    });
    expectSeedOrder(opened, -1);
    // The ribbon icon and the tab draw the 16-unit mark, both inks in the
    // icon's one color.
    const icons = JSON.parse(
      await obEval(
        run.vaultId,
        `JSON.stringify([document.querySelector(${JSON.stringify(`.side-dock-ribbon-action[aria-label="${run.m.command_open_library_view_name()}"] svg`)}),app.workspace.getLeavesOfType('zotlit-library')[0].tabHeaderInnerIconEl.querySelector('svg')].map(svg=>{const g=svg?.querySelector('g');return g&&{transform:g.getAttribute('transform'),fill:g.getAttribute('fill'),paths:[...g.querySelectorAll('path')].map(p=>p.getAttribute('d'))};}))`,
      ),
    ) as unknown[];
    const mark = {
      transform: "scale(6.25)",
      fill: "currentColor",
      paths: [
        "M1.69 1 H12 V4 L5.97 12 H15 V15 H1.78 A0.78 0.78 0 0 1 1 14.22 V12.55 A1.65 1.65 0 0 1 1.33 11.56 L7.03 4 H1.21 A0.21 0.21 0 0 1 1 3.79 V1.69 A0.69 0.69 0 0 1 1.69 1 Z",
        "M12 1 H15 V12 L13.5 10.5 L12 12 Z",
      ],
    };
    expect(icons).toEqual([mark, mark]);

    // With another tab in front, the command and the ribbon icon each bring
    // the one Library View tab back.
    for (const invoke of [
      "app.commands.executeCommandById('zotlit:open-library-view')",
      `(()=>{${PAGE}press(document.querySelector(${JSON.stringify(`.side-dock-ribbon-action[aria-label="${run.m.command_open_library_view_name()}"]`)}),'Library View ribbon icon')})()`,
    ]) {
      await obEval(
        run.vaultId,
        "(async()=>{await app.workspace.getLeaf('tab').openFile(app.vault.getMarkdownFiles()[0]);return true;})()",
      );
      expect(
        (await libraryWhen((library) => library.active !== "zotlit-library"))
          .leaves,
      ).toBe(1);
      await obEval(run.vaultId, `${invoke};true`);
      expect(
        await libraryWhen((library) => library.active === "zotlit-library"),
      ).toMatchObject({ leaves: 1 });
    }

    // The Sort popover turns the order to oldest change first, and plugin
    // data keeps it as the Library View Document's sort.
    const inLibrary = (script: string) =>
      obEval(
        run.vaultId,
        `(async()=>{${PAGE}const el=app.workspace.getLeavesOfType('zotlit-library')[0].view.contentEl;${script};return true;})()`,
      );
    await inLibrary(
      "press(el.querySelector('[data-query-toolbar=\"sort\"]'),'Sort');await pick(await until('sort direction',()=>el.querySelector('[data-query-popover=\"sort\"] [data-sort-direction]')),'ASC','sort direction')",
    );
    expectSeedOrder(
      await libraryWhen(
        (library) => drawn(library) && library.rows[0] !== opened.rows[0],
      ),
      1,
    );
    expect(
      await obEvalUntil(
        run.vaultId,
        "JSON.stringify(app.plugins.plugins.zotlit.services.bridge.runSync(app.plugins.plugins.zotlit.services.settings.current)['library.document']?.sort)",
        {
          expected: JSON.stringify([
            { property: "dateModified", direction: "ASC" },
          ]),
        },
      ),
    ).toBe(true);

    // A plugin reload brings the tab back with the sort it kept.
    expect(
      await obEvalUntil(
        run.vaultId,
        "app.plugins.disablePlugin('zotlit').then(function () { return app.plugins.enablePlugin('zotlit'); }).then(function () { return true; })",
        { expected: "true", tries: 20 },
      ),
    ).toBe(true);
    const reloaded = await libraryWhen(drawn);
    expect(reloaded).toMatchObject({ leaves: 1, failure: null });
    expectSeedOrder(reloaded, 1);
  });

  it("refreshes the empty quick switcher after a lastRead-only write without restarting Obsidian", async () => {
    const readItem = ITEMS.find((item) => item.itemID === 20)!;
    const attachment = ATTACHMENTS.find(
      (entry) => entry.parentItemID === readItem.itemID,
    )!;
    using sqlite = new DatabaseSync(e2eFixture.databasePath);
    const saved = sqlite
      .prepare("SELECT lastRead FROM itemAttachments WHERE itemID = ?")
      .get(attachment.itemID) as { lastRead: number | null };
    const modified = sqlite
      .prepare("SELECT dateModified FROM items WHERE itemID = ?")
      .get(readItem.itemID);
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      sqlite
        .prepare("UPDATE itemAttachments SET lastRead = ? WHERE itemID = ?")
        .run(saved.lastRead, attachment.itemID);
      await obEval(
        run.vaultId,
        "(async()=>{activeDocument.querySelector('.prompt input')?.dispatchEvent(new activeWindow.KeyboardEvent('keydown',{key:'Escape',code:'Escape',keyCode:27,which:27,bubbles:true}));await app.plugins.plugins.zotlit.services.bridge.runPromise(app.plugins.plugins.zotlit.services.zoteroReads.refresh);return true;})()",
      );
    });
    const recent =
      "(async()=>JSON.stringify((await app.plugins.plugins.zotlit.services.itemLookup.search('',{limit:1})).map(hit=>hit.item.indexedKey)))()";
    await obEval(run.vaultId, recent);
    sqlite
      .prepare("UPDATE itemAttachments SET lastRead = ? WHERE itemID = ?")
      .run(2208988800, attachment.itemID);
    expect(
      sqlite
        .prepare("SELECT dateModified FROM items WHERE itemID = ?")
        .get(readItem.itemID),
    ).toEqual(modified);
    await obReadUntil<string[]>(run.vaultId, recent, {
      ready: (keys) => keys[0] === readItem.key,
      what: "empty search to reflect the Zotero read",
      tries: 160,
    });
    await obEval(
      run.vaultId,
      "app.commands.executeCommandById('zotlit:note-quick-switcher');true",
    );
    expect(
      await obEvalUntil(
        run.vaultId,
        `String(activeDocument.querySelector('.prompt .suggestion-item')?.textContent.includes(${JSON.stringify(readItem.title)}))`,
        { expected: "true" },
      ),
    ).toBe(true);
  });

  it("opens a new Library View on Recent, lists the Library Scope newest activity first in rows of two lines at most, keeps the tree toggle beside the search box on a narrow pane, sorts that way again when Recent is selected again, and leaves Recent's own sort behind on a Collection", async () => {
    const services = "app.plugins.plugins.zotlit.services";
    const snapshot = await obEval(
      run.vaultId,
      `JSON.stringify({layout:app.workspace.getLayout(),document:${services}.bridge.runSync(${services}.settings.current)['library.document']??null,scope:${services}.bridge.runSync(${services}.settings.current)[${JSON.stringify(LIBRARY_SCOPE_SETTING_KEY)}]??null})`,
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obEval(
        run.vaultId,
        `(async()=>{const saved=JSON.parse(${JSON.stringify(snapshot)});const {settings,bridge}=${services};bridge.runSync(settings.update({'library.document':saved.document,${JSON.stringify(LIBRARY_SCOPE_SETTING_KEY)}:saved.scope}));await bridge.runPromise(settings.flush);await app.workspace.changeLayout(saved.layout);return true;})()`,
      );
    });
    // No Library View Document yet; the Library Scope holds My Library and
    // one group.
    const library = (type: "user" | number) =>
      LIBRARIES.find((entry) =>
        type === "user" ? entry.type === "user" : entry.groupID === type,
      )!;
    const personal = library("user");
    const shared = library(4200309);
    const scope = (libraries: readonly (typeof personal)[]) =>
      JSON.stringify({
        mode: "selected",
        libraries: libraries.map(({ groupID }) =>
          groupID === null ? { type: "personal" } : { type: "group", groupID },
        ),
      });
    await obEval(
      run.vaultId,
      `(async()=>{app.workspace.getLeavesOfType('zotlit-library').forEach(leaf=>leaf.detach());const {settings,bridge}=${services};bridge.runSync(settings.update({'library.document':null,${JSON.stringify(LIBRARY_SCOPE_SETTING_KEY)}:${scope([personal, shared])}}));await bridge.runPromise(settings.flush);return true;})()`,
    );

    // The seed's oracle: the Items of the Libraries in scope, by Indexed
    // Key. Items modified at the same moment may come in either order, so
    // the rows are checked by key set and by the modification time at each
    // place.
    const indexedKey = (item: FixtureItem) => {
      const { groupID } = LIBRARIES.find(
        (entry) => entry.libraryID === item.libraryID,
      )!;
      return groupID === null ? item.key : `${item.key}g${groupID}`;
    };
    const uses = await obJson<Record<string, number>>(
      run.vaultId,
      `JSON.stringify(${services}.bridge.runSync(${services}.useLedger.uses))`,
    );
    const activity = new Map(
      ITEMS.map((item) => [
        indexedKey(item),
        Math.max(
          Temporal.Instant.from(`${fixtureActivity(item).replace(" ", "T")}Z`)
            .epochMilliseconds,
          uses[indexedKey(item)] ?? 0,
        ),
      ]),
    );
    const expectRecent = (
      shown: Shown,
      libraries: readonly (typeof personal)[],
      direction: 1 | -1,
    ) => {
      const items = ITEMS.filter((item) =>
        libraries.some(({ libraryID }) => libraryID === item.libraryID),
      );
      expect(shown.rows.toSorted()).toEqual(items.map(indexedKey).toSorted());
      expect(shown.rows.map((key) => activity.get(key))).toEqual(
        items
          .map((item) => activity.get(indexedKey(item))!)
          .toSorted((a, b) => direction * (a - b)),
      );
      // A row holds two lines at most: the title, then creators, year and
      // Venue. It has no reading-state line.
      expect(shown.lines.every((lines) => lines <= 2)).toBe(true);
    };

    interface Shown {
      phase: string;
      header: string | null;
      recent: boolean;
      count: string | null;
      rows: string[];
      /** The lines of each row's text. */
      lines: number[];
      /** The Sort button: whether it shows a sort as set, and its text. */
      sort: { set: boolean; text: string | null };
    }
    const readShown = `(async()=>{const view=app.workspace.getLeavesOfType('zotlit-library')[0]?.view;if(!view?.tree)return 'null';await view.query.settled;await view.tree.settled;const el=view.contentEl;const rows=[...el.querySelectorAll('[data-query-papers-row]')];const sort=el.querySelector('[data-query-toolbar="sort"]');return JSON.stringify({sort:{set:sort?.hasAttribute('data-active')??false,text:sort?.textContent??null},phase:view.query.state.getState().phase,header:${LIBRARY_HEADING},recent:[...el.querySelectorAll('[data-library-node]')].some(n=>JSON.parse(n.getAttribute('data-library-node'))[0]==='recent'&&n.getAttribute('aria-selected')==='true'),count:el.querySelector('[data-query-count]')?.getAttribute('data-query-count')??null,rows:rows.map(n=>n.getAttribute('data-query-papers-row')),lines:rows.map(n=>n.querySelector('[data-query-papers-title]').parentElement.childElementCount)});})()`;
    const shownWhen = (ready: (shown: Shown) => boolean) =>
      obReadUntil<Shown>(run.vaultId, readShown, {
        ready,
        what: "Library View",
        tries: 120,
      });
    /** Whether the list drew every row it counted, `count` of them. */
    const listing = (count: number) => (shown: Shown) =>
      shown.phase === "ready" &&
      shown.count === String(count) &&
      shown.rows.length === count;
    const inLibrary = (script: string) =>
      obEval(
        run.vaultId,
        `(async()=>{${PAGE}const el=app.workspace.getLeavesOfType('zotlit-library')[0].view.contentEl;${script};return true;})()`,
      );
    /** Press the tree node `key`; a narrow pane keeps the tree behind its button. */
    const pressNode = (key: string, what: string) =>
      inLibrary(
        `const pane=el.querySelector('[data-library-tree]');if(getComputedStyle(pane).display==='none'){press(el.querySelector('[data-library-tree-toggle]'),'Library Tree button');await until('Library Tree',()=>getComputedStyle(pane).display!=='none');}press([...pane.querySelectorAll('[data-library-node]')].find(n=>n.getAttribute('data-library-node')===${JSON.stringify(key)}),${JSON.stringify(what)})`,
      );
    const size = (libraries: readonly (typeof personal)[]) =>
      ITEMS.filter((item) =>
        libraries.some(({ libraryID }) => libraryID === item.libraryID),
      ).length;

    // The new view opens on Recent: every Item of the Library Scope, newest
    // change first, under a heading that names Recent and counts its papers.
    await obEval(
      run.vaultId,
      "app.commands.executeCommandById('zotlit:open-library-view');true",
    );
    const opened = await shownWhen(listing(size([personal, shared])));
    expect(opened).toMatchObject({
      recent: true,
      header: `${run.m.library_view_recent()} | ${run.m.library_view_heading_papers({ count: size([personal, shared]) })}`,
    });
    expectRecent(opened, [personal, shared], -1);
    const reasons = await obJson<Record<string, string>>(
      run.vaultId,
      `(async()=>{const view=app.workspace.getLeavesOfType('zotlit-library')[0].view;return JSON.stringify(Object.fromEntries([...view.contentEl.querySelectorAll('[data-query-papers-row]')].map(row=>[row.getAttribute('data-query-papers-row'),row.querySelector('[data-query-papers-title]').parentElement.lastElementChild.textContent])));})()`,
    );
    // These seed signals are newer than their parent Item's addition.
    for (const [key, reason] of [
      ["SAKIMA22", "in Zotero"],
      ["AAAAAAAA", "notes edited in Zotero"],
      ["BBBB2222", "added to Zotero"],
    ]) {
      // A preceding case can have used a paper in the shared Fixture vault.
      expect(reasons[key!]).toContain(
        uses[key!] === activity.get(key!) ? "in Obsidian" : reason,
      );
    }

    const emptySearch = JSON.parse(
      await obEval(
        run.vaultId,
        `(async()=>JSON.stringify((await ${services}.itemLookup.search('',{limit:500})).map(hit=>hit.item.indexedKey)))()`,
      ),
    );
    expect(emptySearch).toEqual(opened.rows);

    // On a pane too narrow for the tree beside the list, Recent's tree
    // toggle sits beside the search box, not on a row of its own.
    const narrowRow = JSON.parse(
      await obEval(
        run.vaultId,
        `(()=>{const el=app.workspace.getLeavesOfType('zotlit-library')[0].view.contentEl;const width=el.style.width;el.style.width='400px';try{const toggle=el.querySelector('[data-library-tree-toggle]');const input=el.querySelector('[data-library-search] input');const t=toggle.getBoundingClientRect();const i=input.getBoundingClientRect();return JSON.stringify({toggle:toggle.checkVisibility(),beside:t.top<i.bottom&&t.bottom>i.top&&t.right<=i.left});}finally{el.style.width=width;}})()`,
      ),
    );
    expect(narrowRow).toEqual({ toggle: true, beside: true });

    // Another Library Scope changes what Recent lists.
    await obEval(
      run.vaultId,
      `(async()=>{const {settings,bridge}=${services};bridge.runSync(settings.update({${JSON.stringify(LIBRARY_SCOPE_SETTING_KEY)}:${scope([personal])}}));await bridge.runPromise(settings.flush);return true;})()`,
    );
    const narrowed = await shownWhen(listing(size([personal])));
    expectRecent(narrowed, [personal], -1);

    // A sort change keeps Recent selected; selecting Recent again after a
    // Library sorts newest activity first again.
    await inLibrary(
      "press(el.querySelector('[data-query-toolbar=\"sort\"]'),'Sort');await pick(await until('sort direction',()=>el.querySelector('[data-query-popover=\"sort\"] [data-sort-direction]')),'ASC','sort direction')",
    );
    const ascending = await shownWhen(
      (shown) =>
        listing(size([personal]))(shown) && shown.rows[0] !== narrowed.rows[0],
    );
    expect(ascending.recent).toBe(true);
    expectRecent(ascending, [personal], 1);
    await pressNode(JSON.stringify(["personal"]), "My Library");
    await shownWhen((shown) => !shown.recent && shown.phase === "ready");
    await pressNode(JSON.stringify(["recent"]), "Recent");
    const again = await shownWhen(
      (shown) => shown.recent && listing(size([personal]))(shown),
    );
    expectRecent(again, [personal], -1);
    expect(again.sort).toEqual({ set: false, text: "Sort" });
    const saved = (doc: object) =>
      obEvalUntil(
        run.vaultId,
        `JSON.stringify(${services}.bridge.runSync(${services}.settings.current)['library.document'],['node','kind','library','type','path','sort','property','direction'])`,
        { expected: JSON.stringify(doc) },
      );
    expect(
      await saved({
        node: { kind: "recent" },
        sort: [{ property: "lastActivity", direction: "DESC" }],
      }),
    ).toBe(true);

    const modified = new Map(
      ITEMS.map((item) => [indexedKey(item), item.dateModified]),
    );

    // Leaving Recent clears its own sort: the seed's "Shared key" Collection
    // of My Library lists in the default order, newest change first, and the
    // Sort button shows no sort set.
    const sharedKey = COLLECTIONS.find(
      (entry) =>
        entry.libraryID === personal.libraryID && entry.key === "SHAREDCL",
    )!;
    const subtree = (collectionID: number): number[] => [
      collectionID,
      ...COLLECTIONS.filter(
        (entry) => entry.parentCollectionID === collectionID,
      ).flatMap((child) => subtree(child.collectionID)),
    ];
    const inSharedKey = new Set(subtree(sharedKey.collectionID));
    const filed = ITEMS.filter(({ collectionIDs }) =>
      collectionIDs.some((id) => inSharedKey.has(id)),
    );
    const expectFiled = (shown: Shown, direction: 1 | -1) => {
      expect(shown.rows.toSorted()).toEqual(filed.map(indexedKey).toSorted());
      expect(shown.rows.map((key) => modified.get(key))).toEqual(
        filed
          .map(({ dateModified }) => dateModified)
          .toSorted((a, b) => direction * a.localeCompare(b)),
      );
    };
    const sharedKeyNode = JSON.stringify(["personal", sharedKey.name]);
    const sharedKeyPath = {
      kind: "collection",
      library: { type: "personal" },
      path: [sharedKey.name],
    };
    await pressNode(sharedKeyNode, "Shared key");
    const unsorted = await shownWhen(
      (shown) => !shown.recent && listing(filed.length)(shown),
    );
    expect(unsorted.sort).toEqual({ set: false, text: "Sort" });
    expectFiled(unsorted, -1);
    expect(await saved({ node: sharedKeyPath, sort: [] })).toBe(true);

    // A sort the researcher changed on Recent is theirs: it stays on the
    // Collection, and the Sort button shows it as set.
    await pressNode(JSON.stringify(["recent"]), "Recent");
    await shownWhen(
      (shown) => shown.recent && listing(size([personal]))(shown),
    );
    await inLibrary(
      "press(el.querySelector('[data-query-toolbar=\"sort\"]'),'Sort');await pick(await until('sort direction',()=>el.querySelector('[data-query-popover=\"sort\"] [data-sort-direction]')),'ASC','sort direction')",
    );
    const resorted = await shownWhen(
      (shown) =>
        shown.recent && shown.sort.set && listing(size([personal]))(shown),
    );
    expectRecent(resorted, [personal], 1);
    await pressNode(sharedKeyNode, "Shared key");
    const kept = await shownWhen(
      (shown) => !shown.recent && listing(filed.length)(shown),
    );
    expect(kept.sort).toEqual({ set: true, text: "Sort1" });
    expect(kept.rows.map((key) => activity.get(key))).toEqual(
      filed
        .map((item) => activity.get(indexedKey(item))!)
        .toSorted((a, b) => a - b),
    );
    expect(
      await saved({
        node: sharedKeyPath,
        sort: [{ property: "lastActivity", direction: "ASC" }],
      }),
    ).toBe(true);
  });

  it("records PDF reads from every open route and page changes, preserves restored reads, and excludes standalone Attachments", async () => {
    await verifyPdfReads(run.vaultId, e2eFixture.databasePath, reloadWindow);
  }, 180000);

  it("ranks Literature Note opens from every route and tab returns in Recent and empty search, keeps Uses through reloads, and excludes browsing and Companion updates", async () => {
    await verifyRecentUses(run.vaultId, e2eVaultPath, reloadWindow);
  }, 180000);

  it("picks a sort property in the Library View's Sort popover from the property Select's options, and the row keeps one property Select", async () => {
    const services = "app.plugins.plugins.zotlit.services";
    const snapshot = await obEval(
      run.vaultId,
      `JSON.stringify({layout:app.workspace.getLayout(),document:${services}.bridge.runSync(${services}.settings.current)['library.document']??null})`,
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obEval(
        run.vaultId,
        `(async()=>{const saved=JSON.parse(${JSON.stringify(snapshot)});const {settings,bridge}=${services};bridge.runSync(settings.update({'library.document':saved.document}));await bridge.runPromise(settings.flush);await app.workspace.changeLayout(saved.layout);return true;})()`,
      );
    });
    // A new Library View opens on Recent, whose sort is last change first.
    await obEval(
      run.vaultId,
      `(async()=>{app.workspace.getLeavesOfType('zotlit-library').forEach(leaf=>leaf.detach());const {settings,bridge}=${services};bridge.runSync(settings.update({'library.document':null}));await bridge.runPromise(settings.flush);app.commands.executeCommandById('zotlit:open-library-view');return true;})()`,
    );
    // The heading draws the Sort control in a React root of its own; the
    // property Select's popup opens its Chooser there, with its search and
    // rows, and a pick shuts it.
    const picked = JSON.parse(
      await obEval(
        run.vaultId,
        `(async()=>{${PAGE}const leaf=app.workspace.getLeavesOfType('zotlit-library')[0];await app.workspace.revealLeaf(leaf);const el=leaf.view.contentEl;await until('rows',()=>el.querySelectorAll('[data-query-papers-row]').length>0,20000);press(el.querySelector('[data-query-toolbar="sort"]'),'Sort');const popover=await until('Sort popover',()=>el.querySelector('[data-query-popover="sort"]:popover-open'));await pick(await until('sort property',()=>popover.querySelector('[data-sort-property]')),'title','sort property');const triggers=popover.querySelectorAll('[data-sort-property]').length;popover.hidePopover();return JSON.stringify({triggers});})()`,
      ),
    ) as { triggers: number };
    expect(picked).toEqual({ triggers: 1 });
    expect(
      await obEvalUntil(
        run.vaultId,
        `JSON.stringify(${services}.bridge.runSync(${services}.settings.current)['library.document']?.sort)`,
        {
          expected: JSON.stringify([{ property: "title", direction: "DESC" }]),
        },
      ),
    ).toBe(true);
  });

  it("filters the Library View from the Library Tree, with counts that match the seed and follow a database change", async () => {
    const services = "app.plugins.plugins.zotlit.services";
    const snapshot = await obEval(
      run.vaultId,
      `JSON.stringify({layout:app.workspace.getLayout(),document:${services}.bridge.runSync(${services}.settings.current)['library.document']??null,scope:${services}.bridge.runSync(${services}.settings.current)[${JSON.stringify(LIBRARY_SCOPE_SETTING_KEY)}]??null})`,
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obEval(
        run.vaultId,
        `(async()=>{const saved=JSON.parse(${JSON.stringify(snapshot)});const {settings,bridge}=${services};bridge.runSync(settings.update({'library.document':saved.document,${JSON.stringify(LIBRARY_SCOPE_SETTING_KEY)}:saved.scope}));await bridge.runPromise(settings.flush);await app.workspace.changeLayout(saved.layout);return true;})()`,
      );
    });
    // The Library Scope holds My Library alone; the tree opens on My Library.
    await obEval(
      run.vaultId,
      `(async()=>{app.workspace.getLeavesOfType('zotlit-library').forEach(leaf=>leaf.detach());const {settings,bridge}=${services};bridge.runSync(settings.update({'library.document':${JSON.stringify(MY_LIBRARY_DOCUMENT)},${JSON.stringify(LIBRARY_SCOPE_SETTING_KEY)}:{mode:'selected',libraries:[{type:'personal'}]}}));await bridge.runPromise(settings.flush);return true;})()`,
    );

    // The seed's oracle: each Library's Items, and the Items a Collection
    // and its subcollections hold, each once.
    const library = (type: "user" | number) =>
      LIBRARIES.find((entry) =>
        type === "user" ? entry.type === "user" : entry.groupID === type,
      )!;
    const personal = library("user");
    const shared = library(4200309);
    const indexedKey = (item: FixtureItem) => {
      const { groupID } = LIBRARIES.find(
        (entry) => entry.libraryID === item.libraryID,
      )!;
      return groupID === null ? item.key : `${item.key}g${groupID}`;
    };
    const subtree = (collectionID: number): number[] => [
      collectionID,
      ...COLLECTIONS.filter(
        (entry) => entry.parentCollectionID === collectionID,
      ).flatMap((child) => subtree(child.collectionID)),
    ];
    const collection = (libraryID: number, key: string) =>
      COLLECTIONS.find(
        (entry) => entry.libraryID === libraryID && entry.key === key,
      )!;
    const filed = (collectionID: number) => {
      const ids = new Set(subtree(collectionID));
      return ITEMS.filter(({ collectionIDs }) =>
        collectionIDs.some((id) => ids.has(id)),
      );
    };
    const inLibrary = (libraryID: number) =>
      ITEMS.filter((item) => item.libraryID === libraryID);
    const parent = collection(personal.libraryID, "PERSNAL2");
    const child = collection(personal.libraryID, "PERSCHLD");
    const sharedKey = collection(personal.libraryID, "SHAREDCL");
    const nodeKey = (selector: string, ...path: string[]) =>
      JSON.stringify([selector, ...path]);
    const parentKey = nodeKey("personal", parent.name);
    const childKey = nodeKey("personal", parent.name, child.name);
    const sharedNode = nodeKey(`group:${shared.groupID}`);

    interface Shown {
      phase: string;
      header: string | null;
      all: string | null;
      tree: {
        key: string;
        level: number;
        label: string;
        count: string | null;
        selected: boolean;
      }[];
      count: string | null;
      rows: string[];
    }
    const readShown = `(async()=>{const view=app.workspace.getLeavesOfType('zotlit-library')[0]?.view;if(!view?.tree)return 'null';await view.query.settled;await view.tree.settled;const el=view.contentEl;return JSON.stringify({phase:view.query.state.getState().phase,header:${LIBRARY_HEADING},all:el.querySelector('[data-library-all]')?.getAttribute('data-library-all')??null,tree:[...el.querySelectorAll('[data-library-node]')].map(n=>({key:n.getAttribute('data-library-node'),level:Number(n.getAttribute('aria-level')),label:n.querySelector('[data-library-label]').textContent,count:n.querySelector('[data-library-count]')?.textContent??null,selected:n.getAttribute('aria-selected')==='true'})),count:el.querySelector('[data-query-count]')?.getAttribute('data-query-count')??null,rows:[...el.querySelectorAll('tr[data-query-table-row="item"], [data-query-papers-row]')].map(n=>n.getAttribute('data-query-key')??n.getAttribute('data-query-papers-row'))});})()`;
    const shownWhen = (ready: (shown: Shown) => boolean) =>
      obReadUntil<Shown>(run.vaultId, readShown, {
        ready,
        what: "Library View",
        tries: 120,
      });
    /** Whether the list drew every row it counted, for the selection `key`. */
    const listing = (key: string) => (shown: Shown) =>
      shown.phase === "ready" &&
      shown.tree.some((node) => node.key === key && node.selected) &&
      shown.count !== null &&
      shown.rows.length === Number(shown.count);
    const node = (shown: Shown, key: string) =>
      shown.tree.find((entry) => entry.key === key);
    /**
     * Press the element `target` finds in the tree pane. A narrow pane keeps
     * the tree behind its button, so the press opens it first.
     */
    const inTree = (target: string, what: string) =>
      obEval(
        run.vaultId,
        `(async()=>{${PAGE}const el=app.workspace.getLeavesOfType('zotlit-library')[0].view.contentEl;const pane=el.querySelector('[data-library-tree]');if(getComputedStyle(pane).display==='none'){press(el.querySelector('[data-library-tree-toggle]'),'Library Tree button');await until('Library Tree',()=>getComputedStyle(pane).display!=='none');}press(${target},${JSON.stringify(what)});return true;})()`,
      );
    /** Press the node `key`, or its element that `part` selects. */
    const press = (key: string, part: string, what: string) => {
      const row = `[...pane.querySelectorAll('[data-library-node]')].find(n=>n.getAttribute('data-library-node')===${JSON.stringify(key)})`;
      return inTree(
        part === "" ? row : `${row}.querySelector(${JSON.stringify(part)})`,
        what,
      );
    };

    await obEval(
      run.vaultId,
      "app.commands.executeCommandById('zotlit:open-library-view');true",
    );
    // The tree shows the Library Scope: My Library and its Collections, each
    // counted from the seed, a subcollection's Items inside its parent.
    const opened = await shownWhen(
      (shown) =>
        listing(nodeKey("personal"))(shown) &&
        node(shown, parentKey)?.count != null,
    );
    expect(
      opened.tree.map(({ key, level, count }) => ({ key, level, count })),
    ).toEqual([
      // Recent, above the Libraries, counts nothing.
      { key: JSON.stringify(["recent"]), level: 1, count: null },
      {
        key: nodeKey("personal"),
        level: 1,
        count: String(inLibrary(personal.libraryID).length),
      },
      ...[parent, sharedKey]
        .toSorted((a, b) => a.name.localeCompare(b.name))
        .map((entry) => ({
          key: nodeKey("personal", entry.name),
          level: 2,
          count: String(filed(entry.collectionID).length),
        })),
    ]);
    expect(opened.header).toBe(
      suite.libraryHeader(
        run.m.settings_library_scope_personal(),
        inLibrary(personal.libraryID),
      ),
    );
    await press(parentKey, "[data-library-expand]", "Collection disclosure");
    expect(
      node(
        await shownWhen((shown) => node(shown, childKey) !== undefined),
        childKey,
      ),
    ).toMatchObject({
      level: 3,
      count: String(filed(child.collectionID).length),
    });

    // "All libraries" shows the group libraries outside the Library Scope;
    // one lists its own Items.
    expect(opened.all).toBe("off");
    await inTree("pane.querySelector('[data-library-all]')", "All libraries");
    const widened = await shownWhen(
      (shown) =>
        shown.all === "on" &&
        LIBRARIES.every(
          ({ groupID }) =>
            groupID === null ||
            node(shown, nodeKey(`group:${groupID}`))?.count != null,
        ),
    );
    for (const entry of LIBRARIES.filter(({ groupID }) => groupID !== null))
      expect(node(widened, nodeKey(`group:${entry.groupID}`))).toMatchObject({
        label: entry.name,
        count: String(inLibrary(entry.libraryID).length),
      });
    await press(sharedNode, "", "group library");
    const group = await shownWhen(listing(sharedNode));
    expect(group.rows.toSorted()).toEqual(
      inLibrary(shared.libraryID).map(indexedKey).toSorted(),
    );

    // A Collection lists exactly its Items and its subcollection's, and the
    // header names it with the count.
    await press(parentKey, "", "Collection");
    const expected = filed(parent.collectionID).map(indexedKey).toSorted();
    const chosen = await shownWhen(listing(parentKey));
    expect(chosen.rows.toSorted()).toEqual(expected);
    expect(chosen.header).toBe(
      suite.libraryHeader(parent.name, filed(parent.collectionID)),
    );

    // A plugin reload comes back on the Collection.
    expect(
      await obEvalUntil(
        run.vaultId,
        "app.plugins.disablePlugin('zotlit').then(function () { return app.plugins.enablePlugin('zotlit'); }).then(function () { return true; })",
        { expected: "true", tries: 20 },
      ),
    ).toBe(true);
    const reloaded = await shownWhen(listing(parentKey));
    expect(reloaded.rows.toSorted()).toEqual(expected);
    expect(reloaded.header).toBe(chosen.header);

    // Zotero files one more Item in the subcollection: the counts up the
    // tree and the list take it after the database change.
    const added = inLibrary(personal.libraryID).find(
      ({ collectionIDs }) =>
        !collectionIDs.some((id) => subtree(parent.collectionID).includes(id)),
    )!;
    const file = (sql: string) => {
      using database = new DatabaseSync(e2eFixture.databasePath);
      database.prepare(sql).run(child.collectionID, added.itemID);
    };
    file(
      "insert into collectionItems (collectionID, itemID, orderIndex) values (?, ?, 0)",
    );
    cleanup.defer(async () => {
      file("delete from collectionItems where collectionID = ? and itemID = ?");
      await signalDatabaseUpdated(run.vaultId);
    });
    await signalDatabaseUpdated(run.vaultId);
    const changed = await shownWhen(
      (shown) =>
        listing(parentKey)(shown) &&
        node(shown, parentKey)?.count === String(expected.length + 1),
    );
    expect(changed.rows.toSorted()).toEqual(
      [...expected, indexedKey(added)].toSorted(),
    );
    expect(changed.header).toBe(
      suite.libraryHeader(parent.name, [...filed(parent.collectionID), added]),
    );
  });

  /**
   * Reload the vault's window, as Obsidian's "Reload app without saving"
   * does, and wait for ZotLit to load in the new page with plugin data read.
   */
  async function reloadWindow(): Promise<void> {
    // The page before the reload carries a mark the new page lacks. The
    // workspace saves its layout a while after a change; a researcher
    // reloads later than that, so the case saves it at once.
    await obEval(
      run.vaultId,
      "(async()=>{window.__ztBeforeReload=true;await app.workspace.requestSaveLayout.run();return true;})()",
    );
    await cli([`vault=${run.vaultId}`, "reload"]);
    expect(
      await obEvalUntil(
        run.vaultId,
        "String(!window.__ztBeforeReload&&!!app.plugins.plugins.zotlit?.services?.bridge.runSync(app.plugins.plugins.zotlit?.services?.settings?.current)&&app.workspace.layoutReady)",
        { expected: "true", tries: 120 },
      ),
    ).toBe(true);
    await prepareRunWindow(run.vaultId);
  }

  /** What the Library View shows that a reload must keep, once it settled. */
  interface Kept {
    phase: string;
    open: string[];
    selected: string | null;
    card: string | null;
    inView: boolean;
    banner: boolean;
    pressed: string | null;
    rows: number;
  }
  const readKept = (help: string) =>
    `(async()=>{const view=app.workspace.getLeavesOfType('zotlit-library')[0]?.view;if(!view?.tree)return 'null';await view.searched;await view.query.settled;await view.tree.settled;await new Promise(r=>setTimeout(r,200));const el=view.contentEl;const row=el.querySelector('[data-query-item-row][data-selected]');const card=el.querySelector('[data-library-card]');let inView=false;if(row){const r=row.getBoundingClientRect();const hit=el.ownerDocument.elementFromPoint(r.left+r.width/2,r.top+r.height/2);inView=!!hit&&row.contains(hit);}const action=view.containerEl.querySelector(${JSON.stringify(`.view-actions .view-action[aria-label="${help}"]`)});return JSON.stringify({phase:view.query.state.getState().phase,open:[...el.querySelectorAll('[data-library-node][aria-expanded="true"]')].map(n=>n.getAttribute('data-library-node')),selected:row?.getAttribute('data-query-item-row')??null,card:card&&!card.hidden&&card.checkVisibility()?card.querySelector('[data-library-card-title]')?.textContent??'':null,inView,banner:!!el.querySelector('[data-welcome-banner]'),pressed:action?.getAttribute('aria-pressed')??null,rows:el.querySelectorAll('[data-query-item-row]').length});})()`;

  it("puts the researcher back where they were after a window reload: the Collection left open, the selected paper in view with its Reading Card beside a wide list and none over a narrow one, and the Welcome View banner they asked for, with Zotero closed", async () => {
    const services = "app.plugins.plugins.zotlit.services";
    const snapshot = await obEval(
      run.vaultId,
      `JSON.stringify({layout:app.workspace.getLayout(),document:${services}.bridge.runSync(${services}.settings.current)['library.document']??null,scope:${services}.bridge.runSync(${services}.settings.current)[${JSON.stringify(LIBRARY_SCOPE_SETTING_KEY)}]??null,dismissed:${services}.bridge.runSync(${services}.settings.current)['welcome.dismissed'],requested:${services}.bridge.runSync(${services}.settings.current)['welcome.requested']})`,
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obEval(
        run.vaultId,
        `(async()=>{const saved=JSON.parse(${JSON.stringify(snapshot)});const {settings,bridge}=${services};bridge.runSync(settings.update({'library.document':saved.document,${JSON.stringify(LIBRARY_SCOPE_SETTING_KEY)}:saved.scope,'welcome.dismissed':saved.dismissed,'welcome.requested':saved.requested}));await bridge.runPromise(settings.flush);await app.workspace.changeLayout(saved.layout);return true;})()`,
      );
    });
    await suite.wideWindow(cleanup);
    // The window is short, so the list scrolls under the banner.
    await obEval(
      run.vaultId,
      "require('@electron/remote').getCurrentWindow().setSize(1600,640);true",
    );
    // My Library alone, with the banner put away.
    await obEval(
      run.vaultId,
      `(async()=>{app.workspace.getLeavesOfType('zotlit-library').forEach(leaf=>leaf.detach());const {settings,bridge}=${services};bridge.runSync(settings.update({'library.document':${JSON.stringify(MY_LIBRARY_DOCUMENT)},${JSON.stringify(LIBRARY_SCOPE_SETTING_KEY)}:{mode:'selected',libraries:[{type:'personal'}]},'welcome.dismissed':true,'welcome.requested':false}));await bridge.runPromise(settings.flush);await app.commands.executeCommandById('zotlit:open-library-view');return true;})()`,
    );
    const help = run.m.library_view_help_action();
    const keptWhen = (ready: (kept: Kept) => boolean) =>
      obReadUntil<Kept>(run.vaultId, readKept(help), {
        ready,
        what: "Library View",
        tries: 120,
      });
    const personal = LIBRARIES.find(({ type }) => type === "user")!;
    const parent = COLLECTIONS.find(
      (entry) =>
        entry.libraryID === personal.libraryID && entry.key === "PERSNAL2",
    )!;
    const parentKey = JSON.stringify(["personal", parent.name]);
    const first = await keptWhen(
      (kept) => kept.phase === "ready" && kept.rows > 0,
    );
    expect(first).toMatchObject({ banner: false, pressed: "false" });
    expect(first.open).not.toContain(parentKey);

    // Open the Collection, select the last paper, and ask for the banner.
    const last = JSON.parse(
      await obEval(
        run.vaultId,
        `(async()=>{${PAGE}const leaf=app.workspace.getLeavesOfType('zotlit-library')[0];await app.workspace.revealLeaf(leaf);app.workspace.setActiveLeaf(leaf,{focus:true});const view=leaf.view;const el=view.contentEl;press([...el.querySelectorAll('[data-library-node]')].find(n=>n.getAttribute('data-library-node')===${JSON.stringify(parentKey)}).querySelector('[data-library-expand]'),'Collection disclosure');await until('Collection open',()=>[...el.querySelectorAll('[data-library-node][aria-expanded="true"]')].some(n=>n.getAttribute('data-library-node')===${JSON.stringify(parentKey)}));const rows=[...el.querySelectorAll('[data-query-item-row]')];const row=rows.at(-1);press(row,'last paper');await until('card',()=>{const card=el.querySelector('[data-library-card]');return !card.hidden&&card.checkVisibility();});press(view.containerEl.querySelector(${JSON.stringify(`.view-actions .view-action[aria-label="${help}"]`)}),'Welcome & help');await until('banner',()=>el.querySelector('[data-welcome-banner]'));return JSON.stringify(row.getAttribute('data-query-item-row'));})()`,
      ),
    ) as string;
    const before = await keptWhen(
      (kept) => kept.selected === last && kept.banner,
    );
    expect(before).toMatchObject({
      open: expect.arrayContaining([parentKey]),
      selected: last,
      banner: true,
      pressed: "true",
    });
    expect(before.card).not.toBeNull();

    // A reload right after the changes keeps every one of them.
    await reloadWindow();
    const after = await keptWhen(
      (kept) => kept.phase === "ready" && kept.selected !== null,
    );
    expect(after).toEqual({ ...before, inView: true });
    // The list scrolled to the paper, which a fresh page would not show.
    expect(
      await obEval(
        run.vaultId,
        `(()=>{const el=app.workspace.getLeavesOfType('zotlit-library')[0].view.contentEl;let n=el.querySelector('[data-query-item-row][data-selected]');for(;n&&n!==el;n=n.parentElement)if(n.scrollTop>0)return 'scrolled';return 'top';})()`,
      ),
    ).toBe("scrolled");

    // On a narrow pane the restored paper is selected as the arrow keys
    // select a row: its card does not open over the list, which stays
    // uncovered with the row in view.
    await obEval(
      run.vaultId,
      "require('@electron/remote').getCurrentWindow().setSize(900,640);true",
    );
    await reloadWindow();
    const narrow = await keptWhen(
      (kept) => kept.phase === "ready" && kept.selected !== null,
    );
    expect(narrow).toMatchObject({
      selected: last,
      card: null,
      inView: true,
      banner: true,
      pressed: "true",
    });
  });

  it("keeps the Welcome View banner away after a window reload once the researcher dismissed it", async () => {
    const services = "app.plugins.plugins.zotlit.services";
    const snapshot = await obEval(
      run.vaultId,
      `JSON.stringify({layout:app.workspace.getLayout(),dismissed:${services}.bridge.runSync(${services}.settings.current)['welcome.dismissed'],requested:${services}.bridge.runSync(${services}.settings.current)['welcome.requested']})`,
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obEval(
        run.vaultId,
        `(async()=>{const saved=JSON.parse(${JSON.stringify(snapshot)});const {settings,bridge}=${services};bridge.runSync(settings.update({'welcome.dismissed':saved.dismissed,'welcome.requested':saved.requested}));await bridge.runPromise(settings.flush);await app.workspace.changeLayout(saved.layout);return true;})()`,
      );
    });
    const help = run.m.library_view_help_action();
    const helpAction = `app.workspace.getLeavesOfType('zotlit-library')[0].view.containerEl.querySelector(${JSON.stringify(`.view-actions .view-action[aria-label="${help}"]`)})`;
    const banner = `app.workspace.getLeavesOfType('zotlit-library')[0]?.view.contentEl.querySelector('[data-welcome-banner]')`;
    // The banner shows, as "Open welcome view" shows it, then the researcher
    // dismisses it from its dismiss button.
    await obEval(
      run.vaultId,
      `(async()=>{${PAGE}app.workspace.getLeavesOfType('zotlit-library').forEach(leaf=>leaf.detach());await app.commands.executeCommandById('zotlit:open-welcome-view');const el=await until('banner',()=>${banner},5000);press(el.querySelector('[data-welcome-dismiss]'),'Dismiss the welcome banner');await until('banner gone',()=>!${banner});return true;})()`,
    );
    await reloadWindow();
    const kept = await obReadUntil<Kept>(run.vaultId, readKept(help), {
      ready: (shown) => shown.phase === "ready",
      what: "Library View",
      tries: 120,
    });
    expect(kept).toMatchObject({ banner: false, pressed: "false" });
    expect(
      await obEval(
        run.vaultId,
        `JSON.stringify({dismissed:${services}.bridge.runSync(${services}.settings.current)['welcome.dismissed'],requested:${services}.bridge.runSync(${services}.settings.current)['welcome.requested'],action:!!${helpAction}})`,
      ),
    ).toBe(JSON.stringify({ dismissed: true, requested: false, action: true }));
  });

  it("resizes the Reading Card from its inner edge with the keys and a drag, keeps the width after a window reload, returns it to 24rem on a double click, and widens it toward the list over a narrow pane, with Zotero closed", async () => {
    const services = "app.plugins.plugins.zotlit.services";
    const snapshot = await obEval(
      run.vaultId,
      `JSON.stringify({layout:app.workspace.getLayout(),document:${services}.bridge.runSync(${services}.settings.current)['library.document']??null,dismissed:${services}.bridge.runSync(${services}.settings.current)['welcome.dismissed'],requested:${services}.bridge.runSync(${services}.settings.current)['welcome.requested']})`,
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obEval(
        run.vaultId,
        `(async()=>{const saved=JSON.parse(${JSON.stringify(snapshot)});const {settings,bridge}=${services};bridge.runSync(settings.update({'library.document':saved.document,'welcome.dismissed':saved.dismissed,'welcome.requested':saved.requested}));await bridge.runPromise(settings.flush);await app.workspace.changeLayout(saved.layout);return true;})()`,
      );
    });
    await suite.wideWindow(cleanup);
    /** Save a picture of the window as `library-card-<name>.png`. */
    const screenshot = async (name: string) => {
      const folder = join(workspaceRoot, ".scratch/e2e-screenshots");
      await mkdir(folder, { recursive: true });
      await cli([
        `vault=${run.vaultId}`,
        "dev:screenshot",
        `path=${join(folder, `library-${name}.png`)}`,
      ]);
    };
    /** The card's width, its edge's values and the width plugin data keeps. */
    interface CardWidth {
      phase: string;
      shown: boolean;
      width: number;
      list: number;
      pane: number;
      overlay: boolean;
      now: number;
      min: number;
      max: number;
      stored: number | null;
      label: string | null;
    }
    const readWidth = `(async()=>{const view=app.workspace.getLeavesOfType('zotlit-library')[0]?.view;if(!view?.query)return 'null';await view.query.settled;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const el=view.contentEl;const card=el.querySelector('[data-library-card]');const edge=card.querySelector('[data-library-card-resizer]');const num=n=>Number(edge.getAttribute(n));return JSON.stringify({phase:view.query.state.getState().phase,shown:!card.hidden&&card.checkVisibility(),width:Math.round(card.getBoundingClientRect().width),list:Math.round(el.querySelector('[data-library-search-row]').parentElement.getBoundingClientRect().width),pane:Math.round(card.parentElement.parentElement.getBoundingClientRect().width),overlay:getComputedStyle(card).position==='absolute',now:num('aria-valuenow'),min:num('aria-valuemin'),max:num('aria-valuemax'),stored:${services}.bridge.runSync(${services}.settings.current)['library.document']?.cardWidth??null,label:edge.getAttribute('aria-label')});})()`;
    const widthWhen = (ready: (shown: CardWidth) => boolean) =>
      obReadUntil<CardWidth>(run.vaultId, readWidth, {
        ready,
        what: "Reading Card width",
        tries: 120,
      });
    const edge = `app.workspace.getLeavesOfType('zotlit-library')[0].view.contentEl.querySelector('[data-library-card] [data-library-card-resizer]')`;
    const keys = (...names: string[]) =>
      obEval(
        run.vaultId,
        `(async()=>{const edge=${edge};edge.focus();for(const key of ${JSON.stringify(names)}){edge.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}));await new Promise(r=>requestAnimationFrame(r));}return true;})()`,
      );
    // My Library with no width kept, and its first paper selected.
    await obEval(
      run.vaultId,
      `(async()=>{${PAGE}app.workspace.getLeavesOfType('zotlit-library').forEach(leaf=>leaf.detach());const {settings,bridge}=${services};bridge.runSync(settings.update({'library.document':${JSON.stringify(MY_LIBRARY_DOCUMENT)},'welcome.dismissed':true,'welcome.requested':false}));await bridge.runPromise(settings.flush);await app.commands.executeCommandById('zotlit:open-library-view');const leaf=app.workspace.getLeavesOfType('zotlit-library')[0];await app.workspace.revealLeaf(leaf);app.workspace.setActiveLeaf(leaf,{focus:true});const el=leaf.view.contentEl;const row=await until('rows',()=>el.querySelector('[data-query-item-row]'),20000);press(row,'first paper');await until('card',()=>{const card=el.querySelector('[data-library-card]');return !card.hidden&&card.checkVisibility();},5000);return true;})()`,
    );
    const first = await widthWhen((shown) => shown.shown);
    // The default 24rem, said on its edge, which names what it does.
    expect(first).toMatchObject({
      width: 384,
      now: 384,
      min: 288,
      stored: null,
      label: run.m.library_view_card_resize_hint(),
    });
    expect(first.max).toBe(first.width + first.list - 320);
    await screenshot("card-default");

    // Three presses toward the list widen it by 16px each.
    await keys("ArrowLeft", "ArrowLeft", "ArrowLeft");
    expect(await widthWhen((shown) => shown.stored === 432)).toMatchObject({
      width: 432,
      now: 432,
    });
    await keys("ArrowRight");
    await widthWhen((shown) => shown.stored === 416);
    // Home and End take it to its narrowest and its widest, which leaves
    // the list 20rem.
    await keys("Home");
    expect(await widthWhen((shown) => shown.stored === 288)).toMatchObject({
      width: 288,
    });
    await keys("End");
    const widest = await widthWhen((shown) => shown.stored === first.max);
    expect(widest).toMatchObject({ width: first.max, list: 320 });

    // A drag of the edge 100px away from the list, back from the widest.
    await obEval(
      run.vaultId,
      `(async()=>{const edge=${edge};const r=edge.getBoundingClientRect();const x=r.left+r.width/2;const y=r.top+r.height/2;const fire=(type,clientX)=>edge.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:7,isPrimary:true,button:0,buttons:type==='pointerup'?0:1,clientX,clientY:y}));fire('pointerdown',x);if(!document.body.classList.contains('zt-is-resizing-library-card'))throw new Error('No resize cursor');for(const step of [25,50,75,100]){fire('pointermove',x+step);await new Promise(r=>requestAnimationFrame(r));}fire('pointerup',x+100);return true;})()`,
    );
    const dragged = await widthWhen(
      (shown) => shown.stored === first.max - 100,
    );
    expect(dragged).toMatchObject({ width: first.max - 100 });
    await screenshot("card-resized");

    // A reload keeps the width.
    await reloadWindow();
    const after = await widthWhen(
      (shown) => shown.phase === "ready" && shown.shown,
    );
    expect(after).toMatchObject({
      width: dragged.width,
      now: dragged.width,
      stored: dragged.width,
    });

    // A double click puts the default back, and keeps no width.
    await obEval(
      run.vaultId,
      `(()=>{${edge}.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true,detail:2}));return true;})()`,
    );
    expect(await widthWhen((shown) => shown.stored === null)).toMatchObject({
      width: 384,
      now: 384,
    });

    // Over a narrow pane the card takes up to 85% of the pane it overlays,
    // the list's 20rem aside: from its narrowest, the key toward the list
    // widens it.
    await obEval(
      run.vaultId,
      `(async()=>{${PAGE}require('@electron/remote').getCurrentWindow().setSize(740,1000);const el=app.workspace.getLeavesOfType('zotlit-library')[0].view.contentEl;const card=el.querySelector('[data-library-card]');await until('the narrow pane',()=>activeWindow.outerWidth===740&&getComputedStyle(card).position==='absolute',5000);if(!card.checkVisibility())press(el.querySelector('[data-query-item-row][data-selected]'),'selected paper');await until('card over the list',()=>!card.hidden&&card.checkVisibility(),5000);return true;})()`,
    );
    const narrow = await widthWhen((shown) => shown.shown && shown.overlay);
    expect(narrow.max).toBe(Math.floor(narrow.pane * 0.85));
    expect(narrow.max).toBeGreaterThan(288);
    await keys("Home");
    expect(await widthWhen((shown) => shown.stored === 288)).toMatchObject({
      width: 288,
      min: 288,
    });
    await keys("ArrowLeft", "ArrowLeft");
    expect(await widthWhen((shown) => shown.stored === 320)).toMatchObject({
      width: 320,
      now: 320,
      overlay: true,
    });
    await screenshot("card-narrow-widened");
  });

  it("closes the Reading Card on a wide pane from its close button or a drag of its edge past the minimum, keeps it closed while the arrow keys move and after a window reload, and opens it on a row click at the width it had, with Zotero closed", async () => {
    const services = "app.plugins.plugins.zotlit.services";
    const snapshot = await obEval(
      run.vaultId,
      `JSON.stringify({layout:app.workspace.getLayout(),document:${services}.bridge.runSync(${services}.settings.current)['library.document']??null,dismissed:${services}.bridge.runSync(${services}.settings.current)['welcome.dismissed'],requested:${services}.bridge.runSync(${services}.settings.current)['welcome.requested']})`,
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obEval(
        run.vaultId,
        `(async()=>{const saved=JSON.parse(${JSON.stringify(snapshot)});const {settings,bridge}=${services};bridge.runSync(settings.update({'library.document':saved.document,'welcome.dismissed':saved.dismissed,'welcome.requested':saved.requested}));await bridge.runPromise(settings.flush);await app.workspace.changeLayout(saved.layout);return true;})()`,
      );
    });
    await suite.wideWindow(cleanup);
    /** Save a picture of the window as `library-card-close-<name>.png`. */
    const screenshot = async (name: string) => {
      const folder = join(workspaceRoot, ".scratch/e2e-screenshots");
      await mkdir(folder, { recursive: true });
      await cli([
        `vault=${run.vaultId}`,
        "dev:screenshot",
        `path=${join(folder, `library-card-close-${name}.png`)}`,
      ]);
    };
    /** Whether the card shows, its width, the list's, and what plugin data keeps. */
    interface CardClosed {
      phase: string;
      shown: boolean;
      width: number;
      list: number;
      selected: string | null;
      focused: string | null;
      stored: number | null;
      closed: boolean | null;
      kept: string | null;
    }
    const view = `app.workspace.getLeavesOfType('zotlit-library')[0]?.view`;
    const readClosed = `(async()=>{const view=${view};if(!view?.query)return 'null';await view.query.settled;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const el=view.contentEl;const card=el.querySelector('[data-library-card]');const doc=${services}.bridge.runSync(${services}.settings.current)['library.document'];return JSON.stringify({phase:view.query.state.getState().phase,shown:!card.hidden&&card.checkVisibility(),width:Math.round(card.getBoundingClientRect().width),list:Math.round(el.querySelector('[data-library-search-row]').parentElement.getBoundingClientRect().width),selected:view.selected.key,focused:activeDocument.activeElement?.getAttribute('data-query-item-row')??null,stored:doc?.cardWidth??null,closed:doc?.cardClosed??null,kept:doc?.selected??null});})()`;
    const closedWhen = (ready: (shown: CardClosed) => boolean) =>
      obReadUntil<CardClosed>(run.vaultId, readClosed, {
        ready,
        what: "Reading Card",
        tries: 120,
      });
    const rows = `[...${view}.contentEl.querySelectorAll('[data-query-item-row]')]`;
    const rowKey = async (index: number) =>
      JSON.parse(
        await obEval(
          run.vaultId,
          `JSON.stringify(${rows}[${index}].getAttribute('data-query-item-row'))`,
        ),
      ) as string;
    const clickRow = (index: number) =>
      obEval(
        run.vaultId,
        `(async()=>{${PAGE}press(${rows}[${index}],'paper ${index}');return true;})()`,
      );
    const edge = `${view}.contentEl.querySelector('[data-library-card] [data-library-card-resizer]')`;
    /**
     * Drag the edge: press it, then move the pointer by each of `steps`
     * pixels away from the list, a frame apiece, and let go where `release`.
     */
    const drag = (steps: number[], { press = true, release = true } = {}) =>
      obEval(
        run.vaultId,
        `(async()=>{const edge=${edge};const r=edge.getBoundingClientRect();window.__lvccDrag??={x:r.left+r.width/2,y:r.top+r.height/2};const {x,y}=window.__lvccDrag;const fire=(type,clientX)=>edge.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:7,isPrimary:true,button:0,buttons:type==='pointerup'?0:1,clientX,clientY:y}));if(${press})fire('pointerdown',x);let last=0;for(const step of ${JSON.stringify(steps)}){last=step;fire('pointermove',x+step);await new Promise(r=>requestAnimationFrame(r));}if(${release}){fire('pointerup',x+last);delete window.__lvccDrag;}return true;})()`,
      );
    // My Library with the card 400px wide, and its first paper selected.
    await obEval(
      run.vaultId,
      `(async()=>{${PAGE}app.workspace.getLeavesOfType('zotlit-library').forEach(leaf=>leaf.detach());const {settings,bridge}=${services};bridge.runSync(settings.update({'library.document':${JSON.stringify({ ...MY_LIBRARY_DOCUMENT, cardWidth: 400 })},'welcome.dismissed':true,'welcome.requested':false}));await bridge.runPromise(settings.flush);await app.commands.executeCommandById('zotlit:open-library-view');const leaf=app.workspace.getLeavesOfType('zotlit-library')[0];await app.workspace.revealLeaf(leaf);app.workspace.setActiveLeaf(leaf,{focus:true});const el=leaf.view.contentEl;const row=await until('rows',()=>el.querySelector('[data-query-item-row]'),20000);press(row,'first paper');await until('card',()=>{const card=el.querySelector('[data-library-card]');return !card.hidden&&card.checkVisibility();},5000);return true;})()`,
    );
    const first = await rowKey(0);
    const second = await rowKey(1);
    const open = await closedWhen((shown) => shown.shown);
    expect(open).toMatchObject({ width: 400, selected: first, closed: null });

    // The close button shows on the wide pane too; it hides the card, the
    // list takes its room, and the row keeps the selection and the focus.
    await obEval(
      run.vaultId,
      `(async()=>{${PAGE}press(${view}.contentEl.querySelector('[data-library-card] [data-library-card-close]'),'close button');return true;})()`,
    );
    const closed = await closedWhen((shown) => shown.closed === true);
    expect(closed).toMatchObject({
      shown: false,
      selected: first,
      focused: first,
      stored: 400,
    });
    expect(closed.list).toBe(open.list + open.width);
    await screenshot("wide-closed");

    // The arrow keys move the selection and leave the card closed.
    await obEval(
      run.vaultId,
      "activeDocument.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));true",
    );
    expect(
      await closedWhen((shown) => shown.selected === second),
    ).toMatchObject({ shown: false, closed: true });

    // A reload keeps it closed beside the restored selection.
    await closedWhen((shown) => shown.kept === second);
    await reloadWindow();
    expect(
      await closedWhen(
        (shown) => shown.phase === "ready" && shown.selected === second,
      ),
    ).toMatchObject({ shown: false, closed: true, stored: 400 });

    // A click on a row opens it again, at its width.
    await clickRow(1);
    expect(await closedWhen((shown) => shown.shown)).toMatchObject({
      width: 400,
      closed: null,
    });

    // A drag 300px away from the list takes the card 156px under its
    // 288px minimum, past the 144px that collapses it while the pointer
    // stays; back within the threshold it shows again at the minimum.
    await drag([100, 200, 300], { release: false });
    expect(await closedWhen((shown) => !shown.shown)).toMatchObject({
      closed: null,
      stored: 400,
    });
    await screenshot("mid-drag-collapsed");
    await drag([200], { press: false, release: false });
    expect(await closedWhen((shown) => shown.shown)).toMatchObject({
      width: 288,
    });
    // Let go past the threshold, it closes and keeps the width it had.
    await drag([300], { press: false });
    expect(await closedWhen((shown) => shown.closed === true)).toMatchObject({
      shown: false,
      stored: 400,
      focused: second,
    });
    await clickRow(1);
    expect(await closedWhen((shown) => shown.shown)).toMatchObject({
      width: 400,
      closed: null,
    });

    // Escape during a collapsed drag puts the card and its width back.
    await drag([100, 200, 300], { release: false });
    await closedWhen((shown) => !shown.shown);
    await obEval(
      run.vaultId,
      "activeDocument.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));delete window.__lvccDrag;true",
    );
    expect(await closedWhen((shown) => shown.shown)).toMatchObject({
      width: 400,
      stored: 400,
      closed: null,
    });
  });

  it("draws My Library as two-line Papers with the seeded Literature Notes and Attachment kinds and Sort and Save as query file in its heading, and expands a paper into its seeded Attachments, Child Notes and Annotations that open their targets, with Zotero closed", async () => {
    const layout = await obEval(
      run.vaultId,
      "JSON.stringify(app.workspace.getLayout())",
    );
    const stored = await obEval(
      run.vaultId,
      "JSON.stringify(app.plugins.plugins.zotlit.services.bridge.runSync(app.plugins.plugins.zotlit.services.settings.current)['library.document'])",
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obEval(
        run.vaultId,
        `(async()=>{const {settings,bridge}=app.plugins.plugins.zotlit.services;bridge.runSync(settings.update({'library.document':${stored}}));await bridge.runPromise(settings.flush);await app.workspace.changeLayout(JSON.parse(${JSON.stringify(layout)}));return true;})()`,
      );
    });
    // My Library on the Papers Layout, which a new Library View opens on
    // (the Recent case checks that default).
    await obEval(
      run.vaultId,
      `(async()=>{app.workspace.getLeavesOfType('zotlit-library').forEach(leaf=>leaf.detach());const {settings,bridge}=app.plugins.plugins.zotlit.services;bridge.runSync(settings.update({'library.document':${JSON.stringify(MY_LIBRARY_DOCUMENT)}}));await bridge.runPromise(settings.flush);return true;})()`,
    );

    /** What the Library View shows once its query settled, or `null` while no tab holds it. */
    const readPapers = `(async()=>{const view=app.workspace.getLeavesOfType('zotlit-library')[0]?.view;if(!view?.query)return 'null';await view.query.settled;const el=view.contentEl;const state=view.query.state.getState();const text=(n,s)=>n.querySelector(s)?.textContent??null;return JSON.stringify({phase:state.phase,layout:el.querySelector('[data-query-layout]')?.getAttribute('data-query-layout')??null,toolbar:[...el.querySelectorAll('[role="toolbar"] > button')].map(n=>n.getAttribute('data-query-toolbar')??[...n.attributes].map(a=>a.name).find(a=>a.startsWith('data-query-'))??null),count:el.querySelector('[data-query-count]')?.getAttribute('data-query-count')??null,papers:[...el.querySelectorAll('[data-query-papers-row]')].map(n=>({key:n.getAttribute('data-query-papers-row'),title:text(n,'[data-query-papers-title]'),meta:text(n,'[data-query-papers-meta]'),lines:n.querySelector('[data-query-papers-title]').parentElement.childElementCount,attachment:n.querySelector('[data-query-papers-attachment]')?.getAttribute('data-query-papers-attachment')??null,note:n.querySelector('[data-query-papers-note]')!==null,children:[...n.querySelectorAll('[data-query-papers-child]')].map(c=>[c.getAttribute('data-query-papers-child'),c.getAttribute('data-query-key')])})),tableRows:el.querySelectorAll('tr[data-query-table-row="item"]').length});})()`;
    interface Paper {
      key: string;
      title: string | null;
      meta: string | null;
      /** The lines of the row's text. */
      lines: number;
      attachment: string | null;
      note: boolean;
      children: [string, string | null][];
    }
    interface Papers {
      phase: string;
      layout: string | null;
      /** The toolbar's buttons, by their hook. */
      toolbar: (string | null)[];
      count: string | null;
      papers: Paper[];
      tableRows: number;
    }
    const papersWhen = (ready: (papers: Papers) => boolean) =>
      obReadUntil<Papers>(run.vaultId, readPapers, {
        ready,
        what: "Library View",
        tries: 120,
      });

    // The seed's My Library: each Item's Attachments, and the Literature
    // Note the Fixture Vault holds for every Item but the demo papers.
    const userLibrary = LIBRARIES.find(({ type }) => type === "user")!;
    const personal = ITEMS.filter(
      ({ libraryID }) => libraryID === userLibrary.libraryID,
    );
    const attachmentsOf = (item: FixtureItem) =>
      ATTACHMENTS.filter(({ parentItemID }) => parentItemID === item.itemID);
    /** The kind Zotero gives a file: a link to a page is a web page. */
    const kindOf = ({ linkMode, contentType }: (typeof ATTACHMENTS)[number]) =>
      linkMode === "linked_url"
        ? "web"
        : (
            {
              "application/pdf": "pdf",
              "application/epub+zip": "epub",
              "text/html": "web",
            } as Record<string, string>
          )[contentType];
    const expected = (item: FixtureItem) => {
      const kinds = new Set(attachmentsOf(item).map(kindOf));
      const note = !DEMO_ITEMS.includes(item);
      // The Literature Note shows as the note icon, not on the line.
      return {
        key: item.key,
        title: item.title,
        attachment:
          ["pdf", "epub", "web"].find((kind) => kinds.has(kind)) ?? null,
        note,
      };
    };

    await obEval(
      run.vaultId,
      "app.commands.executeCommandById('zotlit:open-library-view');true",
    );
    const opened = await papersWhen(
      (papers) =>
        papers.phase === "ready" &&
        papers.count !== null &&
        papers.papers.length === Number(papers.count),
    );
    // No view menu and no Properties menu: the full Query View is a
    // "Save as query file" away.
    expect(opened).toMatchObject({
      layout: "papers",
      toolbar: ["sort", "data-query-save-as"],
      count: String(personal.length),
    });
    expect(
      opened.papers
        .map(({ key, title, attachment, note }) => ({
          key,
          title,
          attachment,
          note,
        }))
        .toSorted((a, b) => a.key.localeCompare(b.key)),
    ).toEqual(
      personal.map(expected).toSorted((a, b) => a.key.localeCompare(b.key)),
    );
    // Each paper takes two lines at most, with no reading-state line.
    expect(opened.papers.every(({ lines }) => lines <= 2)).toBe(true);
    // The second line names the first creator, the year and the Venue.
    const missing = personal.flatMap((item) => {
      const meta = opened.papers.find(({ key }) => key === item.key)!.meta;
      return [
        item.creators[0]?.lastName,
        item.date.slice(0, 4),
        item.venue ?? item.publisher,
      ]
        .filter((part) => part !== undefined)
        .filter((part) => !meta?.includes(part))
        .map((part) => [item.key, part]);
    });
    expect(missing).toEqual([]);

    // A paper expands into its Attachments, its live Child Notes and its
    // Literature Note, and its PDF into its Annotations.
    const paper = annotationItem;
    const pdf = annotationAttachment;
    const live = NOTES.filter(
      (note) => note.parentItemID === paper.itemID && !note.trashed,
    );
    // Each gesture brings the Library View's tab to the front first: a link
    // it opened may stand in front of it.
    const inLibrary = (script: string) =>
      obEval(
        run.vaultId,
        `(async()=>{${PAGE}const leaf=app.workspace.getLeavesOfType('zotlit-library')[0];await app.workspace.revealLeaf(leaf);const el=leaf.view.contentEl;${script}})()`,
      );
    await inLibrary(
      `press(el.querySelector('[data-query-expand="item:${paper.key}"]'),'expand paper');return true`,
    );
    const childrenOf = (papers: Papers) =>
      papers.papers.find(({ key }) => key === paper.key)!.children;
    // The Literature Note row shows at once; the others once their query ran.
    const expanded = await papersWhen(
      (papers) =>
        childrenOf(papers).filter(([kind]) => kind === "attachment").length ===
        attachmentsOf(paper).length,
    );
    expect(childrenOf(expanded).at(-1)?.[0]).toBe("literature-note");
    expect(
      childrenOf(expanded)
        .filter(([kind]) => kind === "attachment")
        .map(([, key]) => key)
        .toSorted((a, b) => String(a).localeCompare(String(b))),
    ).toEqual(
      attachmentsOf(paper)
        .map(({ key }) => key)
        .toSorted((a, b) => String(a).localeCompare(String(b))),
    );
    expect(
      childrenOf(expanded)
        .filter(([kind]) => kind === "note")
        .map(([, key]) => key),
    ).toEqual(live.map(({ key }) => key));
    await inLibrary(
      `press(el.querySelector('[data-query-expand="attachment:${pdf.key}"]'),'expand PDF');return true`,
    );
    const pdfAnnotations = ANNOTATIONS.filter(
      ({ parentItemID }) => parentItemID === pdf.itemID,
    );
    const withAnnotations = await papersWhen(
      (papers) =>
        childrenOf(papers).filter(([kind]) => kind === "annotation").length ===
        pdfAnnotations.length,
    );
    expect(
      childrenOf(withAnnotations)
        .filter(([kind]) => kind === "annotation")
        .map(([, key]) => key)
        .toSorted((a, b) => String(a).localeCompare(String(b))),
    ).toEqual(
      pdfAnnotations
        .map(({ key }) => key)
        .toSorted((a, b) => String(a).localeCompare(String(b))),
    );

    // The PDF opens in Obsidian's reader, an Annotation at its page, and the
    // Literature Note in Obsidian.
    const child = (kind: string, key: string) =>
      `el.querySelector('[data-query-papers-row="${paper.key}"] [data-query-papers-child="${kind}"][data-query-key="${key}"] a')`;
    const pdfName = pdf.path!.split("/").pop()!;
    expect(
      await inLibrary(
        `press(${child("attachment", pdf.key)},'PDF link');return String(!!(await until('the PDF opens',()=>app.workspace.getLeavesOfType('pdf').find(l=>l.view.file?.name===${JSON.stringify(pdfName)}),10000)))`,
      ),
    ).toBe("true");
    const anchored = pdfAnnotations.find(
      (annotation) => "pageIndex" in annotation.position,
    )!;
    // A middle click opens a new tab, as the Table case does.
    expect(
      JSON.parse(
        await inLibrary(
          annotationOpenSubpath(
            `const link=${child("annotation", anchored.key)};link.dispatchEvent(new link.ownerDocument.defaultView.MouseEvent('auxclick',{bubbles:true,cancelable:true,button:1}));`,
          ),
        ),
      ),
    ).toEqual(
      annotationOpenKeys({
        page: (anchored.position as { pageIndex: number }).pageIndex + 1,
        annotation: anchored.key,
        attachment: pdf.key,
      }),
    );

    expect(
      await inLibrary(
        `const link=el.querySelector('[data-query-papers-row="${paper.key}"] [data-query-papers-child="literature-note"] [data-query-note]');press(link,'Literature Note link');const path=link.getAttribute('data-query-note');return String(!!(await until('the Literature Note opens',()=>app.workspace.getLeavesOfType('markdown').find(l=>l.view.file?.path===path),10000)))`,
      ),
    ).toBe("true");

    // An Item with Child Notes lists its live ones, and a Child Note opens
    // in Zotero through its link.
    const noted = ITEMS.find(({ itemID }) => itemID === 1)!;
    const notes = NOTES.filter(
      (note) => note.parentItemID === noted.itemID && !note.trashed,
    );
    expect(notes.length, "the Fixture Item has a live Child Note").toBe(1);
    await inLibrary(
      `press(el.querySelector('[data-query-expand="item:${noted.key}"]'),'expand noted paper');return true`,
    );
    const withNotes = await papersWhen(
      (papers) =>
        papers.papers
          .find(({ key }) => key === noted.key)!
          .children.filter(([kind]) => kind === "note").length === notes.length,
    );
    expect(
      withNotes.papers
        .find(({ key }) => key === noted.key)!
        .children.filter(([kind]) => kind === "note")
        .map(([, key]) => key),
    ).toEqual(notes.map(({ key }) => key));
    expect(
      await inLibrary(
        `const native=window.open;let opened=null;window.open=url=>{opened=String(url);return null;};try{press(el.querySelector('[data-query-papers-row="${noted.key}"] [data-query-papers-child="note"][data-query-key="${notes[0]!.key}"] a'),'Child Note link');return await until('Zotero shows the note',()=>opened,10000);}finally{window.open=native;}`,
      ),
    ).toBe(`zotero://select/library/items/${notes[0]!.key}`);
  }, 180000);

  it("scrolls the Library View's rows alone, under a search box and a heading that stay put, keeps each row's trailing icons clear of the scrollbar, and keeps a row the arrow keys select in view under them, on a wide and a narrow pane", async () => {
    const services = "app.plugins.plugins.zotlit.services";
    const snapshot = await obEval(
      run.vaultId,
      `JSON.stringify({layout:app.workspace.getLayout(),document:${services}.bridge.runSync(${services}.settings.current)['library.document']??null})`,
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obEval(
        run.vaultId,
        `(async()=>{const saved=JSON.parse(${JSON.stringify(snapshot)});const {settings,bridge}=${services};bridge.runSync(settings.update({'library.document':saved.document}));await bridge.runPromise(settings.flush);await app.workspace.changeLayout(saved.layout);return true;})()`,
      );
    });
    // My Library: more papers than the pane holds.
    await suite.wideWindow(cleanup);
    await obEval(
      run.vaultId,
      `(async()=>{${PAGE}app.workspace.getLeavesOfType('zotlit-library').forEach(leaf=>leaf.detach());const {settings,bridge}=${services};bridge.runSync(settings.update({'library.document':${JSON.stringify(MY_LIBRARY_DOCUMENT)}}));await bridge.runPromise(settings.flush);app.commands.executeCommandById('zotlit:open-library-view');await until('library',()=>app.workspace.getLeavesOfType('zotlit-library')[0]);return true;})()`,
    );

    interface Pane {
      /** Whether the rows overflow the list, so there is a scroll to test. */
      overflows: boolean;
      /** How far the list scrolled. */
      scrolled: number;
      /** The on-screen tops of the search box and the heading, before and after the scroll. */
      tops: { before: number[]; after: number[] };
      /** The room between the rows' rightmost icon and the list's edges, in px. */
      icon: { toClient: number; toEdge: number };
      /** Obsidian's scrollbar width, in px. */
      scrollbar: number;
      /** The row the arrow keys selected, against the list and the heading. */
      moved: {
        up: { selected: boolean; inList: boolean; underToolbar: boolean };
        down: { selected: boolean; inList: boolean; underToolbar: boolean };
      };
    }
    /** Lay the tab out `width` px wide, scroll its list, and move the selection with the arrow keys. */
    const measure = async (width: number) =>
      JSON.parse(
        await obEval(
          run.vaultId,
          `(async()=>{${PAGE}const leaf=app.workspace.getLeavesOfType('zotlit-library')[0];await app.workspace.revealLeaf(leaf);app.workspace.setActiveLeaf(leaf,{focus:true});await leaf.view.query.settled;const el=leaf.view.contentEl;const width=el.style.width;el.style.width='${width}px';const frame=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));try{await until('rows',()=>el.querySelectorAll('[data-query-papers-row]').length>10,10000);await frame();const list=el.querySelector('[data-query-layout]');const input=el.querySelector('[data-library-search] input');const toolbar=el.querySelector('[data-library-heading]');const tops=()=>[input,toolbar].map(n=>n.getBoundingClientRect().top);list.scrollTop=0;await frame();const before=tops();list.scrollTop=list.scrollHeight;await frame();const after=tops();const scrolled=list.scrollTop;const box=list.getBoundingClientRect();const clientRight=box.left+list.clientLeft+list.clientWidth;const iconRight=Math.max(...[...list.querySelectorAll('[data-query-papers-note],[data-query-papers-attachment]')].filter(n=>n.checkVisibility()).map(n=>n.getBoundingClientRect().right));const rows=()=>[...list.querySelectorAll('[data-query-item-row]')];const place=row=>{const r=row.getBoundingClientRect();const b=list.getBoundingClientRect();return{selected:row.hasAttribute('data-selected'),inList:r.top>=b.top-0.5&&r.bottom<=b.bottom+0.5,underToolbar:r.top>=toolbar.getBoundingClientRect().bottom-0.5};};const arrow=async(key,from,to)=>{const start=rows()[from];leaf.view.card.registry.set(leaf.view.model.selection,{key:start.getAttribute('data-query-item-row'),card:false});await until('row selected',()=>start.hasAttribute('data-selected'));start.focus({preventScroll:true});list.scrollTop=key==='ArrowDown'?list.scrollHeight:0;await frame();activeDocument.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}));await until('selection moves',()=>rows()[to].hasAttribute('data-selected'));await frame();return place(rows()[to]);};const n=rows().length;const down=await arrow('ArrowDown',0,1);const up=await arrow('ArrowUp',n-1,n-2);leaf.view.card.registry.set(leaf.view.model.selection,{key:null,card:false});return JSON.stringify({overflows:list.scrollHeight>list.clientHeight,scrolled,tops:{before,after},icon:{toClient:clientRight-iconRight,toEdge:box.right-iconRight},scrollbar:parseFloat(getComputedStyle(document.body).getPropertyValue('--scrollbar-width')),moved:{down,up}});}finally{el.style.width=width;}})()`,
        ),
      ) as Pane;

    for (const width of [1600, 528]) {
      const pane = await measure(width);
      expect(pane.overflows, `${width}px`).toBe(true);
      expect(pane.scrolled, `${width}px`).toBeGreaterThan(0);
      // The search box and the heading keep their place as the rows scroll.
      expect(pane.tops.after, `${width}px`).toEqual(pane.tops.before);
      // The rows' icons end inside the list's client box, and at least a
      // scrollbar's width short of its edge, so neither an overlay
      // scrollbar nor one that takes room draws over them.
      expect(pane.icon.toClient, `${width}px`).toBeGreaterThan(0);
      expect(pane.icon.toEdge, `${width}px`).toBeGreaterThanOrEqual(
        pane.scrollbar,
      );
      // ArrowDown from a row scrolled off the top, and ArrowUp from one
      // scrolled off the bottom, bring the row they select whole into the
      // list, under the heading.
      const whole = { selected: true, inList: true, underToolbar: true };
      expect(pane.moved, `${width}px`).toEqual({ down: whole, up: whole });
    }
  }, 120000);

  it("expands a row of the Library View, in a tab and in the sidebar, and of a Query File's Papers and Table, in one step whether ZotLit Query answers at once or late, with no row drawn again or over another, with Zotero closed", async () => {
    const services = "app.plugins.plugins.zotlit.services";
    const path = "query-files/Expanding.zotquery";
    const snapshot = await obEval(
      run.vaultId,
      `JSON.stringify({layout:app.workspace.getLayout(),document:${services}.bridge.runSync(${services}.settings.current)['library.document']??null})`,
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obEval(
        run.vaultId,
        `(async()=>{const saved=JSON.parse(${JSON.stringify(snapshot)});const {settings,bridge}=${services};bridge.runSync(settings.update({'library.document':saved.document}));await bridge.runPromise(settings.flush);await app.workspace.changeLayout(saved.layout);const file=app.vault.getFileByPath(${JSON.stringify(path)});if(file)await app.vault.delete(file);return true;})()`,
      );
    });
    await suite.wideWindow(cleanup);

    // A book with a Literature Note and nothing in Zotero under it, and a
    // paper with Attachments, a Child Note and its Literature Note.
    const noteOnly = ITEMS.find(({ key }) => key === "NW2CPDTC")!;
    expect(
      ATTACHMENTS.some(({ parentItemID }) => parentItemID === noteOnly.itemID),
    ).toBe(false);
    expect(
      NOTES.some(
        ({ parentItemID, trashed }) =>
          parentItemID === noteOnly.itemID && !trashed,
      ),
    ).toBe(false);
    const paper = annotationItem;

    interface Expansion {
      /** The row's `aria-expanded` once the frames are taken. */
      expanded: string | null;
      /** Per animation frame, from just before the click on: the Item rows, the next one's offset from the expanded one, the rows over another, the rows being read. */
      frames: {
        rows: number;
        /** The height of the expanded row's own element: a Papers row holds its children. */
        height: number;
        next: number | null;
        overlaps: number;
        status: number;
        /** The opacity of the "Loading…" text, while a row is read. */
        loading: string | null;
      }[];
      /** The Item rows the expansion took out of the page. */
      removed: string[];
      /** Attachment reads sent after the worker delay elapsed. */
      delayedReads: number;
    }
    /** An Item row to expand: the view that shows it, its rows, and its key. */
    interface Target {
      view: string;
      rowSelector: string;
      item: string;
    }
    /**
     * Click the expander of the target's Item, with its attachment request
     * held at the worker boundary for `delay` ms, and read each frame until half
     * a second after that.
     */
    const expand = async (
      { view, rowSelector, item }: Target,
      delay: number,
    ) => {
      const expansion = JSON.parse(
        await obEval(
          run.vaultId,
          `(async()=>{${PAGE}const view=${view};await app.workspace.revealLeaf(view.leaf);await view.query.settled;const el=view.contentEl;const rowSel=${JSON.stringify(rowSelector)};const button=await until('expander',()=>el.querySelector('[data-query-expand="item:${item}"]'),10000);const frame=()=>new Promise(r=>requestAnimationFrame(r));button.scrollIntoView({block:'center',behavior:'instant'});await stands(button,'expander');await frame();await frame();const rows=()=>[...el.querySelectorAll(rowSel)];const own=button.closest(rowSel);const at=rows().indexOf(own);const removed=[];const observer=new MutationObserver(records=>{for(const record of records)for(const n of record.removedNodes)if(n.nodeType===1&&(n.matches(rowSel)||n.querySelector(rowSel)))removed.push(n.getAttribute('data-query-papers-row')??n.getAttribute('data-query-key')??n.nodeName);});observer.observe(el,{childList:true,subtree:true});const frames=[];const take=()=>{const list=rows();const boxes=list.map(n=>n.getBoundingClientRect());const box=own.getBoundingClientRect();const top=box.top;frames.push({rows:list.length,height:Math.round(box.height),next:list[at+1]?Math.round(boxes[at+1].top-top):null,overlaps:boxes.filter((b,i)=>i>0&&b.top<boxes[i-1].bottom-0.5).length,status:el.querySelectorAll('[data-query-table-status]').length,loading:(()=>{const text=el.querySelector('[data-query-loading]');return text?getComputedStyle(text).opacity:null;})()});};const post=Worker.prototype.postMessage;const pending=new Map();let delayedReads=0;if(${delay}>0)Worker.prototype.postMessage=function(...args){const request=args[0]?.[1];const query=request?.tag==='ItemQuery'?request.payload.job.view:null;const target=${JSON.stringify(item)};if(!query||query.from!=='attachments'||query.filter!=='item.indexedKey == '+JSON.stringify(target))return post.apply(this,args);const worker=this;const send=()=>post.apply(worker,args);const timer=setTimeout(()=>{pending.delete(timer);delayedReads++;send();},${delay});pending.set(timer,send);};let expanded=null;try{take();press(button,'expander');take();const start=performance.now();while(performance.now()-start<${delay}+500){await frame();take();}expanded=button.getAttribute('aria-expanded');}finally{Worker.prototype.postMessage=post;for(const [timer,send] of pending){clearTimeout(timer);send();}observer.disconnect();}press(button,'collapse');return JSON.stringify({expanded,frames,removed,delayedReads});})()`,
        ),
      ) as Expansion;
      expect(
        expansion.delayedReads > 0,
        "the expansion attachment read crosses the delayed worker boundary when requested",
      ).toBe(delay > 0 && item !== noteOnly.key);
      return expansion;
    };
    /**
     * The expansion draws the closed row, then the open one: the rows under
     * it move once, straight to where the open row puts them, and none is
     * drawn again or over another.
     */
    const oneStep = (what: string, expansion: Expansion) => {
      expect.soft(expansion.expanded, what).toBe("true");
      expect.soft(expansion.removed, what).toEqual([]);
      const { frames } = expansion;
      expect.soft(new Set(frames.map(({ rows }) => rows)).size, what).toBe(1);
      expect
        .soft(
          frames.filter(({ overlaps }) => overlaps > 0),
          what,
        )
        .toEqual([]);
      expect.soft(frames[0]!.next, what).not.toBeNull();
      // The row under it moves once: from under the closed row to under
      // the open one.
      expect
        .soft([...new Set(frames.map(({ next }) => next))], what)
        .toHaveLength(2);
      expect
        .soft(new Set(frames.map(({ height }) => height)).size, what)
        .toBeLessThanOrEqual(2);
    };

    /**
     * Expand the target with ZotLit Query answering at once, then with it
     * held 400 ms. A row with rows to read shows them being read in the
     * late case, in the room they take; the note-only row reads nothing.
     */
    const expandEach = async (what: string, target: Target) => {
      oneStep(`${what}, fast read`, await expand(target, 0));
      const late = await expand(target, 400);
      oneStep(`${what}, slow read`, late);
      expect
        .soft(
          late.frames.some(({ status }) => status > 0),
          `${what}, slow read`,
        )
        .toBe(target.item !== noteOnly.key);
      // Its "Loading…" text shows only once the read has taken a while.
      const loading = late.frames.flatMap(({ loading }) =>
        loading === null ? [] : [loading],
      );
      expect
        .soft([loading[0], loading.at(-1)], `${what}, slow read`)
        .toEqual(
          target.item === noteOnly.key ? [undefined, undefined] : ["0", "1"],
        );
    };

    // The Library View in a tab, on Papers.
    await obEval(
      run.vaultId,
      `(async()=>{${PAGE}app.workspace.getLeavesOfType('zotlit-library').forEach(leaf=>leaf.detach());const {settings,bridge}=${services};bridge.runSync(settings.update({'library.document':${JSON.stringify(MY_LIBRARY_DOCUMENT)}}));await bridge.runPromise(settings.flush);app.commands.executeCommandById('zotlit:open-library-view');await until('library',()=>app.workspace.getLeavesOfType('zotlit-library')[0],10000);return true;})()`,
    );
    const library = "app.workspace.getLeavesOfType('zotlit-library')[0].view";
    const papersRow = "li[data-query-papers-row]";
    await expandEach("Library View tab, note only", {
      view: library,
      rowSelector: papersRow,
      item: noteOnly.key,
    });
    await expandEach("Library View tab, Attachments", {
      view: library,
      rowSelector: papersRow,
      item: paper.key,
    });

    // The Library View in the sidebar.
    await obEval(
      run.vaultId,
      `(async()=>{app.workspace.getLeavesOfType('zotlit-library').forEach(leaf=>leaf.detach());const leaf=app.workspace.getRightLeaf(false);await leaf.setViewState({type:'zotlit-library',active:true});app.workspace.rightSplit.expand();await app.workspace.revealLeaf(leaf);return true;})()`,
    );
    await expandEach("Library View sidebar, note only", {
      view: library,
      rowSelector: papersRow,
      item: noteOnly.key,
    });
    await expandEach("Library View sidebar, Attachments", {
      view: library,
      rowSelector: papersRow,
      item: paper.key,
    });

    // A Query File tab on Papers, then on the Table.
    for (const layout of ["papers", "table"]) {
      await obEval(
        run.vaultId,
        `(async()=>{const old=app.vault.getFileByPath(${JSON.stringify(path)});if(old)await app.vault.delete(old);const file=await app.vault.create(${JSON.stringify(path)},${JSON.stringify(
          [
            "views:",
            `  - type: ${layout}`,
            "    name: Mine",
            "    from: items",
            '    filters: library == "personal"',
            "    limit: 100",
            "",
          ].join("\n"),
        )});const leaf=app.workspace.getLeaf('tab');await leaf.openFile(file);app.workspace.setActiveLeaf(leaf,{focus:true});return true;})()`,
      );
      const tab = `app.workspace.getLeavesOfType('zotlit-query-file').find(leaf=>leaf.view.file?.path===${JSON.stringify(path)}).view`;
      await expandEach(`Query File ${layout}, Attachments`, {
        view: tab,
        rowSelector:
          layout === "papers" ? papersRow : 'tr[data-query-table-row="item"]',
        item: paper.key,
      });
    }
  }, 180000);
});
