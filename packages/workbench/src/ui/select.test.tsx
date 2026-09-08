import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { WorkbenchSelect } from "./select";
import { WorkbenchThemeProvider } from "./theme";

afterEach(cleanup);

it("keeps the native dropdown skin when a condition supplies its slot class", () => {
  render(
    <WorkbenchThemeProvider
      theme={{ classes: { select: { select: "dropdown" } } }}
    >
      <WorkbenchSelect aria-label="Value" className="condition-value">
        <option value="book">Book</option>
      </WorkbenchSelect>
    </WorkbenchThemeProvider>,
  );
  expect(screen.getByRole("combobox").classList.contains("dropdown")).toBe(
    true,
  );
  expect(
    screen.getByRole("combobox").classList.contains("condition-value"),
  ).toBe(true);
});
