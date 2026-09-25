// @vitest-environment happy-dom
import { Menu } from "@mock/obsidian";
import type { MouseEvent } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as confirmation from "@/lib/confirm";
import * as m from "@/lib/i18n/generated/messages";
import type { AnnotationRecord } from "@/services/annotation-repository/service";
import { annotation } from "@/services/pdf-annotation-editor/__fixtures__";

import { createAnnotActions } from "./actions";
import type { AnnotActionDeps } from "./actions";
import type { CardControl } from "./card-controls";

const { notices } = vi.hoisted(() => ({ notices: [] as string[] }));
vi.mock("@/lib/notice", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/notice")>();
  class BaseNotice extends actual.BaseNotice {
    constructor(message: string | DocumentFragment, duration?: number) {
      super(message, duration);
      notices.push(
        typeof message === "string" ? message : (message.textContent ?? ""),
      );
    }
  }
  return { ...actual, BaseNotice };
});

const FIRST = annotation("PUPR5FG5", "highlight", { pageIndex: 0, rects: [] });
const SECOND = annotation("K3JRFLFQ", "underline", { pageIndex: 0, rects: [] });
const OUTSIDE = annotation("HRK7BG32", "text", { pageIndex: 0, rects: [] });

const LIVE: CardControl = { disabled: false, blocked: null, tooltip: "" };

/**
 * The actions over a Card Selection, with every other dependency inert. The
 * view's own seams are the fakes: what it holds selected, and the select a
 * menu on a card outside the selection runs.
 */
function setup(
  selected: readonly AnnotationRecord[],
  control: CardControl = LIVE,
) {
  const selectAlone = vi.fn();
  const annotations = {
    deleteAnnotation: vi.fn(async () => ({ kind: "idle" as const })),
    deleteAnnotations: vi.fn(async (keys: readonly string[]) =>
      keys.map(() => ({ kind: "idle" as const })),
    ),
  };
  const deps = {
    app: { workspace: { activeEditor: null } },
    annotations,
    deleteControl: () => control,
    selectedCards: () => selected,
    selectAlone,
    resolveAnnotationID: () => null,
    onExploreAnnotation: () => {},
    insertAnnotation: () => {},
  } as unknown as AnnotActionDeps;
  return { actions: createAnnotActions(deps), selectAlone, annotations };
}

/** The titles of the menu a right-click on this card opens. */
function rightClick(
  actions: ReturnType<typeof setup>["actions"],
  card: AnnotationRecord,
): string[] {
  Menu.instances.length = 0;
  actions.onCardMenu(
    { nativeEvent: new window.MouseEvent("contextmenu") } as MouseEvent<
      HTMLElement,
      globalThis.MouseEvent
    >,
    card,
  );
  const [menu] = Menu.instances;
  return menu!.items.map((item) => item.title);
}

beforeEach(() => {
  notices.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the menu a card opens", () => {
  it("offers the counted delete and no single-card entry on a card inside a group", () => {
    const { actions, selectAlone } = setup([FIRST, SECOND]);

    expect(rightClick(actions, SECOND)).toEqual([
      m.annot_view_menu_delete_group({ count: 2 }),
    ]);
    expect(selectAlone).not.toHaveBeenCalled();
  });

  it("selects a card outside the selection alone, and offers its own menu", () => {
    const { actions, selectAlone } = setup([FIRST, SECOND]);

    const titles = rightClick(actions, OUTSIDE);

    expect(selectAlone).toHaveBeenCalledExactlyOnceWith(OUTSIDE);
    expect(titles).toContain(m.annot_view_menu_copy_citation());
    expect(titles.at(-1)).toBe(m.annot_view_menu_delete());
  });
});

describe("Delete on the Card Selection", () => {
  it("asks once with the count, then deletes the group", async () => {
    using ask = vi.spyOn(confirmation, "confirm").mockResolvedValue(true);
    const { actions, annotations } = setup([FIRST, SECOND]);

    actions.onDeleteSelection();

    await vi.waitFor(() =>
      expect(annotations.deleteAnnotations).toHaveBeenCalledExactlyOnceWith([
        FIRST.key,
        SECOND.key,
      ]),
    );
    expect(ask.mock.calls[0]?.[0].title).toBe(
      m.annot_view_delete_group_confirm_title({ count: 2 }),
    );
  });

  it("says why in a notice and asks nothing under a blocked capability", () => {
    using ask = vi.spyOn(confirmation, "confirm").mockResolvedValue(true);
    const { actions, annotations } = setup([FIRST, SECOND], {
      ...LIVE,
      blocked: { reason: "Zotero is not running.", action: null },
    });

    actions.onDeleteSelection();

    expect(notices).toEqual(["Zotero is not running."]);
    expect(ask).not.toHaveBeenCalled();
    expect(annotations.deleteAnnotations).not.toHaveBeenCalled();
  });

  it("does nothing while a write is in flight on a card of the group", () => {
    using ask = vi.spyOn(confirmation, "confirm").mockResolvedValue(true);
    const { actions } = setup([FIRST, SECOND], { ...LIVE, disabled: true });

    actions.onDeleteSelection();

    expect(ask).not.toHaveBeenCalled();
    expect(notices).toEqual([]);
  });
});
