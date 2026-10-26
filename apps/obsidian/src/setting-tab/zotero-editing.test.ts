// @vitest-environment happy-dom
import { expect, it } from "@effect/vitest";
import { renderRow } from "@mock/obsidian";
import { Context, DateTime, Effect, Stream } from "effect";
import { TestClock } from "effect/testing";

import { stubService } from "@/lib/__fixtures__/service-stub";
import * as m from "@/lib/i18n/generated/messages";
import { deadlineAfter } from "@/services/annotation-repository/__fixtures__/capability";
import type { EditingCapability } from "@/services/annotation-repository/capability";
import { CapabilityNotices } from "@/services/annotation-repository/notices";
import { AnnotationRepository } from "@/services/annotation-repository/service";
import { ZoteroLocalApi } from "@/services/zotero-local-api/service";

import { scopedSettingTab } from "./__fixtures__";
import type { SettingTabContext } from "./context";
import { zoteroEditingRow } from "./zotero-editing";
import { editingRowModel } from "./zotero-editing-model";

const NOW = DateTime.makeUnsafe("2026-09-16T15:52:21Z");

it("shows a manual connection check while the service retains its last result", () => {
  const model = editingRowModel({
    capability: { kind: "read-only", reason: "local-api-disabled" },
    remembered: true,
    checking: true,
    now: NOW,
  });
  expect(model.status.label).toBe(m.capability_probing());
  expect(model.check).toEqual({ shown: true, disabled: true });
  expect(model.enable.shown).toBe(false);
  expect(model.forget.disabled).toBe(true);
});

it("drops 'Allow editing' once editing is on", () => {
  expect(row({ kind: "writable" }).enable.shown).toBe(false);
  expect(row({ kind: "authorization-required" }).enable.shown).toBe(true);
});

it("reserves authorization for an available API and offers a separate connection check", () => {
  expect(
    row({ kind: "read-only", reason: "zotero-unavailable" }).enable,
  ).toEqual({ shown: false, disabled: true });
  expect(
    row({ kind: "read-only", reason: "local-api-disabled" }).check.shown,
  ).toBe(true);
  expect(row({ kind: "authorizing" }).enable.disabled).toBe(true);
  expect(row({ kind: "authorizing" }).check.shown).toBe(false);
  expect(row({ kind: "authorization-required" }).enable).toEqual({
    shown: true,
    disabled: false,
  });
});

it("offers 'Forget authorization' only while this device remembers one", () => {
  expect(row({ kind: "writable" }, true).forget).toEqual({
    shown: true,
    disabled: false,
  });
  // Zotero closed and a key still stored: the row can still forget it.
  expect(
    row({ kind: "read-only", reason: "zotero-unavailable" }, true).forget.shown,
  ).toBe(true);
  expect(row({ kind: "authorization-required" }).forget.shown).toBe(false);
});

it("redraws on a clock only while a cooldown runs", () => {
  expect(
    row({ kind: "cooldown", retryAfter: deadlineAfter(NOW, 30) }).countsDown,
  ).toBe(true);
  expect(row({ kind: "writable" }).countsDown).toBe(false);
  expect(row({ kind: "authorizing" }).countsDown).toBe(false);
});

it.effect(
  "counts a cooldown down each second on the Effect clock and stops when it ends",
  () =>
    Effect.gen(function* () {
      let capability: EditingCapability = {
        kind: "cooldown",
        retryAfter: deadlineAfter(yield* DateTime.now, 3),
      };
      let reads = 0;
      const { tab } = yield* scopedSettingTab(
        Context.make(
          AnnotationRepository,
          stubService<AnnotationRepository["Service"]>("AnnotationRepository", {
            capability: Effect.sync(() => {
              reads++;
              return capability;
            }),
            probe: Effect.void,
            capabilityChanges: Stream.never,
          }),
        ).pipe(
          Context.add(
            ZoteroLocalApi,
            stubService<ZoteroLocalApi["Service"]>("ZoteroLocalApi", {
              remembered: Effect.succeed(false),
            }),
          ),
          Context.add(
            CapabilityNotices,
            stubService<CapabilityNotices["Service"]>("CapabilityNotices", {}),
          ),
        ),
      );
      const item = zoteroEditingRow(
        stubService<SettingTabContext>("SettingTabContext", { tab }),
      );
      const setting = renderRow(item);
      yield* Effect.addFinalizer(() => Effect.sync(() => setting.cleanup?.()));
      const desc = () =>
        (setting.desc as unknown as DocumentFragment).textContent;

      yield* TestClock.adjust("0 millis");
      expect(desc()).toContain(m.capability_cooldown_detail({ seconds: 3 }));
      yield* TestClock.adjust("1 second");
      expect(desc()).toContain(m.capability_cooldown_detail({ seconds: 2 }));

      capability = { kind: "writable" };
      yield* TestClock.adjust("1 second");
      expect(desc()).toContain(m.capability_writable());
      const settled = reads;
      yield* TestClock.adjust("5 seconds");
      expect(reads).toBe(settled);
    }),
);

function row(capability: EditingCapability, remembered = false) {
  return editingRowModel({ capability, remembered, now: NOW });
}
