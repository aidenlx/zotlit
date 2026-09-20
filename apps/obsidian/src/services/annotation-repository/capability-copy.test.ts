import { expect, it } from "vitest";

import * as m from "@/lib/i18n/generated/messages";

import type { EditingCapability } from "./capability";
import {
  editingCapabilityAffordance,
  editingCapabilityCopy,
  secondsUntil,
} from "./capability-copy";

const NOW = Temporal.Instant.from("2026-09-16T15:52:21Z");

/** Every read-only reason the spec names, so a new one fails this list. */
const READ_ONLY_REASONS = [
  "zotero-unavailable",
  "local-api-disabled",
  "incompatible-zotero",
  "invalid-response",
  "server-changed",
  "library-read-only",
  "probing",
] as const;

/**
 * Every capability value, each against the message the catalog holds for it.
 * The canonical declaration in `messages/en.json` is the oracle; this asserts
 * which state reaches which message, not what the English says.
 */
it.each<[EditingCapability, { icon: string; tone: string; label: string }]>([
  [
    { kind: "writable" },
    { icon: "pencil", tone: "ready", label: m.capability_writable() },
  ],
  [
    { kind: "authorization-required" },
    // The same icon as writable: the control stays live and the gesture asks.
    {
      icon: "pencil",
      tone: "action",
      label: m.capability_authorization_required(),
    },
  ],
  [
    { kind: "authorizing" },
    { icon: "loader", tone: "busy", label: m.capability_authorizing() },
  ],
  [
    { kind: "read-only", reason: "probing" },
    { icon: "loader", tone: "busy", label: m.capability_probing() },
  ],
  [
    { kind: "read-only", reason: "zotero-unavailable" },
    {
      icon: "alert-triangle",
      tone: "warning",
      label: m.capability_zotero_unavailable(),
    },
  ],
  [
    { kind: "read-only", reason: "local-api-disabled" },
    {
      icon: "alert-triangle",
      tone: "warning",
      label: m.capability_local_api_disabled(),
    },
  ],
  [
    { kind: "read-only", reason: "incompatible-zotero" },
    {
      icon: "alert-triangle",
      tone: "warning",
      label: m.capability_incompatible_zotero(),
    },
  ],
  [
    { kind: "read-only", reason: "invalid-response" },
    {
      icon: "alert-triangle",
      tone: "warning",
      label: m.capability_invalid_response(),
    },
  ],
  [
    { kind: "read-only", reason: "server-changed" },
    {
      icon: "alert-triangle",
      tone: "warning",
      label: m.capability_server_changed(),
    },
  ],
  [
    { kind: "read-only", reason: "library-read-only" },
    {
      icon: "alert-triangle",
      tone: "warning",
      label: m.capability_library_read_only(),
    },
  ],
])("names %o", (capability, expected) => {
  const copy = editingCapabilityCopy(capability, NOW);

  expect({ icon: copy.icon, tone: copy.tone, label: copy.label }).toEqual(
    expected,
  );
});

it("says how to turn the local API on, where Zotero alone can turn it on", () => {
  const copy = editingCapabilityCopy(
    { kind: "read-only", reason: "local-api-disabled" },
    NOW,
  );

  // The enablement step lives in Zotero's own preferences, so the copy names
  // the place rather than offering a control ZotLit does not have.
  expect(copy.detail).toBe(m.capability_local_api_disabled_detail());
  expect(copy.detail).toContain("Settings → Advanced");
});

it("gives every state a line, and every fault a reason to read", () => {
  const states: EditingCapability[] = [
    { kind: "writable" },
    { kind: "authorization-required" },
    { kind: "authorizing" },
    { kind: "cooldown", retryAfter: NOW.add({ seconds: 5 }) },
    ...READ_ONLY_REASONS.map(
      (reason) => ({ kind: "read-only", reason }) as const,
    ),
  ];

  const copies = states.map((state) => editingCapabilityCopy(state, NOW));

  expect(copies.every(({ label }) => label.length > 0)).toBe(true);
  // Only the two states that speak for themselves carry no second line.
  expect(
    states
      .filter((_, index) => copies[index]!.detail === null)
      .map((state) => JSON.stringify(state)),
  ).toEqual([
    JSON.stringify({ kind: "writable" }),
    JSON.stringify({ kind: "read-only", reason: "probing" }),
  ]);
});

it("counts a cooldown down in whole seconds, and never past zero", () => {
  const copy = (seconds: number) =>
    editingCapabilityCopy(
      { kind: "cooldown", retryAfter: NOW.add({ seconds }) },
      NOW,
    );

  expect(copy(44).detail).toBe(m.capability_cooldown_detail({ seconds: 44 }));
  expect(copy(1).detail).toBe(m.capability_cooldown_detail({ seconds: 1 }));
  expect(copy(0).detail).toBe(m.capability_cooldown_detail({ seconds: 0 }));
  expect(copy(44).icon).toBe("clock");

  // A partial second still counts as one: the user is told to wait, not that
  // the wait is over.
  expect(secondsUntil(NOW.add({ milliseconds: 1200 }), NOW)).toBe(2);
  expect(secondsUntil(NOW.subtract({ seconds: 10 }), NOW)).toBe(0);
});

it("keeps reading quiet until authorization can be requested", () => {
  expect(editingCapabilityAffordance({ kind: "writable" }, NOW)).toBeNull();
  for (const reason of READ_ONLY_REASONS) {
    expect(
      editingCapabilityAffordance({ kind: "read-only", reason }, NOW),
    ).toBeNull();
  }
  expect(
    editingCapabilityAffordance({ kind: "authorization-required" }, NOW),
  ).toMatchObject({
    label: m.capability_enable_editing(),
    disabled: false,
  });
  expect(
    editingCapabilityAffordance({ kind: "authorizing" }, NOW),
  ).toMatchObject({
    label: m.capability_authorizing(),
    disabled: true,
    spinning: true,
  });
});

it("counts down the enable-editing action until the capability changes", () => {
  const retryAfter = NOW.add({ seconds: 3 });
  expect(
    [0, 1, 2, 3].map(
      (elapsed) =>
        editingCapabilityAffordance(
          { kind: "cooldown", retryAfter },
          NOW.add({ seconds: elapsed }),
        )?.countdown,
    ),
  ).toEqual([3, 2, 1, 0]);
  expect(editingCapabilityAffordance({ kind: "writable" }, NOW)).toBeNull();
});
