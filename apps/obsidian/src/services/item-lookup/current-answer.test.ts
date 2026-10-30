// @vitest-environment happy-dom
// Regression tests for #1665: the editor suggesters chose a row of an earlier
// query's answer while the typed query's answer was pending. The Item pickers'
// cases (#1650) run through `ItemSearchModal` in `search-modal.test.ts`.
import { describe, expect, it, vi } from "vitest";

import { CurrentAnswer } from "./current-answer";

const enter = { type: "keydown", key: "Enter" } as KeyboardEvent;
const click = { type: "click", button: 0 } as MouseEvent;

function setup() {
  const rowsEl = document.createElement("div");
  const answer = new CurrentAnswer<string>(rowsEl);
  const chosen: string[] = [];
  const select = (row: string) => void chosen.push(row);
  return { rowsEl, answer, chosen, select };
}

describe("CurrentAnswer", () => {
  it("marks the rows busy while the typed query's answer is pending", async () => {
    const { rowsEl, answer } = setup();
    const typed = Promise.withResolvers<string[]>();

    const shown = answer.track(typed.promise);
    expect(rowsEl.getAttribute("aria-busy")).toBe("true");

    typed.resolve(["RUGIER24"]);
    await shown;
    expect(rowsEl.hasAttribute("aria-busy")).toBe(false);
  });

  it("chooses from an answer given at once after the one Enter waited for", async () => {
    const { answer, chosen, select } = setup();
    const ten = Promise.withResolvers<string[]>();
    const older = answer.track(ten.promise);

    answer.choose("DMRGRART", enter, select);
    // The input was cleared: its answer, the fixed choices, comes at once.
    void answer.track(["Personal", "RUGIER24"]);
    ten.resolve(["DMRGRART", "RUGIER24"]);
    await older;

    await vi.waitFor(() => expect(chosen).toEqual(["Personal"]));
  });

  it("chooses nothing for an Enter from before a close, and chooses again after it", async () => {
    const { answer, chosen, select } = setup();
    const before = Promise.withResolvers<string[]>();
    void answer.track(before.promise);
    answer.choose("DMRGRART", enter, select);

    answer.close();
    const after = Promise.withResolvers<string[]>();
    const shown = answer.track(after.promise);
    before.resolve(["DMRGRART"]);
    after.resolve(["RUGIER24"]);
    await shown;
    answer.choose("RUGIER24", click, select);

    expect(chosen).toEqual(["RUGIER24"]);
  });
});
