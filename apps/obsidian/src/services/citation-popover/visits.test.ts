// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";

vi.mock("./popover", () => ({
  CitationHoverPopover: class {
    readonly render = vi.fn(() => true);
    readonly retarget = vi.fn();
    readonly #cleanup: (() => void)[] = [];
    readonly hide = (): void => {
      for (const cleanup of this.#cleanup.splice(0).reverse()) cleanup();
    };

    register(cleanup: () => void): void {
      this.#cleanup.push(cleanup);
    }
  },
}));

import { HoverVisits } from "./visits";

describe("HoverVisits", () => {
  it("keeps the first target's visit apart from the target it moves to", () => {
    let made = 0;
    const visits = new HoverVisits(() => ({ target: ++made }));
    const parent = { hoverPopover: null };

    const first = visits.open(parent, document.createElement("span"));
    const firstSubscriptions = first.subscriptions;
    const second = visits.open(parent, document.createElement("span"));

    expect(second.popover).toBe(first.popover);
    expect(first.state).toEqual({ target: 1 });
    expect(second.state).toEqual({ target: 2 });
    expect(first.subscriptions).toBe(firstSubscriptions);
    expect(first.subscriptions.disposed).toBe(true);
    expect(second.subscriptions.disposed).toBe(false);
  });

  it("keeps a moved visit apart from the next move", () => {
    let made = 0;
    const visits = new HoverVisits(() => ({ target: ++made }));
    const parent = { hoverPopover: null };

    visits.open(parent, document.createElement("span"));
    const second = visits.open(parent, document.createElement("span"));
    visits.open(parent, document.createElement("span"));

    expect(second.state).toEqual({ target: 2 });
    expect(second.subscriptions.disposed).toBe(true);
  });
});
