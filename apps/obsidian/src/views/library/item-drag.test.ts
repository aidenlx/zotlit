// @vitest-environment happy-dom
// A Library View row dragged into a note inserts the Item's citation where it
// lands; dropped back on the view, it is refused.
import type { App } from "obsidian";
import type { DragEvent as ReactDragEvent } from "react";
import { expect, it, vi } from "vitest";

import { createNanoEvents } from "@zotlit/shared/nanoevents";

import { stubService } from "@/lib/__fixtures__/service-stub";

import { createItemDrag, ITEM_DRAG_TYPE, refuseItemDrop } from "./item-drag";

/** A drag's data, as the browser keeps it across one drag. */
function transfer() {
  const data = new Map<string, string>();
  return {
    effectAllowed: "uninitialized",
    dropEffect: "none",
    get types() {
      return [...data.keys()];
    },
    setData: (type: string, value: string) => void data.set(type, value),
    getData: (type: string) => data.get(type) ?? "",
  };
}

function setup() {
  const events = createNanoEvents<{
    "editor-drop": (event: unknown, editor: unknown, info: unknown) => void;
  }>();
  const workspace = stubService<App["workspace"]>("Workspace", {
    on: (name: string, callback: (...args: never[]) => unknown) => {
      const off = events.on("editor-drop", (...args) =>
        callback(...(args as unknown as never[])),
      );
      return { off };
    },
    offref: (ref: { off: () => void }) => ref.off(),
  });
  const insertCitation = vi.fn(() => Promise.resolve());
  const drag = createItemDrag({
    app: stubService<App>("App", { workspace }),
    actions: { insertCitation },
  });
  const row = document.createElement("div");
  document.body.append(row);
  const start = (key: string) => {
    const dataTransfer = transfer();
    drag(key, {
      dataTransfer,
      currentTarget: row,
    } as unknown as ReactDragEvent<HTMLElement>);
    return dataTransfer;
  };
  const drop = (dataTransfer: ReturnType<typeof transfer>) => {
    const editor = { cm: { posAtCoords: () => 42 } };
    const info = { file: { path: "Reading.md" } };
    const event = {
      dataTransfer,
      clientX: 1,
      clientY: 2,
      preventDefault: vi.fn(),
    };
    events.emit("editor-drop", event, editor, info);
    return { event, editor, info };
  };
  return { start, drop, insertCitation, row };
}

it("inserts the citation of the dragged Item where it lands in the note", () => {
  const { start, drop, insertCitation } = setup();
  const data = start("ABCD2345g4815");
  // Outside a note the drag carries the Item's Zotero link.
  expect(data.getData("text/plain")).toBe(
    "zotero://select/groups/4815/items/ABCD2345",
  );
  const { event, editor, info } = drop(data);
  expect(event.preventDefault).toHaveBeenCalled();
  expect(insertCitation).toHaveBeenCalledExactlyOnceWith("ABCD2345g4815", {
    editor,
    info,
    at: 42,
  });
});

it("leaves a drop of another drag to the editor", () => {
  const { start, drop, insertCitation } = setup();
  start("ABCD2345");
  const other = transfer();
  other.setData(ITEM_DRAG_TYPE, "another drag");
  const { event } = drop(other);
  expect(event.preventDefault).not.toHaveBeenCalled();
  expect(insertCitation).not.toHaveBeenCalled();
});

it("inserts nothing once the drag ended without a drop", () => {
  const { start, drop, insertCitation, row } = setup();
  const data = start("ABCD2345");
  row.win.dispatchEvent(new Event("dragend"));
  drop(data);
  expect(insertCitation).not.toHaveBeenCalled();
});

it("refuses an Item dropped on the view, and lets any other drag through", () => {
  const item = transfer();
  item.setData(ITEM_DRAG_TYPE, "a drag");
  const over = { dataTransfer: item, preventDefault: vi.fn() };
  refuseItemDrop(over as unknown as globalThis.DragEvent);
  expect(item.dropEffect).toBe("none");

  const file = transfer();
  file.dropEffect = "copy";
  file.setData("Files", "");
  refuseItemDrop({
    dataTransfer: file,
    preventDefault: vi.fn(),
  } as unknown as globalThis.DragEvent);
  expect(file.dropEffect).toBe("copy");
});
