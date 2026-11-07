import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { ItemRow } from "./item-row";

afterEach(cleanup);

it("names the item beside the control that changes it", () => {
  const { container } = render(
    <ItemRow label="Example: Thinking, fast and slow">
      <button type="button">Choose item</button>
    </ItemRow>,
  );
  const row = container.firstElementChild!;
  expect(row.textContent).toBe("Example: Thinking, fast and slowChoose item");
  expect(
    screen.getByRole("button", { name: "Choose item" }).parentElement,
  ).toBe(row);
});

it("holds the control alone before an item is chosen", () => {
  const { container } = render(
    <ItemRow label={null}>
      <button type="button">Choose item</button>
    </ItemRow>,
  );
  expect(container.querySelectorAll("p")).toHaveLength(0);
  expect(container.firstElementChild!.textContent).toBe("Choose item");
});
