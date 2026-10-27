// @vitest-environment happy-dom
import { expect, it } from "@effect/vitest";
import { ButtonComponent, renderRow } from "@mock/obsidian";
import type { Setting } from "@mock/obsidian";
import { Context, Effect, Exit, Layer, Stream } from "effect";
import { describe, vi } from "vitest";

import { eventually } from "@/lib/__fixtures__/eventually";
import { testNotifier } from "@/lib/__fixtures__/notifier";
import { stubService } from "@/lib/__fixtures__/service-stub";
import * as m from "@/lib/i18n/generated/messages";
import { ChineseSegmenter } from "@/services/chinese-segmenter/service";
import { ManagedBinaryError } from "@/services/managed-binary/platform";
import type {
  ManagedBinaryApi,
  ManagedBinaryStatus,
} from "@/services/managed-binary/service";
import { PandocEngine } from "@/services/pandoc/service";

import { scopedSettingTab, testSettingTab } from "./__fixtures__";
import { chineseSegmenterDefinition } from "./chinese-segmenter";
import type { SettingTabContext } from "./context";
import { installBinary, managedBinaryDefinition } from "./managed-binary";
import type { ManagedBinaryCopy } from "./managed-binary";
import { pandocEngineDefinition } from "./pandoc-engine";

const COPY: ManagedBinaryCopy = {
  id: "settings_segmenter",
  name: "Segmenter",
  desc: "Cuts words.",
  status: {
    absent: "Not installed.",
    installing: "Installing.",
    installed: (version) => `Version ${version}.`,
    downloadFailed: (detail) => `Download failed: ${detail}.`,
    hashMismatch: "Hash mismatch.",
    initFailed: (detail) => `Start failed: ${detail}.`,
  },
  actions: {
    install: "Install",
    installing: "Installing…",
    retry: "Retry",
    uninstall: "Uninstall",
  },
  notices: {
    downloading: "Downloading the segmenter",
    installed: "Segmenter installed",
    installFailed: "Segmenter install failed",
    removed: "Segmenter removed",
    removeFailed: "Segmenter removal failed",
  },
};

/** A binary at `status` whose install and uninstall count their runs. */
function binary(
  status: ManagedBinaryStatus,
  outcome: Effect.Effect<void, ManagedBinaryError> = Effect.void,
) {
  const install = vi.fn(() => outcome);
  const uninstall = vi.fn(() => outcome);
  const members = {
    getStatus: Effect.succeed(status),
    changes: Stream.empty,
    install: Effect.suspend(install),
    uninstall: Effect.suspend(uninstall),
  };
  const api = stubService<ManagedBinaryApi<Disposable | AsyncDisposable>>(
    "ManagedBinary",
    members,
  );
  return { api, members, install, uninstall };
}

/** The tab over a recording Notifier whose tracked notices run on the test's Scope. */
const notifiedTab = Effect.gen(function* () {
  const services = yield* Layer.build(testNotifier().layer);
  const { tab } = yield* scopedSettingTab(services);
  return { tab };
});

function button(setting: Setting): ButtonComponent {
  const found = setting.components.find(
    (control) => control instanceof ButtonComponent,
  );
  if (!(found instanceof ButtonComponent)) throw new Error("No button");
  // The mock's shared stub element has no focus to drop.
  found.buttonEl = document.createElement("button");
  return found;
}

describe("managedBinaryDefinition", () => {
  it.effect("offers the install while nothing is cached", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { tab } = yield* notifiedTab;
        const fake = binary({ kind: "absent" });
        const row = managedBinaryDefinition(
          tab,
          Effect.succeed(fake.api),
          COPY,
        );

        expect(row).toMatchObject({
          id: "settings_segmenter",
          name: "Segmenter",
          desc: "Cuts words. Not installed.",
        });
        const install = button(renderRow(row));
        expect(install.text).toBe("Install");

        install.click();
        yield* eventually(() => expect(fake.install).toHaveBeenCalledOnce());
      }),
    ),
  );

  it.effect("fails the install with the install's own error", () =>
    Effect.gen(function* () {
      const failure = new ManagedBinaryError({ message: "offline" });
      const fake = binary({ kind: "absent" }, Effect.fail(failure));

      const error = yield* installBinary(Effect.succeed(fake.api), COPY).pipe(
        Effect.provide(testNotifier().layer),
        Effect.flip,
      );

      expect(error).toBe(failure);
      expect(fake.install).toHaveBeenCalledOnce();
    }),
  );

  it.effect("ends the install with no failure once it is done", () =>
    Effect.gen(function* () {
      const fake = binary({ kind: "absent" });

      const exit = yield* installBinary(Effect.succeed(fake.api), COPY).pipe(
        Effect.provide(testNotifier().layer),
        Effect.exit,
      );

      expect(Exit.isSuccess(exit)).toBe(true);
    }),
  );

  it.effect("offers the removal once installed", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { tab } = yield* notifiedTab;
        const fake = binary({
          kind: "installed",
          version: "2.4.0",
          binary: { directory: "chinese-segmenter", name: "jieba.wasm" },
        });
        const row = managedBinaryDefinition(
          tab,
          Effect.succeed(fake.api),
          COPY,
        );

        expect(row).toMatchObject({ desc: "Cuts words. Version 2.4.0." });
        const uninstall = button(renderRow(row));
        expect(uninstall.text).toBe("Uninstall");

        uninstall.click();
        yield* eventually(() => expect(fake.uninstall).toHaveBeenCalledOnce());
      }),
    ),
  );

  it("names the failure and offers a retry", () => {
    const row = managedBinaryDefinition(
      testSettingTab().tab,
      Effect.succeed(
        binary({
          kind: "failed",
          failure: { code: "download-failed", url: "u", detail: "offline" },
        }).api,
      ),
      COPY,
    );

    expect(row).toMatchObject({
      desc: "Cuts words. Download failed: offline.",
    });
    expect(button(renderRow(row)).text).toBe("Retry");
  });
});

describe("pandocEngineDefinition", () => {
  it("renders the Pandoc engine row from its own messages", () => {
    const ctx = stubService<SettingTabContext>("SettingTabContext", {
      tab: testSettingTab(
        Context.make(
          PandocEngine,
          stubService<PandocEngine["Service"]>(
            "PandocEngine",
            binary({
              kind: "installed",
              version: "3.10",
              binary: { directory: "pandoc-engine", name: "pandoc.wasm" },
            }).members,
          ),
        ),
      ).tab,
    });
    const row = pandocEngineDefinition(ctx);

    expect(row).toMatchObject({
      id: "settings_citation_engine",
      name: m.settings_citation_engine_name(),
      desc: `${m.settings_citation_engine_desc()} ${m.settings_citation_engine_status_installed({ version: "3.10" })}`,
    });
    expect(button(renderRow(row)).text).toBe(
      m.settings_citation_engine_uninstall(),
    );
  });
});

describe("chineseSegmenterDefinition", () => {
  it("renders the Chinese segmenter row from its own messages", () => {
    const ctx = stubService<SettingTabContext>("SettingTabContext", {
      tab: testSettingTab(
        Context.make(
          ChineseSegmenter,
          stubService<ChineseSegmenter["Service"]>(
            "ChineseSegmenter",
            binary({ kind: "absent" }).members,
          ),
        ),
      ).tab,
    });
    const row = chineseSegmenterDefinition(ctx);

    expect(row).toMatchObject({
      id: "settings_chinese_segmenter",
      name: m.settings_chinese_segmenter_name(),
      desc: `${m.settings_chinese_segmenter_desc()} ${m.settings_chinese_segmenter_status_absent()}`,
    });
    expect(button(renderRow(row)).text).toBe(
      m.settings_chinese_segmenter_install(),
    );
  });
});
