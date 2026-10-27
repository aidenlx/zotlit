import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { WorkspaceLeaf, MarkdownView, PDFFileView } from "obsidian";
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

import type { StoredLibraryViewDocument } from "@/views/library/document";
import type { LibraryView } from "@/views/library/view";
import type { QueryFileView } from "@/views/query-view/file-view";

import { annotationOpenKeys } from "./annotation-open-subpath.ts";
import { prepareRunWindow } from "./background-throttling.ts";
import { reachable } from "./e2e-run-fixture.ts";
import {
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
import { obRun, obRunUntil } from "./obsidian-cli.ts";
import { cli } from "./obsidian-cli.ts";
import type { LibraryLeaf } from "./page-library-types.ts";
import type { LibraryWorkerMessage } from "./page-library-types.ts";
import type {} from "./page-library-types.ts";
import { verifyPdfReads } from "./pdf-reads.ts";
import { verifyRecentUses } from "./recent-uses.ts";

describe.skipIf(!reachable)("End-to-end Run", () => {
  registerEndToEndRunHooks();

  it("opens the Library View from the ribbon and the command, lists My Library newest first, and keeps a sort change across a plugin reload, with Zotero closed", async () => {
    const layout = await obRun(
      run.vaultId,
      async ({ app }) => {
        return String(JSON.stringify(app.workspace.getLayout()));
      },
      undefined,
    );
    const stored = await obRun(
      run.vaultId,
      async ({ zotlit }) => {
        return zotlit.services.bridge.runSync(zotlit.services.settings.current)[
          "library.document"
        ] as StoredLibraryViewDocument | null;
      },
      undefined,
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obRun(
        run.vaultId,
        async ({ app, zotlit }, { stored, layout }) => {
          const { settings, bridge } = zotlit.services;
          bridge.runSync(settings.update({ "library.document": stored }));
          await bridge.runPromise(settings.flush);
          await app.workspace.changeLayout(JSON.parse(layout));
          return String(true);
        },
        { stored: stored, layout: layout },
      );
    });
    // The view opens on My Library; a new view's Recent has a case of its own.
    await obRun(
      run.vaultId,
      async ({ app, zotlit }, { myLibraryDocument }) => {
        (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        ).forEach((leaf) => leaf.detach());
        const { settings, bridge } = zotlit.services;
        bridge.runSync(
          settings.update({ "library.document": myLibraryDocument }),
        );
        await bridge.runPromise(settings.flush);
        return String(true);
      },
      { myLibraryDocument: MY_LIBRARY_DOCUMENT },
    );

    /** What the Library View shows once its query settled, or `null` while no tab holds it. */

    interface Library {
      leaves: number;
      active: string | null;
      title: string;
      phase: string;
      failure: string | null;
      count: string | null;
      rows: string[];
    }

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
    await obRun(
      run.vaultId,
      async ({ page }, { value }) => {
        const { press } = page;
        press(
          document.querySelector<HTMLElement>(value),
          "Library View ribbon icon",
        );
        return String(true);
      },
      {
        value: `.side-dock-ribbon-action[aria-label="${run.m.command_open_library_view_name()}"]`,
      },
    );
    /** Whether the Layout drew every row the count names. */
    const drawn = (library: Library) =>
      library.phase === "ready" &&
      library.count !== null &&
      library.rows.length === Number(library.count);
    const opened = await obRunUntil(
      run.vaultId,
      async ({ app }) => {
        const leaves = app.workspace.getLeavesOfType(
          "zotlit-library",
        ) as (WorkspaceLeaf & { view: LibraryView })[];
        const view = leaves[0]?.view;
        if (!view?.query) return null;
        await view.query.settled;
        const el = view.contentEl;
        const state = view.query.state.getState();
        return {
          leaves: leaves.length,
          active: app.workspace.getMostRecentLeaf()?.view.getViewType() ?? null,
          title: view.getDisplayText(),
          phase: state.phase,
          failure: state.failure?.diagnostic.code ?? null,
          count:
            el
              .querySelector<HTMLElement>("[data-query-count]")
              ?.getAttribute("data-query-count") ?? null,
          rows: [
            ...el.querySelectorAll<HTMLElement>(
              'tr[data-query-table-row="item"], [data-query-papers-row]',
            ),
          ].map(
            (n) =>
              n.getAttribute("data-query-key")! ??
              n.getAttribute("data-query-papers-row")!,
          ),
        };
      },
      undefined,
      {
        what: "Library View",
        tries: 120,
        ready: (value) => value !== null && drawn(value),
      },
    );
    expect(opened).toMatchObject({
      leaves: 1,
      active: "zotlit-library",
      title: run.m.library_view_name(),
      failure: null,
    });
    expectSeedOrder(opened!, -1);
    // The ribbon icon and the tab draw the 16-unit mark, both inks in the
    // icon's one color.
    const icons = JSON.parse(
      await obRun(
        run.vaultId,
        async ({ app }, { value }) => {
          return String(
            JSON.stringify(
              [
                document.querySelector<HTMLElement>(value),
                (
                  (
                    app.workspace.getLeavesOfType(
                      "zotlit-library",
                    ) as (WorkspaceLeaf & { view: LibraryView })[]
                  )[0]! as LibraryLeaf & { view: LibraryView }
                ).tabHeaderInnerIconEl.querySelector<HTMLElement>("svg"),
              ].map((svg) => {
                const g = svg?.querySelector<HTMLElement>("g");
                return (
                  g && {
                    transform: g.getAttribute("transform"),
                    fill: g.getAttribute("fill"),
                    paths: [...g.querySelectorAll<HTMLElement>("path")].map(
                      (p) => p.getAttribute("d"),
                    ),
                  }
                );
              }),
            ),
          );
        },
        {
          value: `.side-dock-ribbon-action[aria-label="${run.m.command_open_library_view_name()}"] svg`,
        },
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
    for (const invoke of ["command", "ribbon"] as const) {
      await obRun(
        run.vaultId,
        async ({ app }) => {
          await app.workspace
            .getLeaf("tab")
            .openFile(app.vault.getMarkdownFiles()[0]!);
          return String(true);
        },
        undefined,
      );
      expect(
        (await obRunUntil(
          run.vaultId,
          async ({ app }) => {
            const leaves = app.workspace.getLeavesOfType(
              "zotlit-library",
            ) as (WorkspaceLeaf & { view: LibraryView })[];
            const view = leaves[0]?.view;
            if (!view?.query) return null;
            await view.query.settled;
            const el = view.contentEl;
            const state = view.query.state.getState();
            return {
              leaves: leaves.length,
              active:
                app.workspace.getMostRecentLeaf()?.view.getViewType() ?? null,
              title: view.getDisplayText(),
              phase: state.phase,
              failure: state.failure?.diagnostic.code ?? null,
              count:
                el
                  .querySelector<HTMLElement>("[data-query-count]")
                  ?.getAttribute("data-query-count") ?? null,
              rows: [
                ...el.querySelectorAll<HTMLElement>(
                  'tr[data-query-table-row="item"], [data-query-papers-row]',
                ),
              ].map(
                (n) =>
                  n.getAttribute("data-query-key")! ??
                  n.getAttribute("data-query-papers-row")!,
              ),
            };
          },
          undefined,
          {
            what: "Library View",
            tries: 120,
            ready: (value) =>
              value !== null &&
              ((library) => library.active !== "zotlit-library")(value),
          },
        ))!.leaves,
      ).toBe(1);
      await obRun(
        run.vaultId,
        ({ app, page }, { invoke, ribbonLabel }) => {
          if (invoke === "command")
            app.commands.executeCommandById("zotlit:open-library-view");
          else
            page.press(
              document.querySelector<HTMLElement>(
                `.side-dock-ribbon-action[aria-label="${ribbonLabel}"]`,
              ),
              "Library View ribbon icon",
            );
          return "true";
        },
        { invoke, ribbonLabel: run.m.command_open_library_view_name() },
      );
      expect(
        await obRunUntil(
          run.vaultId,
          async ({ app }) => {
            const leaves = app.workspace.getLeavesOfType(
              "zotlit-library",
            ) as (WorkspaceLeaf & { view: LibraryView })[];
            const view = leaves[0]?.view;
            if (!view?.query) return null;
            await view.query.settled;
            const el = view.contentEl;
            const state = view.query.state.getState();
            return {
              leaves: leaves.length,
              active:
                app.workspace.getMostRecentLeaf()?.view.getViewType() ?? null,
              title: view.getDisplayText(),
              phase: state.phase,
              failure: state.failure?.diagnostic.code ?? null,
              count:
                el
                  .querySelector<HTMLElement>("[data-query-count]")
                  ?.getAttribute("data-query-count") ?? null,
              rows: [
                ...el.querySelectorAll<HTMLElement>(
                  'tr[data-query-table-row="item"], [data-query-papers-row]',
                ),
              ].map(
                (n) =>
                  n.getAttribute("data-query-key")! ??
                  n.getAttribute("data-query-papers-row")!,
              ),
            };
          },
          undefined,
          {
            what: "Library View",
            tries: 120,
            ready: (value) =>
              value !== null &&
              ((library) => library.active === "zotlit-library")(value),
          },
        ),
      ).toMatchObject({ leaves: 1 });
    }

    // The Sort popover turns the order to oldest change first, and plugin
    // data keeps it as the Library View Document's sort.

    await obRun(
      run.vaultId,
      async ({ app, page }) => {
        const { press, until, pick } = page;
        const el = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]!.view.contentEl;
        press(
          el.querySelector<HTMLElement>('[data-query-toolbar="sort"]'),
          "Sort",
        );
        await pick(
          await until("sort direction", () =>
            el.querySelector<HTMLButtonElement | HTMLSelectElement>(
              '[data-query-popover="sort"] [data-sort-direction]',
            ),
          ),
          "ASC",
          "sort direction",
        );
        return String(true);
      },
      undefined,
    );
    expectSeedOrder(
      (await obRunUntil(
        run.vaultId,
        async ({ app }) => {
          const leaves = app.workspace.getLeavesOfType(
            "zotlit-library",
          ) as (WorkspaceLeaf & { view: LibraryView })[];
          const view = leaves[0]?.view;
          if (!view?.query) return null;
          await view.query.settled;
          const el = view.contentEl;
          const state = view.query.state.getState();
          return {
            leaves: leaves.length,
            active:
              app.workspace.getMostRecentLeaf()?.view.getViewType() ?? null,
            title: view.getDisplayText(),
            phase: state.phase,
            failure: state.failure?.diagnostic.code ?? null,
            count:
              el
                .querySelector<HTMLElement>("[data-query-count]")
                ?.getAttribute("data-query-count") ?? null,
            rows: [
              ...el.querySelectorAll<HTMLElement>(
                'tr[data-query-table-row="item"], [data-query-papers-row]',
              ),
            ].map(
              (n) =>
                n.getAttribute("data-query-key")! ??
                n.getAttribute("data-query-papers-row")!,
            ),
          };
        },
        undefined,
        {
          what: "Library View",
          tries: 120,
          ready: (value) =>
            value !== null &&
            ((library) =>
              drawn(library) && library.rows[0] !== opened!.rows[0])(value),
        },
      ))!,
      1,
    );
    expect(
      await ((options: { expected: string; tries?: number }) =>
        obRunUntil(
          run.vaultId,
          async ({ zotlit }) => {
            return String(
              JSON.stringify(
                zotlit.services.bridge.runSync(
                  zotlit.services.settings.current,
                )["library.document"]?.sort,
              ),
            );
          },
          undefined,
          {
            ready: (value) => value === options.expected,
            tries: options.tries,
            what: "library-view.e2e.ts:196",
          },
        ).then(
          () => true,
          () => false,
        ))({
        expected: JSON.stringify([
          { property: "dateModified", direction: "ASC" },
        ]),
      }),
    ).toBe(true);

    // A plugin reload brings the tab back with the sort it kept.
    expect(
      await ((options: { expected: string; tries?: number }) =>
        obRunUntil(
          run.vaultId,
          async ({ app }) => {
            return String(
              await app.plugins
                .disablePlugin("zotlit")
                .then(function () {
                  return app.plugins.enablePlugin("zotlit");
                })
                .then(function () {
                  return true;
                }),
            );
          },
          undefined,
          {
            ready: (value) => value === options.expected,
            tries: options.tries,
            what: "library-view.e2e.ts:209",
          },
        ).then(
          () => true,
          () => false,
        ))({ expected: "true", tries: 20 }),
    ).toBe(true);
    const reloaded = await obRunUntil(
      run.vaultId,
      async ({ app }) => {
        const leaves = app.workspace.getLeavesOfType(
          "zotlit-library",
        ) as (WorkspaceLeaf & { view: LibraryView })[];
        const view = leaves[0]?.view;
        if (!view?.query) return null;
        await view.query.settled;
        const el = view.contentEl;
        const state = view.query.state.getState();
        return {
          leaves: leaves.length,
          active: app.workspace.getMostRecentLeaf()?.view.getViewType() ?? null,
          title: view.getDisplayText(),
          phase: state.phase,
          failure: state.failure?.diagnostic.code ?? null,
          count:
            el
              .querySelector<HTMLElement>("[data-query-count]")
              ?.getAttribute("data-query-count") ?? null,
          rows: [
            ...el.querySelectorAll<HTMLElement>(
              'tr[data-query-table-row="item"], [data-query-papers-row]',
            ),
          ].map(
            (n) =>
              n.getAttribute("data-query-key")! ??
              n.getAttribute("data-query-papers-row")!,
          ),
        };
      },
      undefined,
      {
        what: "Library View",
        tries: 120,
        ready: (value) => value !== null && drawn(value),
      },
    );
    expect(reloaded).toMatchObject({ leaves: 1, failure: null });
    expectSeedOrder(reloaded!, 1);
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
      await obRun(
        run.vaultId,
        async ({ zotlit }) => {
          activeDocument
            .querySelector<HTMLElement>(".prompt input")
            ?.dispatchEvent(
              new (activeWindow as Window & typeof globalThis).KeyboardEvent(
                "keydown",
                {
                  key: "Escape",
                  code: "Escape",
                  keyCode: 27,
                  which: 27,
                  bubbles: true,
                },
              ),
            );
          await zotlit.services.bridge.runPromise(
            zotlit.services.zoteroReads.refresh,
          );
          return String(true);
        },
        undefined,
      );
    });

    await obRun(
      run.vaultId,
      async ({ zotlit }) => {
        return String(
          JSON.stringify(
            (await zotlit.services.itemLookup.search("", { limit: 1 })).map(
              (hit) => hit.item.indexedKey,
            ),
          ),
        );
      },
      undefined,
    );
    sqlite
      .prepare("UPDATE itemAttachments SET lastRead = ? WHERE itemID = ?")
      .run(2208988800, attachment.itemID);
    expect(
      sqlite
        .prepare("SELECT dateModified FROM items WHERE itemID = ?")
        .get(readItem.itemID),
    ).toEqual(modified);
    await obRunUntil(
      run.vaultId,
      async ({ zotlit }) => {
        return (await zotlit.services.itemLookup.search("", { limit: 1 })).map(
          (hit) => hit.item.indexedKey,
        );
      },
      undefined,
      {
        what: "empty search to reflect the Zotero read",
        tries: 160,
        ready: (value) =>
          value !== null && ((keys) => keys[0] === readItem.key)(value),
      },
    );
    await obRun(
      run.vaultId,
      async ({ app }) => {
        app.commands.executeCommandById("zotlit:note-quick-switcher");
        return String(true);
      },
      undefined,
    );
    expect(
      await ((options: { expected: string; tries?: number }) =>
        obRunUntil(
          run.vaultId,
          async (_context, { readItemTitle }) => {
            return String(
              String(
                activeDocument
                  .querySelector<HTMLElement>(".prompt .suggestion-item")
                  ?.textContent.includes(readItemTitle),
              ),
            );
          },
          { readItemTitle: readItem.title },
          {
            ready: (value) => value === options.expected,
            tries: options.tries,
            what: "library-view.e2e.ts:267",
          },
        ).then(
          () => true,
          () => false,
        ))({ expected: "true" }),
    ).toBe(true);
  });

  it("opens a new Library View on Recent, lists the Library Scope newest activity first in rows of two lines at most, keeps the tree toggle beside the search box on a narrow pane, sorts that way again when Recent is selected again, and leaves Recent's own sort behind on a Collection", async () => {
    const snapshot = await obRun(
      run.vaultId,
      async ({ app, zotlit }, { libraryScopeSettingKey }) => {
        return String(
          JSON.stringify({
            layout: app.workspace.getLayout(),
            document:
              zotlit.services.bridge.runSync(zotlit.services.settings.current)[
                "library.document"
              ] ?? null,
            scope:
              zotlit.services.bridge.runSync(zotlit.services.settings.current)[
                libraryScopeSettingKey
              ] ?? null,
          }),
        );
      },
      { libraryScopeSettingKey: LIBRARY_SCOPE_SETTING_KEY },
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obRun(
        run.vaultId,
        async ({ app, zotlit }, { snapshot, libraryScopeSettingKey }) => {
          const saved = JSON.parse(snapshot);
          const { settings, bridge } = zotlit.services;
          bridge.runSync(
            settings.update({
              "library.document": saved.document,
              [libraryScopeSettingKey]: saved.scope,
            }),
          );
          await bridge.runPromise(settings.flush);
          await app.workspace.changeLayout(saved.layout);
          return String(true);
        },
        {
          snapshot: snapshot,
          libraryScopeSettingKey: LIBRARY_SCOPE_SETTING_KEY,
        },
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

    await obRun(
      run.vaultId,
      async ({ app, zotlit }, { libraryScopeSettingKey, document }) => {
        (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        ).forEach((leaf) => leaf.detach());
        const { settings, bridge } = zotlit.services;
        bridge.runSync(
          settings.update({
            "library.document": null,
            [libraryScopeSettingKey]: document,
          }),
        );
        await bridge.runPromise(settings.flush);
        return String(true);
      },
      {
        libraryScopeSettingKey: LIBRARY_SCOPE_SETTING_KEY,
        document: {
          mode: "selected",
          libraries: [personal, shared].map(({ groupID }) =>
            groupID === null
              ? { type: "personal" as const }
              : { type: "group" as const, groupID },
          ),
        },
      },
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
    const uses = await obRun(
      run.vaultId,
      async ({ zotlit }) => {
        return zotlit.services.bridge.runSync(zotlit.services.useLedger.uses);
      },
      undefined,
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

    /** Whether the list drew every row it counted, `count` of them. */
    const listing = (count: number) => (shown: Shown) =>
      shown.phase === "ready" &&
      shown.count === String(count) &&
      shown.rows.length === count;

    /** Press the tree node `key`; a narrow pane keeps the tree behind its button. */

    const size = (libraries: readonly (typeof personal)[]) =>
      ITEMS.filter((item) =>
        libraries.some(({ libraryID }) => libraryID === item.libraryID),
      ).length;

    // The new view opens on Recent: every Item of the Library Scope, newest
    // change first, under a heading that names Recent and counts its papers.
    await obRun(
      run.vaultId,
      async ({ app }) => {
        app.commands.executeCommandById("zotlit:open-library-view");
        return String(true);
      },
      undefined,
    );
    const opened = await obRunUntil(
      run.vaultId,
      async ({ app }) => {
        const view = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]?.view;
        if (!view?.tree) return null;
        await view.query.settled;
        await view.tree.settled;
        const el = view.contentEl;
        const rows = [
          ...el.querySelectorAll<HTMLElement>("[data-query-papers-row]"),
        ];
        const sort = el.querySelector<HTMLElement>(
          '[data-query-toolbar="sort"]',
        );
        return {
          sort: {
            set: sort?.hasAttribute("data-active") ?? false,
            text: sort?.textContent ?? null,
          },
          phase: view.query.state.getState().phase,
          header: ((h: Element | null) =>
            h
              ? ["[data-library-header]", "[data-library-header-count]"]
                  .map((s) => h.querySelector(s)?.textContent ?? "")
                  .filter((t) => t !== "")
                  .join(" | ")
              : null)(el.querySelector("[data-library-heading]")),
          recent: [
            ...el.querySelectorAll<HTMLElement>("[data-library-node]"),
          ].some(
            (n) =>
              JSON.parse(n.getAttribute("data-library-node")!)[0] ===
                "recent" && n.getAttribute("aria-selected") === "true",
          ),
          count:
            el
              .querySelector<HTMLElement>("[data-query-count]")
              ?.getAttribute("data-query-count") ?? null,
          rows: rows.map((n) => n.getAttribute("data-query-papers-row")!),
          lines: rows.map(
            (n) =>
              n.querySelector<HTMLElement>("[data-query-papers-title]")!
                .parentElement!.childElementCount,
          ),
        };
      },
      undefined,
      {
        what: "Library View",
        tries: 120,
        ready: (value) =>
          value !== null && listing(size([personal, shared]))(value),
      },
    );
    expect(opened).toMatchObject({
      recent: true,
      header: `${run.m.library_view_recent()} | ${run.m.library_view_heading_papers({ count: size([personal, shared]) })}`,
    });
    expectRecent(opened!, [personal, shared], -1);
    const reasons = await obRun(
      run.vaultId,
      async ({ app }) => {
        const view = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]!.view;
        return Object.fromEntries(
          [
            ...view.contentEl.querySelectorAll<HTMLElement>(
              "[data-query-papers-row]",
            ),
          ].map((row) => [
            row.getAttribute("data-query-papers-row")!,
            row.querySelector<HTMLElement>("[data-query-papers-title]")!
              .parentElement!.lastElementChild!.textContent,
          ]),
        );
      },
      undefined,
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
      await obRun(
        run.vaultId,
        async ({ zotlit }) => {
          return String(
            JSON.stringify(
              (await zotlit.services.itemLookup.search("", { limit: 500 })).map(
                (hit) => hit.item.indexedKey,
              ),
            ),
          );
        },
        undefined,
      ),
    );
    expect(emptySearch).toEqual(opened!.rows);

    // On a pane too narrow for the tree beside the list, Recent's tree
    // toggle sits beside the search box, not on a row of its own.
    const narrowRow = JSON.parse(
      await obRun(
        run.vaultId,
        async ({ app }) => {
          const el = (
            app.workspace.getLeavesOfType(
              "zotlit-library",
            ) as (WorkspaceLeaf & { view: LibraryView })[]
          )[0]!.view.contentEl;
          const width = el.style.width;
          el.style.width = "400px";
          try {
            const toggle = el.querySelector<HTMLElement>(
              "[data-library-tree-toggle]",
            );
            const input = el.querySelector<HTMLElement>(
              "[data-library-search] input",
            );
            const t = toggle!.getBoundingClientRect();
            const i = input!.getBoundingClientRect();
            return String(
              JSON.stringify({
                toggle: toggle!.checkVisibility(),
                beside:
                  t.top < i.bottom && t.bottom > i.top && t.right <= i.left,
              }),
            );
          } finally {
            el.style.width = width;
          }
        },
        undefined,
      ),
    );
    expect(narrowRow).toEqual({ toggle: true, beside: true });

    // Another Library Scope changes what Recent lists.
    await obRun(
      run.vaultId,
      async ({ zotlit }, { libraryScopeSettingKey, document }) => {
        const { settings, bridge } = zotlit.services;
        bridge.runSync(settings.update({ [libraryScopeSettingKey]: document }));
        await bridge.runPromise(settings.flush);
        return String(true);
      },
      {
        libraryScopeSettingKey: LIBRARY_SCOPE_SETTING_KEY,
        document: {
          mode: "selected",
          libraries: [personal].map(({ groupID }) =>
            groupID === null
              ? { type: "personal" as const }
              : { type: "group" as const, groupID },
          ),
        },
      },
    );
    const narrowed = await obRunUntil(
      run.vaultId,
      async ({ app }) => {
        const view = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]?.view;
        if (!view?.tree) return null;
        await view.query.settled;
        await view.tree.settled;
        const el = view.contentEl;
        const rows = [
          ...el.querySelectorAll<HTMLElement>("[data-query-papers-row]"),
        ];
        const sort = el.querySelector<HTMLElement>(
          '[data-query-toolbar="sort"]',
        );
        return {
          sort: {
            set: sort?.hasAttribute("data-active") ?? false,
            text: sort?.textContent ?? null,
          },
          phase: view.query.state.getState().phase,
          header: ((h: Element | null) =>
            h
              ? ["[data-library-header]", "[data-library-header-count]"]
                  .map((s) => h.querySelector(s)?.textContent ?? "")
                  .filter((t) => t !== "")
                  .join(" | ")
              : null)(el.querySelector("[data-library-heading]")),
          recent: [
            ...el.querySelectorAll<HTMLElement>("[data-library-node]"),
          ].some(
            (n) =>
              JSON.parse(n.getAttribute("data-library-node")!)[0] ===
                "recent" && n.getAttribute("aria-selected") === "true",
          ),
          count:
            el
              .querySelector<HTMLElement>("[data-query-count]")
              ?.getAttribute("data-query-count") ?? null,
          rows: rows.map((n) => n.getAttribute("data-query-papers-row")!),
          lines: rows.map(
            (n) =>
              n.querySelector<HTMLElement>("[data-query-papers-title]")!
                .parentElement!.childElementCount,
          ),
        };
      },
      undefined,
      {
        what: "Library View",
        tries: 120,
        ready: (value) => value !== null && listing(size([personal]))(value),
      },
    );
    expectRecent(narrowed!, [personal], -1);

    // A sort change keeps Recent selected; selecting Recent again after a
    // Library sorts newest activity first again.
    await obRun(
      run.vaultId,
      async ({ app, page }) => {
        const { press, until, pick } = page;
        const el = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]!.view.contentEl;
        press(
          el.querySelector<HTMLElement>('[data-query-toolbar="sort"]'),
          "Sort",
        );
        await pick(
          await until("sort direction", () =>
            el.querySelector<HTMLButtonElement | HTMLSelectElement>(
              '[data-query-popover="sort"] [data-sort-direction]',
            ),
          ),
          "ASC",
          "sort direction",
        );
        return String(true);
      },
      undefined,
    );
    const ascending = await obRunUntil(
      run.vaultId,
      async ({ app }) => {
        const view = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]?.view;
        if (!view?.tree) return null;
        await view.query.settled;
        await view.tree.settled;
        const el = view.contentEl;
        const rows = [
          ...el.querySelectorAll<HTMLElement>("[data-query-papers-row]"),
        ];
        const sort = el.querySelector<HTMLElement>(
          '[data-query-toolbar="sort"]',
        );
        return {
          sort: {
            set: sort?.hasAttribute("data-active") ?? false,
            text: sort?.textContent ?? null,
          },
          phase: view.query.state.getState().phase,
          header: ((h: Element | null) =>
            h
              ? ["[data-library-header]", "[data-library-header-count]"]
                  .map((s) => h.querySelector(s)?.textContent ?? "")
                  .filter((t) => t !== "")
                  .join(" | ")
              : null)(el.querySelector("[data-library-heading]")),
          recent: [
            ...el.querySelectorAll<HTMLElement>("[data-library-node]"),
          ].some(
            (n) =>
              JSON.parse(n.getAttribute("data-library-node")!)[0] ===
                "recent" && n.getAttribute("aria-selected") === "true",
          ),
          count:
            el
              .querySelector<HTMLElement>("[data-query-count]")
              ?.getAttribute("data-query-count") ?? null,
          rows: rows.map((n) => n.getAttribute("data-query-papers-row")!),
          lines: rows.map(
            (n) =>
              n.querySelector<HTMLElement>("[data-query-papers-title]")!
                .parentElement!.childElementCount,
          ),
        };
      },
      undefined,
      {
        what: "Library View",
        tries: 120,
        ready: (value) =>
          value !== null &&
          ((shown) =>
            listing(size([personal]))(shown) &&
            shown.rows[0] !== narrowed!.rows[0])(value),
      },
    );
    expect(ascending!.recent).toBe(true);
    expectRecent(ascending!, [personal], 1);
    await obRun(
      run.vaultId,
      async ({ app, page }, { JSONStringifyResult, myLibrary }) => {
        const { press, until } = page;
        const el = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]!.view.contentEl;
        const pane = el.querySelector<HTMLElement>("[data-library-tree]");
        if (getComputedStyle(pane!).display === "none") {
          press(
            el.querySelector<HTMLElement>("[data-library-tree-toggle]"),
            "Library Tree button",
          );
          await until(
            "Library Tree",
            () => getComputedStyle(pane!).display !== "none",
          );
        }
        press(
          [...pane!.querySelectorAll<HTMLElement>("[data-library-node]")].find(
            (n) => n.getAttribute("data-library-node")! === JSONStringifyResult,
          ),
          myLibrary,
        );
        return String(true);
      },
      {
        JSONStringifyResult: JSON.stringify(["personal"]),
        myLibrary: "My Library",
      },
    );
    await obRunUntil(
      run.vaultId,
      async ({ app }) => {
        const view = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]?.view;
        if (!view?.tree) return null;
        await view.query.settled;
        await view.tree.settled;
        const el = view.contentEl;
        const rows = [
          ...el.querySelectorAll<HTMLElement>("[data-query-papers-row]"),
        ];
        const sort = el.querySelector<HTMLElement>(
          '[data-query-toolbar="sort"]',
        );
        return {
          sort: {
            set: sort?.hasAttribute("data-active") ?? false,
            text: sort?.textContent ?? null,
          },
          phase: view.query.state.getState().phase,
          header: ((h: Element | null) =>
            h
              ? ["[data-library-header]", "[data-library-header-count]"]
                  .map((s) => h.querySelector(s)?.textContent ?? "")
                  .filter((t) => t !== "")
                  .join(" | ")
              : null)(el.querySelector("[data-library-heading]")),
          recent: [
            ...el.querySelectorAll<HTMLElement>("[data-library-node]"),
          ].some(
            (n) =>
              JSON.parse(n.getAttribute("data-library-node")!)[0] ===
                "recent" && n.getAttribute("aria-selected") === "true",
          ),
          count:
            el
              .querySelector<HTMLElement>("[data-query-count]")
              ?.getAttribute("data-query-count") ?? null,
          rows: rows.map((n) => n.getAttribute("data-query-papers-row")!),
          lines: rows.map(
            (n) =>
              n.querySelector<HTMLElement>("[data-query-papers-title]")!
                .parentElement!.childElementCount,
          ),
        };
      },
      undefined,
      {
        what: "Library View",
        tries: 120,
        ready: (value) =>
          value !== null &&
          ((shown) => !shown.recent && shown.phase === "ready")(value),
      },
    );
    await obRun(
      run.vaultId,
      async ({ app, page }, { JSONStringifyResult, recent }) => {
        const { press, until } = page;
        const el = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]!.view.contentEl;
        const pane = el.querySelector<HTMLElement>("[data-library-tree]");
        if (getComputedStyle(pane!).display === "none") {
          press(
            el.querySelector<HTMLElement>("[data-library-tree-toggle]"),
            "Library Tree button",
          );
          await until(
            "Library Tree",
            () => getComputedStyle(pane!).display !== "none",
          );
        }
        press(
          [...pane!.querySelectorAll<HTMLElement>("[data-library-node]")].find(
            (n) => n.getAttribute("data-library-node")! === JSONStringifyResult,
          ),
          recent,
        );
        return String(true);
      },
      { JSONStringifyResult: JSON.stringify(["recent"]), recent: "Recent" },
    );
    const again = await obRunUntil(
      run.vaultId,
      async ({ app }) => {
        const view = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]?.view;
        if (!view?.tree) return null;
        await view.query.settled;
        await view.tree.settled;
        const el = view.contentEl;
        const rows = [
          ...el.querySelectorAll<HTMLElement>("[data-query-papers-row]"),
        ];
        const sort = el.querySelector<HTMLElement>(
          '[data-query-toolbar="sort"]',
        );
        return {
          sort: {
            set: sort?.hasAttribute("data-active") ?? false,
            text: sort?.textContent ?? null,
          },
          phase: view.query.state.getState().phase,
          header: ((h: Element | null) =>
            h
              ? ["[data-library-header]", "[data-library-header-count]"]
                  .map((s) => h.querySelector(s)?.textContent ?? "")
                  .filter((t) => t !== "")
                  .join(" | ")
              : null)(el.querySelector("[data-library-heading]")),
          recent: [
            ...el.querySelectorAll<HTMLElement>("[data-library-node]"),
          ].some(
            (n) =>
              JSON.parse(n.getAttribute("data-library-node")!)[0] ===
                "recent" && n.getAttribute("aria-selected") === "true",
          ),
          count:
            el
              .querySelector<HTMLElement>("[data-query-count]")
              ?.getAttribute("data-query-count") ?? null,
          rows: rows.map((n) => n.getAttribute("data-query-papers-row")!),
          lines: rows.map(
            (n) =>
              n.querySelector<HTMLElement>("[data-query-papers-title]")!
                .parentElement!.childElementCount,
          ),
        };
      },
      undefined,
      {
        what: "Library View",
        tries: 120,
        ready: (value) =>
          value !== null &&
          ((shown) => shown.recent && listing(size([personal]))(shown))(value),
      },
    );
    expectRecent(again!, [personal], -1);
    expect(again!.sort).toEqual({ set: false, text: "Sort" });

    expect(
      await ((options: { expected: string; tries?: number }) =>
        obRunUntil(
          run.vaultId,
          async ({ zotlit }) => {
            return String(
              JSON.stringify(
                zotlit.services.bridge.runSync(
                  zotlit.services.settings.current,
                )["library.document"],
                [
                  "node",
                  "kind",
                  "library",
                  "type",
                  "path",
                  "sort",
                  "property",
                  "direction",
                ],
              ),
            );
          },
          undefined,
          {
            ready: (value) => value === options.expected,
            tries: options.tries,
            what: "library-view.e2e.ts:479",
          },
        ).then(
          () => true,
          () => false,
        ))({
        expected: JSON.stringify({
          node: { kind: "recent" },
          sort: [{ property: "lastActivity", direction: "DESC" }],
        }),
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
    await obRun(
      run.vaultId,
      async ({ app, page }, { sharedkeynode, sharedKey }) => {
        const { press, until } = page;
        const el = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]!.view.contentEl;
        const pane = el.querySelector<HTMLElement>("[data-library-tree]");
        if (getComputedStyle(pane!).display === "none") {
          press(
            el.querySelector<HTMLElement>("[data-library-tree-toggle]"),
            "Library Tree button",
          );
          await until(
            "Library Tree",
            () => getComputedStyle(pane!).display !== "none",
          );
        }
        press(
          [...pane!.querySelectorAll<HTMLElement>("[data-library-node]")].find(
            (n) => n.getAttribute("data-library-node")! === sharedkeynode,
          ),
          sharedKey,
        );
        return String(true);
      },
      { sharedkeynode: sharedKeyNode, sharedKey: "Shared key" },
    );
    const unsorted = await obRunUntil(
      run.vaultId,
      async ({ app }) => {
        const view = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]?.view;
        if (!view?.tree) return null;
        await view.query.settled;
        await view.tree.settled;
        const el = view.contentEl;
        const rows = [
          ...el.querySelectorAll<HTMLElement>("[data-query-papers-row]"),
        ];
        const sort = el.querySelector<HTMLElement>(
          '[data-query-toolbar="sort"]',
        );
        return {
          sort: {
            set: sort?.hasAttribute("data-active") ?? false,
            text: sort?.textContent ?? null,
          },
          phase: view.query.state.getState().phase,
          header: ((h: Element | null) =>
            h
              ? ["[data-library-header]", "[data-library-header-count]"]
                  .map((s) => h.querySelector(s)?.textContent ?? "")
                  .filter((t) => t !== "")
                  .join(" | ")
              : null)(el.querySelector("[data-library-heading]")),
          recent: [
            ...el.querySelectorAll<HTMLElement>("[data-library-node]"),
          ].some(
            (n) =>
              JSON.parse(n.getAttribute("data-library-node")!)[0] ===
                "recent" && n.getAttribute("aria-selected") === "true",
          ),
          count:
            el
              .querySelector<HTMLElement>("[data-query-count]")
              ?.getAttribute("data-query-count") ?? null,
          rows: rows.map((n) => n.getAttribute("data-query-papers-row")!),
          lines: rows.map(
            (n) =>
              n.querySelector<HTMLElement>("[data-query-papers-title]")!
                .parentElement!.childElementCount,
          ),
        };
      },
      undefined,
      {
        what: "Library View",
        tries: 120,
        ready: (value) =>
          value !== null &&
          ((shown) => !shown.recent && listing(filed.length)(shown))(value),
      },
    );
    expect(unsorted!.sort).toEqual({ set: false, text: "Sort" });
    expectFiled(unsorted!, -1);
    expect(
      await ((options: { expected: string; tries?: number }) =>
        obRunUntil(
          run.vaultId,
          async ({ zotlit }) => {
            return String(
              JSON.stringify(
                zotlit.services.bridge.runSync(
                  zotlit.services.settings.current,
                )["library.document"],
                [
                  "node",
                  "kind",
                  "library",
                  "type",
                  "path",
                  "sort",
                  "property",
                  "direction",
                ],
              ),
            );
          },
          undefined,
          {
            ready: (value) => value === options.expected,
            tries: options.tries,
            what: "library-view.e2e.ts:528",
          },
        ).then(
          () => true,
          () => false,
        ))({ expected: JSON.stringify({ node: sharedKeyPath, sort: [] }) }),
    ).toBe(true);

    // A sort the researcher changed on Recent is theirs: it stays on the
    // Collection, and the Sort button shows it as set.
    await obRun(
      run.vaultId,
      async ({ app, page }, { JSONStringifyResult, recent }) => {
        const { press, until } = page;
        const el = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]!.view.contentEl;
        const pane = el.querySelector<HTMLElement>("[data-library-tree]");
        if (getComputedStyle(pane!).display === "none") {
          press(
            el.querySelector<HTMLElement>("[data-library-tree-toggle]"),
            "Library Tree button",
          );
          await until(
            "Library Tree",
            () => getComputedStyle(pane!).display !== "none",
          );
        }
        press(
          [...pane!.querySelectorAll<HTMLElement>("[data-library-node]")].find(
            (n) => n.getAttribute("data-library-node")! === JSONStringifyResult,
          ),
          recent,
        );
        return String(true);
      },
      { JSONStringifyResult: JSON.stringify(["recent"]), recent: "Recent" },
    );
    await obRunUntil(
      run.vaultId,
      async ({ app }) => {
        const view = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]?.view;
        if (!view?.tree) return null;
        await view.query.settled;
        await view.tree.settled;
        const el = view.contentEl;
        const rows = [
          ...el.querySelectorAll<HTMLElement>("[data-query-papers-row]"),
        ];
        const sort = el.querySelector<HTMLElement>(
          '[data-query-toolbar="sort"]',
        );
        return {
          sort: {
            set: sort?.hasAttribute("data-active") ?? false,
            text: sort?.textContent ?? null,
          },
          phase: view.query.state.getState().phase,
          header: ((h: Element | null) =>
            h
              ? ["[data-library-header]", "[data-library-header-count]"]
                  .map((s) => h.querySelector(s)?.textContent ?? "")
                  .filter((t) => t !== "")
                  .join(" | ")
              : null)(el.querySelector("[data-library-heading]")),
          recent: [
            ...el.querySelectorAll<HTMLElement>("[data-library-node]"),
          ].some(
            (n) =>
              JSON.parse(n.getAttribute("data-library-node")!)[0] ===
                "recent" && n.getAttribute("aria-selected") === "true",
          ),
          count:
            el
              .querySelector<HTMLElement>("[data-query-count]")
              ?.getAttribute("data-query-count") ?? null,
          rows: rows.map((n) => n.getAttribute("data-query-papers-row")!),
          lines: rows.map(
            (n) =>
              n.querySelector<HTMLElement>("[data-query-papers-title]")!
                .parentElement!.childElementCount,
          ),
        };
      },
      undefined,
      {
        what: "Library View",
        tries: 120,
        ready: (value) =>
          value !== null &&
          ((shown) => shown.recent && listing(size([personal]))(shown))(value),
      },
    );
    await obRun(
      run.vaultId,
      async ({ app, page }) => {
        const { press, until, pick } = page;
        const el = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]!.view.contentEl;
        press(
          el.querySelector<HTMLElement>('[data-query-toolbar="sort"]'),
          "Sort",
        );
        await pick(
          await until("sort direction", () =>
            el.querySelector<HTMLButtonElement | HTMLSelectElement>(
              '[data-query-popover="sort"] [data-sort-direction]',
            ),
          ),
          "ASC",
          "sort direction",
        );
        return String(true);
      },
      undefined,
    );
    const resorted = await obRunUntil(
      run.vaultId,
      async ({ app }) => {
        const view = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]?.view;
        if (!view?.tree) return null;
        await view.query.settled;
        await view.tree.settled;
        const el = view.contentEl;
        const rows = [
          ...el.querySelectorAll<HTMLElement>("[data-query-papers-row]"),
        ];
        const sort = el.querySelector<HTMLElement>(
          '[data-query-toolbar="sort"]',
        );
        return {
          sort: {
            set: sort?.hasAttribute("data-active") ?? false,
            text: sort?.textContent ?? null,
          },
          phase: view.query.state.getState().phase,
          header: ((h: Element | null) =>
            h
              ? ["[data-library-header]", "[data-library-header-count]"]
                  .map((s) => h.querySelector(s)?.textContent ?? "")
                  .filter((t) => t !== "")
                  .join(" | ")
              : null)(el.querySelector("[data-library-heading]")),
          recent: [
            ...el.querySelectorAll<HTMLElement>("[data-library-node]"),
          ].some(
            (n) =>
              JSON.parse(n.getAttribute("data-library-node")!)[0] ===
                "recent" && n.getAttribute("aria-selected") === "true",
          ),
          count:
            el
              .querySelector<HTMLElement>("[data-query-count]")
              ?.getAttribute("data-query-count") ?? null,
          rows: rows.map((n) => n.getAttribute("data-query-papers-row")!),
          lines: rows.map(
            (n) =>
              n.querySelector<HTMLElement>("[data-query-papers-title]")!
                .parentElement!.childElementCount,
          ),
        };
      },
      undefined,
      {
        what: "Library View",
        tries: 120,
        ready: (value) =>
          value !== null &&
          ((shown) =>
            shown.recent && shown.sort.set && listing(size([personal]))(shown))(
            value,
          ),
      },
    );
    expectRecent(resorted!, [personal], 1);
    await obRun(
      run.vaultId,
      async ({ app, page }, { sharedkeynode, sharedKey }) => {
        const { press, until } = page;
        const el = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]!.view.contentEl;
        const pane = el.querySelector<HTMLElement>("[data-library-tree]");
        if (getComputedStyle(pane!).display === "none") {
          press(
            el.querySelector<HTMLElement>("[data-library-tree-toggle]"),
            "Library Tree button",
          );
          await until(
            "Library Tree",
            () => getComputedStyle(pane!).display !== "none",
          );
        }
        press(
          [...pane!.querySelectorAll<HTMLElement>("[data-library-node]")].find(
            (n) => n.getAttribute("data-library-node")! === sharedkeynode,
          ),
          sharedKey,
        );
        return String(true);
      },
      { sharedkeynode: sharedKeyNode, sharedKey: "Shared key" },
    );
    const kept = await obRunUntil(
      run.vaultId,
      async ({ app }) => {
        const view = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]?.view;
        if (!view?.tree) return null;
        await view.query.settled;
        await view.tree.settled;
        const el = view.contentEl;
        const rows = [
          ...el.querySelectorAll<HTMLElement>("[data-query-papers-row]"),
        ];
        const sort = el.querySelector<HTMLElement>(
          '[data-query-toolbar="sort"]',
        );
        return {
          sort: {
            set: sort?.hasAttribute("data-active") ?? false,
            text: sort?.textContent ?? null,
          },
          phase: view.query.state.getState().phase,
          header: ((h: Element | null) =>
            h
              ? ["[data-library-header]", "[data-library-header-count]"]
                  .map((s) => h.querySelector(s)?.textContent ?? "")
                  .filter((t) => t !== "")
                  .join(" | ")
              : null)(el.querySelector("[data-library-heading]")),
          recent: [
            ...el.querySelectorAll<HTMLElement>("[data-library-node]"),
          ].some(
            (n) =>
              JSON.parse(n.getAttribute("data-library-node")!)[0] ===
                "recent" && n.getAttribute("aria-selected") === "true",
          ),
          count:
            el
              .querySelector<HTMLElement>("[data-query-count]")
              ?.getAttribute("data-query-count") ?? null,
          rows: rows.map((n) => n.getAttribute("data-query-papers-row")!),
          lines: rows.map(
            (n) =>
              n.querySelector<HTMLElement>("[data-query-papers-title]")!
                .parentElement!.childElementCount,
          ),
        };
      },
      undefined,
      {
        what: "Library View",
        tries: 120,
        ready: (value) =>
          value !== null &&
          ((shown) => !shown.recent && listing(filed.length)(shown))(value),
      },
    );
    expect(kept!.sort).toEqual({ set: true, text: "Sort1" });
    expect(kept!.rows.map((key) => activity.get(key!))).toEqual(
      filed
        .map((item) => activity.get(indexedKey(item))!)
        .toSorted((a, b) => a - b),
    );
    expect(
      await ((options: { expected: string; tries?: number }) =>
        obRunUntil(
          run.vaultId,
          async ({ zotlit }) => {
            return String(
              JSON.stringify(
                zotlit.services.bridge.runSync(
                  zotlit.services.settings.current,
                )["library.document"],
                [
                  "node",
                  "kind",
                  "library",
                  "type",
                  "path",
                  "sort",
                  "property",
                  "direction",
                ],
              ),
            );
          },
          undefined,
          {
            ready: (value) => value === options.expected,
            tries: options.tries,
            what: "library-view.e2e.ts:558",
          },
        ).then(
          () => true,
          () => false,
        ))({
        expected: JSON.stringify({
          node: sharedKeyPath,
          sort: [{ property: "lastActivity", direction: "ASC" }],
        }),
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
    const snapshot = await obRun(
      run.vaultId,
      async ({ app, zotlit }) => {
        return String(
          JSON.stringify({
            layout: app.workspace.getLayout(),
            document:
              zotlit.services.bridge.runSync(zotlit.services.settings.current)[
                "library.document"
              ] ?? null,
          }),
        );
      },
      undefined,
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obRun(
        run.vaultId,
        async ({ app, zotlit }, { snapshot }) => {
          const saved = JSON.parse(snapshot);
          const { settings, bridge } = zotlit.services;
          bridge.runSync(
            settings.update({ "library.document": saved.document }),
          );
          await bridge.runPromise(settings.flush);
          await app.workspace.changeLayout(saved.layout);
          return String(true);
        },
        { snapshot: snapshot },
      );
    });
    // A new Library View opens on Recent, whose sort is last change first.
    await obRun(
      run.vaultId,
      async ({ app, zotlit }) => {
        (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        ).forEach((leaf) => leaf.detach());
        const { settings, bridge } = zotlit.services;
        bridge.runSync(settings.update({ "library.document": null }));
        await bridge.runPromise(settings.flush);
        app.commands.executeCommandById("zotlit:open-library-view");
        return String(true);
      },
      undefined,
    );
    // The heading draws the Sort control in a React root of its own; the
    // property Select's popup opens its Chooser there, with its search and
    // rows, and a pick shuts it.
    const picked = JSON.parse(
      await obRun(
        run.vaultId,
        async ({ app, page }) => {
          const { press, until, pick } = page;
          const leaf = (
            app.workspace.getLeavesOfType(
              "zotlit-library",
            ) as (WorkspaceLeaf & { view: LibraryView })[]
          )[0];
          await app.workspace.revealLeaf(leaf!);
          const el = leaf!.view.contentEl;
          await until(
            "rows",
            () =>
              el.querySelectorAll<HTMLElement>("[data-query-papers-row]")
                .length > 0,
            20000,
          );
          press(
            el.querySelector<HTMLElement>('[data-query-toolbar="sort"]'),
            "Sort",
          );
          const popover = await until("Sort popover", () =>
            el.querySelector<HTMLElement>(
              '[data-query-popover="sort"]:popover-open',
            ),
          );
          await pick(
            await until("sort property", () =>
              popover.querySelector<HTMLButtonElement | HTMLSelectElement>(
                "[data-sort-property]",
              ),
            ),
            "title",
            "sort property",
          );
          const triggers = popover.querySelectorAll<HTMLElement>(
            "[data-sort-property]",
          ).length;
          popover.hidePopover();
          return String(JSON.stringify({ triggers }));
        },
        undefined,
      ),
    ) as { triggers: number };
    expect(picked).toEqual({ triggers: 1 });
    expect(
      await ((options: { expected: string; tries?: number }) =>
        obRunUntil(
          run.vaultId,
          async ({ zotlit }) => {
            return String(
              JSON.stringify(
                zotlit.services.bridge.runSync(
                  zotlit.services.settings.current,
                )["library.document"]?.sort,
              ),
            );
          },
          undefined,
          {
            ready: (value) => value === options.expected,
            tries: options.tries,
            what: "library-view.e2e.ts:602",
          },
        ).then(
          () => true,
          () => false,
        ))({
        expected: JSON.stringify([{ property: "title", direction: "DESC" }]),
      }),
    ).toBe(true);
  });

  it("filters the Library View from the Library Tree, with counts that match the seed and follow a database change", async () => {
    const snapshot = await obRun(
      run.vaultId,
      async ({ app, zotlit }, { libraryScopeSettingKey }) => {
        return String(
          JSON.stringify({
            layout: app.workspace.getLayout(),
            document:
              zotlit.services.bridge.runSync(zotlit.services.settings.current)[
                "library.document"
              ] ?? null,
            scope:
              zotlit.services.bridge.runSync(zotlit.services.settings.current)[
                libraryScopeSettingKey
              ] ?? null,
          }),
        );
      },
      { libraryScopeSettingKey: LIBRARY_SCOPE_SETTING_KEY },
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obRun(
        run.vaultId,
        async ({ app, zotlit }, { snapshot, libraryScopeSettingKey }) => {
          const saved = JSON.parse(snapshot);
          const { settings, bridge } = zotlit.services;
          bridge.runSync(
            settings.update({
              "library.document": saved.document,
              [libraryScopeSettingKey]: saved.scope,
            }),
          );
          await bridge.runPromise(settings.flush);
          await app.workspace.changeLayout(saved.layout);
          return String(true);
        },
        {
          snapshot: snapshot,
          libraryScopeSettingKey: LIBRARY_SCOPE_SETTING_KEY,
        },
      );
    });
    // The Library Scope holds My Library alone; the tree opens on My Library.
    await obRun(
      run.vaultId,
      async (
        { app, zotlit },
        { myLibraryDocument, libraryScopeSettingKey },
      ) => {
        (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        ).forEach((leaf) => leaf.detach());
        const { settings, bridge } = zotlit.services;
        bridge.runSync(
          settings.update({
            "library.document": myLibraryDocument,
            [libraryScopeSettingKey]: {
              mode: "selected",
              libraries: [{ type: "personal" }],
            },
          }),
        );
        await bridge.runPromise(settings.flush);
        return String(true);
      },
      {
        myLibraryDocument: MY_LIBRARY_DOCUMENT,
        libraryScopeSettingKey: LIBRARY_SCOPE_SETTING_KEY,
      },
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

    /** Press the node `key`, or its element that `part` selects. */
    const press = (key: string, part: string, what: string) => {
      return obRun(
        run.vaultId,
        async ({ app, page }, { key, part, condition, what }) => {
          const { press, until } = page;
          const el = (
            app.workspace.getLeavesOfType(
              "zotlit-library",
            ) as (WorkspaceLeaf & { view: LibraryView })[]
          )[0]!.view.contentEl;
          const pane = el.querySelector<HTMLElement>("[data-library-tree]");
          if (getComputedStyle(pane!).display === "none") {
            press(
              el.querySelector<HTMLElement>("[data-library-tree-toggle]"),
              "Library Tree button",
            );
            await until(
              "Library Tree",
              () => getComputedStyle(pane!).display !== "none",
            );
          }
          press(
            condition
              ? [
                  ...pane!.querySelectorAll<HTMLElement>("[data-library-node]"),
                ].find((n) => n.getAttribute("data-library-node")! === key)
              : [...pane!.querySelectorAll<HTMLElement>("[data-library-node]")]
                  .find((n) => n.getAttribute("data-library-node")! === key)!
                  .querySelector<HTMLElement>(part),
            what,
          );
          return String(true);
        },
        { key: key, part: part, condition: part === "", what: what },
      );
    };

    await obRun(
      run.vaultId,
      async ({ app }) => {
        app.commands.executeCommandById("zotlit:open-library-view");
        return String(true);
      },
      undefined,
    );
    // The tree shows the Library Scope: My Library and its Collections, each
    // counted from the seed, a subcollection's Items inside its parent.
    const opened = await obRunUntil(
      run.vaultId,
      async ({ app }) => {
        const view = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]?.view;
        if (!view?.tree) return null;
        await view.query.settled;
        await view.tree.settled;
        const el = view.contentEl;
        return {
          phase: view.query.state.getState().phase,
          header: ((h: Element | null) =>
            h
              ? ["[data-library-header]", "[data-library-header-count]"]
                  .map((s) => h.querySelector(s)?.textContent ?? "")
                  .filter((t) => t !== "")
                  .join(" | ")
              : null)(el.querySelector("[data-library-heading]")),
          all:
            el
              .querySelector<HTMLElement>("[data-library-all]")
              ?.getAttribute("data-library-all") ?? null,
          tree: [
            ...el.querySelectorAll<HTMLElement>("[data-library-node]"),
          ].map((n) => ({
            key: n.getAttribute("data-library-node")!,
            level: Number(n.getAttribute("aria-level")),
            label: n.querySelector<HTMLElement>("[data-library-label]")!
              .textContent,
            count:
              n.querySelector<HTMLElement>("[data-library-count]")
                ?.textContent ?? null,
            selected: n.getAttribute("aria-selected") === "true",
          })),
          count:
            el
              .querySelector<HTMLElement>("[data-query-count]")
              ?.getAttribute("data-query-count") ?? null,
          rows: [
            ...el.querySelectorAll<HTMLElement>(
              'tr[data-query-table-row="item"], [data-query-papers-row]',
            ),
          ].map(
            (n) =>
              n.getAttribute("data-query-key")! ??
              n.getAttribute("data-query-papers-row")!,
          ),
        };
      },
      undefined,
      {
        what: "Library View",
        tries: 120,
        ready: (value) =>
          value !== null &&
          ((shown) =>
            listing(nodeKey("personal"))(shown) &&
            node(shown, parentKey)?.count != null)(value),
      },
    );
    expect(
      opened!.tree.map(({ key, level, count }) => ({ key, level, count })),
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
    expect(opened!.header).toBe(
      suite.libraryHeader(
        run.m.settings_library_scope_personal(),
        inLibrary(personal.libraryID),
      ),
    );
    await press(parentKey, "[data-library-expand]", "Collection disclosure");
    expect(
      node(
        (await obRunUntil(
          run.vaultId,
          async ({ app }) => {
            const view = (
              app.workspace.getLeavesOfType(
                "zotlit-library",
              ) as (WorkspaceLeaf & { view: LibraryView })[]
            )[0]?.view;
            if (!view?.tree) return null;
            await view.query.settled;
            await view.tree.settled;
            const el = view.contentEl;
            return {
              phase: view.query.state.getState().phase,
              header: ((h: Element | null) =>
                h
                  ? ["[data-library-header]", "[data-library-header-count]"]
                      .map((s) => h.querySelector(s)?.textContent ?? "")
                      .filter((t) => t !== "")
                      .join(" | ")
                  : null)(el.querySelector("[data-library-heading]")),
              all:
                el
                  .querySelector<HTMLElement>("[data-library-all]")
                  ?.getAttribute("data-library-all") ?? null,
              tree: [
                ...el.querySelectorAll<HTMLElement>("[data-library-node]"),
              ].map((n) => ({
                key: n.getAttribute("data-library-node")!,
                level: Number(n.getAttribute("aria-level")),
                label: n.querySelector<HTMLElement>("[data-library-label]")!
                  .textContent,
                count:
                  n.querySelector<HTMLElement>("[data-library-count]")
                    ?.textContent ?? null,
                selected: n.getAttribute("aria-selected") === "true",
              })),
              count:
                el
                  .querySelector<HTMLElement>("[data-query-count]")
                  ?.getAttribute("data-query-count") ?? null,
              rows: [
                ...el.querySelectorAll<HTMLElement>(
                  'tr[data-query-table-row="item"], [data-query-papers-row]',
                ),
              ].map(
                (n) =>
                  n.getAttribute("data-query-key")! ??
                  n.getAttribute("data-query-papers-row")!,
              ),
            };
          },
          undefined,
          {
            what: "Library View",
            tries: 120,
            ready: (value) =>
              value !== null &&
              ((shown) => node(shown, childKey) !== undefined)(value),
          },
        ))!,
        childKey,
      ),
    ).toMatchObject({
      level: 3,
      count: String(filed(child.collectionID).length),
    });

    // "All libraries" shows the group libraries outside the Library Scope;
    // one lists its own Items.
    expect(opened!.all).toBe("off");
    await obRun(
      run.vaultId,
      async ({ app, page }, { allLibraries }) => {
        const { press, until } = page;
        const el = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]!.view.contentEl;
        const pane = el.querySelector<HTMLElement>("[data-library-tree]");
        if (getComputedStyle(pane!).display === "none") {
          press(
            el.querySelector<HTMLElement>("[data-library-tree-toggle]"),
            "Library Tree button",
          );
          await until(
            "Library Tree",
            () => getComputedStyle(pane!).display !== "none",
          );
        }
        press(
          pane!.querySelector<HTMLElement>("[data-library-all]"),
          allLibraries,
        );
        return String(true);
      },
      { allLibraries: "All libraries" },
    );
    const widened = await obRunUntil(
      run.vaultId,
      async ({ app }) => {
        const view = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]?.view;
        if (!view?.tree) return null;
        await view.query.settled;
        await view.tree.settled;
        const el = view.contentEl;
        return {
          phase: view.query.state.getState().phase,
          header: ((h: Element | null) =>
            h
              ? ["[data-library-header]", "[data-library-header-count]"]
                  .map((s) => h.querySelector(s)?.textContent ?? "")
                  .filter((t) => t !== "")
                  .join(" | ")
              : null)(el.querySelector("[data-library-heading]")),
          all:
            el
              .querySelector<HTMLElement>("[data-library-all]")
              ?.getAttribute("data-library-all") ?? null,
          tree: [
            ...el.querySelectorAll<HTMLElement>("[data-library-node]"),
          ].map((n) => ({
            key: n.getAttribute("data-library-node")!,
            level: Number(n.getAttribute("aria-level")),
            label: n.querySelector<HTMLElement>("[data-library-label]")!
              .textContent,
            count:
              n.querySelector<HTMLElement>("[data-library-count]")
                ?.textContent ?? null,
            selected: n.getAttribute("aria-selected") === "true",
          })),
          count:
            el
              .querySelector<HTMLElement>("[data-query-count]")
              ?.getAttribute("data-query-count") ?? null,
          rows: [
            ...el.querySelectorAll<HTMLElement>(
              'tr[data-query-table-row="item"], [data-query-papers-row]',
            ),
          ].map(
            (n) =>
              n.getAttribute("data-query-key")! ??
              n.getAttribute("data-query-papers-row")!,
          ),
        };
      },
      undefined,
      {
        what: "Library View",
        tries: 120,
        ready: (value) =>
          value !== null &&
          ((shown) =>
            shown.all === "on" &&
            LIBRARIES.every(
              ({ groupID }) =>
                groupID === null ||
                node(shown, nodeKey(`group:${groupID}`))?.count != null,
            ))(value),
      },
    );
    for (const entry of LIBRARIES.filter(({ groupID }) => groupID !== null))
      expect(node(widened!, nodeKey(`group:${entry.groupID}`))).toMatchObject({
        label: entry.name,
        count: String(inLibrary(entry.libraryID).length),
      });
    await press(sharedNode, "", "group library");
    const group = await obRunUntil(
      run.vaultId,
      async ({ app }) => {
        const view = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]?.view;
        if (!view?.tree) return null;
        await view.query.settled;
        await view.tree.settled;
        const el = view.contentEl;
        return {
          phase: view.query.state.getState().phase,
          header: ((h: Element | null) =>
            h
              ? ["[data-library-header]", "[data-library-header-count]"]
                  .map((s) => h.querySelector(s)?.textContent ?? "")
                  .filter((t) => t !== "")
                  .join(" | ")
              : null)(el.querySelector("[data-library-heading]")),
          all:
            el
              .querySelector<HTMLElement>("[data-library-all]")
              ?.getAttribute("data-library-all") ?? null,
          tree: [
            ...el.querySelectorAll<HTMLElement>("[data-library-node]"),
          ].map((n) => ({
            key: n.getAttribute("data-library-node")!,
            level: Number(n.getAttribute("aria-level")),
            label: n.querySelector<HTMLElement>("[data-library-label]")!
              .textContent,
            count:
              n.querySelector<HTMLElement>("[data-library-count]")
                ?.textContent ?? null,
            selected: n.getAttribute("aria-selected") === "true",
          })),
          count:
            el
              .querySelector<HTMLElement>("[data-query-count]")
              ?.getAttribute("data-query-count") ?? null,
          rows: [
            ...el.querySelectorAll<HTMLElement>(
              'tr[data-query-table-row="item"], [data-query-papers-row]',
            ),
          ].map(
            (n) =>
              n.getAttribute("data-query-key")! ??
              n.getAttribute("data-query-papers-row")!,
          ),
        };
      },
      undefined,
      {
        what: "Library View",
        tries: 120,
        ready: (value) => value !== null && listing(sharedNode)(value),
      },
    );
    expect(group!.rows.toSorted()).toEqual(
      inLibrary(shared.libraryID).map(indexedKey).toSorted(),
    );

    // A Collection lists exactly its Items and its subcollection's, and the
    // header names it with the count.
    await press(parentKey, "", "Collection");
    const expected = filed(parent.collectionID).map(indexedKey).toSorted();
    const chosen = await obRunUntil(
      run.vaultId,
      async ({ app }) => {
        const view = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]?.view;
        if (!view?.tree) return null;
        await view.query.settled;
        await view.tree.settled;
        const el = view.contentEl;
        return {
          phase: view.query.state.getState().phase,
          header: ((h: Element | null) =>
            h
              ? ["[data-library-header]", "[data-library-header-count]"]
                  .map((s) => h.querySelector(s)?.textContent ?? "")
                  .filter((t) => t !== "")
                  .join(" | ")
              : null)(el.querySelector("[data-library-heading]")),
          all:
            el
              .querySelector<HTMLElement>("[data-library-all]")
              ?.getAttribute("data-library-all") ?? null,
          tree: [
            ...el.querySelectorAll<HTMLElement>("[data-library-node]"),
          ].map((n) => ({
            key: n.getAttribute("data-library-node")!,
            level: Number(n.getAttribute("aria-level")),
            label: n.querySelector<HTMLElement>("[data-library-label]")!
              .textContent,
            count:
              n.querySelector<HTMLElement>("[data-library-count]")
                ?.textContent ?? null,
            selected: n.getAttribute("aria-selected") === "true",
          })),
          count:
            el
              .querySelector<HTMLElement>("[data-query-count]")
              ?.getAttribute("data-query-count") ?? null,
          rows: [
            ...el.querySelectorAll<HTMLElement>(
              'tr[data-query-table-row="item"], [data-query-papers-row]',
            ),
          ].map(
            (n) =>
              n.getAttribute("data-query-key")! ??
              n.getAttribute("data-query-papers-row")!,
          ),
        };
      },
      undefined,
      {
        what: "Library View",
        tries: 120,
        ready: (value) => value !== null && listing(parentKey)(value),
      },
    );
    expect(chosen!.rows.toSorted()).toEqual(expected);
    expect(chosen!.header).toBe(
      suite.libraryHeader(parent.name, filed(parent.collectionID)),
    );

    // A plugin reload comes back on the Collection.
    expect(
      await ((options: { expected: string; tries?: number }) =>
        obRunUntil(
          run.vaultId,
          async ({ app }) => {
            return String(
              await app.plugins
                .disablePlugin("zotlit")
                .then(function () {
                  return app.plugins.enablePlugin("zotlit");
                })
                .then(function () {
                  return true;
                }),
            );
          },
          undefined,
          {
            ready: (value) => value === options.expected,
            tries: options.tries,
            what: "library-view.e2e.ts:805",
          },
        ).then(
          () => true,
          () => false,
        ))({ expected: "true", tries: 20 }),
    ).toBe(true);
    const reloaded = await obRunUntil(
      run.vaultId,
      async ({ app }) => {
        const view = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]?.view;
        if (!view?.tree) return null;
        await view.query.settled;
        await view.tree.settled;
        const el = view.contentEl;
        return {
          phase: view.query.state.getState().phase,
          header: ((h: Element | null) =>
            h
              ? ["[data-library-header]", "[data-library-header-count]"]
                  .map((s) => h.querySelector(s)?.textContent ?? "")
                  .filter((t) => t !== "")
                  .join(" | ")
              : null)(el.querySelector("[data-library-heading]")),
          all:
            el
              .querySelector<HTMLElement>("[data-library-all]")
              ?.getAttribute("data-library-all") ?? null,
          tree: [
            ...el.querySelectorAll<HTMLElement>("[data-library-node]"),
          ].map((n) => ({
            key: n.getAttribute("data-library-node")!,
            level: Number(n.getAttribute("aria-level")),
            label: n.querySelector<HTMLElement>("[data-library-label]")!
              .textContent,
            count:
              n.querySelector<HTMLElement>("[data-library-count]")
                ?.textContent ?? null,
            selected: n.getAttribute("aria-selected") === "true",
          })),
          count:
            el
              .querySelector<HTMLElement>("[data-query-count]")
              ?.getAttribute("data-query-count") ?? null,
          rows: [
            ...el.querySelectorAll<HTMLElement>(
              'tr[data-query-table-row="item"], [data-query-papers-row]',
            ),
          ].map(
            (n) =>
              n.getAttribute("data-query-key")! ??
              n.getAttribute("data-query-papers-row")!,
          ),
        };
      },
      undefined,
      {
        what: "Library View",
        tries: 120,
        ready: (value) => value !== null && listing(parentKey)(value),
      },
    );
    expect(reloaded!.rows.toSorted()).toEqual(expected);
    expect(reloaded!.header).toBe(chosen!.header);

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
    const changed = await obRunUntil(
      run.vaultId,
      async ({ app }) => {
        const view = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]?.view;
        if (!view?.tree) return null;
        await view.query.settled;
        await view.tree.settled;
        const el = view.contentEl;
        return {
          phase: view.query.state.getState().phase,
          header: ((h: Element | null) =>
            h
              ? ["[data-library-header]", "[data-library-header-count]"]
                  .map((s) => h.querySelector(s)?.textContent ?? "")
                  .filter((t) => t !== "")
                  .join(" | ")
              : null)(el.querySelector("[data-library-heading]")),
          all:
            el
              .querySelector<HTMLElement>("[data-library-all]")
              ?.getAttribute("data-library-all") ?? null,
          tree: [
            ...el.querySelectorAll<HTMLElement>("[data-library-node]"),
          ].map((n) => ({
            key: n.getAttribute("data-library-node")!,
            level: Number(n.getAttribute("aria-level")),
            label: n.querySelector<HTMLElement>("[data-library-label]")!
              .textContent,
            count:
              n.querySelector<HTMLElement>("[data-library-count]")
                ?.textContent ?? null,
            selected: n.getAttribute("aria-selected") === "true",
          })),
          count:
            el
              .querySelector<HTMLElement>("[data-query-count]")
              ?.getAttribute("data-query-count") ?? null,
          rows: [
            ...el.querySelectorAll<HTMLElement>(
              'tr[data-query-table-row="item"], [data-query-papers-row]',
            ),
          ].map(
            (n) =>
              n.getAttribute("data-query-key")! ??
              n.getAttribute("data-query-papers-row")!,
          ),
        };
      },
      undefined,
      {
        what: "Library View",
        tries: 120,
        ready: (value) =>
          value !== null &&
          ((shown) =>
            listing(parentKey)(shown) &&
            node(shown, parentKey)?.count === String(expected.length + 1))(
            value,
          ),
      },
    );
    expect(changed!.rows.toSorted()).toEqual(
      [...expected, indexedKey(added)].toSorted(),
    );
    expect(changed!.header).toBe(
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
    await obRun(
      run.vaultId,
      async ({ app, page }) => {
        page.scratch.libraryBeforeReload = true;
        void app.workspace.requestSaveLayout.run();
        return String(true);
      },
      undefined,
    );
    await cli([`vault=${run.vaultId}`, "reload"]);
    expect(
      await ((options: { expected: string; tries?: number }) =>
        obRunUntil(
          run.vaultId,
          async ({ app, zotlit, page }) => {
            return String(
              String(
                !page.scratch.libraryBeforeReload &&
                  !!zotlit.services.bridge.runSync(
                    zotlit.services.settings.current,
                  ) &&
                  app.workspace.layoutReady,
              ),
            );
          },
          undefined,
          {
            ready: (value) => value === options.expected,
            tries: options.tries,
            what: "library-view.e2e.ts:865",
          },
        ).then(
          () => true,
          () => false,
        ))({ expected: "true", tries: 120 }),
    ).toBe(true);
    await prepareRunWindow(run.vaultId);
  }

  /** What the Library View shows that a reload must keep, once it settled. */

  it("puts the researcher back where they were after a window reload: the Collection left open, the selected paper in view with its Reading Card beside a wide list and none over a narrow one, and the Welcome View banner they asked for, with Zotero closed", async () => {
    const snapshot = await obRun(
      run.vaultId,
      async ({ app, zotlit }, { libraryScopeSettingKey }) => {
        return String(
          JSON.stringify({
            layout: app.workspace.getLayout(),
            document:
              zotlit.services.bridge.runSync(zotlit.services.settings.current)[
                "library.document"
              ] ?? null,
            scope:
              zotlit.services.bridge.runSync(zotlit.services.settings.current)[
                libraryScopeSettingKey
              ] ?? null,
            dismissed: zotlit.services.bridge.runSync(
              zotlit.services.settings.current,
            )["welcome.dismissed"],
            requested: zotlit.services.bridge.runSync(
              zotlit.services.settings.current,
            )["welcome.requested"],
          }),
        );
      },
      { libraryScopeSettingKey: LIBRARY_SCOPE_SETTING_KEY },
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obRun(
        run.vaultId,
        async ({ app, zotlit }, { snapshot, libraryScopeSettingKey }) => {
          const saved = JSON.parse(snapshot);
          const { settings, bridge } = zotlit.services;
          bridge.runSync(
            settings.update({
              "library.document": saved.document,
              [libraryScopeSettingKey]: saved.scope,
              "welcome.dismissed": saved.dismissed,
              "welcome.requested": saved.requested,
            }),
          );
          await bridge.runPromise(settings.flush);
          await app.workspace.changeLayout(saved.layout);
          return String(true);
        },
        {
          snapshot: snapshot,
          libraryScopeSettingKey: LIBRARY_SCOPE_SETTING_KEY,
        },
      );
    });
    await suite.wideWindow(cleanup);
    // The window is short, so the list scrolls under the banner.
    await obRun(
      run.vaultId,
      async () => {
        require("@electron/remote").getCurrentWindow().setSize(1600, 640);
        return String(true);
      },
      undefined,
    );
    // My Library alone, with the banner put away.
    await obRun(
      run.vaultId,
      async (
        { app, zotlit },
        { myLibraryDocument, libraryScopeSettingKey },
      ) => {
        (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        ).forEach((leaf) => leaf.detach());
        const { settings, bridge } = zotlit.services;
        bridge.runSync(
          settings.update({
            "library.document": myLibraryDocument,
            [libraryScopeSettingKey]: {
              mode: "selected",
              libraries: [{ type: "personal" }],
            },
            "welcome.dismissed": true,
            "welcome.requested": false,
          }),
        );
        await bridge.runPromise(settings.flush);
        app.commands.executeCommandById("zotlit:open-library-view");
        return String(true);
      },
      {
        myLibraryDocument: MY_LIBRARY_DOCUMENT,
        libraryScopeSettingKey: LIBRARY_SCOPE_SETTING_KEY,
      },
    );
    const help = run.m.library_view_help_action();

    const personal = LIBRARIES.find(({ type }) => type === "user")!;
    const parent = COLLECTIONS.find(
      (entry) =>
        entry.libraryID === personal.libraryID && entry.key === "PERSNAL2",
    )!;
    const parentKey = JSON.stringify(["personal", parent.name]);
    const first = await obRunUntil(
      run.vaultId,
      async ({ app }, { value }) => {
        const view = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]?.view;
        if (!view?.tree) return null;
        await view.searched;
        await view.query.settled;
        await view.tree.settled;
        await new Promise((r) => setTimeout(r, 200));
        const el = view.contentEl;
        const row = el.querySelector<HTMLElement>(
          "[data-query-item-row][data-selected]",
        );
        const card = el.querySelector<HTMLElement>("[data-library-card]");
        let inView = false;
        if (row) {
          const r = row.getBoundingClientRect();
          const hit = el.ownerDocument.elementFromPoint(
            r.left + r.width / 2,
            r.top + r.height / 2,
          );
          inView = !!hit && row.contains(hit);
        }
        const action = view.containerEl.querySelector<HTMLElement>(value);
        return {
          phase: view.query.state.getState().phase,
          open: [
            ...el.querySelectorAll<HTMLElement>(
              '[data-library-node][aria-expanded="true"]',
            ),
          ].map((n) => n.getAttribute("data-library-node")!),
          selected: row?.getAttribute("data-query-item-row") ?? null,
          card:
            card && !card.hidden && card.checkVisibility()
              ? (card.querySelector<HTMLElement>("[data-library-card-title]")
                  ?.textContent ?? "")
              : null,
          inView,
          banner: !!el.querySelector<HTMLElement>("[data-welcome-banner]"),
          pressed: action?.getAttribute("aria-pressed") ?? null,
          rows: el.querySelectorAll<HTMLElement>("[data-query-item-row]")
            .length,
        };
      },
      { value: `.view-actions .view-action[aria-label="${help}"]` },
      {
        what: "Library View",
        tries: 120,
        ready: (value) =>
          value !== null &&
          ((kept) => kept.phase === "ready" && kept.rows > 0)(value),
      },
    );
    expect(first).toMatchObject({ banner: false, pressed: "false" });
    expect(first!.open).not.toContain(parentKey);

    // Open the Collection, select the last paper, and ask for the banner.
    const last = JSON.parse(
      await obRun(
        run.vaultId,
        async ({ app, page }, { parentkey, value }) => {
          const { press, until } = page;
          const leaf = (
            app.workspace.getLeavesOfType(
              "zotlit-library",
            ) as (WorkspaceLeaf & { view: LibraryView })[]
          )[0];
          await app.workspace.revealLeaf(leaf!);
          app.workspace.setActiveLeaf(leaf!, { focus: true });
          const view = leaf!.view;
          const el = view.contentEl;
          press(
            [...el.querySelectorAll<HTMLElement>("[data-library-node]")]
              .find((n) => n.getAttribute("data-library-node")! === parentkey)!
              .querySelector<HTMLElement>("[data-library-expand]"),
            "Collection disclosure",
          );
          await until("Collection open", () =>
            [
              ...el.querySelectorAll<HTMLElement>(
                '[data-library-node][aria-expanded="true"]',
              ),
            ].some((n) => n.getAttribute("data-library-node")! === parentkey),
          );
          const rows = [
            ...el.querySelectorAll<HTMLElement>("[data-query-item-row]"),
          ];
          const row = rows.at(-1);
          press(row, "last paper");
          await until("card", () => {
            const card = el.querySelector<HTMLElement>("[data-library-card]");
            return !card!.hidden && card!.checkVisibility();
          });
          press(
            view.containerEl.querySelector<HTMLElement>(value),
            "Welcome & help",
          );
          await until("banner", () =>
            el.querySelector<HTMLElement>("[data-welcome-banner]"),
          );
          return String(
            JSON.stringify(row!.getAttribute("data-query-item-row")!),
          );
        },
        {
          parentkey: parentKey,
          value: `.view-actions .view-action[aria-label="${help}"]`,
        },
      ),
    ) as string;
    const before = await obRunUntil(
      run.vaultId,
      async ({ app }, { value }) => {
        const view = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]?.view;
        if (!view?.tree) return null;
        await view.searched;
        await view.query.settled;
        await view.tree.settled;
        await new Promise((r) => setTimeout(r, 200));
        const el = view.contentEl;
        const row = el.querySelector<HTMLElement>(
          "[data-query-item-row][data-selected]",
        );
        const card = el.querySelector<HTMLElement>("[data-library-card]");
        let inView = false;
        if (row) {
          const r = row.getBoundingClientRect();
          const hit = el.ownerDocument.elementFromPoint(
            r.left + r.width / 2,
            r.top + r.height / 2,
          );
          inView = !!hit && row.contains(hit);
        }
        const action = view.containerEl.querySelector<HTMLElement>(value);
        return {
          phase: view.query.state.getState().phase,
          open: [
            ...el.querySelectorAll<HTMLElement>(
              '[data-library-node][aria-expanded="true"]',
            ),
          ].map((n) => n.getAttribute("data-library-node")!),
          selected: row?.getAttribute("data-query-item-row") ?? null,
          card:
            card && !card.hidden && card.checkVisibility()
              ? (card.querySelector<HTMLElement>("[data-library-card-title]")
                  ?.textContent ?? "")
              : null,
          inView,
          banner: !!el.querySelector<HTMLElement>("[data-welcome-banner]"),
          pressed: action?.getAttribute("aria-pressed") ?? null,
          rows: el.querySelectorAll<HTMLElement>("[data-query-item-row]")
            .length,
        };
      },
      { value: `.view-actions .view-action[aria-label="${help}"]` },
      {
        what: "Library View",
        tries: 120,
        ready: (value) =>
          value !== null &&
          ((kept) => kept.selected === last && kept.banner)(value),
      },
    );
    expect(before).toMatchObject({
      open: expect.arrayContaining([parentKey]),
      selected: last,
      banner: true,
      pressed: "true",
    });
    expect(before!.card).not.toBeNull();

    // A reload right after the changes keeps every one of them.
    await reloadWindow();
    const after = await obRunUntil(
      run.vaultId,
      async ({ app }, { value }) => {
        const view = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]?.view;
        if (!view?.tree) return null;
        await view.searched;
        await view.query.settled;
        await view.tree.settled;
        await new Promise((r) => setTimeout(r, 200));
        const el = view.contentEl;
        const row = el.querySelector<HTMLElement>(
          "[data-query-item-row][data-selected]",
        );
        const card = el.querySelector<HTMLElement>("[data-library-card]");
        let inView = false;
        if (row) {
          const r = row.getBoundingClientRect();
          const hit = el.ownerDocument.elementFromPoint(
            r.left + r.width / 2,
            r.top + r.height / 2,
          );
          inView = !!hit && row.contains(hit);
        }
        const action = view.containerEl.querySelector<HTMLElement>(value);
        return {
          phase: view.query.state.getState().phase,
          open: [
            ...el.querySelectorAll<HTMLElement>(
              '[data-library-node][aria-expanded="true"]',
            ),
          ].map((n) => n.getAttribute("data-library-node")!),
          selected: row?.getAttribute("data-query-item-row") ?? null,
          card:
            card && !card.hidden && card.checkVisibility()
              ? (card.querySelector<HTMLElement>("[data-library-card-title]")
                  ?.textContent ?? "")
              : null,
          inView,
          banner: !!el.querySelector<HTMLElement>("[data-welcome-banner]"),
          pressed: action?.getAttribute("aria-pressed") ?? null,
          rows: el.querySelectorAll<HTMLElement>("[data-query-item-row]")
            .length,
        };
      },
      { value: `.view-actions .view-action[aria-label="${help}"]` },
      {
        what: "Library View",
        tries: 120,
        ready: (value) =>
          value !== null &&
          ((kept) => kept.phase === "ready" && kept.selected !== null)(value),
      },
    );
    expect(after).toEqual({ ...before, inView: true });
    // The list scrolled to the paper, which a fresh page would not show.
    expect(
      await obRun(
        run.vaultId,
        async ({ app }) => {
          const el = (
            app.workspace.getLeavesOfType(
              "zotlit-library",
            ) as (WorkspaceLeaf & { view: LibraryView })[]
          )[0]!.view.contentEl;
          let n = el.querySelector<HTMLElement>(
            "[data-query-item-row][data-selected]",
          );
          for (; n && n !== el; n = n.parentElement)
            if (n.scrollTop > 0) return String("scrolled");
          return String("top");
        },
        undefined,
      ),
    ).toBe("scrolled");

    // On a narrow pane the restored paper is selected as the arrow keys
    // select a row: its card does not open over the list, which stays
    // uncovered with the row in view.
    await obRun(
      run.vaultId,
      async () => {
        require("@electron/remote").getCurrentWindow().setSize(900, 640);
        return String(true);
      },
      undefined,
    );
    await reloadWindow();
    const narrow = await obRunUntil(
      run.vaultId,
      async ({ app }, { value }) => {
        const view = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]?.view;
        if (!view?.tree) return null;
        await view.searched;
        await view.query.settled;
        await view.tree.settled;
        await new Promise((r) => setTimeout(r, 200));
        const el = view.contentEl;
        const row = el.querySelector<HTMLElement>(
          "[data-query-item-row][data-selected]",
        );
        const card = el.querySelector<HTMLElement>("[data-library-card]");
        let inView = false;
        if (row) {
          const r = row.getBoundingClientRect();
          const hit = el.ownerDocument.elementFromPoint(
            r.left + r.width / 2,
            r.top + r.height / 2,
          );
          inView = !!hit && row.contains(hit);
        }
        const action = view.containerEl.querySelector<HTMLElement>(value);
        return {
          phase: view.query.state.getState().phase,
          open: [
            ...el.querySelectorAll<HTMLElement>(
              '[data-library-node][aria-expanded="true"]',
            ),
          ].map((n) => n.getAttribute("data-library-node")!),
          selected: row?.getAttribute("data-query-item-row") ?? null,
          card:
            card && !card.hidden && card.checkVisibility()
              ? (card.querySelector<HTMLElement>("[data-library-card-title]")
                  ?.textContent ?? "")
              : null,
          inView,
          banner: !!el.querySelector<HTMLElement>("[data-welcome-banner]"),
          pressed: action?.getAttribute("aria-pressed") ?? null,
          rows: el.querySelectorAll<HTMLElement>("[data-query-item-row]")
            .length,
        };
      },
      { value: `.view-actions .view-action[aria-label="${help}"]` },
      {
        what: "Library View",
        tries: 120,
        ready: (value) =>
          value !== null &&
          ((kept) => kept.phase === "ready" && kept.selected !== null)(value),
      },
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
    const snapshot = await obRun(
      run.vaultId,
      async ({ app, zotlit }) => {
        return String(
          JSON.stringify({
            layout: app.workspace.getLayout(),
            dismissed: zotlit.services.bridge.runSync(
              zotlit.services.settings.current,
            )["welcome.dismissed"],
            requested: zotlit.services.bridge.runSync(
              zotlit.services.settings.current,
            )["welcome.requested"],
          }),
        );
      },
      undefined,
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obRun(
        run.vaultId,
        async ({ app, zotlit }, { snapshot }) => {
          const saved = JSON.parse(snapshot);
          const { settings, bridge } = zotlit.services;
          bridge.runSync(
            settings.update({
              "welcome.dismissed": saved.dismissed,
              "welcome.requested": saved.requested,
            }),
          );
          await bridge.runPromise(settings.flush);
          await app.workspace.changeLayout(saved.layout);
          return String(true);
        },
        { snapshot: snapshot },
      );
    });
    const help = run.m.library_view_help_action();

    // The banner shows, as "Open welcome view" shows it, then the researcher
    // dismisses it from its dismiss button.
    await obRun(
      run.vaultId,
      async ({ app, page }) => {
        const { press, until } = page;
        (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        ).forEach((leaf) => leaf.detach());
        app.commands.executeCommandById("zotlit:open-welcome-view");
        const el = await until(
          "banner",
          () =>
            (
              app.workspace.getLeavesOfType(
                "zotlit-library",
              ) as (WorkspaceLeaf & { view: LibraryView })[]
            )[0]!.view.contentEl.querySelector<HTMLElement>(
              "[data-welcome-banner]",
            ),
          5000,
        );
        press(
          el.querySelector<HTMLElement>("[data-welcome-dismiss]"),
          "Dismiss the welcome banner",
        );
        await until(
          "banner gone",
          () =>
            !(
              app.workspace.getLeavesOfType(
                "zotlit-library",
              ) as (WorkspaceLeaf & { view: LibraryView })[]
            )[0]!.view.contentEl.querySelector<HTMLElement>(
              "[data-welcome-banner]",
            ),
        );
        return String(true);
      },
      undefined,
    );
    await reloadWindow();
    const kept = await obRunUntil(
      run.vaultId,
      async ({ app }, { value }) => {
        const view = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]?.view;
        if (!view?.tree) return null;
        await view.searched;
        await view.query.settled;
        await view.tree.settled;
        await new Promise((r) => setTimeout(r, 200));
        const el = view.contentEl;
        const row = el.querySelector<HTMLElement>(
          "[data-query-item-row][data-selected]",
        );
        const card = el.querySelector<HTMLElement>("[data-library-card]");
        let inView = false;
        if (row) {
          const r = row.getBoundingClientRect();
          const hit = el.ownerDocument.elementFromPoint(
            r.left + r.width / 2,
            r.top + r.height / 2,
          );
          inView = !!hit && row.contains(hit);
        }
        const action = view.containerEl.querySelector<HTMLElement>(value);
        return {
          phase: view.query.state.getState().phase,
          open: [
            ...el.querySelectorAll<HTMLElement>(
              '[data-library-node][aria-expanded="true"]',
            ),
          ].map((n) => n.getAttribute("data-library-node")!),
          selected: row?.getAttribute("data-query-item-row") ?? null,
          card:
            card && !card.hidden && card.checkVisibility()
              ? (card.querySelector<HTMLElement>("[data-library-card-title]")
                  ?.textContent ?? "")
              : null,
          inView,
          banner: !!el.querySelector<HTMLElement>("[data-welcome-banner]"),
          pressed: action?.getAttribute("aria-pressed") ?? null,
          rows: el.querySelectorAll<HTMLElement>("[data-query-item-row]")
            .length,
        };
      },
      { value: `.view-actions .view-action[aria-label="${help}"]` },
      {
        what: "Library View",
        tries: 120,
        ready: (value) =>
          value !== null && ((shown) => shown.phase === "ready")(value),
      },
    );
    expect(kept).toMatchObject({ banner: false, pressed: "false" });
    expect(
      await obRun(
        run.vaultId,
        async ({ app, zotlit }, { value }) => {
          return String(
            JSON.stringify({
              dismissed: zotlit.services.bridge.runSync(
                zotlit.services.settings.current,
              )["welcome.dismissed"],
              requested: zotlit.services.bridge.runSync(
                zotlit.services.settings.current,
              )["welcome.requested"],
              action: !!(
                app.workspace.getLeavesOfType(
                  "zotlit-library",
                ) as (WorkspaceLeaf & { view: LibraryView })[]
              )[0]!.view.containerEl.querySelector<HTMLElement>(value),
            }),
          );
        },
        { value: `.view-actions .view-action[aria-label="${help}"]` },
      ),
    ).toBe(JSON.stringify({ dismissed: true, requested: false, action: true }));
  });

  it("resizes the Reading Card from its inner edge with the keys and a drag, keeps the width after a window reload, returns it to 24rem on a double click, and widens it toward the list over a narrow pane, with Zotero closed", async () => {
    const snapshot = await obRun(
      run.vaultId,
      async ({ app, zotlit }) => {
        return String(
          JSON.stringify({
            layout: app.workspace.getLayout(),
            document:
              zotlit.services.bridge.runSync(zotlit.services.settings.current)[
                "library.document"
              ] ?? null,
            dismissed: zotlit.services.bridge.runSync(
              zotlit.services.settings.current,
            )["welcome.dismissed"],
            requested: zotlit.services.bridge.runSync(
              zotlit.services.settings.current,
            )["welcome.requested"],
          }),
        );
      },
      undefined,
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obRun(
        run.vaultId,
        async ({ app, zotlit }, { snapshot }) => {
          const saved = JSON.parse(snapshot);
          const { settings, bridge } = zotlit.services;
          bridge.runSync(
            settings.update({
              "library.document": saved.document,
              "welcome.dismissed": saved.dismissed,
              "welcome.requested": saved.requested,
            }),
          );
          await bridge.runPromise(settings.flush);
          await app.workspace.changeLayout(saved.layout);
          return String(true);
        },
        { snapshot: snapshot },
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

    // My Library with no width kept, and its first paper selected.
    await obRun(
      run.vaultId,
      async ({ app, zotlit, page }, { myLibraryDocument }) => {
        const { press, until } = page;
        (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        ).forEach((leaf) => leaf.detach());
        const { settings, bridge } = zotlit.services;
        bridge.runSync(
          settings.update({
            "library.document": myLibraryDocument,
            "welcome.dismissed": true,
            "welcome.requested": false,
          }),
        );
        await bridge.runPromise(settings.flush);
        app.commands.executeCommandById("zotlit:open-library-view");
        const leaf = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0];
        await app.workspace.revealLeaf(leaf!);
        app.workspace.setActiveLeaf(leaf!, { focus: true });
        const el = leaf!.view.contentEl;
        const row = await until(
          "rows",
          () => el.querySelector<HTMLElement>("[data-query-item-row]"),
          20000,
        );
        press(row, "first paper");
        await until(
          "card",
          () => {
            const card = el.querySelector<HTMLElement>("[data-library-card]");
            return !card!.hidden && card!.checkVisibility();
          },
          5000,
        );
        return String(true);
      },
      { myLibraryDocument: MY_LIBRARY_DOCUMENT },
    );
    const first = await obRunUntil(
      run.vaultId,
      async ({ app, zotlit }) => {
        const view = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]?.view;
        if (!view?.query) return null;
        await view.query.settled;
        await new Promise((r) =>
          requestAnimationFrame(() => requestAnimationFrame(r)),
        );
        const el = view.contentEl;
        const card = el.querySelector<HTMLElement>("[data-library-card]");
        const edge = card!.querySelector<HTMLElement>(
          "[data-library-card-resizer]",
        );
        const num = (n: string) => Number(edge!.getAttribute(n));
        return {
          phase: view.query.state.getState().phase,
          shown: !card!.hidden && card!.checkVisibility(),
          width: Math.round(card!.getBoundingClientRect().width),
          list: Math.round(
            el
              .querySelector<HTMLElement>("[data-library-search-row]")!
              .parentElement!.getBoundingClientRect().width,
          ),
          pane: Math.round(
            card!.parentElement!.parentElement!.getBoundingClientRect().width,
          ),
          overlay: getComputedStyle(card!).position === "absolute",
          now: num("aria-valuenow"),
          min: num("aria-valuemin"),
          max: num("aria-valuemax"),
          stored:
            (
              zotlit.services.bridge.runSync(zotlit.services.settings.current)[
                "library.document"
              ] as StoredLibraryViewDocument | null
            )?.cardWidth ?? null,
          label: edge!.getAttribute("aria-label"),
        };
      },
      undefined,
      {
        what: "Reading Card width",
        tries: 120,
        ready: (value) => value !== null && ((shown) => shown.shown)(value),
      },
    );
    // The default 24rem, said on its edge, which names what it does.
    expect(first).toMatchObject({
      width: 384,
      now: 384,
      min: 288,
      stored: null,
      label: run.m.library_view_card_resize_hint(),
    });
    expect(first!.max).toBe(first!.width + first!.list - 320);
    await screenshot("card-default");

    // Three presses toward the list widen it by 16px each.
    await obRun(
      run.vaultId,
      async ({ app }, { arrowLeft }) => {
        const edge = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]!.view.contentEl.querySelector<HTMLElement>(
          "[data-library-card] [data-library-card-resizer]",
        );
        edge!.focus();
        for (const key of arrowLeft) {
          edge!.dispatchEvent(
            new KeyboardEvent("keydown", {
              key,
              bubbles: true,
              cancelable: true,
            }),
          );
          await new Promise((r) => requestAnimationFrame(r));
        }
        return String(true);
      },
      { arrowLeft: ["ArrowLeft", "ArrowLeft", "ArrowLeft"] },
    );
    expect(
      await obRunUntil(
        run.vaultId,
        async ({ app, zotlit }) => {
          const view = (
            app.workspace.getLeavesOfType(
              "zotlit-library",
            ) as (WorkspaceLeaf & { view: LibraryView })[]
          )[0]?.view;
          if (!view?.query) return null;
          await view.query.settled;
          await new Promise((r) =>
            requestAnimationFrame(() => requestAnimationFrame(r)),
          );
          const el = view.contentEl;
          const card = el.querySelector<HTMLElement>("[data-library-card]");
          const edge = card!.querySelector<HTMLElement>(
            "[data-library-card-resizer]",
          );
          const num = (n: string) => Number(edge!.getAttribute(n));
          return {
            phase: view.query.state.getState().phase,
            shown: !card!.hidden && card!.checkVisibility(),
            width: Math.round(card!.getBoundingClientRect().width),
            list: Math.round(
              el
                .querySelector<HTMLElement>("[data-library-search-row]")!
                .parentElement!.getBoundingClientRect().width,
            ),
            pane: Math.round(
              card!.parentElement!.parentElement!.getBoundingClientRect().width,
            ),
            overlay: getComputedStyle(card!).position === "absolute",
            now: num("aria-valuenow"),
            min: num("aria-valuemin"),
            max: num("aria-valuemax"),
            stored:
              (
                zotlit.services.bridge.runSync(
                  zotlit.services.settings.current,
                )["library.document"] as StoredLibraryViewDocument | null
              )?.cardWidth ?? null,
            label: edge!.getAttribute("aria-label"),
          };
        },
        undefined,
        {
          what: "Reading Card width",
          tries: 120,
          ready: (value) =>
            value !== null && ((shown) => shown.stored === 432)(value),
        },
      ),
    ).toMatchObject({
      width: 432,
      now: 432,
    });
    await obRun(
      run.vaultId,
      async ({ app }, { arrowRight }) => {
        const edge = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]!.view.contentEl.querySelector<HTMLElement>(
          "[data-library-card] [data-library-card-resizer]",
        );
        edge!.focus();
        for (const key of arrowRight) {
          edge!.dispatchEvent(
            new KeyboardEvent("keydown", {
              key,
              bubbles: true,
              cancelable: true,
            }),
          );
          await new Promise((r) => requestAnimationFrame(r));
        }
        return String(true);
      },
      { arrowRight: ["ArrowRight"] },
    );
    await obRunUntil(
      run.vaultId,
      async ({ app, zotlit }) => {
        const view = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]?.view;
        if (!view?.query) return null;
        await view.query.settled;
        await new Promise((r) =>
          requestAnimationFrame(() => requestAnimationFrame(r)),
        );
        const el = view.contentEl;
        const card = el.querySelector<HTMLElement>("[data-library-card]");
        const edge = card!.querySelector<HTMLElement>(
          "[data-library-card-resizer]",
        );
        const num = (n: string) => Number(edge!.getAttribute(n));
        return {
          phase: view.query.state.getState().phase,
          shown: !card!.hidden && card!.checkVisibility(),
          width: Math.round(card!.getBoundingClientRect().width),
          list: Math.round(
            el
              .querySelector<HTMLElement>("[data-library-search-row]")!
              .parentElement!.getBoundingClientRect().width,
          ),
          pane: Math.round(
            card!.parentElement!.parentElement!.getBoundingClientRect().width,
          ),
          overlay: getComputedStyle(card!).position === "absolute",
          now: num("aria-valuenow"),
          min: num("aria-valuemin"),
          max: num("aria-valuemax"),
          stored:
            (
              zotlit.services.bridge.runSync(zotlit.services.settings.current)[
                "library.document"
              ] as StoredLibraryViewDocument | null
            )?.cardWidth ?? null,
          label: edge!.getAttribute("aria-label"),
        };
      },
      undefined,
      {
        what: "Reading Card width",
        tries: 120,
        ready: (value) =>
          value !== null && ((shown) => shown.stored === 416)(value),
      },
    );
    // Home and End take it to its narrowest and its widest, which leaves
    // the list 20rem.
    await obRun(
      run.vaultId,
      async ({ app }, { home }) => {
        const edge = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]!.view.contentEl.querySelector<HTMLElement>(
          "[data-library-card] [data-library-card-resizer]",
        );
        edge!.focus();
        for (const key of home) {
          edge!.dispatchEvent(
            new KeyboardEvent("keydown", {
              key,
              bubbles: true,
              cancelable: true,
            }),
          );
          await new Promise((r) => requestAnimationFrame(r));
        }
        return String(true);
      },
      { home: ["Home"] },
    );
    expect(
      await obRunUntil(
        run.vaultId,
        async ({ app, zotlit }) => {
          const view = (
            app.workspace.getLeavesOfType(
              "zotlit-library",
            ) as (WorkspaceLeaf & { view: LibraryView })[]
          )[0]?.view;
          if (!view?.query) return null;
          await view.query.settled;
          await new Promise((r) =>
            requestAnimationFrame(() => requestAnimationFrame(r)),
          );
          const el = view.contentEl;
          const card = el.querySelector<HTMLElement>("[data-library-card]");
          const edge = card!.querySelector<HTMLElement>(
            "[data-library-card-resizer]",
          );
          const num = (n: string) => Number(edge!.getAttribute(n));
          return {
            phase: view.query.state.getState().phase,
            shown: !card!.hidden && card!.checkVisibility(),
            width: Math.round(card!.getBoundingClientRect().width),
            list: Math.round(
              el
                .querySelector<HTMLElement>("[data-library-search-row]")!
                .parentElement!.getBoundingClientRect().width,
            ),
            pane: Math.round(
              card!.parentElement!.parentElement!.getBoundingClientRect().width,
            ),
            overlay: getComputedStyle(card!).position === "absolute",
            now: num("aria-valuenow"),
            min: num("aria-valuemin"),
            max: num("aria-valuemax"),
            stored:
              (
                zotlit.services.bridge.runSync(
                  zotlit.services.settings.current,
                )["library.document"] as StoredLibraryViewDocument | null
              )?.cardWidth ?? null,
            label: edge!.getAttribute("aria-label"),
          };
        },
        undefined,
        {
          what: "Reading Card width",
          tries: 120,
          ready: (value) =>
            value !== null && ((shown) => shown.stored === 288)(value),
        },
      ),
    ).toMatchObject({
      width: 288,
    });
    await obRun(
      run.vaultId,
      async ({ app }, { end }) => {
        const edge = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]!.view.contentEl.querySelector<HTMLElement>(
          "[data-library-card] [data-library-card-resizer]",
        );
        edge!.focus();
        for (const key of end) {
          edge!.dispatchEvent(
            new KeyboardEvent("keydown", {
              key,
              bubbles: true,
              cancelable: true,
            }),
          );
          await new Promise((r) => requestAnimationFrame(r));
        }
        return String(true);
      },
      { end: ["End"] },
    );
    const widest = await obRunUntil(
      run.vaultId,
      async ({ app, zotlit }) => {
        const view = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]?.view;
        if (!view?.query) return null;
        await view.query.settled;
        await new Promise((r) =>
          requestAnimationFrame(() => requestAnimationFrame(r)),
        );
        const el = view.contentEl;
        const card = el.querySelector<HTMLElement>("[data-library-card]");
        const edge = card!.querySelector<HTMLElement>(
          "[data-library-card-resizer]",
        );
        const num = (n: string) => Number(edge!.getAttribute(n));
        return {
          phase: view.query.state.getState().phase,
          shown: !card!.hidden && card!.checkVisibility(),
          width: Math.round(card!.getBoundingClientRect().width),
          list: Math.round(
            el
              .querySelector<HTMLElement>("[data-library-search-row]")!
              .parentElement!.getBoundingClientRect().width,
          ),
          pane: Math.round(
            card!.parentElement!.parentElement!.getBoundingClientRect().width,
          ),
          overlay: getComputedStyle(card!).position === "absolute",
          now: num("aria-valuenow"),
          min: num("aria-valuemin"),
          max: num("aria-valuemax"),
          stored:
            (
              zotlit.services.bridge.runSync(zotlit.services.settings.current)[
                "library.document"
              ] as StoredLibraryViewDocument | null
            )?.cardWidth ?? null,
          label: edge!.getAttribute("aria-label"),
        };
      },
      undefined,
      {
        what: "Reading Card width",
        tries: 120,
        ready: (value) =>
          value !== null && ((shown) => shown.stored === first!.max)(value),
      },
    );
    expect(widest).toMatchObject({ width: first!.max, list: 320 });

    // A drag of the edge 100px away from the list, back from the widest.
    await obRun(
      run.vaultId,
      async ({ app }) => {
        const edge = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]!.view.contentEl.querySelector<HTMLElement>(
          "[data-library-card] [data-library-card-resizer]",
        );
        const r = edge!.getBoundingClientRect();
        const x = r.left + r.width / 2;
        const y = r.top + r.height / 2;
        const fire = (type: string, clientX: number) =>
          edge!.dispatchEvent(
            new PointerEvent(type, {
              bubbles: true,
              cancelable: true,
              pointerId: 7,
              isPrimary: true,
              button: 0,
              buttons: type === "pointerup" ? 0 : 1,
              clientX,
              clientY: y,
            }),
          );
        fire("pointerdown", x);
        if (!document.body.classList.contains("zt-is-resizing-library-card"))
          throw new Error("No resize cursor");
        for (const step of [25, 50, 75, 100]) {
          fire("pointermove", x + step);
          await new Promise((r) => requestAnimationFrame(r));
        }
        fire("pointerup", x + 100);
        return String(true);
      },
      undefined,
    );
    const dragged = await obRunUntil(
      run.vaultId,
      async ({ app, zotlit }) => {
        const view = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]?.view;
        if (!view?.query) return null;
        await view.query.settled;
        await new Promise((r) =>
          requestAnimationFrame(() => requestAnimationFrame(r)),
        );
        const el = view.contentEl;
        const card = el.querySelector<HTMLElement>("[data-library-card]");
        const edge = card!.querySelector<HTMLElement>(
          "[data-library-card-resizer]",
        );
        const num = (n: string) => Number(edge!.getAttribute(n));
        return {
          phase: view.query.state.getState().phase,
          shown: !card!.hidden && card!.checkVisibility(),
          width: Math.round(card!.getBoundingClientRect().width),
          list: Math.round(
            el
              .querySelector<HTMLElement>("[data-library-search-row]")!
              .parentElement!.getBoundingClientRect().width,
          ),
          pane: Math.round(
            card!.parentElement!.parentElement!.getBoundingClientRect().width,
          ),
          overlay: getComputedStyle(card!).position === "absolute",
          now: num("aria-valuenow"),
          min: num("aria-valuemin"),
          max: num("aria-valuemax"),
          stored:
            (
              zotlit.services.bridge.runSync(zotlit.services.settings.current)[
                "library.document"
              ] as StoredLibraryViewDocument | null
            )?.cardWidth ?? null,
          label: edge!.getAttribute("aria-label"),
        };
      },
      undefined,
      {
        what: "Reading Card width",
        tries: 120,
        ready: (value) =>
          value !== null &&
          ((shown) => shown.stored === first!.max - 100)(value),
      },
    );
    expect(dragged).toMatchObject({ width: first!.max - 100 });
    await screenshot("card-resized");

    // A reload keeps the width.
    await reloadWindow();
    const after = await obRunUntil(
      run.vaultId,
      async ({ app, zotlit }) => {
        const view = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]?.view;
        if (!view?.query) return null;
        await view.query.settled;
        await new Promise((r) =>
          requestAnimationFrame(() => requestAnimationFrame(r)),
        );
        const el = view.contentEl;
        const card = el.querySelector<HTMLElement>("[data-library-card]");
        const edge = card!.querySelector<HTMLElement>(
          "[data-library-card-resizer]",
        );
        const num = (n: string) => Number(edge!.getAttribute(n));
        return {
          phase: view.query.state.getState().phase,
          shown: !card!.hidden && card!.checkVisibility(),
          width: Math.round(card!.getBoundingClientRect().width),
          list: Math.round(
            el
              .querySelector<HTMLElement>("[data-library-search-row]")!
              .parentElement!.getBoundingClientRect().width,
          ),
          pane: Math.round(
            card!.parentElement!.parentElement!.getBoundingClientRect().width,
          ),
          overlay: getComputedStyle(card!).position === "absolute",
          now: num("aria-valuenow"),
          min: num("aria-valuemin"),
          max: num("aria-valuemax"),
          stored:
            (
              zotlit.services.bridge.runSync(zotlit.services.settings.current)[
                "library.document"
              ] as StoredLibraryViewDocument | null
            )?.cardWidth ?? null,
          label: edge!.getAttribute("aria-label"),
        };
      },
      undefined,
      {
        what: "Reading Card width",
        tries: 120,
        ready: (value) =>
          value !== null &&
          ((shown) => shown.phase === "ready" && shown.shown)(value),
      },
    );
    expect(after).toMatchObject({
      width: dragged!.width,
      now: dragged!.width,
      stored: dragged!.width,
    });

    // A double click puts the default back, and keeps no width.
    await obRun(
      run.vaultId,
      async ({ app }) => {
        (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]!.view.contentEl
          .querySelector<HTMLElement>(
            "[data-library-card] [data-library-card-resizer]",
          )!
          .dispatchEvent(
            new MouseEvent("dblclick", {
              bubbles: true,
              cancelable: true,
              detail: 2,
            }),
          );
        return String(true);
      },
      undefined,
    );
    expect(
      await obRunUntil(
        run.vaultId,
        async ({ app, zotlit }) => {
          const view = (
            app.workspace.getLeavesOfType(
              "zotlit-library",
            ) as (WorkspaceLeaf & { view: LibraryView })[]
          )[0]?.view;
          if (!view?.query) return null;
          await view.query.settled;
          await new Promise((r) =>
            requestAnimationFrame(() => requestAnimationFrame(r)),
          );
          const el = view.contentEl;
          const card = el.querySelector<HTMLElement>("[data-library-card]");
          const edge = card!.querySelector<HTMLElement>(
            "[data-library-card-resizer]",
          );
          const num = (n: string) => Number(edge!.getAttribute(n));
          return {
            phase: view.query.state.getState().phase,
            shown: !card!.hidden && card!.checkVisibility(),
            width: Math.round(card!.getBoundingClientRect().width),
            list: Math.round(
              el
                .querySelector<HTMLElement>("[data-library-search-row]")!
                .parentElement!.getBoundingClientRect().width,
            ),
            pane: Math.round(
              card!.parentElement!.parentElement!.getBoundingClientRect().width,
            ),
            overlay: getComputedStyle(card!).position === "absolute",
            now: num("aria-valuenow"),
            min: num("aria-valuemin"),
            max: num("aria-valuemax"),
            stored:
              (
                zotlit.services.bridge.runSync(
                  zotlit.services.settings.current,
                )["library.document"] as StoredLibraryViewDocument | null
              )?.cardWidth ?? null,
            label: edge!.getAttribute("aria-label"),
          };
        },
        undefined,
        {
          what: "Reading Card width",
          tries: 120,
          ready: (value) =>
            value !== null && ((shown) => shown.stored === null)(value),
        },
      ),
    ).toMatchObject({
      width: 384,
      now: 384,
    });

    // Over a narrow pane the card takes up to 85% of the pane it overlays,
    // the list's 20rem aside: from its narrowest, the key toward the list
    // widens it.
    await obRun(
      run.vaultId,
      async ({ app, page }) => {
        const { press, until } = page;
        require("@electron/remote").getCurrentWindow().setSize(740, 1000);
        const el = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]!.view.contentEl;
        const card = el.querySelector<HTMLElement>("[data-library-card]");
        await until(
          "the narrow pane",
          () =>
            activeWindow.outerWidth === 740 &&
            getComputedStyle(card!).position === "absolute",
          5000,
        );
        if (!card!.checkVisibility())
          press(
            el.querySelector<HTMLElement>(
              "[data-query-item-row][data-selected]",
            ),
            "selected paper",
          );
        await until(
          "card over the list",
          () => !card!.hidden && card!.checkVisibility(),
          5000,
        );
        return String(true);
      },
      undefined,
    );
    const narrow = await obRunUntil(
      run.vaultId,
      async ({ app, zotlit }) => {
        const view = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]?.view;
        if (!view?.query) return null;
        await view.query.settled;
        await new Promise((r) =>
          requestAnimationFrame(() => requestAnimationFrame(r)),
        );
        const el = view.contentEl;
        const card = el.querySelector<HTMLElement>("[data-library-card]");
        const edge = card!.querySelector<HTMLElement>(
          "[data-library-card-resizer]",
        );
        const num = (n: string) => Number(edge!.getAttribute(n));
        return {
          phase: view.query.state.getState().phase,
          shown: !card!.hidden && card!.checkVisibility(),
          width: Math.round(card!.getBoundingClientRect().width),
          list: Math.round(
            el
              .querySelector<HTMLElement>("[data-library-search-row]")!
              .parentElement!.getBoundingClientRect().width,
          ),
          pane: Math.round(
            card!.parentElement!.parentElement!.getBoundingClientRect().width,
          ),
          overlay: getComputedStyle(card!).position === "absolute",
          now: num("aria-valuenow"),
          min: num("aria-valuemin"),
          max: num("aria-valuemax"),
          stored:
            (
              zotlit.services.bridge.runSync(zotlit.services.settings.current)[
                "library.document"
              ] as StoredLibraryViewDocument | null
            )?.cardWidth ?? null,
          label: edge!.getAttribute("aria-label"),
        };
      },
      undefined,
      {
        what: "Reading Card width",
        tries: 120,
        ready: (value) =>
          value !== null && ((shown) => shown.shown && shown.overlay)(value),
      },
    );
    expect(narrow!.max).toBe(Math.floor(narrow!.pane * 0.85));
    expect(narrow!.max).toBeGreaterThan(288);
    await obRun(
      run.vaultId,
      async ({ app }, { home }) => {
        const edge = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]!.view.contentEl.querySelector<HTMLElement>(
          "[data-library-card] [data-library-card-resizer]",
        );
        edge!.focus();
        for (const key of home) {
          edge!.dispatchEvent(
            new KeyboardEvent("keydown", {
              key,
              bubbles: true,
              cancelable: true,
            }),
          );
          await new Promise((r) => requestAnimationFrame(r));
        }
        return String(true);
      },
      { home: ["Home"] },
    );
    expect(
      await obRunUntil(
        run.vaultId,
        async ({ app, zotlit }) => {
          const view = (
            app.workspace.getLeavesOfType(
              "zotlit-library",
            ) as (WorkspaceLeaf & { view: LibraryView })[]
          )[0]?.view;
          if (!view?.query) return null;
          await view.query.settled;
          await new Promise((r) =>
            requestAnimationFrame(() => requestAnimationFrame(r)),
          );
          const el = view.contentEl;
          const card = el.querySelector<HTMLElement>("[data-library-card]");
          const edge = card!.querySelector<HTMLElement>(
            "[data-library-card-resizer]",
          );
          const num = (n: string) => Number(edge!.getAttribute(n));
          return {
            phase: view.query.state.getState().phase,
            shown: !card!.hidden && card!.checkVisibility(),
            width: Math.round(card!.getBoundingClientRect().width),
            list: Math.round(
              el
                .querySelector<HTMLElement>("[data-library-search-row]")!
                .parentElement!.getBoundingClientRect().width,
            ),
            pane: Math.round(
              card!.parentElement!.parentElement!.getBoundingClientRect().width,
            ),
            overlay: getComputedStyle(card!).position === "absolute",
            now: num("aria-valuenow"),
            min: num("aria-valuemin"),
            max: num("aria-valuemax"),
            stored:
              (
                zotlit.services.bridge.runSync(
                  zotlit.services.settings.current,
                )["library.document"] as StoredLibraryViewDocument | null
              )?.cardWidth ?? null,
            label: edge!.getAttribute("aria-label"),
          };
        },
        undefined,
        {
          what: "Reading Card width",
          tries: 120,
          ready: (value) =>
            value !== null && ((shown) => shown.stored === 288)(value),
        },
      ),
    ).toMatchObject({
      width: 288,
      min: 288,
    });
    await obRun(
      run.vaultId,
      async ({ app }, { arrowLeft }) => {
        const edge = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]!.view.contentEl.querySelector<HTMLElement>(
          "[data-library-card] [data-library-card-resizer]",
        );
        edge!.focus();
        for (const key of arrowLeft) {
          edge!.dispatchEvent(
            new KeyboardEvent("keydown", {
              key,
              bubbles: true,
              cancelable: true,
            }),
          );
          await new Promise((r) => requestAnimationFrame(r));
        }
        return String(true);
      },
      { arrowLeft: ["ArrowLeft", "ArrowLeft"] },
    );
    expect(
      await obRunUntil(
        run.vaultId,
        async ({ app, zotlit }) => {
          const view = (
            app.workspace.getLeavesOfType(
              "zotlit-library",
            ) as (WorkspaceLeaf & { view: LibraryView })[]
          )[0]?.view;
          if (!view?.query) return null;
          await view.query.settled;
          await new Promise((r) =>
            requestAnimationFrame(() => requestAnimationFrame(r)),
          );
          const el = view.contentEl;
          const card = el.querySelector<HTMLElement>("[data-library-card]");
          const edge = card!.querySelector<HTMLElement>(
            "[data-library-card-resizer]",
          );
          const num = (n: string) => Number(edge!.getAttribute(n));
          return {
            phase: view.query.state.getState().phase,
            shown: !card!.hidden && card!.checkVisibility(),
            width: Math.round(card!.getBoundingClientRect().width),
            list: Math.round(
              el
                .querySelector<HTMLElement>("[data-library-search-row]")!
                .parentElement!.getBoundingClientRect().width,
            ),
            pane: Math.round(
              card!.parentElement!.parentElement!.getBoundingClientRect().width,
            ),
            overlay: getComputedStyle(card!).position === "absolute",
            now: num("aria-valuenow"),
            min: num("aria-valuemin"),
            max: num("aria-valuemax"),
            stored:
              (
                zotlit.services.bridge.runSync(
                  zotlit.services.settings.current,
                )["library.document"] as StoredLibraryViewDocument | null
              )?.cardWidth ?? null,
            label: edge!.getAttribute("aria-label"),
          };
        },
        undefined,
        {
          what: "Reading Card width",
          tries: 120,
          ready: (value) =>
            value !== null && ((shown) => shown.stored === 320)(value),
        },
      ),
    ).toMatchObject({
      width: 320,
      now: 320,
      overlay: true,
    });
    await screenshot("card-narrow-widened");
  });

  it("closes the Reading Card on a wide pane from its close button or a drag of its edge past the minimum, keeps it closed while the arrow keys move and after a window reload, and opens it on a row click at the width it had, with Zotero closed", async () => {
    const snapshot = await obRun(
      run.vaultId,
      async ({ app, zotlit }) => {
        return String(
          JSON.stringify({
            layout: app.workspace.getLayout(),
            document:
              zotlit.services.bridge.runSync(zotlit.services.settings.current)[
                "library.document"
              ] ?? null,
            dismissed: zotlit.services.bridge.runSync(
              zotlit.services.settings.current,
            )["welcome.dismissed"],
            requested: zotlit.services.bridge.runSync(
              zotlit.services.settings.current,
            )["welcome.requested"],
          }),
        );
      },
      undefined,
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obRun(
        run.vaultId,
        async ({ app, zotlit }, { snapshot }) => {
          const saved = JSON.parse(snapshot);
          const { settings, bridge } = zotlit.services;
          bridge.runSync(
            settings.update({
              "library.document": saved.document,
              "welcome.dismissed": saved.dismissed,
              "welcome.requested": saved.requested,
            }),
          );
          await bridge.runPromise(settings.flush);
          await app.workspace.changeLayout(saved.layout);
          return String(true);
        },
        { snapshot: snapshot },
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

    const rowKey = async (index: number) =>
      JSON.parse(
        await obRun(
          run.vaultId,
          async ({ app }, { index }) => {
            return String(
              JSON.stringify(
                [
                  ...(
                    app.workspace.getLeavesOfType(
                      "zotlit-library",
                    ) as (WorkspaceLeaf & { view: LibraryView })[]
                  )[0]!.view.contentEl.querySelectorAll<HTMLElement>(
                    "[data-query-item-row]",
                  )!,
                ][index]!.getAttribute("data-query-item-row")!,
              ),
            );
          },
          { index: index },
        ),
      ) as string;

    /**
     * Drag the edge: press it, then move the pointer by each of `steps`
     * pixels away from the list, a frame apiece, and let go where `release`.
     */
    const drag = (steps: number[], { press = true, release = true } = {}) =>
      obRun(
        run.vaultId,
        async ({ app, page }, { press, steps, release }) => {
          const edge = (
            app.workspace.getLeavesOfType(
              "zotlit-library",
            ) as (WorkspaceLeaf & { view: LibraryView })[]
          )[0]!.view.contentEl.querySelector<HTMLElement>(
            "[data-library-card] [data-library-card-resizer]",
          );
          const r = edge!.getBoundingClientRect();
          page.scratch.libraryCardDrag ??= {
            x: r.left + r.width / 2,
            y: r.top + r.height / 2,
          };
          const { x, y } = page.scratch.libraryCardDrag;
          const fire = (type: string, clientX: number) =>
            edge!.dispatchEvent(
              new PointerEvent(type, {
                bubbles: true,
                cancelable: true,
                pointerId: 7,
                isPrimary: true,
                button: 0,
                buttons: type === "pointerup" ? 0 : 1,
                clientX,
                clientY: y,
              }),
            );
          if (press) fire("pointerdown", x);
          let last = 0;
          for (const step of steps) {
            last = step;
            fire("pointermove", x + step);
            await new Promise((r) => requestAnimationFrame(r));
          }
          if (release) {
            fire("pointerup", x + last);
            delete page.scratch.libraryCardDrag;
          }
          return String(true);
        },
        { press: press, steps: steps, release: release },
      );
    // My Library with the card 400px wide, and its first paper selected.
    await obRun(
      run.vaultId,
      async ({ app, zotlit, page }, { document }) => {
        const { press, until } = page;
        (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        ).forEach((leaf) => leaf.detach());
        const { settings, bridge } = zotlit.services;
        bridge.runSync(
          settings.update({
            "library.document": document,
            "welcome.dismissed": true,
            "welcome.requested": false,
          }),
        );
        await bridge.runPromise(settings.flush);
        app.commands.executeCommandById("zotlit:open-library-view");
        const leaf = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0];
        await app.workspace.revealLeaf(leaf!);
        app.workspace.setActiveLeaf(leaf!, { focus: true });
        const el = leaf!.view.contentEl;
        const row = await until(
          "rows",
          () => el.querySelector<HTMLElement>("[data-query-item-row]"),
          20000,
        );
        press(row, "first paper");
        await until(
          "card",
          () => {
            const card = el.querySelector<HTMLElement>("[data-library-card]");
            return !card!.hidden && card!.checkVisibility();
          },
          5000,
        );
        return String(true);
      },
      { document: { ...MY_LIBRARY_DOCUMENT, cardWidth: 400 } },
    );
    const first = await rowKey(0);
    const second = await rowKey(1);
    const open = await obRunUntil(
      run.vaultId,
      async ({ app, zotlit }) => {
        const view = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]?.view;
        if (!view?.query) return null;
        await view.query.settled;
        await new Promise((r) =>
          requestAnimationFrame(() => requestAnimationFrame(r)),
        );
        const el = view.contentEl;
        const card = el.querySelector<HTMLElement>("[data-library-card]");
        const doc = zotlit.services.bridge.runSync(
          zotlit.services.settings.current,
        )["library.document"] as StoredLibraryViewDocument | null;
        return {
          phase: view.query.state.getState().phase,
          shown: !card!.hidden && card!.checkVisibility(),
          width: Math.round(card!.getBoundingClientRect().width),
          list: Math.round(
            el
              .querySelector<HTMLElement>("[data-library-search-row]")!
              .parentElement!.getBoundingClientRect().width,
          ),
          selected: view.selected.key,
          focused:
            activeDocument.activeElement?.getAttribute("data-query-item-row") ??
            null,
          stored: doc?.cardWidth ?? null,
          closed: doc?.cardClosed ?? null,
          kept: doc?.selected ?? null,
        };
      },
      undefined,
      {
        what: "Reading Card",
        tries: 120,
        ready: (value) => value !== null && ((shown) => shown.shown)(value),
      },
    );
    expect(open).toMatchObject({ width: 400, selected: first, closed: null });

    // The close button shows on the wide pane too; it hides the card, the
    // list takes its room, and the row keeps the selection and the focus.
    await obRun(
      run.vaultId,
      async ({ app, page }) => {
        const { press } = page;
        press(
          (
            app.workspace.getLeavesOfType(
              "zotlit-library",
            ) as (WorkspaceLeaf & { view: LibraryView })[]
          )[0]!.view.contentEl.querySelector<HTMLElement>(
            "[data-library-card] [data-library-card-close]",
          ),
          "close button",
        );
        return String(true);
      },
      undefined,
    );
    const closed = await obRunUntil(
      run.vaultId,
      async ({ app, zotlit }) => {
        const view = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]?.view;
        if (!view?.query) return null;
        await view.query.settled;
        await new Promise((r) =>
          requestAnimationFrame(() => requestAnimationFrame(r)),
        );
        const el = view.contentEl;
        const card = el.querySelector<HTMLElement>("[data-library-card]");
        const doc = zotlit.services.bridge.runSync(
          zotlit.services.settings.current,
        )["library.document"] as StoredLibraryViewDocument | null;
        return {
          phase: view.query.state.getState().phase,
          shown: !card!.hidden && card!.checkVisibility(),
          width: Math.round(card!.getBoundingClientRect().width),
          list: Math.round(
            el
              .querySelector<HTMLElement>("[data-library-search-row]")!
              .parentElement!.getBoundingClientRect().width,
          ),
          selected: view.selected.key,
          focused:
            activeDocument.activeElement?.getAttribute("data-query-item-row") ??
            null,
          stored: doc?.cardWidth ?? null,
          closed: doc?.cardClosed ?? null,
          kept: doc?.selected ?? null,
        };
      },
      undefined,
      {
        what: "Reading Card",
        tries: 120,
        ready: (value) =>
          value !== null && ((shown) => shown.closed === true)(value),
      },
    );
    expect(closed).toMatchObject({
      shown: false,
      selected: first,
      focused: first,
      stored: 400,
    });
    expect(closed!.list).toBe(open!.list + open!.width);
    await screenshot("wide-closed");

    // The arrow keys move the selection and leave the card closed.
    await obRun(
      run.vaultId,
      async () => {
        activeDocument.activeElement!.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "ArrowDown",
            bubbles: true,
            cancelable: true,
          }),
        );
        return String(true);
      },
      undefined,
    );
    expect(
      await obRunUntil(
        run.vaultId,
        async ({ app, zotlit }) => {
          const view = (
            app.workspace.getLeavesOfType(
              "zotlit-library",
            ) as (WorkspaceLeaf & { view: LibraryView })[]
          )[0]?.view;
          if (!view?.query) return null;
          await view.query.settled;
          await new Promise((r) =>
            requestAnimationFrame(() => requestAnimationFrame(r)),
          );
          const el = view.contentEl;
          const card = el.querySelector<HTMLElement>("[data-library-card]");
          const doc = zotlit.services.bridge.runSync(
            zotlit.services.settings.current,
          )["library.document"] as StoredLibraryViewDocument | null;
          return {
            phase: view.query.state.getState().phase,
            shown: !card!.hidden && card!.checkVisibility(),
            width: Math.round(card!.getBoundingClientRect().width),
            list: Math.round(
              el
                .querySelector<HTMLElement>("[data-library-search-row]")!
                .parentElement!.getBoundingClientRect().width,
            ),
            selected: view.selected.key,
            focused:
              activeDocument.activeElement?.getAttribute(
                "data-query-item-row",
              ) ?? null,
            stored: doc?.cardWidth ?? null,
            closed: doc?.cardClosed ?? null,
            kept: doc?.selected ?? null,
          };
        },
        undefined,
        {
          what: "Reading Card",
          tries: 120,
          ready: (value) =>
            value !== null && ((shown) => shown.selected === second)(value),
        },
      ),
    ).toMatchObject({ shown: false, closed: true });

    // A reload keeps it closed beside the restored selection.
    await obRunUntil(
      run.vaultId,
      async ({ app, zotlit }) => {
        const view = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]?.view;
        if (!view?.query) return null;
        await view.query.settled;
        await new Promise((r) =>
          requestAnimationFrame(() => requestAnimationFrame(r)),
        );
        const el = view.contentEl;
        const card = el.querySelector<HTMLElement>("[data-library-card]");
        const doc = zotlit.services.bridge.runSync(
          zotlit.services.settings.current,
        )["library.document"] as StoredLibraryViewDocument | null;
        return {
          phase: view.query.state.getState().phase,
          shown: !card!.hidden && card!.checkVisibility(),
          width: Math.round(card!.getBoundingClientRect().width),
          list: Math.round(
            el
              .querySelector<HTMLElement>("[data-library-search-row]")!
              .parentElement!.getBoundingClientRect().width,
          ),
          selected: view.selected.key,
          focused:
            activeDocument.activeElement?.getAttribute("data-query-item-row") ??
            null,
          stored: doc?.cardWidth ?? null,
          closed: doc?.cardClosed ?? null,
          kept: doc?.selected ?? null,
        };
      },
      undefined,
      {
        what: "Reading Card",
        tries: 120,
        ready: (value) =>
          value !== null && ((shown) => shown.kept === second)(value),
      },
    );
    await reloadWindow();
    expect(
      await obRunUntil(
        run.vaultId,
        async ({ app, zotlit }) => {
          const view = (
            app.workspace.getLeavesOfType(
              "zotlit-library",
            ) as (WorkspaceLeaf & { view: LibraryView })[]
          )[0]?.view;
          if (!view?.query) return null;
          await view.query.settled;
          await new Promise((r) =>
            requestAnimationFrame(() => requestAnimationFrame(r)),
          );
          const el = view.contentEl;
          const card = el.querySelector<HTMLElement>("[data-library-card]");
          const doc = zotlit.services.bridge.runSync(
            zotlit.services.settings.current,
          )["library.document"] as StoredLibraryViewDocument | null;
          return {
            phase: view.query.state.getState().phase,
            shown: !card!.hidden && card!.checkVisibility(),
            width: Math.round(card!.getBoundingClientRect().width),
            list: Math.round(
              el
                .querySelector<HTMLElement>("[data-library-search-row]")!
                .parentElement!.getBoundingClientRect().width,
            ),
            selected: view.selected.key,
            focused:
              activeDocument.activeElement?.getAttribute(
                "data-query-item-row",
              ) ?? null,
            stored: doc?.cardWidth ?? null,
            closed: doc?.cardClosed ?? null,
            kept: doc?.selected ?? null,
          };
        },
        undefined,
        {
          what: "Reading Card",
          tries: 120,
          ready: (value) =>
            value !== null &&
            ((shown) => shown.phase === "ready" && shown.selected === second)(
              value,
            ),
        },
      ),
    ).toMatchObject({ shown: false, closed: true, stored: 400 });

    // A click on a row opens it again, at its width.
    await obRun(
      run.vaultId,
      async ({ app, page }, { position }) => {
        const { press } = page;
        press(
          [
            ...(
              app.workspace.getLeavesOfType(
                "zotlit-library",
              ) as (WorkspaceLeaf & { view: LibraryView })[]
            )[0]!.view.contentEl.querySelectorAll<HTMLElement>(
              "[data-query-item-row]",
            )!,
          ][position],
          `paper ${position}`,
        );
        return String(true);
      },
      { position: 1 },
    );
    expect(
      await obRunUntil(
        run.vaultId,
        async ({ app, zotlit }) => {
          const view = (
            app.workspace.getLeavesOfType(
              "zotlit-library",
            ) as (WorkspaceLeaf & { view: LibraryView })[]
          )[0]?.view;
          if (!view?.query) return null;
          await view.query.settled;
          await new Promise((r) =>
            requestAnimationFrame(() => requestAnimationFrame(r)),
          );
          const el = view.contentEl;
          const card = el.querySelector<HTMLElement>("[data-library-card]");
          const doc = zotlit.services.bridge.runSync(
            zotlit.services.settings.current,
          )["library.document"] as StoredLibraryViewDocument | null;
          return {
            phase: view.query.state.getState().phase,
            shown: !card!.hidden && card!.checkVisibility(),
            width: Math.round(card!.getBoundingClientRect().width),
            list: Math.round(
              el
                .querySelector<HTMLElement>("[data-library-search-row]")!
                .parentElement!.getBoundingClientRect().width,
            ),
            selected: view.selected.key,
            focused:
              activeDocument.activeElement?.getAttribute(
                "data-query-item-row",
              ) ?? null,
            stored: doc?.cardWidth ?? null,
            closed: doc?.cardClosed ?? null,
            kept: doc?.selected ?? null,
          };
        },
        undefined,
        {
          what: "Reading Card",
          tries: 120,
          ready: (value) => value !== null && ((shown) => shown.shown)(value),
        },
      ),
    ).toMatchObject({
      width: 400,
      closed: null,
    });

    // A drag 300px away from the list takes the card 156px under its
    // 288px minimum, past the 144px that collapses it while the pointer
    // stays; back within the threshold it shows again at the minimum.
    await drag([100, 200, 300], { release: false });
    expect(
      await obRunUntil(
        run.vaultId,
        async ({ app, zotlit }) => {
          const view = (
            app.workspace.getLeavesOfType(
              "zotlit-library",
            ) as (WorkspaceLeaf & { view: LibraryView })[]
          )[0]?.view;
          if (!view?.query) return null;
          await view.query.settled;
          await new Promise((r) =>
            requestAnimationFrame(() => requestAnimationFrame(r)),
          );
          const el = view.contentEl;
          const card = el.querySelector<HTMLElement>("[data-library-card]");
          const doc = zotlit.services.bridge.runSync(
            zotlit.services.settings.current,
          )["library.document"] as StoredLibraryViewDocument | null;
          return {
            phase: view.query.state.getState().phase,
            shown: !card!.hidden && card!.checkVisibility(),
            width: Math.round(card!.getBoundingClientRect().width),
            list: Math.round(
              el
                .querySelector<HTMLElement>("[data-library-search-row]")!
                .parentElement!.getBoundingClientRect().width,
            ),
            selected: view.selected.key,
            focused:
              activeDocument.activeElement?.getAttribute(
                "data-query-item-row",
              ) ?? null,
            stored: doc?.cardWidth ?? null,
            closed: doc?.cardClosed ?? null,
            kept: doc?.selected ?? null,
          };
        },
        undefined,
        {
          what: "Reading Card",
          tries: 120,
          ready: (value) => value !== null && ((shown) => !shown.shown)(value),
        },
      ),
    ).toMatchObject({
      closed: null,
      stored: 400,
    });
    await screenshot("mid-drag-collapsed");
    await drag([200], { press: false, release: false });
    expect(
      await obRunUntil(
        run.vaultId,
        async ({ app, zotlit }) => {
          const view = (
            app.workspace.getLeavesOfType(
              "zotlit-library",
            ) as (WorkspaceLeaf & { view: LibraryView })[]
          )[0]?.view;
          if (!view?.query) return null;
          await view.query.settled;
          await new Promise((r) =>
            requestAnimationFrame(() => requestAnimationFrame(r)),
          );
          const el = view.contentEl;
          const card = el.querySelector<HTMLElement>("[data-library-card]");
          const doc = zotlit.services.bridge.runSync(
            zotlit.services.settings.current,
          )["library.document"] as StoredLibraryViewDocument | null;
          return {
            phase: view.query.state.getState().phase,
            shown: !card!.hidden && card!.checkVisibility(),
            width: Math.round(card!.getBoundingClientRect().width),
            list: Math.round(
              el
                .querySelector<HTMLElement>("[data-library-search-row]")!
                .parentElement!.getBoundingClientRect().width,
            ),
            selected: view.selected.key,
            focused:
              activeDocument.activeElement?.getAttribute(
                "data-query-item-row",
              ) ?? null,
            stored: doc?.cardWidth ?? null,
            closed: doc?.cardClosed ?? null,
            kept: doc?.selected ?? null,
          };
        },
        undefined,
        {
          what: "Reading Card",
          tries: 120,
          ready: (value) => value !== null && ((shown) => shown.shown)(value),
        },
      ),
    ).toMatchObject({
      width: 288,
    });
    // Let go past the threshold, it closes and keeps the width it had.
    await drag([300], { press: false });
    expect(
      await obRunUntil(
        run.vaultId,
        async ({ app, zotlit }) => {
          const view = (
            app.workspace.getLeavesOfType(
              "zotlit-library",
            ) as (WorkspaceLeaf & { view: LibraryView })[]
          )[0]?.view;
          if (!view?.query) return null;
          await view.query.settled;
          await new Promise((r) =>
            requestAnimationFrame(() => requestAnimationFrame(r)),
          );
          const el = view.contentEl;
          const card = el.querySelector<HTMLElement>("[data-library-card]");
          const doc = zotlit.services.bridge.runSync(
            zotlit.services.settings.current,
          )["library.document"] as StoredLibraryViewDocument | null;
          return {
            phase: view.query.state.getState().phase,
            shown: !card!.hidden && card!.checkVisibility(),
            width: Math.round(card!.getBoundingClientRect().width),
            list: Math.round(
              el
                .querySelector<HTMLElement>("[data-library-search-row]")!
                .parentElement!.getBoundingClientRect().width,
            ),
            selected: view.selected.key,
            focused:
              activeDocument.activeElement?.getAttribute(
                "data-query-item-row",
              ) ?? null,
            stored: doc?.cardWidth ?? null,
            closed: doc?.cardClosed ?? null,
            kept: doc?.selected ?? null,
          };
        },
        undefined,
        {
          what: "Reading Card",
          tries: 120,
          ready: (value) =>
            value !== null && ((shown) => shown.closed === true)(value),
        },
      ),
    ).toMatchObject({
      shown: false,
      stored: 400,
      focused: second,
    });
    await obRun(
      run.vaultId,
      async ({ app, page }, { position }) => {
        const { press } = page;
        press(
          [
            ...(
              app.workspace.getLeavesOfType(
                "zotlit-library",
              ) as (WorkspaceLeaf & { view: LibraryView })[]
            )[0]!.view.contentEl.querySelectorAll<HTMLElement>(
              "[data-query-item-row]",
            ),
          ][position],
          `paper ${position}`,
        );
        return String(true);
      },
      { position: 1 },
    );
    expect(
      await obRunUntil(
        run.vaultId,
        async ({ app, zotlit }) => {
          const view = (
            app.workspace.getLeavesOfType(
              "zotlit-library",
            ) as (WorkspaceLeaf & { view: LibraryView })[]
          )[0]?.view;
          if (!view?.query) return null;
          await view.query.settled;
          await new Promise((r) =>
            requestAnimationFrame(() => requestAnimationFrame(r)),
          );
          const el = view.contentEl;
          const card = el.querySelector<HTMLElement>("[data-library-card]");
          const doc = zotlit.services.bridge.runSync(
            zotlit.services.settings.current,
          )["library.document"] as StoredLibraryViewDocument | null;
          return {
            phase: view.query.state.getState().phase,
            shown: !card!.hidden && card!.checkVisibility(),
            width: Math.round(card!.getBoundingClientRect().width),
            list: Math.round(
              el
                .querySelector<HTMLElement>("[data-library-search-row]")!
                .parentElement!.getBoundingClientRect().width,
            ),
            selected: view.selected.key,
            focused:
              activeDocument.activeElement?.getAttribute(
                "data-query-item-row",
              ) ?? null,
            stored: doc?.cardWidth ?? null,
            closed: doc?.cardClosed ?? null,
            kept: doc?.selected ?? null,
          };
        },
        undefined,
        {
          what: "Reading Card",
          tries: 120,
          ready: (value) => value !== null && ((shown) => shown.shown)(value),
        },
      ),
    ).toMatchObject({
      width: 400,
      closed: null,
    });

    // Escape during a collapsed drag puts the card and its width back.
    await drag([100, 200, 300], { release: false });
    await obRunUntil(
      run.vaultId,
      async ({ app, zotlit }) => {
        const view = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]?.view;
        if (!view?.query) return null;
        await view.query.settled;
        await new Promise((r) =>
          requestAnimationFrame(() => requestAnimationFrame(r)),
        );
        const el = view.contentEl;
        const card = el.querySelector<HTMLElement>("[data-library-card]");
        const doc = zotlit.services.bridge.runSync(
          zotlit.services.settings.current,
        )["library.document"] as StoredLibraryViewDocument | null;
        return {
          phase: view.query.state.getState().phase,
          shown: !card!.hidden && card!.checkVisibility(),
          width: Math.round(card!.getBoundingClientRect().width),
          list: Math.round(
            el
              .querySelector<HTMLElement>("[data-library-search-row]")!
              .parentElement!.getBoundingClientRect().width,
          ),
          selected: view.selected.key,
          focused:
            activeDocument.activeElement?.getAttribute("data-query-item-row") ??
            null,
          stored: doc?.cardWidth ?? null,
          closed: doc?.cardClosed ?? null,
          kept: doc?.selected ?? null,
        };
      },
      undefined,
      {
        what: "Reading Card",
        tries: 120,
        ready: (value) => value !== null && ((shown) => !shown.shown)(value),
      },
    );
    await obRun(
      run.vaultId,
      async ({ page }) => {
        activeDocument.body.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Escape",
            bubbles: true,
            cancelable: true,
          }),
        );
        delete page.scratch.libraryCardDrag;
        return String(true);
      },
      undefined,
    );
    expect(
      await obRunUntil(
        run.vaultId,
        async ({ app, zotlit }) => {
          const view = (
            app.workspace.getLeavesOfType(
              "zotlit-library",
            ) as (WorkspaceLeaf & { view: LibraryView })[]
          )[0]?.view;
          if (!view?.query) return null;
          await view.query.settled;
          await new Promise((r) =>
            requestAnimationFrame(() => requestAnimationFrame(r)),
          );
          const el = view.contentEl;
          const card = el.querySelector<HTMLElement>("[data-library-card]");
          const doc = zotlit.services.bridge.runSync(
            zotlit.services.settings.current,
          )["library.document"] as StoredLibraryViewDocument | null;
          return {
            phase: view.query.state.getState().phase,
            shown: !card!.hidden && card!.checkVisibility(),
            width: Math.round(card!.getBoundingClientRect().width),
            list: Math.round(
              el
                .querySelector<HTMLElement>("[data-library-search-row]")!
                .parentElement!.getBoundingClientRect().width,
            ),
            selected: view.selected.key,
            focused:
              activeDocument.activeElement?.getAttribute(
                "data-query-item-row",
              ) ?? null,
            stored: doc?.cardWidth ?? null,
            closed: doc?.cardClosed ?? null,
            kept: doc?.selected ?? null,
          };
        },
        undefined,
        {
          what: "Reading Card",
          tries: 120,
          ready: (value) => value !== null && ((shown) => shown.shown)(value),
        },
      ),
    ).toMatchObject({
      width: 400,
      stored: 400,
      closed: null,
    });
  });

  it("draws My Library as two-line Papers with the seeded Literature Notes and Attachment kinds and Sort and Save as query file in its heading, and expands a paper into its seeded Attachments, Child Notes and Annotations that open their targets, with Zotero closed", async () => {
    const layout = await obRun(
      run.vaultId,
      async ({ app }) => {
        return String(JSON.stringify(app.workspace.getLayout()));
      },
      undefined,
    );
    const stored = await obRun(
      run.vaultId,
      async ({ zotlit }) => {
        return zotlit.services.bridge.runSync(zotlit.services.settings.current)[
          "library.document"
        ] as StoredLibraryViewDocument | null;
      },
      undefined,
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obRun(
        run.vaultId,
        async ({ app, zotlit }, { stored, layout }) => {
          const { settings, bridge } = zotlit.services;
          bridge.runSync(settings.update({ "library.document": stored }));
          await bridge.runPromise(settings.flush);
          await app.workspace.changeLayout(JSON.parse(layout));
          return String(true);
        },
        { stored: stored, layout: layout },
      );
    });
    // My Library on the Papers Layout, which a new Library View opens on
    // (the Recent case checks that default).
    await obRun(
      run.vaultId,
      async ({ app, zotlit }, { myLibraryDocument }) => {
        (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        ).forEach((leaf) => leaf.detach());
        const { settings, bridge } = zotlit.services;
        bridge.runSync(
          settings.update({ "library.document": myLibraryDocument }),
        );
        await bridge.runPromise(settings.flush);
        return String(true);
      },
      { myLibraryDocument: MY_LIBRARY_DOCUMENT },
    );

    /** What the Library View shows once its query settled, or `null` while no tab holds it. */

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

    await obRun(
      run.vaultId,
      async ({ app }) => {
        app.commands.executeCommandById("zotlit:open-library-view");
        return String(true);
      },
      undefined,
    );
    const opened = await obRunUntil(
      run.vaultId,
      async ({ app }) => {
        const view = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]?.view;
        if (!view?.query) return null;
        await view.query.settled;
        const el = view.contentEl;
        const state = view.query.state.getState();
        const text = (n: Element, s: string) =>
          n.querySelector<HTMLElement>(s)?.textContent ?? null;
        return {
          phase: state.phase,
          layout:
            el
              .querySelector<HTMLElement>("[data-query-layout]")
              ?.getAttribute("data-query-layout") ?? null,
          toolbar: [
            ...el.querySelectorAll<HTMLElement>('[role="toolbar"] > button'),
          ].map(
            (n) =>
              n.getAttribute("data-query-toolbar") ??
              [...n.attributes]
                .map((a) => a.name)
                .find((a) => a.startsWith("data-query-")) ??
              null,
          ),
          count:
            el
              .querySelector<HTMLElement>("[data-query-count]")
              ?.getAttribute("data-query-count") ?? null,
          papers: [
            ...el.querySelectorAll<HTMLElement>("[data-query-papers-row]"),
          ].map((n) => ({
            key: n.getAttribute("data-query-papers-row")!,
            title: text(n, "[data-query-papers-title]"),
            meta: text(n, "[data-query-papers-meta]"),
            lines: n.querySelector<HTMLElement>("[data-query-papers-title]")!
              .parentElement!.childElementCount,
            attachment:
              n
                .querySelector<HTMLElement>("[data-query-papers-attachment]")
                ?.getAttribute("data-query-papers-attachment") ?? null,
            note:
              n.querySelector<HTMLElement>("[data-query-papers-note]") !== null,
            children: [
              ...n.querySelectorAll<HTMLElement>("[data-query-papers-child]"),
            ].map(
              (c) =>
                [
                  c.getAttribute("data-query-papers-child")!,
                  c.getAttribute("data-query-key")!,
                ] as [string, string | null],
            ),
          })),
          tableRows: el.querySelectorAll<HTMLElement>(
            'tr[data-query-table-row="item"]',
          ).length,
        };
      },
      undefined,
      {
        what: "Library View",
        tries: 120,
        ready: (value) =>
          value !== null &&
          ((papers) =>
            papers.phase === "ready" &&
            papers.count !== null &&
            papers.papers.length === Number(papers.count))(value),
      },
    );
    // No view menu and no Properties menu: the full Query View is a
    // "Save as query file" away.
    expect(opened).toMatchObject({
      layout: "papers",
      toolbar: ["sort", "data-query-save-as"],
      count: String(personal.length),
    });
    expect(
      opened!.papers
        .map(({ key, title, attachment, note }) => ({
          key,
          title,
          attachment,
          note,
        }))
        .toSorted((a, b) => a.key!.localeCompare(b.key!)),
    ).toEqual(
      personal.map(expected).toSorted((a, b) => a.key.localeCompare(b.key!)),
    );
    // Each paper takes two lines at most, with no reading-state line.
    expect(opened!.papers.every(({ lines }) => lines <= 2)).toBe(true);
    // The second line names the first creator, the year and the Venue.
    const missing = personal.flatMap((item) => {
      const meta = opened!.papers.find(({ key }) => key === item.key)!.meta;
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

    await obRun(
      run.vaultId,
      async ({ app, page }, { paperKey }) => {
        const { press } = page;
        const leaf = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0];
        await app.workspace.revealLeaf(leaf!);
        const el = leaf!.view.contentEl;
        press(
          el.querySelector<HTMLElement>(
            `[data-query-expand="item:${paperKey}"]`,
          ),
          "expand paper",
        );
        return String(true);
      },
      { paperKey: paper.key },
    );
    const childrenOf = (papers: Papers) =>
      papers.papers.find(({ key }) => key === paper.key)!.children;
    // The Literature Note row shows at once; the others once their query ran.
    const expanded = await obRunUntil(
      run.vaultId,
      async ({ app }) => {
        const view = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]?.view;
        if (!view?.query) return null;
        await view.query.settled;
        const el = view.contentEl;
        const state = view.query.state.getState();
        const text = (n: Element, s: string) =>
          n.querySelector<HTMLElement>(s)?.textContent ?? null;
        return {
          phase: state.phase,
          layout:
            el
              .querySelector<HTMLElement>("[data-query-layout]")
              ?.getAttribute("data-query-layout") ?? null,
          toolbar: [
            ...el.querySelectorAll<HTMLElement>('[role="toolbar"] > button'),
          ].map(
            (n) =>
              n.getAttribute("data-query-toolbar") ??
              [...n.attributes]
                .map((a) => a.name)
                .find((a) => a.startsWith("data-query-")) ??
              null,
          ),
          count:
            el
              .querySelector<HTMLElement>("[data-query-count]")
              ?.getAttribute("data-query-count") ?? null,
          papers: [
            ...el.querySelectorAll<HTMLElement>("[data-query-papers-row]"),
          ].map((n) => ({
            key: n.getAttribute("data-query-papers-row")!,
            title: text(n, "[data-query-papers-title]"),
            meta: text(n, "[data-query-papers-meta]"),
            lines: n.querySelector<HTMLElement>("[data-query-papers-title]")!
              .parentElement!.childElementCount,
            attachment:
              n
                .querySelector<HTMLElement>("[data-query-papers-attachment]")
                ?.getAttribute("data-query-papers-attachment") ?? null,
            note:
              n.querySelector<HTMLElement>("[data-query-papers-note]") !== null,
            children: [
              ...n.querySelectorAll<HTMLElement>("[data-query-papers-child]"),
            ].map(
              (c) =>
                [
                  c.getAttribute("data-query-papers-child")!,
                  c.getAttribute("data-query-key")!,
                ] as [string, string | null],
            ),
          })),
          tableRows: el.querySelectorAll<HTMLElement>(
            'tr[data-query-table-row="item"]',
          ).length,
        };
      },
      undefined,
      {
        what: "Library View",
        tries: 120,
        ready: (value) =>
          value !== null &&
          ((papers) =>
            childrenOf(papers).filter(([kind]) => kind === "attachment")
              .length === attachmentsOf(paper).length)(value),
      },
    );
    expect(childrenOf(expanded!).at(-1)?.[0]).toBe("literature-note");
    expect(
      childrenOf(expanded!)
        .filter(([kind]) => kind === "attachment")
        .map(([, key]) => key)
        .toSorted((a, b) => String(a).localeCompare(String(b))),
    ).toEqual(
      attachmentsOf(paper)
        .map(({ key }) => key)
        .toSorted((a, b) => String(a).localeCompare(String(b))),
    );
    expect(
      childrenOf(expanded!)
        .filter(([kind]) => kind === "note")
        .map(([, key]) => key),
    ).toEqual(live.map(({ key }) => key));
    await obRun(
      run.vaultId,
      async ({ app, page }, { pdfKey }) => {
        const { press } = page;
        const leaf = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0];
        await app.workspace.revealLeaf(leaf!);
        const el = leaf!.view.contentEl;
        press(
          el.querySelector<HTMLElement>(
            `[data-query-expand="attachment:${pdfKey}"]`,
          ),
          "expand PDF",
        );
        return String(true);
      },
      { pdfKey: pdf.key },
    );
    const pdfAnnotations = ANNOTATIONS.filter(
      ({ parentItemID }) => parentItemID === pdf.itemID,
    );
    const withAnnotations = await obRunUntil(
      run.vaultId,
      async ({ app }) => {
        const view = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]?.view;
        if (!view?.query) return null;
        await view.query.settled;
        const el = view.contentEl;
        const state = view.query.state.getState();
        const text = (n: Element, s: string) =>
          n.querySelector<HTMLElement>(s)?.textContent ?? null;
        return {
          phase: state.phase,
          layout:
            el
              .querySelector<HTMLElement>("[data-query-layout]")
              ?.getAttribute("data-query-layout") ?? null,
          toolbar: [
            ...el.querySelectorAll<HTMLElement>('[role="toolbar"] > button'),
          ].map(
            (n) =>
              n.getAttribute("data-query-toolbar") ??
              [...n.attributes]
                .map((a) => a.name)
                .find((a) => a.startsWith("data-query-")) ??
              null,
          ),
          count:
            el
              .querySelector<HTMLElement>("[data-query-count]")
              ?.getAttribute("data-query-count") ?? null,
          papers: [
            ...el.querySelectorAll<HTMLElement>("[data-query-papers-row]"),
          ].map((n) => ({
            key: n.getAttribute("data-query-papers-row")!,
            title: text(n, "[data-query-papers-title]"),
            meta: text(n, "[data-query-papers-meta]"),
            lines: n.querySelector<HTMLElement>("[data-query-papers-title]")!
              .parentElement!.childElementCount,
            attachment:
              n
                .querySelector<HTMLElement>("[data-query-papers-attachment]")
                ?.getAttribute("data-query-papers-attachment") ?? null,
            note:
              n.querySelector<HTMLElement>("[data-query-papers-note]") !== null,
            children: [
              ...n.querySelectorAll<HTMLElement>("[data-query-papers-child]"),
            ].map(
              (c) =>
                [
                  c.getAttribute("data-query-papers-child")!,
                  c.getAttribute("data-query-key")!,
                ] as [string, string | null],
            ),
          })),
          tableRows: el.querySelectorAll<HTMLElement>(
            'tr[data-query-table-row="item"]',
          ).length,
        };
      },
      undefined,
      {
        what: "Library View",
        tries: 120,
        ready: (value) =>
          value !== null &&
          ((papers) =>
            childrenOf(papers).filter(([kind]) => kind === "annotation")
              .length === pdfAnnotations.length)(value),
      },
    );
    expect(
      childrenOf(withAnnotations!)
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

    const pdfName = pdf.path!.split("/").pop()!;
    expect(
      await obRun(
        run.vaultId,
        async ({ app, page }, { paperKey, attachment, pdfKey, pdfname }) => {
          const { press, until } = page;
          const leaf = (
            app.workspace.getLeavesOfType(
              "zotlit-library",
            ) as (WorkspaceLeaf & { view: LibraryView })[]
          )[0];
          await app.workspace.revealLeaf(leaf!);
          const el = leaf!.view.contentEl;
          press(
            el.querySelector<HTMLElement>(
              `[data-query-papers-row="${paperKey}"] [data-query-papers-child="${attachment}"][data-query-key="${pdfKey}"] a`,
            ),
            "PDF link",
          );
          return String(
            String(
              !!(await until(
                "the PDF opens",
                () =>
                  (
                    app.workspace.getLeavesOfType("pdf") as (WorkspaceLeaf & {
                      view: PDFFileView;
                    })[]
                  ).find((l) => l.view.file?.name === pdfname),
                10000,
              )),
            ),
          );
        },
        {
          paperKey: paper.key,
          attachment: "attachment",
          pdfKey: pdf.key,
          pdfname: pdfName,
        },
      ),
    ).toBe("true");
    const anchored = pdfAnnotations.find(
      (annotation) => "pageIndex" in annotation.position,
    )!;
    // A middle click opens a new tab, as the Table case does.
    expect(
      JSON.parse(
        await obRun(
          run.vaultId,
          async ({ app, page }, { paperKeyInput, anchoredKey }) => {
            const leaf = app.workspace.getLeavesOfType("zotlit-library")[0]!;
            await app.workspace.revealLeaf(leaf);
            const el = (leaf.view as LibraryView).contentEl;
            return JSON.stringify(
              await page.annotationOpenSubpath(() => {
                const link = el.querySelector<HTMLElement>(
                  `[data-query-papers-row="${paperKeyInput}"] [data-query-papers-child="annotation"][data-query-key="${anchoredKey}"] a`,
                )!;
                link.dispatchEvent(
                  new (
                    link.ownerDocument.defaultView as Window & typeof globalThis
                  ).MouseEvent("auxclick", {
                    bubbles: true,
                    cancelable: true,
                    button: 1,
                  }),
                );
              }),
            );
          },
          { paperKeyInput: paper.key, anchoredKey: anchored.key },
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
      await obRun(
        run.vaultId,
        async ({ app, page }, { paperKey }) => {
          const { press, until } = page;
          const leaf = (
            app.workspace.getLeavesOfType(
              "zotlit-library",
            ) as (WorkspaceLeaf & { view: LibraryView })[]
          )[0];
          await app.workspace.revealLeaf(leaf!);
          const el = leaf!.view.contentEl;
          const link = el.querySelector<HTMLElement>(
            `[data-query-papers-row="${paperKey}"] [data-query-papers-child="literature-note"] [data-query-note]`,
          );
          press(link, "Literature Note link");
          const path = link!.getAttribute("data-query-note");
          return String(
            String(
              !!(await until(
                "the Literature Note opens",
                () =>
                  (
                    app.workspace.getLeavesOfType(
                      "markdown",
                    ) as (WorkspaceLeaf & { view: MarkdownView })[]
                  ).find((l) => l.view.file?.path === path),
                10000,
              )),
            ),
          );
        },
        { paperKey: paper.key },
      ),
    ).toBe("true");

    // An Item with Child Notes lists its live ones, and a Child Note opens
    // in Zotero through its link.
    const noted = ITEMS.find(({ itemID }) => itemID === 1)!;
    const notes = NOTES.filter(
      (note) => note.parentItemID === noted.itemID && !note.trashed,
    );
    expect(notes.length, "the Fixture Item has a live Child Note").toBe(1);
    await obRun(
      run.vaultId,
      async ({ app, page }, { notedKey }) => {
        const { press } = page;
        const leaf = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0];
        await app.workspace.revealLeaf(leaf!);
        const el = leaf!.view.contentEl;
        press(
          el.querySelector<HTMLElement>(
            `[data-query-expand="item:${notedKey}"]`,
          ),
          "expand noted paper",
        );
        return String(true);
      },
      { notedKey: noted.key },
    );
    const withNotes = await obRunUntil(
      run.vaultId,
      async ({ app }) => {
        const view = (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        )[0]?.view;
        if (!view?.query) return null;
        await view.query.settled;
        const el = view.contentEl;
        const state = view.query.state.getState();
        const text = (n: Element, s: string) =>
          n.querySelector<HTMLElement>(s)?.textContent ?? null;
        return {
          phase: state.phase,
          layout:
            el
              .querySelector<HTMLElement>("[data-query-layout]")
              ?.getAttribute("data-query-layout") ?? null,
          toolbar: [
            ...el.querySelectorAll<HTMLElement>('[role="toolbar"] > button'),
          ].map(
            (n) =>
              n.getAttribute("data-query-toolbar") ??
              [...n.attributes]
                .map((a) => a.name)
                .find((a) => a.startsWith("data-query-")) ??
              null,
          ),
          count:
            el
              .querySelector<HTMLElement>("[data-query-count]")
              ?.getAttribute("data-query-count") ?? null,
          papers: [
            ...el.querySelectorAll<HTMLElement>("[data-query-papers-row]"),
          ].map((n) => ({
            key: n.getAttribute("data-query-papers-row")!,
            title: text(n, "[data-query-papers-title]"),
            meta: text(n, "[data-query-papers-meta]"),
            lines: n.querySelector<HTMLElement>("[data-query-papers-title]")!
              .parentElement!.childElementCount,
            attachment:
              n
                .querySelector<HTMLElement>("[data-query-papers-attachment]")
                ?.getAttribute("data-query-papers-attachment") ?? null,
            note:
              n.querySelector<HTMLElement>("[data-query-papers-note]") !== null,
            children: [
              ...n.querySelectorAll<HTMLElement>("[data-query-papers-child]"),
            ].map(
              (c) =>
                [
                  c.getAttribute("data-query-papers-child")!,
                  c.getAttribute("data-query-key")!,
                ] as [string, string | null],
            ),
          })),
          tableRows: el.querySelectorAll<HTMLElement>(
            'tr[data-query-table-row="item"]',
          ).length,
        };
      },
      undefined,
      {
        what: "Library View",
        tries: 120,
        ready: (value) =>
          value !== null &&
          ((papers) =>
            papers.papers
              .find(({ key }) => key === noted.key)!
              .children.filter(([kind]) => kind === "note").length ===
            notes.length)(value),
      },
    );
    expect(
      withNotes!.papers
        .find(({ key }) => key === noted.key)!
        .children.filter(([kind]) => kind === "note")
        .map(([, key]) => key),
    ).toEqual(notes.map(({ key }) => key));
    expect(
      await obRun(
        run.vaultId,
        async ({ app, page }, { notedKey, key }) => {
          const { press, until } = page;
          const leaf = (
            app.workspace.getLeavesOfType(
              "zotlit-library",
            ) as (WorkspaceLeaf & { view: LibraryView })[]
          )[0];
          await app.workspace.revealLeaf(leaf!);
          const el = leaf!.view.contentEl;
          const native = window.open;
          let opened: string | null = null;
          window.open = (url) => {
            opened = String(url);
            return null;
          };
          try {
            press(
              el.querySelector<HTMLElement>(
                `[data-query-papers-row="${notedKey}"] [data-query-papers-child="note"][data-query-key="${key}"] a`,
              ),
              "Child Note link",
            );
            return String(
              await until("Zotero shows the note", () => opened, 10000),
            );
          } finally {
            window.open = native;
          }
        },
        { notedKey: noted.key, key: notes[0]!.key },
      ),
    ).toBe(`zotero://select/library/items/${notes[0]!.key}`);
  }, 180000);

  it("scrolls the Library View's rows alone, under a search box and a heading that stay put, keeps each row's trailing icons clear of the scrollbar, and keeps a row the arrow keys select in view under them, on a wide and a narrow pane", async () => {
    const snapshot = await obRun(
      run.vaultId,
      async ({ app, zotlit }) => {
        return String(
          JSON.stringify({
            layout: app.workspace.getLayout(),
            document:
              zotlit.services.bridge.runSync(zotlit.services.settings.current)[
                "library.document"
              ] ?? null,
          }),
        );
      },
      undefined,
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obRun(
        run.vaultId,
        async ({ app, zotlit }, { snapshot }) => {
          const saved = JSON.parse(snapshot);
          const { settings, bridge } = zotlit.services;
          bridge.runSync(
            settings.update({ "library.document": saved.document }),
          );
          await bridge.runPromise(settings.flush);
          await app.workspace.changeLayout(saved.layout);
          return String(true);
        },
        { snapshot: snapshot },
      );
    });
    // My Library: more papers than the pane holds.
    await suite.wideWindow(cleanup);
    await obRun(
      run.vaultId,
      async ({ app, zotlit, page }, { myLibraryDocument }) => {
        const { until } = page;
        (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        ).forEach((leaf) => leaf.detach());
        const { settings, bridge } = zotlit.services;
        bridge.runSync(
          settings.update({ "library.document": myLibraryDocument }),
        );
        await bridge.runPromise(settings.flush);
        app.commands.executeCommandById("zotlit:open-library-view");
        await until(
          "library",
          () =>
            (
              app.workspace.getLeavesOfType(
                "zotlit-library",
              ) as (WorkspaceLeaf & { view: LibraryView })[]
            )[0],
        );
        return String(true);
      },
      { myLibraryDocument: MY_LIBRARY_DOCUMENT },
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
        await obRun(
          run.vaultId,
          async ({ app, page }, { widthInput }) => {
            const { until } = page;
            const leaf = (
              app.workspace.getLeavesOfType(
                "zotlit-library",
              ) as (WorkspaceLeaf & { view: LibraryView })[]
            )[0];
            await app.workspace.revealLeaf(leaf!);
            app.workspace.setActiveLeaf(leaf!, { focus: true });
            await leaf!.view.query.settled;
            const el = leaf!.view.contentEl;
            const width = el.style.width;
            el.style.width = `${widthInput}px`;
            const frame = () =>
              new Promise((r) =>
                requestAnimationFrame(() => requestAnimationFrame(r)),
              );
            try {
              await until(
                "rows",
                () =>
                  el.querySelectorAll<HTMLElement>("[data-query-papers-row]")
                    .length > 10,
                10000,
              );
              await frame();
              const list = el.querySelector<HTMLElement>("[data-query-layout]");
              const input = el.querySelector<HTMLElement>(
                "[data-library-search] input",
              );
              const toolbar = el.querySelector<HTMLElement>(
                "[data-library-heading]",
              );
              const tops = () =>
                [input, toolbar].map((n) => n!.getBoundingClientRect().top);
              list!.scrollTop = 0;
              await frame();
              const before = tops();
              list!.scrollTop = list!.scrollHeight;
              await frame();
              const after = tops();
              const scrolled = list!.scrollTop;
              const box = list!.getBoundingClientRect();
              const clientRight =
                box.left + list!.clientLeft + list!.clientWidth;
              const iconRight = Math.max(
                ...[
                  ...list!.querySelectorAll<HTMLElement>(
                    "[data-query-papers-note],[data-query-papers-attachment]",
                  ),
                ]
                  .filter((n) => n.checkVisibility())
                  .map((n) => n.getBoundingClientRect().right),
              );
              const rows = () => [
                ...list!.querySelectorAll<HTMLElement>("[data-query-item-row]"),
              ];
              const place = (row: HTMLElement) => {
                const r = row.getBoundingClientRect();
                const b = list!.getBoundingClientRect();
                return {
                  selected: row.hasAttribute("data-selected"),
                  inList: r.top >= b.top - 0.5 && r.bottom <= b.bottom + 0.5,
                  underToolbar:
                    r.top >= toolbar!.getBoundingClientRect().bottom - 0.5,
                };
              };
              const arrow = async (key: string, from: number, to: number) => {
                const start = rows()[from];
                leaf!.view.card.registry.set(leaf!.view.model.selection, {
                  key: start!.getAttribute("data-query-item-row")!,
                  card: false,
                });
                await until("row selected", () =>
                  start!.hasAttribute("data-selected"),
                );
                start!.focus({ preventScroll: true });
                list!.scrollTop = key === "ArrowDown" ? list!.scrollHeight : 0;
                await frame();
                activeDocument.activeElement!.dispatchEvent(
                  new KeyboardEvent("keydown", {
                    key,
                    bubbles: true,
                    cancelable: true,
                  }),
                );
                await until("selection moves", () =>
                  rows()[to]!.hasAttribute("data-selected"),
                );
                await frame();
                return place(rows()[to]!);
              };
              const n = rows().length;
              const down = await arrow("ArrowDown", 0, 1);
              const up = await arrow("ArrowUp", n - 1, n - 2);
              leaf!.view.card.registry.set(leaf!.view.model.selection, {
                key: null,
                card: false,
              });
              return String(
                JSON.stringify({
                  overflows: list!.scrollHeight > list!.clientHeight,
                  scrolled,
                  tops: { before, after },
                  icon: {
                    toClient: clientRight - iconRight,
                    toEdge: box.right - iconRight,
                  },
                  scrollbar: Number.parseFloat(
                    getComputedStyle(document.body).getPropertyValue(
                      "--scrollbar-width",
                    ),
                  ),
                  moved: { down, up },
                }),
              );
            } finally {
              el.style.width = width;
            }
          },
          { widthInput: width },
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
    const path = "query-files/Expanding.zotquery";
    const snapshot = await obRun(
      run.vaultId,
      async ({ app, zotlit }) => {
        return String(
          JSON.stringify({
            layout: app.workspace.getLayout(),
            document:
              zotlit.services.bridge.runSync(zotlit.services.settings.current)[
                "library.document"
              ] ?? null,
          }),
        );
      },
      undefined,
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obRun(
        run.vaultId,
        async ({ app, zotlit }, { snapshot, path }) => {
          const saved = JSON.parse(snapshot);
          const { settings, bridge } = zotlit.services;
          bridge.runSync(
            settings.update({ "library.document": saved.document }),
          );
          await bridge.runPromise(settings.flush);
          await app.workspace.changeLayout(saved.layout);
          const file = app.vault.getFileByPath(path);
          if (file) await app.vault.delete(file);
          return String(true);
        },
        { snapshot: snapshot, path: path },
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
      view: { kind: "library" } | { kind: "query"; path: string };
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
        await obRun(
          run.vaultId,
          async ({ app, page }, { viewInput, rowselector, item, delay }) => {
            const { press, until, stands } = page;
            const view =
              viewInput.kind === "library"
                ? (app.workspace.getLeavesOfType("zotlit-library")[0]!
                    .view as LibraryView)
                : (app.workspace
                    .getLeavesOfType("zotlit-query-file")
                    .find(
                      (leaf) =>
                        (leaf.view as QueryFileView).file?.path ===
                        (viewInput as { kind: "query"; path: string }).path,
                    )!.view as QueryFileView);
            await app.workspace.revealLeaf(view.leaf);
            await (view as QueryFileView).query.settled;
            const el = view.contentEl;
            const rowSel = rowselector;
            const button = await until(
              "expander",
              () =>
                el.querySelector<HTMLElement>(
                  `[data-query-expand="item:${item}"]`,
                ),
              10000,
            );
            const frame = () => new Promise((r) => requestAnimationFrame(r));
            button.scrollIntoView({ block: "center", behavior: "instant" });
            await stands(button, "expander");
            await frame();
            await frame();
            const rows = () => [...el.querySelectorAll<HTMLElement>(rowSel)];
            const own = button.closest<HTMLElement>(rowSel);
            const at = rows().indexOf(own!);
            const removed: string[] = [];
            const observer = new MutationObserver((records) => {
              for (const record of records)
                for (const n of record.removedNodes)
                  if (
                    n instanceof HTMLElement &&
                    (n.matches(rowSel) || n.querySelector<HTMLElement>(rowSel))
                  )
                    removed.push(
                      n.getAttribute("data-query-papers-row")! ??
                        n.getAttribute("data-query-key")! ??
                        n.nodeName,
                    );
            });
            observer.observe(el, { childList: true, subtree: true });
            const frames: Expansion["frames"] = [];
            const take = () => {
              const list = rows();
              const boxes = list.map((n) => n.getBoundingClientRect());
              const box = own!.getBoundingClientRect();
              const top = box.top;
              frames.push({
                rows: list.length,
                height: Math.round(box.height),
                next: list[at + 1]
                  ? Math.round(boxes[at + 1]!.top - top)
                  : null,
                overlaps: boxes.filter(
                  (b, i) => i > 0 && b.top < boxes[i - 1]!.bottom - 0.5,
                ).length,
                status: el.querySelectorAll<HTMLElement>(
                  "[data-query-table-status]",
                ).length,
                loading: (() => {
                  const text = el.querySelector<HTMLElement>(
                    "[data-query-loading]",
                  );
                  return text ? getComputedStyle(text).opacity : null;
                })(),
              });
            };
            // oxlint-disable-next-line typescript/unbound-method -- Restored unchanged and called with the original worker receiver.
            const post = Worker.prototype.postMessage;
            const pending = new Map<
              ReturnType<typeof setTimeout>,
              () => void
            >();
            let delayedReads = 0;
            if (delay > 0)
              Worker.prototype.postMessage = new Proxy(post, {
                apply: (
                  postTarget,
                  receiver: Worker,
                  args: Parameters<Worker["postMessage"]>,
                ) => {
                  const request = (args[0] as LibraryWorkerMessage)?.[1];
                  const query =
                    request?.tag === "ItemQuery" &&
                    "view" in request.payload.job
                      ? request.payload.job.view
                      : null;
                  const target = item;
                  if (
                    !query ||
                    query.from !== "attachments" ||
                    query.filter !==
                      `item.indexedKey == ${JSON.stringify(target)}`
                  )
                    return Reflect.apply(postTarget, receiver, args);
                  const worker = receiver;
                  const send = () => Reflect.apply(postTarget, worker, args);
                  const timer = setTimeout(() => {
                    pending.delete(timer);
                    delayedReads++;
                    send();
                  }, delay);
                  pending.set(timer, send);
                },
              });
            let expanded = null;
            try {
              take();
              press(button, "expander");
              take();
              const start = performance.now();
              while (performance.now() - start < delay + 500) {
                await frame();
                take();
              }
              expanded = button.getAttribute("aria-expanded");
            } finally {
              Worker.prototype.postMessage = post;
              for (const [timer, send] of pending) {
                clearTimeout(timer);
                send();
              }
              observer.disconnect();
            }
            press(button, "collapse");
            return String(
              JSON.stringify({ expanded, frames, removed, delayedReads }),
            );
          },
          {
            viewInput: view,
            rowselector: rowSelector,
            item: item,
            delay: delay,
          },
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
    await obRun(
      run.vaultId,
      async ({ app, zotlit, page }, { myLibraryDocument }) => {
        const { until } = page;
        (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        ).forEach((leaf) => leaf.detach());
        const { settings, bridge } = zotlit.services;
        bridge.runSync(
          settings.update({ "library.document": myLibraryDocument }),
        );
        await bridge.runPromise(settings.flush);
        app.commands.executeCommandById("zotlit:open-library-view");
        await until(
          "library",
          () =>
            (
              app.workspace.getLeavesOfType(
                "zotlit-library",
              ) as (WorkspaceLeaf & { view: LibraryView })[]
            )[0],
          10000,
        );
        return String(true);
      },
      { myLibraryDocument: MY_LIBRARY_DOCUMENT },
    );
    const library = { kind: "library" } as const;
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
    await obRun(
      run.vaultId,
      async ({ app }) => {
        (
          app.workspace.getLeavesOfType("zotlit-library") as (WorkspaceLeaf & {
            view: LibraryView;
          })[]
        ).forEach((leaf) => leaf.detach());
        const leaf = app.workspace.getRightLeaf(false);
        await leaf!.setViewState({ type: "zotlit-library", active: true });
        app.workspace.rightSplit.expand();
        await app.workspace.revealLeaf(leaf!);
        return String(true);
      },
      undefined,
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
      await obRun(
        run.vaultId,
        async ({ app }, { path, joinResult }) => {
          const old = app.vault.getFileByPath(path);
          if (old) await app.vault.delete(old);
          const file = await app.vault.create(path, joinResult);
          const leaf = app.workspace.getLeaf("tab");
          await leaf.openFile(file);
          app.workspace.setActiveLeaf(leaf, { focus: true });
          return String(true);
        },
        {
          path: path,
          joinResult: [
            "views:",
            `  - type: ${layout}`,
            "    name: Mine",
            "    from: items",
            '    filters: library == "personal"',
            "    limit: 100",
            "",
          ].join("\n"),
        },
      );
      const tab = { kind: "query", path } as const;
      await expandEach(`Query File ${layout}, Attachments`, {
        view: tab,
        rowSelector:
          layout === "papers" ? papersRow : 'tr[data-query-table-row="item"]',
        item: paper.key,
      });
    }
  }, 180000);
});
