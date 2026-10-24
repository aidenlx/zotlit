// @vitest-environment happy-dom
import { ButtonComponent } from "obsidian";
import type { App } from "obsidian";
import { expect, vi } from "vitest";

import { DOCS_COMPANION } from "@/lib/constants";
import { Effect } from "@/lib/effect";
import { it } from "@/lib/effect-vitest";
import type { HydrationOrigin } from "@/services/settings/classify";
import type { Settings } from "@/services/settings/schema";

import { buildRelease, releaseApp, releaseOf } from "./__fixtures__";
import { releaseNoteUrl, V1_TEMPLATE_FOLDER } from "./constants";

/** The configured Literature Note template folder in the fixture settings. */
const CONFIGURED_TEMPLATE_FOLDER = "templates";

it.effect("Release.openReleaseNote succeeds when the view cannot open", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const setViewState = vi
        .fn()
        .mockRejectedValue(new Error("Cannot open view"));
      const app = {
        workspace: {
          onLayoutReady: () => {},
          getLeavesOfType: () => [],
          getLeaf: () => ({ setViewState }),
          revealLeaf: vi.fn(),
        },
        internalPlugins: {
          getEnabledPluginById: () => true,
        },
      } as unknown as App;
      const fixture = yield* releaseOf({
        app,
        layoutReady: () => {},
        current: () => ({}) as Settings,
      });

      yield* fixture.release.openReleaseNote();

      expect(setViewState).toHaveBeenCalledOnce();
    }),
  ),
);

it.effect("Release.acknowledgeMigration clears the pending flag when set", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const state = {
        "release.migration-pending": true,
      } as Partial<Settings>;
      const fixture = yield* releaseOf({
        app: releaseApp([]).app,
        layoutReady: () => {},
        current: () => state as Settings,
        update: (patch) => Object.assign(state, patch),
      });
      yield* fixture.release.acknowledgeMigration();
      expect(fixture.update).toHaveBeenCalledWith({
        "release.migration-pending": false,
      });
    }),
  ),
);

it.effect(
  "Release.acknowledgeMigration is a no-op when the flag is already clear",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const state = {
          "release.migration-pending": false,
        } as Partial<Settings>;
        const fixture = yield* releaseOf({
          app: releaseApp([]).app,
          layoutReady: () => {},
          current: () => state as Settings,
          update: (patch) => Object.assign(state, patch),
        });
        yield* fixture.release.acknowledgeMigration();
        expect(fixture.update).not.toHaveBeenCalled();
      }),
    ),
);

it.each([
  ["zt-note.eta.md", true],
  ["zt-content.eta.md", true],
  ["zotlit-note.eta.md", false],
  ["zotlit-profile.default.md", false],
  ["zt-note.liquid.md", false],
] as const)("reports v1 evidence for %s as %s", async (name, expected) => {
  const state = {} as Settings;
  const vault = releaseApp([name], CONFIGURED_TEMPLATE_FOLDER);
  await using release = await buildRelease({
    app: vault.app,
    layoutReady: () => vault.layoutReady(),
    current: () => state,
    version: "2.1.0",
  });
  expect(
    release.bridge.runSync(
      release.release.hasV1Templates(CONFIGURED_TEMPLATE_FOLDER),
    ),
  ).toBe(expected);
  expect(
    release.bridge.runSync(release.release.hasV1Templates("another folder")),
  ).toBe(false);
});

function runCheck(opts: {
  origin: HydrationOrigin;
  templateFiles: string[];
  /** Folder the fixture vault places `templateFiles` under. */
  folderPath?: string;
  migrationPending?: boolean;
  recordedVersion?: string | null;
  currentVersion?: string;
  noticesEnabled?: boolean;
  updatePending?: boolean;
}) {
  const state = {
    "release.previous-version": opts.recordedVersion ?? null,
    "release.migration-pending": opts.migrationPending ?? false,
    "release.notices-enabled": opts.noticesEnabled ?? true,
    "release.update-pending": opts.updatePending ?? false,
    "template.folder": CONFIGURED_TEMPLATE_FOLDER,
  } as Partial<Settings>;
  const openFirstScreen = vi.fn();
  const vault = releaseApp(opts.templateFiles, opts.folderPath);
  return Effect.scoped(
    Effect.gen(function* () {
      const fixture = yield* releaseOf({
        app: vault.app,
        layoutReady: () => vault.layoutReady(),
        current: () => state as Settings,
        origin: opts.origin,
        update: (patch) => Object.assign(state, patch),
        version: opts.currentVersion ?? "2.0.0",
        openFirstScreen,
      });
      vault.layoutReady();
      yield* fixture.release.checked;
      return { update: fixture.update, openFirstScreen };
    }),
  );
}

it.effect(
  "Release Companion update notice opens both the current release note and Companion installation guide",
  () =>
    Effect.gen(function* () {
      const labels = new WeakMap<ButtonComponent, string>();
      const actions = new Map<string, (event: MouseEvent) => unknown>();
      vi.spyOn(ButtonComponent.prototype, "setButtonText").mockImplementation(
        function (this: ButtonComponent, text) {
          labels.set(this, text);
          return this;
        },
      );
      vi.spyOn(ButtonComponent.prototype, "onClick").mockImplementation(
        function (
          this: ButtonComponent,
          callback: (event: MouseEvent) => unknown,
        ) {
          actions.set(labels.get(this)!, callback);
          return this;
        },
      );
      const open = vi.spyOn(window, "open").mockImplementation(() => null);

      yield* runCheck({
        origin: "current",
        templateFiles: [],
        recordedVersion: "2.0.1",
        currentVersion: "2.1.0",
        noticesEnabled: false,
      });

      actions.get("See what's new")?.(new MouseEvent("click"));
      actions.get("Open installation guide")?.(new MouseEvent("click"));
      yield* Effect.promise(() =>
        vi.waitFor(() => {
          expect(open).toHaveBeenCalledWith(releaseNoteUrl("2.1.0"));
          expect(open).toHaveBeenCalledWith(DOCS_COMPANION);
        }),
      );
    }),
);

it.effect(
  "Release update marks the update pending and opens the first screen, where the banner announces it",
  () =>
    Effect.gen(function* () {
      const { update, openFirstScreen } = yield* runCheck({
        origin: "current",
        templateFiles: [],
        recordedVersion: "2.1.0",
        currentVersion: "2.1.1",
      });
      expect(openFirstScreen).toHaveBeenCalledOnce();
      expect(update).toHaveBeenCalledWith({
        "release.previous-version": "2.1.1",
        "release.update-pending": true,
      });
    }),
);

it.effect.each([
  ["a downgrade", { recordedVersion: "2.1.1", currentVersion: "2.1.0" }],
  [
    "an upgrade with notices off",
    {
      recordedVersion: "2.1.0",
      currentVersion: "2.1.1",
      noticesEnabled: false,
    },
  ],
] as const)(
  "Release update %s opens nothing and marks no update",
  (_, versions) =>
    Effect.gen(function* () {
      const { update, openFirstScreen } = yield* runCheck({
        origin: "current",
        templateFiles: [],
        ...versions,
      });
      expect(openFirstScreen).not.toHaveBeenCalled();
      for (const [patch] of update.mock.calls) {
        expect(patch).not.toHaveProperty("release.update-pending", true);
      }
    }),
);

it.effect(
  "Release update opens the first screen on a fresh install with no update to announce",
  () =>
    Effect.gen(function* () {
      const { update, openFirstScreen } = yield* runCheck({
        origin: "absent",
        templateFiles: [],
        currentVersion: "2.1.1",
      });
      expect(openFirstScreen).toHaveBeenCalledOnce();
      expect(update).toHaveBeenCalledWith({
        "release.previous-version": "2.1.1",
      });
    }),
);

it.effect("Release.acknowledgeUpdate clears the update once", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const state = {
        "release.update-pending": true,
      } as Partial<Settings>;
      const fixture = yield* releaseOf({
        app: releaseApp([]).app,
        layoutReady: () => {},
        current: () => state as Settings,
        update: (patch) => Object.assign(state, patch),
        version: "2.1.1",
      });
      yield* fixture.release.acknowledgeUpdate();
      expect(fixture.update).toHaveBeenCalledWith({
        "release.update-pending": false,
      });
    }),
  ),
);

it("Release.checked settles once the launch check has opened the first screen", async () => {
  const opened = Promise.withResolvers<void>();
  const started = Promise.withResolvers<void>();
  const vault = releaseApp([]);
  const state = {
    "release.previous-version": null,
    "release.migration-pending": false,
    "release.notices-enabled": true,
    "template.folder": CONFIGURED_TEMPLATE_FOLDER,
  } as Partial<Settings>;
  await using release = await buildRelease({
    app: vault.app,
    layoutReady: () => vault.layoutReady(),
    current: () => state as Settings,
    origin: "absent",
    openFirstScreen: () => {
      started.resolve();
      return opened.promise;
    },
  });
  let checked = false;
  const checkedPromise = release.bridge
    .runPromise(release.release.checked)
    .then(() => {
      checked = true;
    });
  vault.layoutReady();
  await started.promise;
  expect(checked).toBe(false);
  opened.resolve();
  await checkedPromise;
  expect(checked).toBe(true);
});

it.effect(
  "Release templates-only v1 detection opens the first screen, arms the prompt, and reconstructs the folder",
  () =>
    Effect.gen(function* () {
      const { update, openFirstScreen } = yield* runCheck({
        origin: "absent",
        templateFiles: ["zt-note.eta.md"],
      });
      expect(openFirstScreen).toHaveBeenCalledOnce();
      expect(update).toHaveBeenCalledWith({
        "release.previous-version": "2.0.0",
        "release.migration-pending": true,
        "template.folder": V1_TEMPLATE_FOLDER,
      });
    }),
);

it.effect(
  "Release templates-only v1 detection with no ejected templates opens the first screen and leaves the folder alone",
  () =>
    Effect.gen(function* () {
      const { update, openFirstScreen } = yield* runCheck({
        origin: "absent",
        templateFiles: [],
      });
      expect(openFirstScreen).toHaveBeenCalledOnce();
      expect(update).toHaveBeenCalledWith({
        "release.previous-version": "2.0.0",
      });
    }),
);

it.effect(
  "Release templates-only v1 detection ignores malformed origins with ejected templates",
  () =>
    Effect.gen(function* () {
      const { update, openFirstScreen } = yield* runCheck({
        origin: "malformed",
        templateFiles: ["zt-note.eta.md"],
      });
      expect(openFirstScreen).toHaveBeenCalledOnce();
      expect(update).toHaveBeenCalledWith({
        "release.previous-version": "2.0.0",
      });
    }),
);

it.effect(
  "Release pending Migration Prompt re-probe leaves a configured folder with templates alone",
  () =>
    Effect.gen(function* () {
      const { update, openFirstScreen } = yield* runCheck({
        origin: "current",
        migrationPending: true,
        templateFiles: ["zt-note.eta.md"],
        folderPath: CONFIGURED_TEMPLATE_FOLDER,
      });
      expect(openFirstScreen).not.toHaveBeenCalled();
      for (const call of update.mock.calls) {
        expect(call[0]).not.toHaveProperty("release.migration-pending");
      }
    }),
);

it.effect(
  "Release pending Migration Prompt re-probe auto-clears when the configured folder is empty",
  () =>
    Effect.gen(function* () {
      const { update, openFirstScreen } = yield* runCheck({
        origin: "current",
        migrationPending: true,
        templateFiles: [],
        folderPath: CONFIGURED_TEMPLATE_FOLDER,
      });
      expect(openFirstScreen).not.toHaveBeenCalled();
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({ "release.migration-pending": false }),
      );
    }),
);

it.effect(
  "Release pending Migration Prompt re-probe auto-clears when the configured folder is missing",
  () =>
    Effect.gen(function* () {
      const { update, openFirstScreen } = yield* runCheck({
        origin: "current",
        migrationPending: true,
        templateFiles: ["zt-note.eta.md"],
        // Templates exist, but not under the configured folder, so it resolves
        // to a missing folder from the service's perspective.
        folderPath: "some-other-folder",
      });
      expect(openFirstScreen).not.toHaveBeenCalled();
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({ "release.migration-pending": false }),
      );
    }),
);
