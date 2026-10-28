// @vitest-environment happy-dom
import { it } from "@effect/vitest";
import { Context, Effect, Fiber, Layer, SubscriptionRef } from "effect";
import type { Scope } from "effect";
import { TestClock } from "effect/testing";
import { TFile } from "obsidian";
import { describe, expect, vi } from "vitest";

import { CONTRACT_VERSION } from "@zotlit/db";
import { exportLiteratureNotePack } from "@zotlit/templates/literature-note-pack";
import type {
  LiteratureNotePackError,
  LiteratureNoteTemplatePartial,
} from "@zotlit/templates/literature-note-pack";

import { openTestBridge } from "@/lib/__fixtures__/effect-bridge";
import { testNotifier } from "@/lib/__fixtures__/notifier";
import { layerTestObsidianEnv } from "@/lib/__fixtures__/obsidian-env";
import { layerHost } from "@/lib/__fixtures__/obsidian-host-app";
import { MemoryMetadataCache } from "@/lib/__fixtures__/obsidian-metadata-cache";
import { MemoryVault } from "@/lib/__fixtures__/obsidian-vault";
import { MemoryWorkspace } from "@/lib/__fixtures__/obsidian-workspace";
import * as m from "@/lib/i18n/generated/messages";
import type { ProfileId } from "@/lib/profile-stamp";
import { LocalServer } from "@/services/local-server/service";
import { Profile, ProfileOperationError } from "@/services/profile/service";
import type { LiteratureNoteProfile } from "@/services/profile/service";
import { defaults } from "@/services/settings/schema";
import type { Settings } from "@/services/settings/schema";
import { PluginSettings } from "@/services/settings/service";
import { Template } from "@/services/template/service";
import {
  profileCustomization,
  saveProfileCustomization,
} from "@/views/template-workbench/preferences";

import {
  bindCustomize,
  Customize,
  customize,
  layerCustomize,
} from "./customize";
import type {
  CustomizePorts,
  CustomizeRequest,
  LaunchConsent,
  LaunchSheetDetails,
  NativeProfileTarget,
} from "./customize";
import { LocalBridge } from "./service";

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

/** A Liquid document that calls a partial the template folder must answer. */
const CALLING_PROFILE = LIQUID_PROFILE.replace(
  "# {{ zt.title }}",
  "# {{ zt.title }}\n{% render 'byline' %}",
);

/** The build the unsupported check reads a Profile against. */
const PLUGIN_VERSION = "2.3.0";

const DEFAULT_DOCUMENT = "templates/zotlit-profile.default.md";

const LAUNCH_URL =
  "https://zotlit.aidenlx.site/workbench#zotlit-connect=abc&port=9091";

interface Harness {
  customize(request: CustomizeRequest): Effect.Effect<void, unknown>;
  /** The flow as its layer builds it, for a run through {@link bindCustomize}. */
  service: Effect.Effect<Customize["Service"], never, Scope.Scope>;
  /** The ports the flow runs with. */
  ports: CustomizePorts;
  device: Map<string, unknown>;
  settings: Settings;
  update: ReturnType<typeof vi.fn>;
  opened: string[];
  sheets: LaunchSheetDetails[];
  /** The sheets taken away without an answer. */
  closedSheets: LaunchSheetDetails[];
  launches: unknown[];
  openedFiles: string[];
}

interface Options {
  webWorkbenchEnabled?: boolean;
  settings?: Partial<Settings>;
  source?: string;
  /** What the sheet answers; `null` is Cancel, and `"held"` never answers. */
  consent?: LaunchConsent | null | "held";
  effectivePort?: number | null;
  /** The listener binds once the flow turns the server on; `false` keeps it silent. */
  serverStarts?: boolean;
  /** What the template folder holds. */
  partials?: readonly LiteratureNoteTemplatePartial[];
  activeNote?: { basename: string; itemKey: string | null } | null;
  /** The Profiles the registry holds; the vault holds each one's file. */
  profiles?: readonly LiteratureNoteProfile[];
  /** The vault holds a saved Default Profile document that does not parse. */
  invalidDefault?: boolean;
}

const harness = Effect.fnUntraced(function* ({
  webWorkbenchEnabled = true,
  settings: overrides = {},
  source = LIQUID_PROFILE,
  consent = { destination: "web", remember: false },
  effectivePort = 9091,
  serverStarts = true,
  partials = [],
  activeNote = null,
  profiles = [],
  invalidDefault = false,
}: Options = {}) {
  const settings: Settings = {
    ...defaults,
    "server.workbench": true,
    ...overrides,
  };
  const device = new Map<string, unknown>();
  const opened: string[] = [];
  const sheets: LaunchSheetDetails[] = [];
  const closedSheets: LaunchSheetDetails[] = [];
  const launches: unknown[] = [];
  const openedFiles: string[] = [];
  const update = vi.fn((patch: Partial<Settings>) => {
    Object.assign(settings, patch);
  });
  const port = yield* SubscriptionRef.make<number | null>(effectivePort);

  const workspace = new MemoryWorkspace();
  const metadataCache = new MemoryMetadataCache();
  if (activeNote) {
    const file = new TFile();
    file.path = `literatures/${activeNote.basename}.md`;
    file.basename = activeNote.basename;
    workspace.activeFile = file;
    metadataCache.entries.set(file.path, {
      frontmatter: activeNote.itemKey
        ? { "zotero-key": activeNote.itemKey }
        : {},
    });
  }

  const vault = new MemoryVault();
  for (const { path } of profiles) vault.add(path);
  if (invalidDefault) vault.add(DEFAULT_DOCUMENT);

  const layer = Layer.mergeAll(
    layerHost({ workspace, metadataCache, vault }),
    layerTestObsidianEnv({ vaultName: "Research" }),
    testNotifier().layer,
    Layer.mock(PluginSettings, {
      current: Effect.succeed(settings),
      update: (patch) =>
        Effect.gen(function* () {
          const applied = (
            typeof patch === "function" ? patch(settings) : patch
          ) as Partial<Settings>;
          update(applied);
          // The listener binds once the flow turns the server on.
          if (serverStarts && applied["server.enabled"])
            yield* SubscriptionRef.set(port, 9095);
          return settings;
        }),
    }),
    Layer.mock(Profile, {
      profiles: Effect.succeed(profiles),
      defaultDocumentPath: Effect.succeed(DEFAULT_DOCUMENT),
      getSource: () =>
        invalidDefault
          ? Effect.fail(
              new ProfileOperationError({
                message: "The Default Profile does not parse",
                cause: undefined,
              }),
            )
          : Effect.succeed(source),
    }),
    Layer.mock(Template, {
      exportLiteratureNotePackSource: (draft, options) =>
        Effect.try({
          try: () => exportLiteratureNotePack(draft, partials, options),
          catch: (error) => error as LiteratureNotePackError,
        }),
    }),
    Layer.mock(LocalServer, {
      effectivePort: SubscriptionRef.get(port),
      effectivePortChanges: SubscriptionRef.changes(port),
    }),
    Layer.mock(LocalBridge, {
      launchUrl: (launch) =>
        Effect.sync(() => {
          launches.push(launch);
          return LAUNCH_URL;
        }),
    }),
  );

  const deviceStore = deviceOfMap(device);
  const ports: CustomizePorts = {
    webWorkbenchEnabled,
    pluginVersion: PLUGIN_VERSION,
    confirmLaunch: (details, settle) => {
      sheets.push(details);
      if (consent !== "held") settle(consent);
      return { close: () => closedSheets.push(details) };
    },
    openExternal: (url) => opened.push(url),
    openNative: (_request, target: NativeProfileTarget) =>
      Effect.sync(() => {
        openedFiles.push(
          target instanceof TFile ? target.path : target.defaultDocumentPath,
        );
      }),
    preference: () => profileCustomization(deviceStore),
    rememberPreference: (value) => saveProfileCustomization(deviceStore, value),
  };
  const built: Harness = {
    customize: (request) =>
      customize(request, ports).pipe(Effect.provide(layer)),
    service: Layer.build(layerCustomize(ports).pipe(Layer.provide(layer))).pipe(
      Effect.map((context) => Context.get(context, Customize)),
    ),
    ports,
    device,
    settings,
    update,
    opened,
    sheets,
    closedSheets,
    launches,
    openedFiles,
  };
  return built;
});

/** The common case: the Local Server already on. */
const serverOn = () => harness({ settings: { "server.enabled": true } });

describe("the Customize flow", () => {
  it.effect("opens a named Profile's own document in the native editor", () =>
    Effect.gen(function* () {
      const books: LiteratureNoteProfile = {
        id: "Bk3Qn7XvT2Lp" as ProfileId,
        label: "Books",
        document: "zotlit-profile.books.md",
        path: "templates/zotlit-profile.books.md",
        bindings: {},
        match: { state: "absent", summary: m.profile_match_absent() },
      };
      const local = yield* harness({
        webWorkbenchEnabled: false,
        profiles: [books],
      });

      yield* local.customize({ profileId: books.id });
      yield* local.customize({ profileId: "Zz9Zz9Zz9Zz9" as ProfileId });

      // A Profile the registry does not hold opens nothing.
      expect(local.openedFiles).toEqual([books.path]);
    }),
  );

  it.effect(
    "opens a saved Default Profile that does not parse, so it can be repaired",
    () =>
      Effect.gen(function* () {
        const local = yield* harness({
          webWorkbenchEnabled: false,
          invalidDefault: true,
        });

        yield* local.customize({ profileId: "default" });

        expect(local.openedFiles).toEqual([DEFAULT_DOCUMENT]);
      }),
  );

  it.effect(
    "opens locally when the build gate is off despite persisted web access",
    () =>
      Effect.gen(function* () {
        const local = yield* harness({
          webWorkbenchEnabled: false,
          settings: { "server.enabled": true, "server.workbench": true },
        });
        saveProfileCustomization(deviceOf(local), "web");
        local.device.set("zotlit-workbench-launch-approved", "1");

        yield* local.customize({ profileId: "default", destination: "web" });

        expect(local.openedFiles).toEqual([
          "templates/zotlit-profile.default.md",
        ]);
        expect(local.sheets).toEqual([]);
        expect(local.launches).toEqual([]);
        expect(local.update).not.toHaveBeenCalled();
      }),
  );

  it.effect("skips the sheet once the web choice is remembered", () =>
    Effect.gen(function* () {
      const asked = yield* harness({
        settings: { "server.enabled": true },
        consent: { destination: "web", remember: true },
      });
      yield* asked.customize({ profileId: "default" });
      expect(asked.sheets).toHaveLength(1);

      yield* asked.customize({ profileId: "default" });
      expect(asked.sheets).toHaveLength(1);
      expect(asked.opened).toHaveLength(2);
    }),
  );

  it.effect(
    "brings the sheet back once the destination preference returns to Ask",
    () =>
      Effect.gen(function* () {
        const asked = yield* harness({
          settings: { "server.enabled": true },
          consent: { destination: "web", remember: true },
        });
        yield* asked.customize({ profileId: "default" });
        expect(profileCustomization(deviceOf(asked))).toBe("web");

        saveProfileCustomization(deviceOf(asked), "ask");

        yield* asked.customize({ profileId: "default" });
        expect(asked.sheets).toHaveLength(2);
      }),
  );

  it.effect(
    "always shows the sheet while the Local Server is off, and turns it on",
    () =>
      Effect.gen(function* () {
        const off = yield* harness({
          settings: { "server.enabled": false },
          consent: { destination: "web", remember: true },
          effectivePort: null,
        });
        // A device that already ticked the box still meets the sheet.
        saveProfileCustomization(deviceOf(off), "web");

        yield* off.customize({ profileId: "default" });

        expect(off.sheets[0]).toMatchObject({ turnServerOn: true });
        expect(off.update).toHaveBeenCalledWith({ "server.enabled": true });
        expect(off.opened).toEqual([LAUNCH_URL]);
      }),
  );

  it.effect("says the server did not start instead of opening a tab", () =>
    Effect.gen(function* () {
      const stuck = yield* harness({
        settings: { "server.enabled": false },
        consent: { destination: "web", remember: true },
        effectivePort: null,
        serverStarts: false,
      });

      const launch = yield* Effect.forkChild(
        stuck.customize({ profileId: "default" }),
      );
      yield* TestClock.adjust("10 seconds");
      yield* Fiber.join(launch);

      expect(stuck.update).toHaveBeenCalledWith({ "server.enabled": true });
      expect(stuck.opened).toEqual([]);
      // The tick is not honoured for a launch that never happened.
      expect(profileCustomization(deviceOf(stuck))).toBe("ask");
    }),
  );

  it.effect("closes the open sheet when the flow is interrupted", () =>
    Effect.gen(function* () {
      const held = yield* harness({
        settings: { "server.enabled": false },
        consent: "held",
        effectivePort: null,
      });

      const launch = yield* Effect.forkChild(
        held.customize({ profileId: "default" }),
        { startImmediately: true },
      );
      expect(held.sheets).toHaveLength(1);
      yield* Fiber.interrupt(launch);

      expect(held.closedSheets).toEqual(held.sheets);
      expect(held.opened).toEqual([]);
      expect(held.update).not.toHaveBeenCalled();
    }),
  );

  it.effect("closes the open sheet when the plugin unloads", () =>
    Effect.gen(function* () {
      const held = yield* harness({
        settings: { "server.enabled": false },
        consent: "held",
        effectivePort: null,
      });
      const bridge = openTestBridge();
      const action = bindCustomize(bridge, yield* held.service);

      void action({ profileId: "default" });
      yield* Effect.yieldNow;
      expect(held.sheets).toHaveLength(1);
      yield* Effect.promise(() => bridge[Symbol.asyncDispose]());

      expect(held.closedSheets).toEqual(held.sheets);
      expect(held.opened).toEqual([]);
      expect(held.update).not.toHaveBeenCalled();
    }),
  );

  it.effect("opens nothing and writes nothing on Cancel", () =>
    Effect.gen(function* () {
      const cancelled = yield* harness({
        settings: { "server.enabled": false },
        consent: null,
        effectivePort: null,
      });

      yield* cancelled.customize({ profileId: "default" });

      expect(cancelled.opened).toEqual([]);
      expect(cancelled.update).not.toHaveBeenCalled();
      expect(cancelled.device.size).toBe(0);
    }),
  );

  it.effect(
    "remembers native editing without enabling either server service",
    () =>
      Effect.gen(function* () {
        const native = yield* harness({
          settings: { "server.enabled": false, "server.workbench": false },
          consent: { destination: "native", remember: true },
        });
        yield* native.customize({ profileId: "default" });
        yield* native.customize({ profileId: "default" });
        expect(native.sheets).toHaveLength(1);
        expect(native.openedFiles).toHaveLength(2);
        expect(native.launches).toEqual([]);
        expect(native.update).not.toHaveBeenCalled();
        expect(profileCustomization(deviceOf(native))).toBe("native");
      }),
  );

  it.effect(
    "an explicit web action asks for approval despite a remembered native choice",
    () =>
      Effect.gen(function* () {
        const h = yield* serverOn();
        saveProfileCustomization(deviceOf(h), "native");
        yield* h.customize({ profileId: "default", destination: "web" });
        expect(h.sheets).toHaveLength(1);
        expect(h.opened).toEqual([LAUNCH_URL]);
      }),
  );

  it.effect(
    "an explicit native action skips the sheet despite a remembered web choice",
    () =>
      Effect.gen(function* () {
        const h = yield* serverOn();
        saveProfileCustomization(deviceOf(h), "web");
        yield* h.customize({ profileId: "default", destination: "native" });
        expect(h.sheets).toEqual([]);
        expect(h.openedFiles).toHaveLength(1);
        expect(h.update).not.toHaveBeenCalled();
      }),
  );

  it.effect(
    "asks before enabling web access even with a remembered web choice",
    () =>
      Effect.gen(function* () {
        const disabled = yield* harness({
          settings: { "server.enabled": true, "server.workbench": false },
        });
        saveProfileCustomization(deviceOf(disabled), "web");
        yield* disabled.customize({ profileId: "default" });
        expect(disabled.sheets[0]).toMatchObject({ turnWorkbenchOn: true });
        expect(disabled.update).toHaveBeenCalledWith({
          "server.workbench": true,
        });
        expect(disabled.opened).toEqual([LAUNCH_URL]);
      }),
  );

  it.effect(
    "reads the legacy web approval only while the destination preference is absent",
    () =>
      Effect.gen(function* () {
        const h = yield* serverOn();
        h.device.set("zotlit-workbench-launch-approved", "1");
        yield* h.customize({ profileId: "default" });
        expect(h.sheets).toEqual([]);
        saveProfileCustomization(deviceOf(h), "ask");
        yield* h.customize({ profileId: "default" });
        expect(h.sheets).toHaveLength(1);
      }),
  );

  it.effect("opens JavaScript frontmatter in the native editor", () =>
    Effect.gen(function* () {
      const javascript = yield* harness({
        source: LIQUID_PROFILE.replace(
          "language: liquid",
          "language: liquid\nfrontmatter:\n  - key: title\n    js: zt.title",
        ),
      });
      yield* javascript.customize({ profileId: "default", destination: "web" });
      expect(javascript.openedFiles).toHaveLength(1);
      expect(javascript.sheets).toEqual([]);
      expect(javascript.launches).toEqual([]);
    }),
  );

  it.effect(
    "takes the active Literature Note's paper, and a Sample Item without one",
    () =>
      Effect.gen(function* () {
        const withNote = yield* harness({
          settings: { "server.enabled": true },
          activeNote: {
            basename: "Why most published research findings are false",
            itemKey: "IANNP5A2",
          },
        });
        yield* withNote.customize({ profileId: "default" });
        expect(withNote.launches[0]).toEqual({
          profileId: "default",
          item: {
            key: "IANNP5A2",
            title: "Why most published research findings are false",
          },
        });

        const plain = yield* harness({
          settings: { "server.enabled": true },
          activeNote: { basename: "Reading list", itemKey: null },
        });
        yield* plain.customize({ profileId: "default" });
        expect(plain.launches[0]).toEqual({ profileId: "default", item: null });
      }),
  );

  it.effect(
    "keeps a Profile that calls an Eta partial from the template folder in Obsidian",
    () =>
      Effect.gen(function* () {
        const byline = {
          name: "byline",
          language: "eta",
          source: "<%= it.zt.title %>",
        } as const;
        const calling = yield* harness({
          settings: { "server.enabled": true },
          source: CALLING_PROFILE,
          partials: [byline],
        });
        yield* calling.customize({ profileId: "default" });
        expect(calling.opened).toEqual([]);
        expect(calling.openedFiles).toEqual([
          "templates/zotlit-profile.default.md",
        ]);

        // The same call answered by a Liquid partial opens the browser.
        const liquid = yield* harness({
          settings: { "server.enabled": true },
          source: CALLING_PROFILE,
          partials: [
            { ...byline, language: "liquid", source: "{{ zt.title }}" },
          ],
        });
        yield* liquid.customize({ profileId: "default" });
        expect(liquid.opened).toEqual([LAUNCH_URL]);
      }),
  );

  it.effect("keeps a Profile that asks for a newer plugin in Obsidian", () =>
    Effect.gen(function* () {
      const newer = yield* harness({
        settings: { "server.enabled": true },
        source: LIQUID_PROFILE.replace(
          "language: liquid",
          "language: liquid\nminAppVersion: 9.9.9",
        ),
      });

      yield* newer.customize({ profileId: "default" });

      expect(newer.opened).toEqual([]);
      expect(newer.openedFiles).toEqual([
        "templates/zotlit-profile.default.md",
      ]);
    }),
  );
});

function deviceOf(h: Harness) {
  return deviceOfMap(h.device);
}

function deviceOfMap(device: Map<string, unknown>): {
  loadLocalStorage: (key: string) => unknown;
  saveLocalStorage: (key: string, value: unknown) => void;
} {
  return {
    loadLocalStorage: (key) => device.get(key) ?? null,
    saveLocalStorage: (key, value) => {
      if (value === null) device.delete(key);
      else device.set(key, value);
    },
  };
}
