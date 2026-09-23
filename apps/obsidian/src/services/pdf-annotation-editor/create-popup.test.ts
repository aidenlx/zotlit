// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";

import { ANNOTATION_COLORS } from "@/lib/annotation-colors";
import type { EditingCapability } from "@/services/annotation-repository/capability";
import { editingCapabilityCopy } from "@/services/annotation-repository/capability-copy";
import { IDLE } from "@/services/annotation-repository/write";
import type { MutationState } from "@/services/annotation-repository/write";

import { createPopupRow, renderCreatePopupRow } from "./create-popup";
import type { CreatePopupAction, CreatePopupControl } from "./create-popup";
import { resolveToolColors } from "./tools";
import type { MarkTool } from "./tools";

const NOW = Temporal.Instant.from("2026-09-17T10:00:00Z");

const COLORS = resolveToolColors({
  highlight: "#ffd400",
  underline: "#2ea8e5",
  image: "#ff6666",
});

function row(
  overrides: {
    armed?: MarkTool | null;
    capability?: EditingCapability;
    mutation?: MutationState;
    commenting?: boolean;
    swatches?: readonly string[];
  } = {},
): readonly CreatePopupControl[] {
  return createPopupRow({
    armed: overrides.armed ?? null,
    colors: COLORS,
    swatches: overrides.swatches ?? ANNOTATION_COLORS.slice(0, 4),
    capability: overrides.capability ?? { kind: "writable" },
    mutation: overrides.mutation ?? IDLE,
    commenting: overrides.commenting ?? false,
    now: NOW,
  });
}

it("offers both tools, the swatches it is handed, the comment sheet and copy", () => {
  expect(row().map(({ id }) => id)).toEqual([
    "highlight",
    "underline",
    "color-1",
    "color-2",
    "color-3",
    "color-4",
    "comment",
    "copy",
  ]);
});

it("names each swatch by its seat in Zotero's palette, in the order handed", () => {
  const swatches = row({
    swatches: [ANNOTATION_COLORS[5]!, ANNOTATION_COLORS[1]!],
  }).flatMap(({ id, action }) =>
    action.kind === "color" ? [[id, action.color]] : [],
  );

  expect(swatches).toEqual([
    ["color-6", ANNOTATION_COLORS[5]],
    ["color-2", ANNOTATION_COLORS[1]],
  ]);
});

it("marks the armed tool's own colour, so the popup and the toolbar agree", () => {
  const checked = (armed: "highlight" | "underline") =>
    row({ armed })
      .filter(({ pressed, action }) => pressed && action.kind === "color")
      .map(({ color }) => color);

  expect(checked("highlight")).toEqual([COLORS.highlight]);
  expect(checked("underline")).toEqual([COLORS.underline]);
});

it("commits with highlight while nothing is armed", () => {
  const armed = row().filter(({ pressed }) => pressed === true);

  expect(armed.map(({ color }) => color)).toEqual([COLORS.highlight]);
});

it("commits with highlight while the image tool is armed, since a selection is text", () => {
  const pressed = row({ armed: "image" }).filter(
    ({ pressed }) => pressed === true,
  );

  expect(pressed.map(({ id, color }) => [id, color])).toEqual([
    [
      `color-${ANNOTATION_COLORS.indexOf(COLORS.highlight) + 1}`,
      COLORS.highlight,
    ],
  ]);
});

it.each([
  { kind: "read-only", reason: "zotero-unavailable" },
  { kind: "read-only", reason: "library-read-only" },
] satisfies EditingCapability[])(
  "stands every creating verb down in place and says why under $reason",
  (capability) => {
    const controls = row({ capability });
    const copy = editingCapabilityCopy(capability, NOW);

    expect(
      controls.filter(({ disabled }) => !disabled).map(({ id }) => id),
    ).toEqual(["copy"]);
    expect(controls[0]?.tooltip).toBe(copy.detail ?? copy.label);
  },
);

it("stands the creating verbs down while a create is in flight", () => {
  const controls = row({ mutation: { kind: "pending" } });

  expect(
    controls.filter(({ disabled }) => !disabled).map(({ id }) => id),
  ).toEqual(["copy"]);
});

it("keeps only copying available before authorization", () => {
  expect(
    row({ capability: { kind: "authorization-required" } })
      .filter(({ disabled }) => !disabled)
      .map(({ id }) => id),
  ).toEqual(["copy"]);
});

it("draws the row and runs each control's own action", () => {
  const content = document.createElement("div");
  const pressed: CreatePopupAction[] = [];
  renderCreatePopupRow(content, row(), (action) => pressed.push(action));

  content.querySelector<HTMLElement>('[data-zt-verb="underline"]')!.click();
  content.querySelector<HTMLElement>('[data-zt-verb="color-3"]')!.click();
  content.querySelector<HTMLElement>('[data-zt-verb="comment"]')!.click();

  expect(pressed).toEqual([
    { kind: "tool", tool: "underline" },
    { kind: "color", color: ANNOTATION_COLORS[2] },
    { kind: "comment" },
  ]);
});

it("wears each swatch's colour on the node itself, not on the icon's SVG", () => {
  const content = document.createElement("div");
  renderCreatePopupRow(content, row(), vi.fn());

  const swatch = content.querySelector<HTMLElement>(
    '[data-zt-verb="color-4"]',
  )!;

  expect(swatch.style.color).toBe(ANNOTATION_COLORS[3]);
  expect(swatch.querySelector("svg")?.getAttribute("fill")).toBeNull();
});

it("gives a blocked control no listener", () => {
  const content = document.createElement("div");
  const pressed: CreatePopupAction[] = [];
  renderCreatePopupRow(
    content,
    row({ capability: { kind: "read-only", reason: "zotero-unavailable" } }),
    (action) => pressed.push(action),
  );

  content.querySelector<HTMLElement>('[data-zt-verb="highlight"]')!.click();
  content.querySelector<HTMLElement>('[data-zt-verb="copy"]')!.click();

  expect(pressed).toEqual([{ kind: "copy" }]);
});
