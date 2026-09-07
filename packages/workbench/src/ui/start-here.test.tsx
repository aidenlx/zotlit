import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { StartHere } from "./start-here";
import { mount } from "./test-host";

afterEach(cleanup);

it("explains the three surfaces and keeps dismissal across editor instances", () => {
  const first = mount(<StartHere />);
  const rendered = render(first.ui);
  expect(
    screen
      .getByRole("complementary", { name: "Start here" })
      .querySelectorAll("p"),
  ).toHaveLength(3);
  fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  expect(screen.queryByRole("complementary")).toBeNull();
  expect(first.host.preferences.get("device:start-here-dismissed")).toBe(
    "true",
  );
  rendered.unmount();
  const second = mount(<StartHere />);
  for (const [key, value] of first.host.preferences)
    second.host.preferences.set(key, value);
  render(second.ui);
  expect(screen.queryByRole("complementary")).toBeNull();
});
