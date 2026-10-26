// @vitest-environment happy-dom
import { it } from "@effect/vitest";
import { ButtonComponent, controlsOf } from "@mock/obsidian";
import { Effect, Layer, Stream } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect } from "vitest";

import { testNotifier } from "@/lib/__fixtures__/notifier";
import type { RecordedNotice } from "@/lib/__fixtures__/notifier";
import * as m from "@/lib/i18n/generated/messages";

import { CHINESE_PACK, eventually, fakeDevice, startOn } from "./__fixtures__";
import type { FakeDevice } from "./__fixtures__";
import { layerLanguagePackNotices } from "./notices";
import { LanguagePack } from "./service";
import type { LanguagePackSituation } from "./service";

/** Start on `device` and register the startup notices, as plugin load does. */
const loadOn = Effect.fn("test.loadOn")(function* (
  device: FakeDevice,
  options: { language: string; pluginVersion?: string },
) {
  const pack = yield* startOn(device, options);
  return { pack, notices: yield* registerNotices(pack) };
});

/** Register the startup notices over `pack`, as the service graph does. */
const registerNotices = Effect.fn("test.registerNotices")(function* (
  pack: LanguagePack["Service"],
) {
  const notifier = testNotifier();
  yield* Layer.build(
    layerLanguagePackNotices.pipe(
      Layer.provide(Layer.succeed(LanguagePack, pack)),
      Layer.provide(notifier.layer),
    ),
  );
  return notifier.notices;
});

/** The first situation that is not `kind`, once the pack reaches it. */
const leaving = (
  pack: LanguagePack["Service"],
  kind: LanguagePackSituation["kind"],
) =>
  pack.changes.pipe(
    Stream.filter((situation) => situation.kind !== kind),
    Stream.runHead,
  );

function textOf(message: RecordedNotice["messages"][number]): string | null {
  return typeof message === "string" ? message : message.textContent;
}

/** The consent notice's buttons, by label. */
function buttonsOf(notice: RecordedNotice | undefined): ButtonComponent[] {
  const message = notice?.messages[0];
  if (message === undefined || typeof message === "string") return [];
  const actions = message.querySelector<HTMLElement>(".zt-notice-actions");
  return actions
    ? controlsOf(actions).filter(
        (control): control is ButtonComponent =>
          control instanceof ButtonComponent,
      )
    : [];
}

describe("Language Pack startup notices", () => {
  it.effect("offers the pack in the user's language, naming its Endonym", () =>
    Effect.gen(function* () {
      const { notices } = yield* loadOn(fakeDevice(), { language: "zh" });

      expect(notices).toHaveLength(1);
      expect(notices[0]?.duration).toBe(0);
      expect(textOf(notices[0]!.messages[0]!)).toContain(
        "ZotLit 简体中文 语言包可用。",
      );
      expect(buttonsOf(notices[0]).map((button) => button.text)).toEqual([
        m.notice_language_pack_decline_action(),
        m.notice_language_pack_install_action(),
      ]);
    }),
  );

  it.effect("shows nothing where no pack is offered", () =>
    Effect.gen(function* () {
      const { notices } = yield* loadOn(fakeDevice(), { language: "en" });

      expect(notices).toEqual([]);
    }),
  );

  it.effect("declining hides the offer and records the answer", () =>
    Effect.gen(function* () {
      const device = fakeDevice();
      const { pack, notices } = yield* loadOn(device, { language: "zh" });

      buttonsOf(notices[0])[0]!.click();
      yield* leaving(pack, "offered");

      expect(notices[0]?.hidden).toBe(true);
      expect(device.storage.get("zotlit:i18n:consent:zh-CN")).toBe("declined");
    }),
  );

  it.effect(
    "installing from the offer hides it and reports the download until the restart notice",
    () =>
      Effect.gen(function* () {
        const device = fakeDevice();
        const { pack, notices } = yield* loadOn(device, { language: "zh" });

        buttonsOf(notices[0])[1]!.click();
        yield* leaving(pack, "offered");
        expect(notices[0]?.hidden).toBe(true);
        yield* leaving(pack, "downloading");
        yield* eventually(() => expect(notices).toHaveLength(2));

        expect(notices[1]?.messages.map(textOf)).toEqual([
          m.notice_language_pack_restart(),
        ]);
        yield* TestClock.adjust("9 seconds");
        expect(notices[1]?.hidden).toBe(false);
        yield* TestClock.adjust("1 second");
        expect(notices[1]?.hidden).toBe(true);
      }),
  );

  it.effect(
    "an install from settings hides the offer, so the two entry points agree",
    () =>
      Effect.gen(function* () {
        const { pack, notices } = yield* loadOn(fakeDevice(), {
          language: "zh",
        });

        yield* pack.install;

        expect(notices[0]?.hidden).toBe(true);
      }),
  );

  it.effect(
    "a consented refresh shows its download, then the restart notice",
    () =>
      Effect.gen(function* () {
        const device = fakeDevice();
        yield* (yield* startOn(device, {
          language: "zh",
          pluginVersion: "1.0.0",
        })).install;
        let answer!: () => void;
        device.held = new Promise<void>((resolve) => {
          answer = resolve;
        });

        const { pack, notices } = yield* loadOn(device, { language: "zh" });
        yield* TestClock.adjust("200 millis");
        expect(notices.map((notice) => notice.messages.map(textOf))).toEqual([
          [m.notice_language_pack_downloading()],
        ]);

        answer();
        yield* leaving(pack, "downloading");
        yield* eventually(() => expect(notices[0]?.messages).toHaveLength(2));
        expect(notices[0]?.messages.map(textOf)).toEqual([
          m.notice_language_pack_downloading(),
          m.notice_language_pack_restart(),
        ]);
      }),
  );

  it.effect.each([
    [
      "the restart notice",
      CHINESE_PACK,
      () => m.notice_language_pack_restart(),
    ],
    [
      "the failure",
      { status: 503, text: "unavailable" },
      () =>
        m.notice_language_pack_download_failed({
          message:
            "https://github.com/aidenlx/zotlit/releases/download/res-2.0.0/zh-CN.json responded 503",
        }),
    ],
  ] as const)(
    "a consented refresh that ends before the notices register still shows %s",
    ([, answer, expected]) =>
      Effect.gen(function* () {
        const device = fakeDevice();
        yield* (yield* startOn(device, {
          language: "zh",
          pluginVersion: "1.0.0",
        })).install;
        device.answer = answer;

        const pack = yield* startOn(device, { language: "zh" });
        yield* leaving(pack, "downloading");
        const notices = yield* registerNotices(pack);
        yield* eventually(() => expect(notices).toHaveLength(1));

        expect(notices[0]?.messages.map(textOf)).toEqual([expected()]);
      }),
  );

  it.effect.each([
    [
      "names the failure of a download",
      { status: 503, text: "unavailable" },
      () =>
        m.notice_language_pack_download_failed({
          message:
            "https://github.com/aidenlx/zotlit/releases/download/res-2.0.0/zh-CN.json responded 503",
        }),
    ],
    [
      "asks for a plugin update for a pack from a newer lineage",
      JSON.stringify({ schemaVersion: 2, locale: "zh-CN", messages: {} }),
      () => m.notice_language_pack_update_needed(),
    ],
  ] as const)("%s", ([, answer, expected]) =>
    Effect.gen(function* () {
      const device = fakeDevice(answer);
      const { pack, notices } = yield* loadOn(device, { language: "zh" });

      buttonsOf(notices[0])[1]!.click();
      yield* leaving(pack, "offered");
      yield* leaving(pack, "downloading");
      yield* eventually(() => expect(notices).toHaveLength(2));

      expect(notices[1]?.messages.map(textOf)).toEqual([expected()]);
    }),
  );
});
