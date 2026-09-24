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
import type {
  CreationToolbarControl,
  CreationToolbarControlId,
} from "./creation-toolbar";
import { MARK_TOOLS } from "./tools";
import type { MarkTool } from "./tools";

const NOW = Temporal.Instant.from("2026-09-17T10:00:00Z");

const COLORS = {
  highlight: "#ffd400",
  underline: "#2ea8e5",
  note: "#5fb236",
  text: "#e56eee",
  image: "#ff6666",
  ink: "#a28ae5",
} as const;

/** Both halves of one tool, in the order the toolbar draws them. */
function halves(tool: MarkTool): CreationToolbarControlId[] {
  return [tool, `${tool}-color`];
}

function model(
  overrides: {
    armed?: MarkTool | null;
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

it("splits every tool in two, then mark visibility, and nothing else", () => {
  // "Clear all annotations" is deliberately absent (ADR 0042): the reader's
  // toolbar carries no verb that erases what ZotLit did not just create.
  expect(model().map(({ id }) => id)).toEqual([
    ...MARK_TOOLS.flatMap(halves),
    "visibility",
  ]);
});

it("seats the tools in Zotero's toolbar order, note and text between underline and image", () => {
  expect(
    model()
      .filter(({ id }) => !id.endsWith("-color"))
      .map(({ id }) => id),
  ).toEqual([
    "highlight",
    "underline",
    "note",
    "text",
    "image",
    "ink",
    "visibility",
  ]);
});

it("shows each tool's own colour on its toggle, so underline is a peer of highlight", () => {
  const byId = new Map(model().map((control) => [control.id, control]));

  expect(byId.get("highlight")?.color).toBe(COLORS.highlight);
  expect(byId.get("underline")?.color).toBe(COLORS.underline);
  expect(byId.get("image")?.color).toBe(COLORS.image);
  // The chevron says a menu opens; the toggle beside it shows the colour.
  expect(byId.get("highlight-color")?.color).toBeNull();
  expect(byId.get("underline-color")?.color).toBeNull();
});

it("offers each tool's colours from its own chevron, armed or not", () => {
  const byId = (armed: "highlight" | "underline" | null) =>
    new Map(model({ armed }).map((control) => [control.id, control]));

  for (const armed of ["highlight", null] as const) {
    const control = byId(armed).get("underline-color")!;
    expect(control.icon).toBe("chevron-down");
    expect(control.disabled).toBe(false);
    expect(control.pressed).toBeNull();
  }
  // Each chevron names the tool it colours, so the two never read alike.
  expect(byId(null).get("highlight-color")?.tooltip).not.toBe(
    byId(null).get("underline-color")?.tooltip,
  );
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
    const controls = model({ armed: "highlight", capability });
    const copy = editingCapabilityCopy(capability, NOW);
    const writing: string[] = MARK_TOOLS.flatMap(halves);

    expect(
      controls.filter(({ disabled }) => disabled).map(({ id }) => id),
    ).toEqual(writing);
    for (const control of controls) {
      if (!writing.includes(control.id)) continue;
      expect(control.tooltip).toBe(copy.detail ?? copy.label);
    }
  },
);

it.each([
  { kind: "writable" },
  { kind: "writable", oneTime: true },
] satisfies EditingCapability[])(
  "enables editing tools with an available grant",
  (capability) => {
    const live = model({ armed: "highlight", capability }).filter(
      ({ disabled }) => !disabled,
    );

    expect(live.map(({ id }) => id)).toEqual([
      ...MARK_TOOLS.flatMap(halves),
      "visibility",
    ]);
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
      disabled: control.disabled ? "true" : null,
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

it("keeps every control node across a redraw with equal controls", () => {
  const slot = toolbarSlot();
  draw(slot);
  const before = [...slot.querySelectorAll("[data-zt-tool]")];

  draw(slot);

  const after = [...slot.querySelectorAll("[data-zt-tool]")];
  expect(after).toHaveLength(before.length);
  after.forEach((node, index) => expect(node).toBe(before[index]));
});

it("patches changed controls in place rather than rebuilding them", () => {
  const slot = toolbarSlot();
  draw(slot);
  const before = [...slot.querySelectorAll("[data-zt-tool]")];
  const capability = {
    kind: "read-only",
    reason: "library-read-only",
  } as const;
  const copy = editingCapabilityCopy(capability, NOW);
  const why = copy.detail ?? copy.label;

  draw(slot, model({ armed: "underline", marksVisible: false, capability }));

  const after = [...slot.querySelectorAll("[data-zt-tool]")];
  after.forEach((node, index) => expect(node).toBe(before[index]));
  expect(shownIn(slot)).toEqual([
    {
      id: "highlight",
      pressed: "false",
      disabled: "true",
      tooltip: why,
      color: "#ffd400",
      icon: expect.stringContaining("lucide-highlighter"),
    },
    {
      id: "highlight-color",
      pressed: null,
      disabled: "true",
      tooltip: why,
      color: "",
      icon: expect.stringContaining("lucide-chevron-down"),
    },
    {
      id: "underline",
      pressed: "true",
      disabled: "true",
      tooltip: why,
      color: "#2ea8e5",
      icon: expect.stringContaining("lucide-underline"),
    },
    {
      id: "underline-color",
      pressed: null,
      disabled: "true",
      tooltip: why,
      color: "",
      icon: expect.stringContaining("lucide-chevron-down"),
    },
    {
      id: "note",
      pressed: "false",
      disabled: "true",
      tooltip: why,
      color: "#5fb236",
      icon: expect.stringContaining("lucide-sticky-note"),
    },
    {
      id: "note-color",
      pressed: null,
      disabled: "true",
      tooltip: why,
      color: "",
      icon: expect.stringContaining("lucide-chevron-down"),
    },
    {
      id: "text",
      pressed: "false",
      disabled: "true",
      tooltip: why,
      color: "#e56eee",
      icon: expect.stringContaining("lucide-type"),
    },
    {
      id: "text-color",
      pressed: null,
      disabled: "true",
      tooltip: why,
      color: "",
      icon: expect.stringContaining("lucide-chevron-down"),
    },
    {
      id: "image",
      pressed: "false",
      disabled: "true",
      tooltip: why,
      color: "#ff6666",
      icon: expect.stringContaining("lucide-square-dashed-mouse-pointer"),
    },
    {
      id: "image-color",
      pressed: null,
      disabled: "true",
      tooltip: why,
      color: "",
      icon: expect.stringContaining("lucide-chevron-down"),
    },
    {
      id: "ink",
      pressed: "false",
      disabled: "true",
      tooltip: why,
      color: "#a28ae5",
      icon: expect.stringContaining("lucide-pencil"),
    },
    {
      id: "ink-color",
      pressed: null,
      disabled: "true",
      tooltip: why,
      color: "",
      icon: expect.stringContaining("lucide-chevron-down"),
    },
    {
      id: "visibility",
      pressed: "false",
      disabled: null,
      tooltip: "Show Zotero annotations",
      color: "",
      icon: expect.stringContaining("lucide-eye-off"),
    },
  ]);
});

it("runs nothing for a press on a control that was stood down after it was built", () => {
  const slot = toolbarSlot();
  const activate = vi.fn();
  draw(slot, model(), activate);
  const highlight = slot.querySelector<HTMLElement>(
    '[data-zt-tool="highlight"]',
  )!;

  draw(
    slot,
    model({ capability: { kind: "read-only", reason: "zotero-unavailable" } }),
    activate,
  );
  highlight.click();
  highlight.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));

  expect(activate).not.toHaveBeenCalled();
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
  expect(slot.querySelectorAll(".zt-pdf-tool")).toHaveLength(MARK_TOOLS.length);
  expect(
    [...slot.querySelectorAll<HTMLElement>("[data-zt-tool]")].map(
      (node) => node.dataset.ztTool,
    ),
  ).toEqual([
    "highlight",
    "highlight-color",
    "underline",
    "underline-color",
    "note",
    "note-color",
    "text",
    "text-color",
    "image",
    "image-color",
    "ink",
    "ink-color",
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
