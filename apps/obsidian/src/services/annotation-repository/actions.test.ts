import { createMockPlugin } from "@mock/obsidian";
import type { Command } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { addAnnotationHistoryActions } from "./actions";
import type { HistorySurface } from "./actions";
import type { HistoryDirection } from "./history";

interface Surface extends HistorySurface {
  /** Every step this surface was asked to take, in the order asked. */
  readonly stepped: readonly HistoryDirection[];
}

/** A view that names one Attachment and records what it was asked to step. */
function surface(historyAttachment: string | null): Surface {
  const stepped: HistoryDirection[] = [];
  return {
    historyAttachment,
    stepped,
    stepHistory: (direction) => stepped.push(direction),
  };
}

/** The two commands, registered against one active surface and one history. */
function setup({
  active = surface("RGRPDF24"),
  undo = true,
  redo = true,
}: {
  active?: HistorySurface | null;
  undo?: boolean;
  redo?: boolean;
} = {}) {
  const plugin = createMockPlugin();
  const canUndo = vi.fn(() => undo);
  const canRedo = vi.fn(() => redo);
  addAnnotationHistoryActions(plugin, {
    annotations: { canUndo, canRedo },
    activeSurface: () => active,
  });
  const command = (id: string): Command => {
    const registered = plugin.commands.get(id);
    if (!registered) throw new Error(`${id} was not registered`);
    return registered;
  };
  return { canRedo, canUndo, command };
}

describe("the Annotation History commands", () => {
  it("names both directions from the message catalogs, with no keyboard shortcut of their own", () => {
    const { command } = setup();

    expect([
      command("undo-annotation-change").name,
      command("redo-annotation-change").name,
    ]).toEqual(["Undo annotation change", "Redo annotation change"]);
    expect([
      command("undo-annotation-change").hotkeys,
      command("redo-annotation-change").hotkeys,
    ]).toEqual([undefined, undefined]);
  });

  it("steps the active surface, in the direction the command names", () => {
    const active = surface("RGRPDF24");
    const { command } = setup({ active });

    expect(command("undo-annotation-change").checkCallback?.(false)).toBe(true);
    expect(command("redo-annotation-change").checkCallback?.(false)).toBe(true);

    expect(active.stepped).toEqual(["undo", "redo"]);
  });

  it("asks about the Attachment the active surface shows", () => {
    const { canRedo, canUndo, command } = setup({
      active: surface("ABCD2345g42"),
    });

    command("undo-annotation-change").checkCallback?.(true);
    command("redo-annotation-change").checkCallback?.(true);

    expect(canUndo).toHaveBeenCalledExactlyOnceWith("ABCD2345g42");
    expect(canRedo).toHaveBeenCalledExactlyOnceWith("ABCD2345g42");
  });

  it("leaves the palette where the history holds nothing that way", () => {
    const active = surface("RGRPDF24");
    const { command } = setup({ active, undo: false });

    expect(command("undo-annotation-change").checkCallback?.(true)).toBe(false);
    expect(command("redo-annotation-change").checkCallback?.(true)).toBe(true);
    expect(active.stepped).toEqual([]);
  });

  it("leaves the palette where the active view shows no Attachment", () => {
    const shown = setup({ active: surface(null) });

    expect(shown.command("undo-annotation-change").checkCallback?.(true)).toBe(
      false,
    );
    expect(shown.canUndo).not.toHaveBeenCalled();

    const none = setup({ active: null });

    expect(none.command("redo-annotation-change").checkCallback?.(true)).toBe(
      false,
    );
    expect(none.canRedo).not.toHaveBeenCalled();
  });
});
