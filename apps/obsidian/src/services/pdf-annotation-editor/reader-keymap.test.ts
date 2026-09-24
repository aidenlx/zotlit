// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";

import type { AnnotationRecord } from "@/services/annotation-repository/service";

import {
  annotation,
  annotationEdits,
  pageView,
  readerSurfaces,
} from "./__fixtures__";
import { historyVerbOf } from "./reader-keymap";
import type { OverlayPageView } from "./render";

const MARK: AnnotationRecord = annotation("PARA1111", "highlight", {
  pageIndex: 0,
  rects: [[100, 600, 500, 640]],
});

/** The reader surfaces of one PDF view on one platform. */
function setup(isMacOS: boolean) {
  const containerEl = document.body.appendChild(document.createElement("div"));
  const page = pageView();
  containerEl.append(page.div);
  const reader = readerSurfaces({
    containerEl,
    page: page as unknown as OverlayPageView,
    records: [MARK],
    annotations: { ...annotationEdits(), createAnnotation: vi.fn() },
    isMacOS,
  });
  return {
    ...reader,
    containerEl,
    [Symbol.dispose]() {
      reader[Symbol.dispose]();
      containerEl.remove();
    },
  };
}

/** Every chord the two platforms are asked about, by the name a reader reads. */
const CHORDS: Readonly<Record<string, KeyboardEventInit>> = {
  "Ctrl+Z": { key: "z", ctrlKey: true },
  "Ctrl+Shift+Z": { key: "z", ctrlKey: true, shiftKey: true },
  "Ctrl+Y": { key: "y", ctrlKey: true },
  "Command+Z": { key: "z", metaKey: true },
  "Command+Shift+Z": { key: "z", metaKey: true, shiftKey: true },
  "Command+Y": { key: "y", metaKey: true },
  "Alt+Command+Z": { key: "z", metaKey: true, altKey: true },
  "Alt+Ctrl+Z": { key: "z", ctrlKey: true, altKey: true },
  Z: { key: "z" },
  Y: { key: "y" },
};

function decisions(isMacOS: boolean): Record<string, string> {
  return Object.fromEntries(
    Object.entries(CHORDS).map(([name, init]) => [
      name,
      historyVerbOf(
        {
          key: init.key!,
          ctrlKey: init.ctrlKey ?? false,
          metaKey: init.metaKey ?? false,
          altKey: init.altKey ?? false,
          shiftKey: init.shiftKey ?? false,
        },
        isMacOS,
      ) ?? "pass",
    ]),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

it("reads Command+Z and Command+Shift+Z as the history keys on macOS", () => {
  expect(decisions(true)).toEqual({
    "Command+Z": "undo",
    "Command+Shift+Z": "redo",
    // Mod+Y is not a macOS redo, and Ctrl is not the platform key there.
    "Command+Y": "pass",
    "Ctrl+Z": "pass",
    "Ctrl+Shift+Z": "pass",
    "Ctrl+Y": "pass",
    "Alt+Command+Z": "pass",
    "Alt+Ctrl+Z": "pass",
    Z: "pass",
    Y: "pass",
  });
});

it("reads Ctrl+Z, Ctrl+Shift+Z and Ctrl+Y as the history keys elsewhere", () => {
  expect(decisions(false)).toEqual({
    "Ctrl+Z": "undo",
    "Ctrl+Shift+Z": "redo",
    "Ctrl+Y": "redo",
    // The Command key is no platform key off macOS.
    "Command+Z": "pass",
    "Command+Shift+Z": "pass",
    "Command+Y": "pass",
    "Alt+Command+Z": "pass",
    "Alt+Ctrl+Z": "pass",
    Z: "pass",
    Y: "pass",
  });
});

it("runs the platform's own history keys and leaves the other platform's", () => {
  using mac = setup(true);
  mac.key({ key: "z", metaKey: true });
  mac.key({ key: "z", metaKey: true, shiftKey: true });
  mac.key({ key: "z", ctrlKey: true });
  mac.key({ key: "y", ctrlKey: true });
  expect(mac.stepped).toEqual(["undo", "redo"]);

  using pc = setup(false);
  pc.key({ key: "z", ctrlKey: true });
  pc.key({ key: "z", ctrlKey: true, shiftKey: true });
  pc.key({ key: "y", ctrlKey: true });
  pc.key({ key: "z", metaKey: true });
  expect(pc.stepped).toEqual(["undo", "redo", "redo"]);
});

it("takes the key that acted, and leaves the one it did not", () => {
  using h = setup(false);

  expect(h.key({ key: "z", ctrlKey: true }).defaultPrevented).toBe(true);
  expect(h.key({ key: "z", metaKey: true }).defaultPrevented).toBe(false);
});

it("steps once for a held key", () => {
  using h = setup(false);

  h.key({ key: "z", ctrlKey: true });
  h.key({ key: "z", ctrlKey: true, repeat: true });
  h.key({ key: "z", ctrlKey: true, repeat: true });

  expect(h.stepped).toEqual(["undo"]);
});

it("leaves the history keys to a text field they were typed into", () => {
  using h = setup(false);
  const textarea = h.containerEl.appendChild(
    document.createElement("textarea"),
  );

  h.key({ key: "z", ctrlKey: true }, textarea);
  h.key({ key: "y", ctrlKey: true }, textarea);

  expect(h.stepped).toEqual([]);
});
