// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";

import { themeHook } from "@/lib/theme-hooks";
import type { EditingCapability } from "@/services/annotation-repository/capability";
import { editingCapabilityCopy } from "@/services/annotation-repository/capability-copy";

import {
  isEditGesture,
  removeCapabilityAffordance,
  renderCapabilityAffordance,
} from "./capability-affordance";

/** The instant every render is read at, so a cooldown's seconds are exact. */
const NOW = Temporal.Instant.from("2026-09-17T10:00:00Z");

/** Every value the Editing Capability can take, in the enum's own order. */
const EVERY_CAPABILITY = [
  { kind: "writable" },
  { kind: "authorization-required" },
  { kind: "authorizing" },
  { kind: "cooldown", retryAfter: NOW.add({ seconds: 42 }) },
  { kind: "read-only", reason: "probing" },
  { kind: "read-only", reason: "zotero-unavailable" },
  { kind: "read-only", reason: "local-api-disabled" },
  { kind: "read-only", reason: "incompatible-zotero" },
  { kind: "read-only", reason: "invalid-response" },
  { kind: "read-only", reason: "server-changed" },
  { kind: "read-only", reason: "library-read-only" },
] as const satisfies readonly EditingCapability[];

/** One capability named the way the assertions below list them. */
function reasonOf(capability: EditingCapability): string {
  return capability.kind === "read-only"
    ? `read-only:${capability.reason}`
    : capability.kind;
}

/** Obsidian's own right toolbar slot, as a bare element. */
function toolbarSlot(): HTMLElement {
  return document.createElement("div");
}

function draw(
  slot: HTMLElement,
  capability: EditingCapability,
  onActivate = () => undefined,
): HTMLElement {
  return renderCapabilityAffordance(slot, { capability, now: NOW, onActivate });
}

/**
 * The affordance's state as a reader sees it: the icon Obsidian stamped, the
 * tone, the tooltip, whether it reads as busy, and the countdown beside it.
 */
function shownIn(node: HTMLElement) {
  return {
    icon: node.querySelector("svg")?.getAttribute("class"),
    tone: node.dataset.ztCapabilityTone,
    tooltip: node.getAttribute("aria-label"),
    busy: node.getAttribute("aria-busy"),
    warning: node.classList.contains("mod-warning"),
    countdown: node.querySelector("span")?.textContent ?? null,
  };
}

it("shows every Editing Capability with its own icon, tone and tooltip", () => {
  const slot = toolbarSlot();

  const shown = EVERY_CAPABILITY.map((capability) => {
    const node = draw(slot, capability);
    // One node per slot, however often the render function is called.
    expect(slot.childElementCount).toBe(1);
    expect(node.classList.contains("clickable-icon")).toBe(true);
    expect(node.classList.contains(themeHook.pdfCapability)).toBe(true);
    // ADR 0042: the toolbar carries no `.zt-root`, so no preflight reaches it.
    expect(node.closest(".zt-root")).toBeNull();
    return shownIn(node);
  });

  // The copy table is the oracle: every label and detail on screen is the one
  // the settings row and the Annotation View read for the same value.
  expect(shown).toEqual(
    EVERY_CAPABILITY.map((capability) => {
      const { icon, tone, label, detail, spinning } = editingCapabilityCopy(
        capability,
        NOW,
      );
      return {
        // A spinning icon turns; the rest stand still.
        icon: `svg-icon lucide-${icon}${spinning ? " zt:animate-spin" : ""}`,
        tone,
        tooltip: detail === null ? label : expect.stringContaining(detail),
        busy: spinning ? "true" : null,
        warning: tone === "warning",
        countdown: capability.kind === "cooldown" ? "42" : null,
      };
    }),
  );
});

it("counts the cooldown down and drops the count when it lifts", () => {
  const slot = toolbarSlot();
  const retryAfter = NOW.add({ seconds: 3 });
  const seconds = [0, 1, 2, 3].map(
    (elapsed) =>
      shownIn(
        renderCapabilityAffordance(slot, {
          capability: { kind: "cooldown", retryAfter },
          now: NOW.add({ seconds: elapsed }),
          onActivate: () => undefined,
        }),
      ).countdown,
  );
  expect(seconds).toEqual(["3", "2", "1", "0"]);

  // The same node takes the next state; nothing of the countdown is left.
  expect(shownIn(draw(slot, { kind: "writable" }))).toMatchObject({
    countdown: null,
    tone: "ready",
    busy: null,
  });
  expect(slot.childElementCount).toBe(1);
});

it("turns the icon while ZotLit or Zotero is working, and only then", () => {
  const slot = toolbarSlot();
  const spinning = EVERY_CAPABILITY.filter(
    (capability) => shownIn(draw(slot, capability)).busy === "true",
  ).map(reasonOf);

  // Stated as literal values rather than re-derived: waiting on Zotero's dialog
  // and waiting on a probe are the two states nothing can be done about.
  expect(spinning).toEqual(["authorizing", "read-only:probing"]);
});

it("promises the theme one class and one state attribute, by literal name", () => {
  const slot = toolbarSlot();
  const node = draw(slot, { kind: "read-only", reason: "library-read-only" });

  // The public hooks a theme styles the affordance through.
  expect(node.classList.contains("zt-pdf-capability")).toBe(true);
  expect(node.dataset.ztCapabilityTone).toBe("warning");
  expect(draw(slot, { kind: "writable" }).dataset.ztCapabilityTone).toBe(
    "ready",
  );
});

it("runs the click and the keyboard activation through one handler", () => {
  const slot = toolbarSlot();
  const onActivate = vi.fn();
  const node = draw(slot, { kind: "writable" }, onActivate);
  expect(node.getAttribute("role")).toBe("button");
  expect(node.getAttribute("tabindex")).toBe("0");

  node.click();
  node.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
  node.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));
  // A key that is not an activation leaves the affordance alone.
  node.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
  expect(onActivate).toHaveBeenCalledTimes(3);

  // A redraw keeps the one handler the node was built with.
  draw(slot, { kind: "read-only", reason: "probing" }, onActivate);
  node.click();
  expect(onActivate).toHaveBeenCalledTimes(4);
});

it("removes the affordance idempotently, and leaves the slot as it found it", () => {
  const slot = toolbarSlot();
  const sibling = slot.createDiv({ cls: "pdf-toolbar-button" });

  draw(slot, { kind: "writable" });
  expect(slot.childElementCount).toBe(2);

  removeCapabilityAffordance(slot);
  removeCapabilityAffordance(slot);
  expect([...slot.children]).toEqual([sibling]);

  // A slot that never held one answers the same.
  removeCapabilityAffordance(toolbarSlot());
});

it("reads the reader's edit keystrokes, and nothing else, as edit gestures", () => {
  const gesture = (init: KeyboardEventInit, target?: HTMLElement): boolean => {
    const event = new KeyboardEvent("keydown", init);
    if (target) target.dispatchEvent(event);
    return isEditGesture(event);
  };

  expect(["h", "u", "c", "1", "8", "H"].map((key) => gesture({ key }))).toEqual(
    [true, true, true, true, true, true],
  );
  // `9` is not one of the eight colours, and the rest are other people's keys.
  expect(["9", "0", "x", "Escape"].map((key) => gesture({ key }))).toEqual([
    false,
    false,
    false,
    false,
  ]);
  // A modified key belongs to Obsidian's own commands.
  expect(gesture({ key: "h", ctrlKey: true })).toBe(false);
  expect(gesture({ key: "h", metaKey: true })).toBe(false);
  expect(gesture({ key: "h", altKey: true })).toBe(false);

  // A keystroke inside a text field belongs to the field.
  const field = document.createElement("input");
  document.body.append(field);
  expect(gesture({ key: "h", bubbles: true }, field)).toBe(false);
  field.remove();
});
