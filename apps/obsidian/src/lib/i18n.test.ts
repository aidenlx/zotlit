import { it } from "@effect/vitest";
import { Effect, Layer, ManagedRuntime, Stream } from "effect";
import { describe, expect } from "vitest";

import { testNotifier } from "@/lib/__fixtures__/notifier";
import * as m from "@/lib/i18n/generated/messages";
import {
  eventually,
  fakeDevice,
  startOn,
} from "@/services/language-pack/__fixtures__";
import { LanguagePack } from "@/services/language-pack/service";

import { languagePackEdge } from "./i18n";
import { languagePackSettingCopy } from "./i18n/settings-copy";

/** The setting tab's edge over a runtime that holds `pack`. */
const edgeOver = Effect.fn("test.edgeOver")(function* (
  pack: LanguagePack["Service"],
) {
  const notifier = testNotifier();
  const runtime = yield* Effect.acquireRelease(
    Effect.sync(() =>
      ManagedRuntime.make(
        Layer.merge(Layer.succeed(LanguagePack, pack), notifier.layer),
      ),
    ),
    (runtime) => runtime.disposeEffect,
  );
  return { edge: languagePackEdge(runtime), notices: notifier.notices };
});

describe("the setting tab's Language Pack edge", () => {
  it.effect("reads the situation and calls back on each change after it", () =>
    Effect.gen(function* () {
      const pack = yield* startOn(fakeDevice(), { language: "zh" });
      const { edge } = yield* edgeOver(pack);
      const seen: string[] = [];

      edge.subscribe(() => seen.push(edge.getSituation().kind));
      expect(edge.getSituation().kind).toBe("offered");
      expect(seen).toEqual([]);

      yield* pack.decline;
      yield* pack.changes.pipe(Stream.take(1), Stream.runDrain);
      expect(seen).toEqual(["installable"]);
    }),
  );

  it.effect(
    "installs from the setting row behind the toast, and resets in place",
    () =>
      Effect.gen(function* () {
        const device = fakeDevice();
        const pack = yield* startOn(device, { language: "zh" });
        const { edge, notices } = yield* edgeOver(pack);

        languagePackSettingCopy(edge)?.install?.run();
        yield* pack.changes.pipe(
          Stream.filter((situation) => situation.kind === "restart-pending"),
          Stream.runHead,
        );
        yield* eventually(() => notices.length > 0);

        expect(notices[0]?.messages).toEqual([
          m.notice_language_pack_restart(),
        ]);
        expect(languagePackSettingCopy(edge)?.desc).toBe(
          m.notice_language_pack_restart(),
        );

        edge.reset();
        expect(edge.getSituation().kind).toBe("installable");
        expect([...device.storage.keys()]).toEqual([]);
      }),
  );
});
