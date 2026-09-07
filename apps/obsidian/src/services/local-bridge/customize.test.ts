// @vitest-environment happy-dom
import type { App } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CONTRACT_VERSION } from "@zotlit/db";

import { defaults } from "@/services/settings/schema";
import type { Settings } from "@/services/settings/schema";

import {
  createCustomize,
  launchSheetSkipped,
  setLaunchSheetSkipped,
} from "./customize";
import type {
  CustomizeDeps,
  LaunchConsent,
  LaunchSheetDetails,
} from "./customize";

const LIQUID_PROFILE = `---
id: default
name: Default
version: 1.0.0
contract: ${CONTRACT_VERSION}
filename: '{{ zt.key }}'
language: liquid
---
# {{ zt.title }}

--- zotlit:annotation ---
{{ zt.text }}
`;

const ETA_PROFILE = LIQUID_PROFILE.replace("language: liquid", "language: eta");

const LAUNCH_URL =
  "https://zotlit.aidenlx.site/workbench#zotlit-connect=abc&port=9091";

interface Harness {
  customize: ReturnType<typeof createCustomize>;
  device: Map<string, unknown>;
  settings: Settings;
  update: ReturnType<typeof vi.fn>;
  opened: string[];
  sheets: LaunchSheetDetails[];
  launches: unknown[];
  openedFiles: string[];
}

interface Options {
  settings?: Partial<Settings>;
  source?: string;
  /** What the sheet answers; `null` is Cancel. */
  consent?: LaunchConsent | null;
  effectivePort?: number | null;
  activeNote?: { basename: string; itemKey: string | null } | null;
}

function harness({
  settings: overrides = {},
  source = LIQUID_PROFILE,
  consent = { doNotAskAgain: false },
  effectivePort = 9091,
  activeNote = null,
}: Options = {}): Harness {
  const settings: Settings = { ...defaults, ...overrides };
  const device = new Map<string, unknown>();
  const opened: string[] = [];
  const sheets: LaunchSheetDetails[] = [];
  const launches: unknown[] = [];
  const openedFiles: string[] = [];
  const update = vi.fn((patch: Partial<Settings>) => {
    Object.assign(settings, patch);
  });
  const file = activeNote && { basename: activeNote.basename };
  const app = {
    vault: {
      getName: () => "Research",
      getFileByPath: (path: string) => ({ path }),
    },
    workspace: {
      getActiveFile: () => file,
      getLeaf: () => ({
        openFile: (target: { path: string }) => {
          openedFiles.push(target.path);
          return Promise.resolve();
        },
      }),
    },
    metadataCache: {
      getFileCache: () => ({
        frontmatter: activeNote?.itemKey
          ? { "zotero-key": activeNote.itemKey }
          : {},
      }),
    },
    loadLocalStorage: (key: string) => device.get(key) ?? null,
    saveLocalStorage: (key: string, value: unknown) => {
      if (value === null) device.delete(key);
      else device.set(key, value);
    },
  } as unknown as App;

  const deps: CustomizeDeps = {
    app,
    settings: {
      get current() {
        return settings;
      },
      update,
    } as unknown as CustomizeDeps["settings"],
    profile: {
      ready: Promise.resolve(),
      profiles: [],
      defaultDocumentPath: "templates/zotlit-profile.default.md",
      getSource: () => Promise.resolve(source),
    } as unknown as CustomizeDeps["profile"],
    localServer: {
      get effectivePort() {
        return effectivePort;
      },
      // The listener the flow just asked for binds on the next tick.
      on: (_event: "listening", cb: (port: number | null) => void) => {
        queueMicrotask(() => cb(9095));
        return () => {};
      },
    } as unknown as CustomizeDeps["localServer"],
    bridge: {
      launchUrl: (launch: unknown) => {
        launches.push(launch);
        return LAUNCH_URL;
      },
    } as unknown as CustomizeDeps["bridge"],
    confirmLaunch: (details) => {
      sheets.push(details);
      return Promise.resolve(consent);
    },
    openExternal: (url) => opened.push(url),
  };

  return {
    customize: createCustomize(deps),
    device,
    settings,
    update,
    opened,
    sheets,
    launches,
    openedFiles,
  };
}

describe("the Customize flow", () => {
  let h: Harness;

  beforeEach(() => {
    h = harness({ settings: { "server.enabled": true } });
  });

  it("shows the sheet on the first launch of this device, then opens the browser", async () => {
    await h.customize({ profileId: "default" });

    expect(h.sheets).toHaveLength(1);
    expect(h.sheets[0]).toEqual({
      website: "zotlit.aidenlx.site",
      vault: "Research",
      item: null,
      template: "Default",
      turnServerOn: false,
    });
    expect(h.opened).toEqual([LAUNCH_URL]);
  });

  it("skips the sheet once Do not ask again is ticked", async () => {
    const asked = harness({
      settings: { "server.enabled": true },
      consent: { doNotAskAgain: true },
    });
    await asked.customize({ profileId: "default" });
    expect(asked.sheets).toHaveLength(1);

    await asked.customize({ profileId: "default" });
    expect(asked.sheets).toHaveLength(1);
    expect(asked.opened).toHaveLength(2);
  });

  it("brings the sheet back once Confirm before opening clears the flag", async () => {
    const asked = harness({
      settings: { "server.enabled": true },
      consent: { doNotAskAgain: true },
    });
    await asked.customize({ profileId: "default" });
    expect(launchSheetSkipped(deviceOf(asked))).toBe(true);

    setLaunchSheetSkipped(deviceOf(asked), false);

    await asked.customize({ profileId: "default" });
    expect(asked.sheets).toHaveLength(2);
  });

  it("always shows the sheet while the Local Server is off, and turns it on", async () => {
    const off = harness({
      settings: { "server.enabled": false },
      consent: { doNotAskAgain: true },
      effectivePort: null,
    });
    // A device that already ticked the box still meets the sheet.
    setLaunchSheetSkipped(deviceOf(off), true);

    await off.customize({ profileId: "default" });

    expect(off.sheets[0]).toMatchObject({ turnServerOn: true });
    expect(off.update).toHaveBeenCalledWith({ "server.enabled": true });
    expect(off.opened).toEqual([LAUNCH_URL]);
  });

  it("opens nothing and writes nothing on Cancel", async () => {
    const cancelled = harness({
      settings: { "server.enabled": false },
      consent: null,
      effectivePort: null,
    });

    await cancelled.customize({ profileId: "default" });

    expect(cancelled.opened).toEqual([]);
    expect(cancelled.update).not.toHaveBeenCalled();
    expect(cancelled.device.size).toBe(0);
  });

  it("takes the active Literature Note's paper, and a Sample Item without one", async () => {
    const withNote = harness({
      settings: { "server.enabled": true },
      activeNote: {
        basename: "Why most published research findings are false",
        itemKey: "IANNP5A2",
      },
    });
    await withNote.customize({ profileId: "default" });
    expect(withNote.launches[0]).toEqual({
      profileId: "default",
      item: {
        key: "IANNP5A2",
        title: "Why most published research findings are false",
      },
    });

    const plain = harness({
      settings: { "server.enabled": true },
      activeNote: { basename: "Reading list", itemKey: null },
    });
    await plain.customize({ profileId: "default" });
    expect(plain.launches[0]).toEqual({ profileId: "default", item: null });
  });

  it("keeps an Eta Profile in Obsidian instead of opening a browser", async () => {
    const eta = harness({
      settings: { "server.enabled": true },
      source: ETA_PROFILE,
    });

    await eta.customize({ profileId: "default" });

    expect(eta.opened).toEqual([]);
    expect(eta.sheets).toEqual([]);
    expect(eta.openedFiles).toEqual(["templates/zotlit-profile.default.md"]);
  });
});

function deviceOf(h: Harness): {
  loadLocalStorage: (key: string) => unknown;
  saveLocalStorage: (key: string, value: unknown) => void;
} {
  return {
    loadLocalStorage: (key) => h.device.get(key) ?? null,
    saveLocalStorage: (key, value) => {
      if (value === null) h.device.delete(key);
      else h.device.set(key, value);
    },
  };
}
