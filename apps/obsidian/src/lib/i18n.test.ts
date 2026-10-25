import { it } from "@effect/vitest";
import { Effect, Exit, Layer, ManagedRuntime, Scope, Stream } from "effect";
import { describe, expect } from "vitest";

import { testNotifier } from "@/lib/__fixtures__/notifier";
import { effectBridge } from "@/lib/effect-bridge";
import * as m from "@/lib/i18n/generated/messages";
import {
  eventually,
  fakeDevice,
  startOn,
} from "@/services/language-pack/__fixtures__";
import { LanguagePack } from "@/services/language-pack/service";

import { languagePackEdge } from "./i18n";
import { languagePackSettingCopy } from "./i18n/settings-copy";

/** The setting tab's edge over a runtime that holds `pack`, as `build.ts` makes it. */
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
  const edge = languagePackEdge(
    { pack, notifier: notifier.service },
    effectBridge(runtime),
  );
  return { edge, notices: notifier.notices, runtime };
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
        yield* eventually(() => expect(notices).toHaveLength(1));

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

  it.effect("resets in place while a download is in flight", () =>
    Effect.gen(function* () {
      const device = fakeDevice();
      device.held = new Promise<void>(() => {});
      const pack = yield* startOn(device, { language: "zh" });
      const { edge } = yield* edgeOver(pack);

      edge.install();
      yield* eventually(() => expect(device.requests).toHaveLength(1));
      expect(edge.getSituation().kind).toBe("downloading");

      edge.reset();
      expect(edge.getSituation().kind).toBe("installable");
      expect([...device.storage.keys()]).toEqual([]);
    }),
  );

  it.effect(
    "after unload, reads the last situation and starts nothing new",
    () =>
      Effect.gen(function* () {
        const device = fakeDevice();
        device.held = new Promise<void>(() => {});
        // The pack's layer closes with the runtime, as at plugin unload.
        const layerScope = yield* Scope.make();
        const pack = yield* startOn(device, { language: "zh" }).pipe(
          Scope.provide(layerScope),
        );
        const { edge, notices, runtime } = yield* edgeOver(pack);
        edge.install();
        yield* eventually(() => expect(device.requests).toHaveLength(1));
        yield* runtime.disposeEffect;
        yield* Scope.close(layerScope, Exit.void);
        const seen: string[] = [];

        expect(edge.getSituation().kind).toBe("downloading");
        edge.subscribe(() => seen.push(edge.getSituation().kind));
        edge.install();
        yield* Effect.yieldNow;
        expect(device.requests).toHaveLength(1);
        expect(notices).toEqual([]);

        edge.reset();
        expect(edge.getSituation().kind).toBe("installable");
        expect([...device.storage.keys()]).toEqual([]);
        expect(seen).toEqual([]);
      }),
  );
});
