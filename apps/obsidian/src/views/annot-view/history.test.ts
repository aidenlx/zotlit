// @vitest-environment happy-dom
import { Scope } from "obsidian";
import { afterEach, describe, expect, it } from "vitest";

import type { HistoryDirection } from "@/services/annotation-repository/service";
import { dispatchKey } from "@/services/pdf-annotation-editor/__fixtures__";

import { mountCardHistoryKeys, onAnnotationCard } from "./history";

/**
 * One Annotation View's Scope, with a card on screen: the card itself, a
 * control inside it, its comment editor, and a surface outside every card.
 *
 * A registration stands behind the view's own, where Obsidian's keymap
 * carries on to whatever else holds the chord — the app's own hotkeys, and the
 * command a researcher bound to it.
 */
function setup(isMacOS = false) {
  const scope = new Scope();
  const stepped: HistoryDirection[] = [];
  const keys = mountCardHistoryKeys(scope, (d) => stepped.push(d), {
    isMacOS,
  });
  const behind: string[] = [];
  scope.register(null, null, (event) => {
    behind.push(event.key);
  });
  const card = document.body.appendChild(document.createElement("div"));
  card.className = "zt-annot-card";
  card.tabIndex = -1;
  const control = card.appendChild(document.createElement("button"));
  const comment = card.appendChild(document.createElement("textarea"));
  const header = document.body.appendChild(document.createElement("div"));
  return {
    behind,
    card,
    comment,
    control,
    header,
    keys,
    stepped,
    /** One chord, as Obsidian's Scope delivers it to the view. */
    key(init: KeyboardEventInit, target: EventTarget = card) {
      return dispatchKey(scope, init, target);
    },
    [Symbol.dispose]() {
      keys[Symbol.dispose]();
      card.remove();
      header.remove();
    },
  };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("onAnnotationCard", () => {
  it("reads the card and everything it holds as the card", () => {
    using h = setup();

    expect([
      onAnnotationCard(h.card),
      onAnnotationCard(h.control),
      onAnnotationCard(h.comment),
    ]).toEqual([true, true, true]);
  });

  it("reads the rest of the view, and nothing at all, as no card", () => {
    using h = setup();

    expect([onAnnotationCard(h.header), onAnnotationCard(null)]).toEqual([
      false,
      false,
    ]);
  });
});

describe("the Annotation History keys on a card", () => {
  it("steps the history for this platform's own chords", () => {
    using pc = setup(false);
    pc.key({ key: "z", ctrlKey: true });
    pc.key({ key: "z", ctrlKey: true, shiftKey: true });
    pc.key({ key: "y", ctrlKey: true });
    pc.key({ key: "z", metaKey: true });
    expect(pc.stepped).toEqual(["undo", "redo", "redo"]);

    using mac = setup(true);
    mac.key({ key: "z", metaKey: true });
    mac.key({ key: "z", metaKey: true, shiftKey: true });
    mac.key({ key: "z", ctrlKey: true });
    expect(mac.stepped).toEqual(["undo", "redo"]);
  });

  it("takes the key that acted, and leaves the one it did not", () => {
    using h = setup();

    expect(h.key({ key: "z", ctrlKey: true }).defaultPrevented).toBe(true);
    expect(h.key({ key: "z", metaKey: true }).defaultPrevented).toBe(false);
  });

  it("steps once for a held key", () => {
    using h = setup();

    h.key({ key: "z", ctrlKey: true });
    h.key({ key: "z", ctrlKey: true, repeat: true });
    h.key({ key: "z", ctrlKey: true, repeat: true });

    expect(h.stepped).toEqual(["undo"]);
  });

  it("leaves the key to a card's comment editor", () => {
    using h = setup();

    const event = h.key({ key: "z", ctrlKey: true }, h.comment);

    expect([h.stepped, h.behind, event.defaultPrevented]).toEqual([
      [],
      ["z"],
      false,
    ]);
  });

  it("leaves the key to the view around the cards", () => {
    using h = setup();

    const event = h.key({ key: "z", ctrlKey: true }, h.header);

    // The chord reaches what stands behind the view, so a command bound to it
    // still runs while the Annotation View is the active leaf.
    expect([h.stepped, h.behind, event.defaultPrevented]).toEqual([
      [],
      ["z"],
      false,
    ]);
  });

  it("takes the chord from everything behind the view when a card steps", () => {
    using h = setup();

    h.key({ key: "z", ctrlKey: true });

    expect([h.stepped, h.behind]).toEqual([["undo"], []]);
  });

  it("gives the chords back when the view closes", () => {
    using h = setup();
    h.keys[Symbol.dispose]();

    expect(h.key({ key: "z", ctrlKey: true }).defaultPrevented).toBe(false);
    expect(h.stepped).toEqual([]);
  });
});
