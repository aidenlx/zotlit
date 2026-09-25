import { expect, it } from "vitest";

import * as m from "@/lib/i18n/generated/messages";
import type { EditingCapability } from "@/services/annotation-repository/capability";

import { editingRowModel } from "./zotero-editing";

const NOW = Temporal.Instant.from("2026-09-16T15:52:21Z");

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

it("shows the capability from the one shared copy table", () => {
  const model = row({ kind: "read-only", reason: "local-api-disabled" });

  expect(model.status.label).toBe(m.capability_local_api_disabled());
  expect(model.status.detail).toBe(m.capability_local_api_disabled_detail());
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
    row({ kind: "cooldown", retryAfter: NOW.add({ seconds: 30 }) }).countsDown,
  ).toBe(true);
  expect(row({ kind: "writable" }).countsDown).toBe(false);
  expect(row({ kind: "authorizing" }).countsDown).toBe(false);
});

function row(capability: EditingCapability, remembered = false) {
  return editingRowModel({ capability, remembered, now: NOW });
}
