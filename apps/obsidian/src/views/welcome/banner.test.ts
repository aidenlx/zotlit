// @vitest-environment happy-dom
// The Welcome View as a banner above the Library View: it shows while setup
// is incomplete, until the researcher dismisses it, and an upgrade from v1
// keeps its Migration Prompt on screen until a dismissal acknowledges it.
import { resetMockPlatform, setMockPlatform } from "@mock/obsidian";
import type { App } from "obsidian";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";

import { createNanoEvents } from "@zotlit/shared/nanoevents";

import {
  createObsidianHost,
  PluginStub,
} from "@/lib/__fixtures__/obsidian-host";
import { Effect } from "@/lib/effect";
import * as m from "@/lib/i18n/generated/messages";
import { QueryClientService } from "@/services/query-client/service";
import { ReleaseService } from "@/services/release/service";
import { buildSettings } from "@/services/settings/__fixtures__";
import type { PlainPluginSettings } from "@/services/settings/plain";

import { WelcomeBanner } from "./banner";
import type { WelcomeBannerDeps } from "./banner";

vi.mock("zustand", () => import("@/views/__fixtures__/zustand"));

let cleanup = new AsyncDisposableStack();
afterEach(async () => {
  await cleanup.disposeAsync();
  cleanup = new AsyncDisposableStack();
  document.body.replaceChildren();
});

/** A vault whose plugin data holds `data`, beside a Zotero database of 3 Items. */
async function setup(data: Record<string, unknown> = {}) {
  setMockPlatform({ isMacOS: true });
  cleanup.defer(resetMockPlatform);
  const host = createObsidianHost({});
  const app = host.app as unknown as App;
  // No Web Viewer: the Release Note opens in the browser.
  Object.assign(app, { internalPlugins: { getEnabledPluginById: () => null } });
  const plugin = new PluginStub(app, { __VERSION__: 10, ...data });
  const settings = loadSettings(plugin);
  await settings.loaded;
  const deps = bannerDeps(app, settings);
  /**
   * Obsidian reloads: plugin data, written to disk, is read again by a new
   * instance of the plugin.
   */
  let latest = settings;
  const reload = async () => {
    await latest.flush();
    latest = loadSettings(plugin);
    await latest.loaded;
    return bannerDeps(app, latest);
  };
  return { deps, host, settings, reload };
}

/** The settings of plugin data that `plugin` holds. */
function loadSettings(plugin: PluginStub): PlainPluginSettings {
  const identity = (raw: unknown) => raw;
  return cleanup.use(
    buildSettings({
      plugin,
      migrateLegacy: identity,
      migrateV1: identity,
      migrateV2: identity,
      migrateV3: identity,
      migrateV4: identity,
      migrateV5: identity,
      migrateV6: identity,
      migrateV7: identity,
      migrateV8: identity,
      migrateV9: identity,
    }),
  );
}

/** What the banner reads, over `settings`, beside a Zotero database of 3 Items. */
function bannerDeps(
  app: App,
  settings: PlainPluginSettings,
): WelcomeBannerDeps {
  const events = createNanoEvents<Record<string, () => void>>();
  const deps: WelcomeBannerDeps = {
    app,
    reads: {
      state: "ready",
      error: null,
      ready: Promise.resolve({
        reads: { ConnectionReadout: () => Effect.succeed({ itemCount: 3 }) },
      }),
      on: events.on.bind(events),
    } as unknown as WelcomeBannerDeps["reads"],
    queries: new QueryClientService(),
    zoteroPref: { dataDir: "/Zotero" },
    settings,
    setupActions: {
      openSettings: vi.fn(),
      pickFolder: vi.fn(),
      locateZotero: vi.fn(),
    },
    templateMigration: { convert: vi.fn(), retryCleanup: vi.fn() },
    release: cleanup.use(
      new ReleaseService({ app, version: "2.2.0", settings }),
    ),
  };
  return deps;
}

/** The banner, loaded into the page and settled on its connection readout. */
async function open(deps: WelcomeBannerDeps) {
  return (await openBanner(deps)).el;
}

/** {@link open}, with the banner itself. */
async function openBanner(deps: WelcomeBannerDeps) {
  const el = document.body.createDiv();
  const banner = new WelcomeBanner(deps, { searchLibrary: vi.fn() }, el);
  await act(async () => {
    banner.load();
    await banner.settled;
  });
  cleanup.defer(() => banner.unload());
  return { el, banner };
}

const heading = (el: HTMLElement, text: string) =>
  [...el.querySelectorAll('[role="heading"]')].some(
    (node) => node.textContent === text,
  );

/** The Help Link the banner names `name`, the title its `aria-labelledby` points at. */
const helpLink = (el: HTMLElement, name: string) =>
  [...el.querySelectorAll("a")].find(
    (a) =>
      el.ownerDocument.getElementById(a.getAttribute("aria-labelledby") ?? "")
        ?.textContent === name,
  );

function dismissButton(el: HTMLElement): HTMLElement {
  const button = el.querySelector<HTMLElement>("[data-welcome-dismiss]");
  if (!button) throw new Error("No dismiss control");
  return button;
}

it("keeps the Migration Prompt of a v1 upgrade on screen until a dismissal acknowledges it", async () => {
  const { deps, host, settings } = await setup({
    "welcome.dismissed": true,
    "release.migration-pending": true,
  });
  host.vault.addFile("literatures/Paper.md", "");
  host.vault.addFile("templates/zt-note.eta.md", "");
  // A v1 upgrader's templates live in the folder their settings name.
  settings.update({ "template.folder": "templates" });
  const el = await open(deps);
  expect(heading(el, m.welcome_migration_title())).toBe(true);
  // An upgrade from v1 on Zotero 10 needs ZotLit Companion to read recent changes.
  expect(heading(el, m.welcome_companion_title())).toBe(true);
  expect(el.textContent).toContain(m.companion_zotero_10_guidance());
  // The Help Links show with the Migration Prompt once setup is done.
  expect(helpLink(el, "Star on GitHub")?.getAttribute("href")).toBe(
    "https://github.com/aidenlx/zotlit",
  );
  await act(() => dismissButton(el).click());
  expect(el.textContent).toBe("");
  expect(settings.current?.["release.migration-pending"]).toBe(false);
});

it("announces an update until What's new acknowledges it, beside the Help Links", async () => {
  const { deps, host, settings } = await setup({
    "welcome.dismissed": true,
    // The release check of this launch found the update.
    "release.previous-version": "2.2.0",
    "release.update-pending": true,
  });
  host.vault.addFile("literatures/Paper.md", "");
  const el = await open(deps);
  expect(heading(el, m.welcome_update_title({ version: "2.2.0" }))).toBe(true);
  expect(helpLink(el, "Getting started")).toBeDefined();
  const opened = vi.spyOn(window, "open").mockReturnValue(null);
  cleanup.defer(() => opened.mockRestore());
  const whatsNew = [...el.querySelectorAll("button")].find(
    (button) => button.textContent === m.welcome_update_action(),
  );
  expect(whatsNew).toBeDefined();
  await act(() => whatsNew?.click());
  expect(opened.mock.calls).toEqual([
    ["https://zotlit.aidenlx.site/changelog/2.2.0"],
  ]);
  expect(settings.current?.["release.update-pending"]).toBe(false);
  expect(el.textContent).toBe("");
});

it("acknowledges an update on dismissal, so it stays away when the view opens again", async () => {
  const { deps, host, settings } = await setup({
    // The release check of this launch found the update.
    "release.previous-version": "2.2.0",
    "release.update-pending": true,
  });
  host.vault.addFile("literatures/Paper.md", "");
  const el = await open(deps);
  expect(heading(el, m.welcome_update_title({ version: "2.2.0" }))).toBe(true);
  await act(() => dismissButton(el).click());
  expect(el.textContent).toBe("");
  expect(settings.current?.["release.update-pending"]).toBe(false);
  expect((await open(deps)).textContent).toBe("");
});

it("keeps the setup steps after What's new while setup is incomplete", async () => {
  const { deps } = await setup({
    "release.previous-version": "2.2.0",
    "release.update-pending": true,
  });
  const el = await open(deps);
  const opened = vi.spyOn(window, "open").mockReturnValue(null);
  cleanup.defer(() => opened.mockRestore());
  const whatsNew = [...el.querySelectorAll("button")].find(
    (button) => button.textContent === m.welcome_update_action(),
  );
  expect(whatsNew).toBeDefined();
  await act(() => whatsNew?.click());
  expect(heading(el, m.welcome_update_title({ version: "2.2.0" }))).toBe(false);
  expect(heading(el, m.welcome_step_folder_title())).toBe(true);
});

it("announces no update while release notices are off", async () => {
  const { deps, host } = await setup({
    // The release check of this launch found the update.
    "release.previous-version": "2.2.0",
    "release.update-pending": true,
    "release.notices-enabled": false,
  });
  host.vault.addFile("literatures/Paper.md", "");
  expect((await open(deps)).textContent).toBe("");
});

/** The "Show steps" control of the folded "Setup done" line. */
function stepsToggle(el: HTMLElement): HTMLElement {
  const button = el.querySelector<HTMLElement>(
    "[data-welcome-setup-done] button[aria-expanded]",
  );
  if (!button) throw new Error("No Show steps control");
  return button;
}

it("shows the banner it was asked for again after Obsidian reloads, and keeps it away once dismissed", async () => {
  const { deps, host, settings, reload } = await setup();
  host.vault.addFile("literatures/Paper.md", "");
  const { el, banner } = await openBanner(deps);
  expect(el.textContent).toBe("");
  await act(() => banner.request());
  expect(heading(el, m.welcome_step_folder_title())).toBe(true);
  expect(settings.current?.["welcome.requested"]).toBe(true);

  const again = await openBanner(await reload());
  expect(again.banner.shown).toBe(true);
  expect(heading(again.el, m.welcome_step_folder_title())).toBe(true);
  await act(() => dismissButton(again.el).click());
  expect(again.el.textContent).toBe("");

  const last = await openBanner(await reload());
  expect(last.banner.shown).toBe(false);
  expect(last.el.textContent).toBe("");
});

it("keeps Show steps open after Obsidian reloads, until the banner is dismissed", async () => {
  const { deps, host, reload } = await setup({
    // A notice beside a complete setup folds the steps.
    "note.template-conversion-pending": true,
  });
  host.vault.addFile("literatures/Paper.md", "");
  const el = await open(deps);
  expect(stepsToggle(el).getAttribute("aria-expanded")).toBe("false");
  await act(() => stepsToggle(el).click());
  expect(stepsToggle(el).getAttribute("aria-expanded")).toBe("true");

  const again = await open(await reload());
  expect(stepsToggle(again).getAttribute("aria-expanded")).toBe("true");
  await act(() => dismissButton(again).click());

  const after = await reload();
  // The conversion offer shows again, as a request would show it.
  after.settings.update({ "welcome.dismissed": false });
  const last = await open(after);
  expect(stepsToggle(last).getAttribute("aria-expanded")).toBe("false");
});

it("reads plugin data of an earlier build, which kept no request, as no request and steps folded", async () => {
  const { deps, host, settings } = await setup({ "welcome.dismissed": false });
  host.vault.addFile("literatures/Paper.md", "");
  expect(settings.current?.["welcome.requested"]).toBe(false);
  expect(settings.current?.["welcome.steps-shown"]).toBe(false);
  expect((await open(deps)).textContent).toBe("");
});
