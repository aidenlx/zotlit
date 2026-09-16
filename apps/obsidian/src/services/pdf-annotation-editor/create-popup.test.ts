// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";

import { ANNOTATION_COLORS } from "@/lib/annotation-colors";
import type { EditingCapability } from "@/services/annotation-repository/capability";
import { editingCapabilityCopy } from "@/services/annotation-repository/capability-copy";
import { IDLE } from "@/services/annotation-repository/write";
import type { MutationState } from "@/services/annotation-repository/write";

import {
  createPopupRow,
  renderCommentSheet,
  renderCreatePopupRow,
} from "./create-popup";
import type { CreatePopupAction, CreatePopupControl } from "./create-popup";

const NOW = Temporal.Instant.from("2026-09-17T10:00:00Z");

const COLORS = { highlight: "#ffd400", underline: "#2ea8e5" } as const;

function row(
  overrides: {
    armed?: "highlight" | "underline" | null;
    capability?: EditingCapability;
    mutation?: MutationState;
    commenting?: boolean;
  } = {},
): readonly CreatePopupControl[] {
  return createPopupRow({
    armed: overrides.armed ?? null,
    colors: COLORS,
    capability: overrides.capability ?? { kind: "writable" },
    mutation: overrides.mutation ?? IDLE,
    commenting: overrides.commenting ?? false,
    now: NOW,
  });
}

it("offers both tools, Zotero's eight colours, the comment sheet and copy", () => {
  expect(row().map(({ id }) => id)).toEqual([
    "highlight",
    "underline",
    ...ANNOTATION_COLORS.map((_, index) => `color-${index + 1}`),
    "comment",
    "copy",
  ]);
});

it("names the eight swatches in Zotero's own order", () => {
  const swatches = row().flatMap(({ action }) =>
    action.kind === "color" ? [action.color] : [],
  );

  expect(swatches).toEqual(ANNOTATION_COLORS);
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

it("keeps every verb live where the gesture is what asks for authorization", () => {
  expect(
    row({ capability: { kind: "authorization-required" } }).some(
      ({ disabled }) => disabled,
    ),
  ).toBe(false);
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

it("saves the comment sheet on Ctrl+Enter and on Command+Enter", () => {
  const sheet = document.createElement("div");
  const onSave = vi.fn();
  const editor = renderCommentSheet(sheet, {
    value: "a thought",
    onSave,
    onCancel: vi.fn(),
  });

  editor.value = "a second thought";
  editor.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true }),
  );
  editor.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", metaKey: true }),
  );

  expect(onSave.mock.calls).toEqual([
    ["a second thought"],
    ["a second thought"],
  ]);
});

it("leaves a plain Enter to the editor and steps back on Escape", () => {
  const sheet = document.createElement("div");
  const onSave = vi.fn();
  const onCancel = vi.fn();
  const editor = renderCommentSheet(sheet, { value: "", onSave, onCancel });

  editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
  editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

  expect(onSave).not.toHaveBeenCalled();
  expect(onCancel).toHaveBeenCalledOnce();
});

it("promises the comment sheet's theme hook by its literal name", () => {
  // The name itself is the public surface, so the literal is the test.
  // @see apps/obsidian/policies/theme-hooks.md
  const sheet = document.createElement("div");

  renderCommentSheet(sheet, { value: "", onSave: vi.fn(), onCancel: vi.fn() });

  expect(sheet.classList.contains("zt-pdf-comment-sheet")).toBe(true);
});

it("opens the sheet on the comment already typed", () => {
  const sheet = document.createElement("div");

  const editor = renderCommentSheet(sheet, {
    value: "kept across a redraw",
    onSave: vi.fn(),
    onCancel: vi.fn(),
  });

  expect(editor.value).toBe("kept across a redraw");
});
