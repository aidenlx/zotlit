import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { useState } from "react";
import type { ComponentProps } from "react";
import { afterEach, expect, it } from "vitest";

import { TagsInput } from "./tags-input";

afterEach(cleanup);

function Tags({
  initial = [],
  commitKeys,
  onKeyDown,
  onBlur,
}: {
  initial?: string[];
  commitKeys?: readonly string[];
} & Pick<ComponentProps<typeof TagsInput.Input>, "onKeyDown" | "onBlur">) {
  const [names, setNames] = useState(initial);
  return (
    <>
      <TagsInput.Root
        value={names}
        onValueChange={setNames}
        commitKeys={commitKeys}
        className="root"
      >
        {names.map((name, index) => (
          <TagsInput.Item
            key={index}
            value={name}
            index={index}
            className="item"
          >
            <TagsInput.ItemText className="text" />
            <TagsInput.ItemRemove
              className="remove"
              aria-label={`Remove ${name} ${index}`}
            />
          </TagsInput.Item>
        ))}
        <TagsInput.Input
          className="input"
          aria-label="Tag"
          onKeyDown={onKeyDown}
          onBlur={onBlur}
        />
      </TagsInput.Root>
      <output>{JSON.stringify(names)}</output>
    </>
  );
}

const input = () => screen.getByLabelText<HTMLInputElement>("Tag");
const names = () => JSON.parse(screen.getByRole("status").textContent!);

function type(text: string, key?: string) {
  fireEvent.input(input(), { target: { value: text } });
  if (key) fireEvent.keyDown(input(), { key });
}

it("adds the trimmed text on Enter and clears the input", () => {
  render(<Tags initial={["Read"]} />);
  type("  Methods ", "Enter");
  expect(names()).toEqual(["Read", "Methods"]);
  expect(input().value).toBe("");
});

it("keeps a comma as text unless it is a commit key", () => {
  render(<Tags />);
  type("Smith, J.", ",");
  expect(names()).toEqual([]);
  fireEvent.keyDown(input(), { key: "Enter" });
  expect(names()).toEqual(["Smith, J."]);
});

it("adds on a configured comma", () => {
  render(<Tags commitKeys={["Enter", ","]} />);
  type("Read", ",");
  type("Later", "Enter");
  expect(names()).toEqual(["Read", "Later"]);
});

it("ignores an exact duplicate and keeps names that differ only in case", () => {
  render(<Tags initial={["Read"]} />);
  type("Read", "Enter");
  expect(names()).toEqual(["Read"]);
  expect(input().value).toBe("");
  type("read", "Enter");
  expect(names()).toEqual(["Read", "read"]);
});

it("removes the last value on Backspace in an empty input only", () => {
  render(<Tags initial={["Read", "Later"]} />);
  type("x", "Backspace");
  expect(names()).toEqual(["Read", "Later"]);
  type("", "Backspace");
  expect(names()).toEqual(["Read"]);
});

it("adds pending text on blur", () => {
  render(<Tags initial={["Read"]} />);
  act(() => input().focus());
  type("Later");
  act(() => input().blur());
  expect(names()).toEqual(["Read", "Later"]);
});

it("removes only its own chip when names repeat", () => {
  render(<Tags initial={["Read", "Later", "Read"]} />);
  fireEvent.click(screen.getByRole("button", { name: "Remove Read 2" }));
  expect(names()).toEqual(["Read", "Later"]);
});

it("cancels the pointer press on a remove button, so the input keeps focus", () => {
  render(<Tags initial={["Read", "Later"]} />);
  const later = screen.getByRole("button", { name: "Remove Later 1" });
  expect(fireEvent.mouseDown(later)).toBe(false);
  fireEvent.click(later);
  expect(names()).toEqual(["Read"]);
});

it("skips its key and blur rules when a consumer handler prevents the default", () => {
  render(
    <Tags
      initial={["Read"]}
      onKeyDown={(event) => event.preventDefault()}
      onBlur={(event) => event.preventDefault()}
    />,
  );
  act(() => input().focus());
  type("Later", "Enter");
  type("", "Backspace");
  type("Later");
  // Both runtimes hear focusout, which is not cancelable, as in a browser.
  fireEvent.focusOut(input());
  expect(names()).toEqual(["Read"]);
  expect(input().value).toBe("Later");
});

it("marks each part with its data-slot and passes its className", () => {
  const { container } = render(<Tags initial={["Read"]} />);
  const slots = Object.fromEntries(
    [...container.querySelectorAll("[data-slot]")].map((element) => [
      element.getAttribute("data-slot"),
      element.className,
    ]),
  );
  expect(slots).toEqual({
    "tags-input": "root",
    "tags-input-item": "item",
    "tags-input-item-text": "text",
    "tags-input-item-remove": "remove",
    "tags-input-input": "input",
  });
});
