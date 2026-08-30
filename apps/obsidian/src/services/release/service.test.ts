// @vitest-environment happy-dom
import { ButtonComponent, TFile, TFolder } from "obsidian";
import type { App } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { DOCS_COMPANION } from "@/lib/constants";
import type { HydrationOrigin } from "@/services/settings/classify";
import type { Settings } from "@/services/settings/schema";
import type { SettingsService } from "@/services/settings/service";

import { releaseNoteUrl, V1_TEMPLATE_FOLDER } from "./constants";
import { ReleaseService } from "./service";

function fakeApp(): App {
  return { workspace: { onLayoutReady: () => {} } } as unknown as App;
}

function fakeSettings(
  pending: boolean,
  update: (patch: unknown) => void,
): SettingsService {
  return {
    current: { "release.migration-pending": pending } as Partial<Settings>,
    update,
  } as unknown as SettingsService;
}

function makeService(pending: boolean, update: (patch: unknown) => void) {
  return new ReleaseService({
    app: fakeApp(),
    version: "2.0.0",
    settings: fakeSettings(pending, update),
  });
}

describe("ReleaseService.acknowledgeMigration", () => {
  it("clears the pending flag when set", async () => {
    const update = vi.fn();
    await using service = makeService(true, update);
    service.acknowledgeMigration();
    expect(update).toHaveBeenCalledWith({ "release.migration-pending": false });
  });

  it("is a no-op when the flag is already clear", async () => {
    const update = vi.fn();
    await using service = makeService(false, update);
    service.acknowledgeMigration();
    expect(update).not.toHaveBeenCalled();
  });
});

/** Vault whose folder at `folderPath` holds the named files; any other path resolves to null. */
function vaultWith(
  templateFiles: string[],
  folderPath: string = V1_TEMPLATE_FOLDER,
): App["vault"] {
  const folder = new TFolder();
  folder.children = templateFiles.map((name) => {
    const file = new TFile();
    file.name = name;
    return file;
  });
  return {
    getFolderByPath: (path: string) => (path === folderPath ? folder : null),
  } as unknown as App["vault"];
}

const flush = () => new Promise((resolve) => setTimeout(resolve));

/** The configured Literature Note template folder in the fixture settings. */
const CONFIGURED_TEMPLATE_FOLDER = "templates";

it.each([
  ["zt-note.eta.md", true],
  ["zt-content.eta.md", true],
  ["zotlit-note.eta.md", false],
  ["zotlit-profile.default.md", false],
  ["zt-note.liquid.md", false],
] as const)("reports v1 evidence for %s as %s", async (name, expected) => {
  await using service = new ReleaseService({
    app: {
      workspace: { onLayoutReady: () => {} },
      vault: vaultWith([name], CONFIGURED_TEMPLATE_FOLDER),
    } as unknown as App,
    version: "2.1.0",
    settings: fakeSettings(false, vi.fn()),
  });
  expect(service.hasV1Templates(CONFIGURED_TEMPLATE_FOLDER)).toBe(expected);
  expect(service.hasV1Templates("another folder")).toBe(false);
});

async function runCheck(opts: {
  origin: HydrationOrigin;
  templateFiles: string[];
  /** Folder the fixture vault places `templateFiles` under. */
  folderPath?: string;
  migrationPending?: boolean;
  recordedVersion?: string | null;
  currentVersion?: string;
  noticesEnabled?: boolean;
}): Promise<{
  update: ReturnType<typeof vi.fn>;
  openWelcomeView: ReturnType<typeof vi.fn>;
}> {
  const update = vi.fn();
  const openWelcomeView = vi.fn();
  let layoutReady: (() => void) | undefined;
  const settings = {
    loaded: Promise.resolve({
      "release.previous-version": opts.recordedVersion ?? null,
      "release.migration-pending": opts.migrationPending ?? false,
      "release.notices-enabled": opts.noticesEnabled ?? true,
      "template.folder": CONFIGURED_TEMPLATE_FOLDER,
    } as Partial<Settings>),
    hydrationOrigin: opts.origin,
    update,
  } as unknown as SettingsService;
  const app = {
    workspace: {
      onLayoutReady: (cb: () => void) => {
        layoutReady = cb;
      },
    },
    internalPlugins: { getEnabledPluginById: () => null },
    vault: vaultWith(opts.templateFiles, opts.folderPath),
  } as unknown as App;

  await using service = new ReleaseService({
    app,
    version: opts.currentVersion ?? "2.0.0",
    settings,
    openWelcomeView,
  });
  await service.ready;
  layoutReady?.();
  await flush();
  return { update, openWelcomeView };
}

describe("ReleaseService Companion update notice", () => {
  it("opens both the current release note and Companion installation guide", async () => {
    const labels = new WeakMap<ButtonComponent, string>();
    const actions = new Map<string, (event: MouseEvent) => unknown>();
    vi.spyOn(ButtonComponent.prototype, "setButtonText").mockImplementation(
      function (this: ButtonComponent, text) {
        labels.set(this, text);
        return this;
      },
    );
    vi.spyOn(ButtonComponent.prototype, "onClick").mockImplementation(
      function (this: ButtonComponent, callback) {
        actions.set(labels.get(this)!, callback);
        return this;
      },
    );
    const open = vi.spyOn(window, "open").mockImplementation(() => null);

    await runCheck({
      origin: "current",
      templateFiles: [],
      recordedVersion: "2.0.1",
      currentVersion: "2.1.0",
      noticesEnabled: false,
    });

    actions.get("See what's new")?.(new MouseEvent("click"));
    actions.get("Open installation guide")?.(new MouseEvent("click"));
    expect(open).toHaveBeenCalledWith(releaseNoteUrl("2.1.0"));
    expect(open).toHaveBeenCalledWith(DOCS_COMPANION);
  });
});

describe("ReleaseService templates-only v1 detection", () => {
  it("absent origin + ejected v1 templates opens upgraded, arms the prompt, and reconstructs the folder", async () => {
    const { update, openWelcomeView } = await runCheck({
      origin: "absent",
      templateFiles: ["zt-note.eta.md"],
    });
    expect(openWelcomeView).toHaveBeenCalledWith("upgraded");
    expect(update).toHaveBeenCalledWith({
      "release.previous-version": "2.0.0",
      "release.migration-pending": true,
      "template.folder": V1_TEMPLATE_FOLDER,
    });
  });

  it("absent origin with no ejected templates opens fresh and leaves the folder alone", async () => {
    const { update, openWelcomeView } = await runCheck({
      origin: "absent",
      templateFiles: [],
    });
    expect(openWelcomeView).toHaveBeenCalledWith("fresh");
    expect(update).toHaveBeenCalledWith({
      "release.previous-version": "2.0.0",
    });
  });

  it("malformed origin with ejected templates present still opens fresh, not upgraded", async () => {
    const { update, openWelcomeView } = await runCheck({
      origin: "malformed",
      templateFiles: ["zt-note.eta.md"],
    });
    expect(openWelcomeView).toHaveBeenCalledWith("fresh");
    expect(update).toHaveBeenCalledWith({
      "release.previous-version": "2.0.0",
    });
  });
});

describe("ReleaseService pending Migration Prompt re-probe", () => {
  it("configured folder still holds ejected templates: nothing opens, flag untouched", async () => {
    const { update, openWelcomeView } = await runCheck({
      origin: "current",
      migrationPending: true,
      templateFiles: ["zt-note.eta.md"],
      folderPath: CONFIGURED_TEMPLATE_FOLDER,
    });
    expect(openWelcomeView).not.toHaveBeenCalled();
    for (const call of update.mock.calls) {
      expect(call[0]).not.toHaveProperty("release.migration-pending");
    }
  });

  it("configured folder empty: nothing opens, flag auto-clears", async () => {
    const { update, openWelcomeView } = await runCheck({
      origin: "current",
      migrationPending: true,
      templateFiles: [],
      folderPath: CONFIGURED_TEMPLATE_FOLDER,
    });
    expect(openWelcomeView).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ "release.migration-pending": false }),
    );
  });

  it("configured folder missing entirely: nothing opens, flag auto-clears", async () => {
    const { update, openWelcomeView } = await runCheck({
      origin: "current",
      migrationPending: true,
      templateFiles: ["zt-note.eta.md"],
      // Templates exist, but not under the configured folder, so it resolves
      // to a missing folder from the service's perspective.
      folderPath: "some-other-folder",
    });
    expect(openWelcomeView).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ "release.migration-pending": false }),
    );
  });
});
