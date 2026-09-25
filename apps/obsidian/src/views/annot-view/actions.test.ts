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
import type { CardControl, CardControls } from "./card-controls";

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
/** Two cards with text, of two colours, and one with only a comment. */
const QUOTED = {
  ...FIRST,
  color: "#ffd400",
  text: "Scientific visualization is classically defined",
};
const COMMENTED = {
  ...SECOND,
  color: "#ff6666",
  comment: "Compare with <i>Rougier</i>",
};

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
    patchColor: vi.fn(async () => ({ kind: "idle" as const })),
    patchColors: vi.fn(async (keys: readonly string[]) =>
      keys.map(() => ({ kind: "idle" as const })),
    ),
  };
  const controls: CardControls = {
    color: control,
    comment: control,
    tags: control,
    delete: control,
  };
  const deps = {
    app: { workspace: { activeEditor: null } },
    annotations,
    controls: () => controls,
    selectedCards: () => selected,
    selectAlone,
    resolveAnnotationID: () => null,
    onExploreAnnotation: () => {},
    insertAnnotation: () => {},
  } as unknown as AnnotActionDeps;
  return { actions: createAnnotActions(deps), selectAlone, annotations };
}

/** The menu a right-click on this card opens. */
function openMenu(
  actions: ReturnType<typeof setup>["actions"],
  card: AnnotationRecord,
): Menu {
  Menu.instances.length = 0;
  actions.onCardMenu(
    { nativeEvent: new window.MouseEvent("contextmenu") } as MouseEvent<
      HTMLElement,
      globalThis.MouseEvent
    >,
    card,
  );
  return Menu.instances[0]!;
}

/** The titles of the menu a right-click on this card opens. */
function rightClick(
  actions: ReturnType<typeof setup>["actions"],
  card: AnnotationRecord,
): string[] {
  return openMenu(actions, card).items.map((item) => item.title);
}

/** One entry of a menu, by its title. */
function entry(menu: Menu, title: string) {
  return menu.items.find((item) => item.title === title)!;
}

beforeEach(() => {
  notices.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the menu a card opens", () => {
  it("offers the group verbs and no single-card entry on a card inside a group", () => {
    const { actions, selectAlone } = setup([FIRST, SECOND]);

    expect(rightClick(actions, SECOND)).toEqual([
      m.annot_view_card_color(),
      m.annot_view_menu_copy_text(),
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

describe("the colour of a group", () => {
  it("checks no swatch for a mixed group, and recolours every card from one", () => {
    const { actions, annotations } = setup([QUOTED, COMMENTED]);

    const colors = entry(
      openMenu(actions, COMMENTED),
      m.annot_view_card_color(),
    ).submenu!;

    expect(colors.items.filter((item) => item.checked)).toEqual([]);
    colors.items[2]!.click();
    expect(annotations.patchColors).toHaveBeenCalledExactlyOnceWith(
      [QUOTED.key, COMMENTED.key],
      "#5fb236",
    );
    expect(annotations.patchColor).not.toHaveBeenCalled();
  });

  it("checks the swatch every card of the group has", () => {
    const { actions } = setup([QUOTED, { ...COMMENTED, color: "#FFD400" }]);

    const colors = entry(
      openMenu(actions, QUOTED),
      m.annot_view_card_color(),
    ).submenu!;

    expect(colors.items.map((item) => item.checked)).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it("is dimmed, and the palette says why, under a blocked capability", () => {
    const blocked = {
      ...LIVE,
      blocked: { reason: "Zotero is not running.", action: null },
    };
    const { actions } = setup([QUOTED, COMMENTED], blocked);

    expect(
      entry(openMenu(actions, QUOTED), m.annot_view_card_color()).disabled,
    ).toBe(true);
    Menu.instances.length = 0;
    actions.onColorMenu(
      {
        currentTarget: document.createElement("button"),
      } as unknown as MouseEvent<HTMLElement>,
      QUOTED,
    );
    expect(notices).toEqual(["Zotero is not running."]);
    expect(Menu.instances).toEqual([]);
  });
});

describe("copying the text of cards", () => {
  it("copies each card's text, or its comment, in list order", () => {
    using write = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue(undefined);
    const { actions } = setup([QUOTED, COMMENTED]);

    entry(openMenu(actions, QUOTED), m.annot_view_menu_copy_text()).click();

    expect(write).toHaveBeenCalledExactlyOnceWith(
      `${QUOTED.text}\n\nCompare with Rougier`,
    );
  });

  it("dims the group's copy where no card has text or a comment", () => {
    const { actions } = setup([FIRST, SECOND]);

    expect(
      entry(openMenu(actions, FIRST), m.annot_view_menu_copy_text()).disabled,
    ).toBe(true);
    expect(actions.onCopySelection()).toBe(false);
  });

  it("offers the copy on one card that carries only a comment", () => {
    const { actions } = setup([]);

    expect(rightClick(actions, COMMENTED)).toContain(
      m.annot_view_menu_copy_text(),
    );
    expect(rightClick(actions, FIRST)).not.toContain(
      m.annot_view_menu_copy_text(),
    );
  });
});
