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
import { SettingsService } from "@/services/settings/service";

import { WelcomeBanner } from "./banner";
import type { WelcomeBannerDeps } from "./banner";

vi.mock("zustand", () => import("../__fixtures__/zustand"));

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
  const plugin = new PluginStub(app, { __VERSION__: 10, ...data });
  const identity = (raw: unknown) => raw;
  const settings = cleanup.use(
    new SettingsService({
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
  await settings.loaded;
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
  return { deps, host, settings };
}

/** The banner, loaded into the page and settled on its connection readout. */
async function open(deps: WelcomeBannerDeps) {
  const el = document.body.createDiv();
  const banner = new WelcomeBanner(deps, el);
  await act(async () => {
    banner.load();
    await banner.settled;
  });
  cleanup.defer(() => banner.unload());
  return el;
}

const heading = (el: HTMLElement, text: string) =>
  [...el.querySelectorAll('[role="heading"]')].some(
    (node) => node.textContent === text,
  );

function dismissButton(el: HTMLElement): HTMLElement {
  const button = el.querySelector<HTMLElement>("[data-welcome-dismiss]");
  if (!button) throw new Error("No dismiss control");
  return button;
}

it("shows the setup steps while setup is incomplete, with no Companion step", async () => {
  const { deps } = await setup();
  const el = await open(deps);
  expect(heading(el, m.welcome_step_connect_title())).toBe(true);
  expect(heading(el, m.welcome_step_folder_title())).toBe(true);
  // ZotLit Companion is named at the action that needs it, not here.
  expect(el.textContent).not.toContain("Companion");
});

it("leaves out the Connect step while ZotLit cannot read the Zotero data folder, which the Library View says itself", async () => {
  const { deps } = await setup();
  Object.assign(deps.reads, { state: "degraded" });
  const el = await open(deps);
  expect(heading(el, m.welcome_step_connect_title())).toBe(false);
  expect(heading(el, m.welcome_step_folder_title())).toBe(true);
});

it("goes away on dismissal, and stays away when the view opens again", async () => {
  const { deps, settings } = await setup();
  const el = await open(deps);
  await act(() => dismissButton(el).click());
  expect(el.textContent).toBe("");
  expect(settings.current?.["welcome.dismissed"]).toBe(true);
  expect((await open(deps)).textContent).toBe("");
});

it("shows nothing once the library is connected and the literature-notes folder exists", async () => {
  const { deps, host } = await setup();
  host.vault.addFile("literatures/Paper.md", "");
  const el = await open(deps);
  expect(el.textContent).toBe("");
});

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
  await act(() => dismissButton(el).click());
  expect(el.textContent).toBe("");
  expect(settings.current?.["release.migration-pending"]).toBe(false);
});
