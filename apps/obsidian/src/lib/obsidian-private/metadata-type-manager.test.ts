import type { App } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { assignedWidget, onTypesChanged } from "./metadata-type-manager";

const warn = vi.hoisted(() => vi.fn());
vi.mock("@/lib/log", () => ({
  getLogger: () => ({ trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn }),
}));

beforeEach(() => warn.mockClear());

/** A type manager as Obsidian 1.14.4 keeps it, with `types.json` as given. */
function manager(types: Record<string, string>) {
  const listeners = new Set<(name: string) => void>();
  const ref = {};
  return {
    getAssignedWidget: (name: string) => {
      const found = Object.entries(types).find(
        ([key]) => key.toLowerCase() === name.toLowerCase(),
      );
      return found ? found[1] : null;
    },
    on: vi.fn((_event: "changed", cb: (name: string) => void) => {
      listeners.add(cb);
      return Object.assign(ref, { cb });
    }),
    offref: vi.fn((eventRef: { cb?: (name: string) => void }) => {
      if (eventRef.cb) listeners.delete(eventRef.cb);
    }),
    /** Assign a type, as `setType` does. */
    setType(name: string, widget: string) {
      types[name] = widget;
      for (const cb of listeners) cb(name.toLowerCase());
    },
  };
}

describe("assignedWidget", () => {
  it("reads the type assigned to a property, whatever its case", () => {
    const app = {
      metadataTypeManager: manager({ Pages: "number" }),
    } as unknown as App;

    expect(assignedWidget(app, "pages")).toBe("number");
    expect(assignedWidget(app, "status")).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it("reads no type, and warns once, when the app has no type manager", () => {
    const app = {} as App;

    expect(assignedWidget(app, "pages")).toBeNull();
    expect(assignedWidget(app, "status")).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
  });

  it("reads no type when the manager lost its read", () => {
    const { on, offref } = manager({});
    const app = { metadataTypeManager: { on, offref } } as unknown as App;

    expect(assignedWidget(app, "pages")).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe("onTypesChanged", () => {
  it("runs the callback on each change of an assigned type, until the returned callback stops it", () => {
    const types = manager({});
    const app = { metadataTypeManager: types } as unknown as App;
    const listener = vi.fn();

    const off = onTypesChanged(app, listener);
    types.setType("pages", "number");
    off();
    types.setType("pages", "text");

    expect(listener).toHaveBeenCalledOnce();
    expect(types.offref).toHaveBeenCalledOnce();
  });

  it("does nothing when the app has no type manager", () => {
    const off = onTypesChanged({} as App, vi.fn());

    expect(() => off()).not.toThrow();
  });
});
