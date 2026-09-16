// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";

import { themeHook } from "@/lib/theme-hooks";
import type { EditingCapability } from "@/services/annotation-repository/capability";
import { editingCapabilityCopy } from "@/services/annotation-repository/capability-copy";

import {
  creationToolbar,
  removeCreationToolbar,
  renderCreationToolbar,
} from "./creation-toolbar";
import type { CreationToolbarControl } from "./creation-toolbar";

const NOW = Temporal.Instant.from("2026-09-17T10:00:00Z");

const COLORS = { highlight: "#ffd400", underline: "#2ea8e5" } as const;

function model(
  overrides: {
    armed?: "highlight" | "underline" | null;
    marksVisible?: boolean;
    capability?: EditingCapability;
  } = {},
): readonly CreationToolbarControl[] {
  return creationToolbar({
    armed: overrides.armed ?? null,
    colors: COLORS,
    marksVisible: overrides.marksVisible ?? true,
    capability: overrides.capability ?? { kind: "writable" },
    now: NOW,
  });
}

/** Obsidian's own right toolbar slot, as a bare element. */
function toolbarSlot(): HTMLElement {
  return document.createElement("div");
}

function draw(
  slot: HTMLElement,
  controls = model(),
  activate = vi.fn(),
): { activate: typeof activate } {
  renderCreationToolbar(slot, controls, activate);
  return { activate };
}

/** What a reader sees on each control: its id, state, and accessible name. */
function shownIn(slot: HTMLElement) {
  return [...slot.querySelectorAll<HTMLElement>("[data-zt-tool]")].map(
    (node) => ({
      id: node.dataset.ztTool,
      pressed: node.getAttribute("aria-pressed"),
      disabled: node.getAttribute("aria-disabled"),
      tooltip: node.getAttribute("aria-label"),
      color: node.style.color,
      icon: node.querySelector("svg")?.getAttribute("class"),
    }),
  );
}

it("offers the two tools, their colours and mark visibility, and nothing else", () => {
  // "Clear all annotations" is deliberately absent (ADR 0042): the reader's
  // toolbar carries no verb that erases what ZotLit did not just create.
  expect(model().map(({ id }) => id)).toEqual([
    "highlight",
    "highlight-color",
    "underline",
    "underline-color",
    "visibility",
  ]);
});

it("shows each tool's own colour, so underline is a peer of highlight", () => {
  const byId = new Map(model().map((control) => [control.id, control]));

  expect(byId.get("highlight")?.color).toBe(COLORS.highlight);
  expect(byId.get("highlight-color")?.color).toBe(COLORS.highlight);
  expect(byId.get("underline")?.color).toBe(COLORS.underline);
  expect(byId.get("underline-color")?.color).toBe(COLORS.underline);
});

it("presses only the armed tool", () => {
  const pressed = (armed: "highlight" | "underline" | null) =>
    model({ armed })
      .filter((control) => control.pressed === true)
      .map(({ id }) => id);

  expect(pressed(null)).toEqual(["visibility"]);
  expect(pressed("highlight")).toEqual(["highlight", "visibility"]);
  expect(pressed("underline")).toEqual(["underline", "visibility"]);
});

it("names the verb mark visibility would run next", () => {
  const visibility = (marksVisible: boolean) =>
    model({ marksVisible }).find(({ id }) => id === "visibility")!;

  expect(visibility(true).tooltip).not.toBe(visibility(false).tooltip);
  expect(visibility(true).pressed).toBe(true);
  expect(visibility(false).pressed).toBe(false);
});

it.each([
  { kind: "read-only", reason: "zotero-unavailable" },
  { kind: "read-only", reason: "library-read-only" },
  { kind: "cooldown", retryAfter: NOW.add({ seconds: 30 }) },
] satisfies EditingCapability[])(
  "stands the writing controls down in place and says why under $kind",
  (capability) => {
    const controls = model({ capability });
    const copy = editingCapabilityCopy(capability, NOW);

    expect(
      controls.filter(({ disabled }) => disabled).map(({ id }) => id),
    ).toEqual(["highlight", "highlight-color", "underline", "underline-color"]);
    for (const control of controls) {
      if (!control.disabled) continue;
      expect(control.tooltip).toBe(copy.detail ?? copy.label);
    }
  },
);

it.each([
  { kind: "writable" },
  { kind: "authorization-required" },
] satisfies EditingCapability[])(
  "keeps every control live under $kind, because the gesture is what asks",
  (capability) => {
    expect(model({ capability }).some(({ disabled }) => disabled)).toBe(false);
  },
);

it("never stands mark visibility down, because it changes nothing in Zotero", () => {
  const capability = {
    kind: "read-only",
    reason: "zotero-unavailable",
  } as const;

  expect(
    model({ capability }).find(({ id }) => id === "visibility")?.disabled,
  ).toBe(false);
});

it("draws every control into the slot with its state and its tooltip", () => {
  const slot = toolbarSlot();

  draw(slot, model({ armed: "underline" }));

  expect(shownIn(slot)).toEqual(
    model({ armed: "underline" }).map((control) => ({
      id: control.id,
      pressed: control.pressed === null ? null : String(control.pressed),
      disabled: null,
      tooltip: control.tooltip,
      color: control.color ?? "",
      icon: expect.stringContaining("lucide-"),
    })),
  );
});

it("marks a blocked control disabled and gives it no listener", () => {
  const slot = toolbarSlot();
  const { activate } = draw(
    slot,
    model({ capability: { kind: "read-only", reason: "library-read-only" } }),
  );

  const highlight = slot.querySelector<HTMLElement>(
    '[data-zt-tool="highlight"]',
  )!;
  highlight.click();

  expect(highlight.getAttribute("aria-disabled")).toBe("true");
  expect(highlight.classList.contains("is-disabled")).toBe(true);
  expect(activate).not.toHaveBeenCalled();
});

it("runs a live control from the pointer and from the keyboard", () => {
  const slot = toolbarSlot();
  const { activate } = draw(slot);
  const node = slot.querySelector<HTMLElement>('[data-zt-tool="visibility"]')!;

  node.click();
  node.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));

  expect(activate.mock.calls.map(([id]) => id)).toEqual([
    "visibility",
    "visibility",
  ]);
});

it("rewrites its controls in place and keeps the capability slot", () => {
  const slot = toolbarSlot();
  draw(slot);
  const first = slot.querySelector(`.${themeHook.pdfCreationToolbar}`);
  const capabilitySlot = renderCreationToolbar(
    slot,
    model(),
    vi.fn(),
  ).capabilitySlot;
  capabilitySlot.createDiv({ cls: "zt-pdf-capability" });

  renderCreationToolbar(slot, model({ armed: "highlight" }), vi.fn());

  expect(slot.querySelector(`.${themeHook.pdfCreationToolbar}`)).toBe(first);
  expect(capabilitySlot.childElementCount).toBe(1);
  expect(
    slot
      .querySelector('[data-zt-tool="highlight"]')
      ?.getAttribute("aria-pressed"),
  ).toBe("true");
});

it("mounts bare clickable icons, with no preflight root in Obsidian's toolbar", () => {
  const slot = toolbarSlot();

  draw(slot);

  expect(slot.querySelector(".zt-root")).toBeNull();
  for (const node of slot.querySelectorAll("[data-zt-tool]")) {
    expect(node.classList.contains("clickable-icon")).toBe(true);
  }
});

it("promises the theme hook and the data attribute by their literal names", () => {
  // The names themselves are the public surface, so the literals are the test.
  // @see apps/obsidian/policies/theme-hooks.md
  const slot = toolbarSlot();

  draw(slot);

  expect(slot.querySelector(".zt-pdf-creation-toolbar")).not.toBeNull();
  expect(
    [...slot.querySelectorAll<HTMLElement>("[data-zt-tool]")].map(
      (node) => node.dataset.ztTool,
    ),
  ).toEqual([
    "highlight",
    "highlight-color",
    "underline",
    "underline-color",
    "visibility",
  ]);
});

it("leaves the slot as Obsidian built it, however often it is taken out", () => {
  const slot = toolbarSlot();
  slot.createDiv({ cls: "pdf-toolbar-button" });
  draw(slot);

  removeCreationToolbar(slot);
  removeCreationToolbar(slot);
  slot.empty();
  removeCreationToolbar(slot);

  expect(slot.childElementCount).toBe(0);
});
