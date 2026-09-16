import { expect, it } from "vitest";

import * as m from "@/lib/i18n/generated/messages";
import type { EditingCapability } from "@/services/annotation-repository/capability";

import { editingRowModel } from "./zotero-editing";

const NOW = Temporal.Instant.from("2026-09-16T15:52:21Z");

it("shows the capability from the one shared copy table", () => {
  const model = row({ kind: "read-only", reason: "local-api-disabled" });

  expect(model.status.label).toBe(m.capability_local_api_disabled());
  expect(model.status.detail).toBe(m.capability_local_api_disabled_detail());
});

it("drops 'Enable editing' once editing is on", () => {
  expect(row({ kind: "writable" }).enable.shown).toBe(false);
  expect(row({ kind: "authorization-required" }).enable.shown).toBe(true);
});

/**
 * "Enable editing" runs a Capability Probe before it asks Zotero for anything,
 * so it stays live wherever a fresh probe could clear the state.
 */
it.each<[EditingCapability, boolean]>([
  [{ kind: "authorization-required" }, false],
  [{ kind: "read-only", reason: "probing" }, false],
  [{ kind: "read-only", reason: "zotero-unavailable" }, false],
  [{ kind: "read-only", reason: "local-api-disabled" }, false],
  [{ kind: "read-only", reason: "server-changed" }, false],
  [{ kind: "read-only", reason: "invalid-response" }, false],
  // Nothing a probe or a dialog can do changes these two.
  [{ kind: "read-only", reason: "incompatible-zotero" }, true],
  [{ kind: "read-only", reason: "library-read-only" }, true],
  // A request is already at the dialog, or Zotero refuses to be asked again.
  [{ kind: "authorizing" }, true],
  [{ kind: "cooldown", retryAfter: NOW.add({ seconds: 30 }) }, true],
])("refuses 'Enable editing' for %o: %s", (capability, disabled) => {
  expect(row(capability).enable.disabled).toBe(disabled);
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
