// @vitest-environment happy-dom
import type { App } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CONTRACT_VERSION } from "@zotlit/db";
import { exportLiteratureNotePack } from "@zotlit/templates/literature-note-pack";
import type { LiteratureNoteTemplatePartial } from "@zotlit/templates/literature-note-pack";

import { defaults } from "@/services/settings/schema";
import type { Settings } from "@/services/settings/schema";
import {
  profileCustomization,
  saveProfileCustomization,
} from "@/views/profile-editor/preferences";

import { createCustomize } from "./customize";
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

/** A Liquid document that calls a partial the template folder must answer. */
const CALLING_PROFILE = LIQUID_PROFILE.replace(
  "# {{ zt.title }}",
  "# {{ zt.title }}\n{% render 'byline' %}",
);

/** The build the unsupported check reads a Profile against. */
const PLUGIN_VERSION = "2.3.0";

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
  /** The listener binds on the next tick once asked; `false` keeps it silent. */
  serverStarts?: boolean;
  /** What the template folder holds. */
  partials?: readonly LiteratureNoteTemplatePartial[];
  activeNote?: { basename: string; itemKey: string | null } | null;
}

function harness({
  settings: overrides = {},
  source = LIQUID_PROFILE,
  consent = { destination: "web", remember: false },
  effectivePort = 9091,
  serverStarts = true,
  partials = [],
  activeNote = null,
}: Options = {}): Harness {
  const settings: Settings = {
    ...defaults,
    "server.workbench": true,
    ...overrides,
  };
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
    template: {
      ready: Promise.resolve(),
      exportLiteratureNotePackSource: (
        draft: string,
        options: Parameters<typeof exportLiteratureNotePack>[2],
      ) => Promise.resolve(exportLiteratureNotePack(draft, partials, options)),
    } as unknown as CustomizeDeps["template"],
    localServer: {
      get effectivePort() {
        return effectivePort;
      },
      on: (_event: "listening", cb: (port: number | null) => void) => {
        if (serverStarts) queueMicrotask(() => cb(9095));
        return () => {};
      },
    } as unknown as CustomizeDeps["localServer"],
    pluginVersion: PLUGIN_VERSION,
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
    openNative: async () => {
      openedFiles.push("templates/zotlit-profile.default.md");
    },
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
      turnWorkbenchOn: false,
    });
    expect(h.opened).toEqual([LAUNCH_URL]);
  });

  it("skips the sheet once the web choice is remembered", async () => {
    const asked = harness({
      settings: { "server.enabled": true },
      consent: { destination: "web", remember: true },
    });
    await asked.customize({ profileId: "default" });
    expect(asked.sheets).toHaveLength(1);

    await asked.customize({ profileId: "default" });
    expect(asked.sheets).toHaveLength(1);
    expect(asked.opened).toHaveLength(2);
  });

  it("brings the sheet back once the destination preference returns to Ask", async () => {
    const asked = harness({
      settings: { "server.enabled": true },
      consent: { destination: "web", remember: true },
    });
    await asked.customize({ profileId: "default" });
    expect(profileCustomization(deviceOf(asked))).toBe("web");

    saveProfileCustomization(deviceOf(asked), "ask");

    await asked.customize({ profileId: "default" });
    expect(asked.sheets).toHaveLength(2);
  });

  it("always shows the sheet while the Local Server is off, and turns it on", async () => {
    const off = harness({
      settings: { "server.enabled": false },
      consent: { destination: "web", remember: true },
      effectivePort: null,
    });
    // A device that already ticked the box still meets the sheet.
    saveProfileCustomization(deviceOf(off), "web");

    await off.customize({ profileId: "default" });

    expect(off.sheets[0]).toMatchObject({ turnServerOn: true });
    expect(off.update).toHaveBeenCalledWith({ "server.enabled": true });
    expect(off.opened).toEqual([LAUNCH_URL]);
  });

  it("says the server did not start instead of opening a tab", async () => {
    vi.useFakeTimers();
    try {
      const stuck = harness({
        settings: { "server.enabled": false },
        consent: { destination: "web", remember: true },
        effectivePort: null,
        serverStarts: false,
      });

      const launch = stuck.customize({ profileId: "default" });
      await vi.advanceTimersByTimeAsync(10_000);
      await launch;

      expect(stuck.update).toHaveBeenCalledWith({ "server.enabled": true });
      expect(stuck.opened).toEqual([]);
      // The tick is not honoured for a launch that never happened.
      expect(profileCustomization(deviceOf(stuck))).toBe("ask");
    } finally {
      vi.useRealTimers();
    }
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

  it("remembers native editing without enabling either server service", async () => {
    const native = harness({
      settings: { "server.enabled": false, "server.workbench": false },
      consent: { destination: "native", remember: true },
    });
    await native.customize({ profileId: "default" });
    await native.customize({ profileId: "default" });
    expect(native.sheets).toHaveLength(1);
    expect(native.openedFiles).toHaveLength(2);
    expect(native.launches).toEqual([]);
    expect(native.update).not.toHaveBeenCalled();
    expect(profileCustomization(deviceOf(native))).toBe("native");
  });

  it("an explicit web action asks for approval despite a remembered native choice", async () => {
    saveProfileCustomization(deviceOf(h), "native");
    await h.customize({ profileId: "default", destination: "web" });
    expect(h.sheets).toHaveLength(1);
    expect(h.opened).toEqual([LAUNCH_URL]);
  });

  it("an explicit native action skips the sheet despite a remembered web choice", async () => {
    saveProfileCustomization(deviceOf(h), "web");
    await h.customize({ profileId: "default", destination: "native" });
    expect(h.sheets).toEqual([]);
    expect(h.openedFiles).toHaveLength(1);
    expect(h.update).not.toHaveBeenCalled();
  });

  it("asks before enabling web access even with a remembered web choice", async () => {
    const disabled = harness({
      settings: { "server.enabled": true, "server.workbench": false },
    });
    saveProfileCustomization(deviceOf(disabled), "web");
    await disabled.customize({ profileId: "default" });
    expect(disabled.sheets[0]).toMatchObject({ turnWorkbenchOn: true });
    expect(disabled.update).toHaveBeenCalledWith({ "server.workbench": true });
    expect(disabled.opened).toEqual([LAUNCH_URL]);
  });

  it("reads the legacy web approval only while the destination preference is absent", async () => {
    h.device.set("zotlit-workbench-launch-approved", "1");
    await h.customize({ profileId: "default" });
    expect(h.sheets).toEqual([]);
    saveProfileCustomization(deviceOf(h), "ask");
    await h.customize({ profileId: "default" });
    expect(h.sheets).toHaveLength(1);
  });

  it("opens JavaScript frontmatter in the native editor", async () => {
    const javascript = harness({
      source: LIQUID_PROFILE.replace(
        "language: liquid",
        "language: liquid\nfrontmatter:\n  - key: title\n    js: zt.title",
      ),
    });
    await javascript.customize({ profileId: "default", destination: "web" });
    expect(javascript.openedFiles).toHaveLength(1);
    expect(javascript.sheets).toEqual([]);
    expect(javascript.launches).toEqual([]);
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

  it("keeps a Profile that calls an Eta partial from the template folder in Obsidian", async () => {
    const byline = {
      name: "byline",
      language: "eta",
      source: "<%= it.zt.title %>",
    } as const;
    const calling = harness({
      settings: { "server.enabled": true },
      source: CALLING_PROFILE,
      partials: [byline],
    });
    await calling.customize({ profileId: "default" });
    expect(calling.opened).toEqual([]);
    expect(calling.openedFiles).toEqual([
      "templates/zotlit-profile.default.md",
    ]);

    // The same call answered by a Liquid partial opens the browser.
    const liquid = harness({
      settings: { "server.enabled": true },
      source: CALLING_PROFILE,
      partials: [{ ...byline, language: "liquid", source: "{{ zt.title }}" }],
    });
    await liquid.customize({ profileId: "default" });
    expect(liquid.opened).toEqual([LAUNCH_URL]);
  });

  it("keeps a Profile that asks for a newer plugin in Obsidian", async () => {
    const newer = harness({
      settings: { "server.enabled": true },
      source: LIQUID_PROFILE.replace(
        "language: liquid",
        "language: liquid\nminAppVersion: 9.9.9",
      ),
    });

    await newer.customize({ profileId: "default" });

    expect(newer.opened).toEqual([]);
    expect(newer.openedFiles).toEqual(["templates/zotlit-profile.default.md"]);
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
