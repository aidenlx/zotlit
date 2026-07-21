import { type App, TFile, TFolder } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { type HydrationOrigin } from "@/services/settings/classify";
import { type Settings } from "@/services/settings/schema";
import { type SettingsService } from "@/services/settings/service";

import { V1_TEMPLATE_FOLDER } from "./constants";
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

async function runCheck(opts: {
  origin: HydrationOrigin;
  templateFiles: string[];
  /** Folder the fixture vault places `templateFiles` under. */
  folderPath?: string;
  migrationPending?: boolean;
}): Promise<{
  update: ReturnType<typeof vi.fn>;
  openWelcomeView: ReturnType<typeof vi.fn>;
}> {
  const update = vi.fn();
  const openWelcomeView = vi.fn();
  let layoutReady: (() => void) | undefined;
  const settings = {
    loaded: Promise.resolve({
      "release.previous-version": null,
      "release.migration-pending": opts.migrationPending ?? false,
      "release.notices-enabled": true,
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
    vault: vaultWith(opts.templateFiles, opts.folderPath),
  } as unknown as App;

  await using service = new ReleaseService({
    app,
    version: "2.0.0",
    settings,
    openWelcomeView,
  });
  await service.ready;
  layoutReady?.();
  await flush();
  return { update, openWelcomeView };
}

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
