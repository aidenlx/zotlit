// @vitest-environment happy-dom
import { Menu } from "@mock/obsidian";
import type { MouseEvent } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as confirmation from "@/lib/confirm";
import * as m from "@/lib/i18n/generated/messages";
import type { AnnotationRecord } from "@/services/annotation-repository/service";
import { annotation } from "@/services/pdf-annotation-editor/__fixtures__";

import { createAnnotActions } from "./actions";
import type { AnnotActionDeps } from "./actions";
import { hasQuotedText } from "./card-controls";
import type { CardControl, CardControls } from "./card-controls";

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
const NOT_RUNNING = {
  reason: "Zotero is not running.",
  action: null,
  source: "capability",
} as const;
const BLOCKED: CardControl = { ...LIVE, blocked: NOT_RUNNING };
const LOCKED: CardControl = {
  ...LIVE,
  blocked: {
    reason: m.annot_view_lock_external(),
    action: null,
    source: "lock",
  },
};

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
  const openEditor = vi.fn();
  const annotations = {
    editTextField: vi.fn(() => ({})),
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
    text: control,
  };
  const deps = {
    app: { workspace: { activeEditor: null } },
    annotations,
    // Only a highlight or underline has a Quoted Text, as `cardControls` rules.
    controls: (annot: AnnotationRecord) => ({
      ...controls,
      text: hasQuotedText(annot.type) ? control : null,
    }),
    selectedCards: () => selected,
    selectAlone,
    closeEditors: () => {},
    openEditor,
    resolveAnnotationID: () => null,
    onExploreAnnotation: () => {},
    insertAnnotation: () => {},
  } as unknown as AnnotActionDeps;
  return {
    actions: createAnnotActions(deps),
    selectAlone,
    openEditor,
    annotations,
  };
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

  it("keeps the press of a locked delete entry, and asks nothing and deletes nothing", () => {
    using ask = vi.spyOn(confirmation, "confirm").mockResolvedValue(true);
    const { actions, annotations } = setup([], LOCKED);

    const item = entry(openMenu(actions, QUOTED), m.annot_view_menu_delete());
    expect(item.disabled).toBe(false);
    item.click();

    expect(ask).not.toHaveBeenCalled();
    expect(annotations.deleteAnnotations).not.toHaveBeenCalled();
    expect(annotations.deleteAnnotation).not.toHaveBeenCalled();
  });
});

describe("Edit quoted text", () => {
  it("leads the menu of one highlight or underline card, and opens its Quoted Text editor", () => {
    const { actions, openEditor, annotations } = setup([]);

    const menu = openMenu(actions, QUOTED);
    expect(menu.items[0]?.title).toBe(m.annot_view_menu_edit_text());
    entry(menu, m.annot_view_menu_edit_text()).click();

    expect(annotations.editTextField).toHaveBeenCalledWith("text", QUOTED.key);
    expect(openEditor).toHaveBeenCalledExactlyOnceWith(QUOTED, "text");
  });

  it("is left out where the Annotation has no Quoted Text", () => {
    const { actions } = setup([]);

    expect(rightClick(actions, OUTSIDE)).not.toContain(
      m.annot_view_menu_edit_text(),
    );
  });

  it("stays enabled while editing is blocked, and its press opens no editor", () => {
    const { actions, openEditor } = setup([], BLOCKED);

    const item = entry(
      openMenu(actions, QUOTED),
      m.annot_view_menu_edit_text(),
    );
    expect(item.disabled).toBe(false);
    item.click();

    expect(openEditor).not.toHaveBeenCalled();
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
    const { actions, annotations } = setup([FIRST, SECOND], BLOCKED);

    expect(actions.onDeleteSelection()).toEqual(NOT_RUNNING);
    expect(ask).not.toHaveBeenCalled();
    expect(annotations.deleteAnnotations).not.toHaveBeenCalled();
  });

  it("does nothing while a write is in flight on a card of the group", () => {
    using ask = vi.spyOn(confirmation, "confirm").mockResolvedValue(true);
    const { actions } = setup([FIRST, SECOND], { ...LIVE, disabled: true });

    expect(actions.onDeleteSelection()).toBeNull();
    expect(ask).not.toHaveBeenCalled();
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
    const { actions } = setup([QUOTED, COMMENTED], BLOCKED);

    expect(
      entry(openMenu(actions, QUOTED), m.annot_view_card_color()).disabled,
    ).toBe(true);
    Menu.instances.length = 0;
    expect(
      actions.onColorMenu(
        {
          currentTarget: document.createElement("button"),
        } as unknown as MouseEvent<HTMLElement>,
        QUOTED,
      ),
    ).toEqual(NOT_RUNNING);
    expect(Menu.instances).toEqual([]);
  });
});

describe("a colour key on the Card Selection", () => {
  it("recolours every Selected Card as one group write", () => {
    const { actions, annotations } = setup([QUOTED, COMMENTED]);

    expect(actions.onRecolorSelection("#5fb236")).toBeNull();

    expect(annotations.patchColors).toHaveBeenCalledExactlyOnceWith(
      [QUOTED.key, COMMENTED.key],
      "#5fb236",
    );
  });

  it("says why and writes nothing under a blocked capability", () => {
    const { actions, annotations } = setup([QUOTED, COMMENTED], BLOCKED);

    expect(actions.onRecolorSelection("#5fb236")).toEqual(NOT_RUNNING);
    expect(annotations.patchColors).not.toHaveBeenCalled();
  });

  it("does nothing while a write is in flight, or with no card selected", () => {
    const busy = setup([QUOTED], { ...LIVE, disabled: true });
    const empty = setup([]);

    expect(busy.actions.onRecolorSelection("#5fb236")).toBeNull();
    expect(empty.actions.onRecolorSelection("#5fb236")).toBeNull();
    expect(busy.annotations.patchColor).not.toHaveBeenCalled();
    expect(empty.annotations.patchColor).not.toHaveBeenCalled();
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

describe("opening a card editor", () => {
  /**
   * The actions with the view's seams that an editor's open runs through, in
   * the order they run. `draft` is what the repository's open answers.
   */
  function opening(draft: object | null) {
    const calls: string[] = [];
    const deps = {
      selectAlone: () => calls.push("select alone"),
      closeEditors: () => calls.push("close editors"),
      annotations: {
        editTextField: (field: string) => (calls.push(`open ${field}`), draft),
        editTags: () => (calls.push("open tags"), draft),
      },
    } as unknown as AnnotActionDeps;
    return { actions: createAnnotActions(deps), calls };
  }

  it("saves and closes the open editor before the other opens", () => {
    const { actions, calls } = opening({});
    actions.onOpenTags(FIRST);
    actions.onOpenField(FIRST, "comment");
    expect(calls).toEqual([
      "select alone",
      "close editors",
      "open tags",
      "select alone",
      "close editors",
      "open comment",
    ]);
  });

  it("opens the comment editor only where a draft starts", () => {
    expect(opening({}).actions.onOpenField(FIRST, "comment")).toBe(true);
    expect(opening(null).actions.onOpenField(FIRST, "text")).toBe(false);
  });
});

describe("the verbs that end a text field's draft", () => {
  /**
   * The actions over one card, recording which repository verb each press
   * reaches.
   */
  function verbs() {
    const calls: string[] = [];
    const call =
      (name: string) =>
      (...args: string[]) => {
        // A field's verb names its field first; a write's verb takes the key.
        calls.push(args.length > 1 ? `${name} ${args[0]} draft` : name);
        return Promise.resolve({ kind: "idle" as const });
      };
    const deps = {
      annotations: {
        retryTextDraft: call("retry"),
        retryWrite: call("retry write"),
        discardTextDraft: call("discard"),
        discardConflict: call("discard conflict"),
      },
    } as unknown as AnnotActionDeps;
    return { actions: createAnnotActions(deps), calls };
  }

  it("end the named field's draft, and leave the other field's", () => {
    const { actions, calls } = verbs();
    actions.onApplyAgain(FIRST, "text");
    actions.onDiscardConflict(FIRST, "text");
    actions.onDiscardDraft(FIRST, "text");
    actions.onApplyAgain(FIRST, "comment");
    actions.onDiscardConflict(FIRST, "comment");
    actions.onDiscardDraft(FIRST, "comment");
    expect(calls).toEqual([
      "retry text draft",
      "discard text draft",
      "discard text draft",
      "retry comment draft",
      "discard comment draft",
      "discard comment draft",
    ]);
  });

  it("end a conflict with no draft behind it through the write itself", () => {
    const { actions, calls } = verbs();
    actions.onApplyAgain(FIRST);
    actions.onDiscardConflict(FIRST);
    expect(calls).toEqual(["retry write", "discard conflict"]);
  });
});
