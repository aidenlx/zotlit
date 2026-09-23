import { expect, it, vi } from "vitest";

import { ANNOTATION_COLORS } from "@/lib/annotation-colors";
import type { EditingCapability } from "@/services/annotation-repository/capability";

import { toolColors } from "./__fixtures__";
import type { CreationToolbarControl } from "./creation-toolbar";
import {
  arm,
  createReaderSurfaceState,
  ingestCapability,
  sameCapability,
  sameFlat,
  sameFlatList,
  selectCapabilityAffordance,
  selectCreationToolbar,
  setToolColor,
  tick,
} from "./reader-surface-state";

const NOW = Temporal.Instant.from("2026-09-17T10:00:00Z");
const RETRY_AFTER = NOW.add({ seconds: 45 });

/**
 * One store and a listener on each of its three slices, the way the reader's
 * surfaces subscribe to it.
 */
function observed(capability: EditingCapability = { kind: "writable" }) {
  const colors = toolColors();
  const store = createReaderSurfaceState({
    colors: colors.current(),
    capability,
    now: NOW,
  });
  const toolbar = vi.fn();
  const affordance = vi.fn();
  const capabilitySlice = vi.fn();
  store.subscribe(selectCreationToolbar, toolbar, {
    equalityFn: sameFlatList,
  });
  store.subscribe(selectCapabilityAffordance, affordance, {
    equalityFn: sameFlat,
  });
  store.subscribe((state) => state.capability, capabilitySlice, {
    equalityFn: sameCapability,
  });
  return { store, colors, toolbar, affordance, capability: capabilitySlice };
}

/** A new object that means what the given capability means. */
function sameMeaning(capability: EditingCapability): EditingCapability {
  return capability.kind === "cooldown"
    ? {
        kind: "cooldown",
        retryAfter: Temporal.Instant.from(RETRY_AFTER.toString()),
      }
    : { ...capability };
}

/** The ids of the controls whose drawn state differs between two models. */
function changedIds(
  before: readonly CreationToolbarControl[],
  after: readonly CreationToolbarControl[],
): string[] {
  return after
    .filter(
      (control, index) =>
        JSON.stringify(control) !== JSON.stringify(before[index]),
    )
    .map(({ id }) => id);
}

it.each([
  { kind: "writable" },
  { kind: "read-only", reason: "zotero-unavailable" },
  { kind: "cooldown", retryAfter: RETRY_AFTER },
] satisfies EditingCapability[])(
  "fires no subscriber when an announcement ingests the same $kind again",
  (capability) => {
    const {
      store,
      toolbar,
      affordance,
      capability: slice,
    } = observed(capability);

    // A fresh object with the same meaning, as a repeated probe answers it.
    ingestCapability(store, sameMeaning(capability), NOW);

    expect(toolbar).not.toHaveBeenCalled();
    expect(affordance).not.toHaveBeenCalled();
    expect(slice).not.toHaveBeenCalled();
  },
);

it("fires the capability slice when a cooldown's deadline moves", () => {
  const { store, capability } = observed({
    kind: "cooldown",
    retryAfter: RETRY_AFTER,
  });

  ingestCapability(
    store,
    { kind: "cooldown", retryAfter: RETRY_AFTER.add({ seconds: 30 }) },
    NOW,
  );

  expect(capability).toHaveBeenCalledOnce();
});

it("counts a cooldown down in the affordance and leaves the toolbar alone", () => {
  const { store, toolbar, affordance } = observed({
    kind: "cooldown",
    retryAfter: RETRY_AFTER,
  });

  tick(store, NOW.add({ seconds: 1 }));

  expect(affordance).toHaveBeenCalledOnce();
  expect(affordance.mock.calls[0]![0]).toMatchObject({ countdown: 44 });
  expect(toolbar).not.toHaveBeenCalled();
});

it("changes only the armed tool's toggle when a tool is armed", () => {
  const { store, toolbar } = observed();
  const before = selectCreationToolbar(store.getState());

  arm(store, "highlight");

  expect(toolbar).toHaveBeenCalledOnce();
  const after = toolbar.mock.calls[0]![0] as CreationToolbarControl[];
  expect(changedIds(before, after)).toEqual(["highlight"]);
  expect(after.find(({ id }) => id === "highlight")?.pressed).toBe(true);
});

it("changes only that tool's toggle on a colour change, and keeps the colour", () => {
  const { store, colors, toolbar } = observed();
  const before = selectCreationToolbar(store.getState());
  const chosen = ANNOTATION_COLORS[3]!;

  setToolColor(store, colors, { tool: "underline", color: chosen });

  expect(toolbar).toHaveBeenCalledOnce();
  const after = toolbar.mock.calls[0]![0] as CreationToolbarControl[];
  expect(changedIds(before, after)).toEqual(["underline"]);
  expect(after.find(({ id }) => id === "underline")?.color).toBe(chosen);
  // The colour outlives this view: the next PDF opened reads it back.
  expect(colors.current().underline).toBe(chosen);
});
