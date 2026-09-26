import { createMockPlugin } from "@mock/obsidian";
import type { Command } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import * as m from "@/lib/i18n/generated/messages";

import { addAnnotationHistoryActions, historyOutcomeNotice } from "./actions";
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

// What can go wrong with the notice of one undo or redo press:
// - a step a lock refused gives the capability copy, or no notice at all;
// - a block of the Editing Capability gets a second notice beside the one its
//   own seam raises.
describe("the notice of one undo or redo press", () => {
  const NOW = Temporal.Instant.from("2026-09-26T12:00:00Z");

  it("gives the Lock Reason alone for a step a lock refused", () => {
    expect(
      historyOutcomeNotice({ kind: "locked", reason: "external" }, NOW),
    ).toBe(m.annot_view_lock_external());
  });

  it("leaves a block of the Editing Capability to its own seam", () => {
    expect(historyOutcomeNotice({ kind: "blocked" }, NOW)).toBeNull();
  });

  it("says the user is now the creator after a restore of another user's Annotations", () => {
    expect(
      historyOutcomeNotice(
        {
          kind: "stepped",
          annotationKey: "MADE2345",
          restoredAsCreator: { count: 2 },
        },
        NOW,
      ),
    ).toBe(m.annot_history_restored_new_creator({ count: 2 }));
  });

  it("gives no notice for a step it took", () => {
    expect(
      historyOutcomeNotice({ kind: "stepped", annotationKey: "PUPR5FG5" }, NOW),
    ).toBeNull();
    expect(historyOutcomeNotice({ kind: "idle" }, NOW)).toBeNull();
  });
});
