// @vitest-environment happy-dom
import { expect, it } from "vitest";

import { nativeCompletion } from "./native-completion";

it("writes a code span of a row's description as code", () => {
  const presentation = nativeCompletion(() => ({
    note: "Whether the value has the named value type; `any` names every type.",
  }));
  const note = presentation.addToOptions!.find(
    ({ position }) => position === 70,
  )!;
  const cell = note.render(
    { label: "isType" },
    // The state and the view: the cell reads neither.
    ...([undefined, undefined] as unknown as [never, never]),
  ) as HTMLElement;
  expect(cell.className).toBe("suggestion-note");
  expect(cell.textContent).toBe(
    "Whether the value has the named value type; any names every type.",
  );
  expect([...cell.querySelectorAll("code")].map((n) => n.textContent)).toEqual([
    "any",
  ]);
});
