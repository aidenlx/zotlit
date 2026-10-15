import { cleanup, fireEvent, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { WorkbenchHostProvider } from "./host";
import { MatchEditor, MatchExpressionInput } from "./match";
import type { MatchConditionKind, MatchFilter, MatchVocabulary } from "./match";
import { fakeHost, renderWithMessages as render } from "./test-host";
import { m } from "./test-messages";
import { WorkbenchThemeProvider } from "./theme";

afterEach(cleanup);

// happy-dom has no `ondragstart`-style properties, which Preact reads to pick
// the lowercase event name a browser dispatches.
for (const type of ["dragstart", "dragend", "dragover", "dragleave", "drop"])
  if (!(`on${type}` in HTMLElement.prototype))
    Object.defineProperty(HTMLElement.prototype, `on${type}`, {
      value: null,
      writable: true,
      configurable: true,
    });

type TitleRow = { kind: "title"; operator: "contains" | "is"; value: string };
type PagesRow = { kind: "pages"; operator: ">" | "=="; value: string };
type Row = TitleRow | PagesRow;

function operatorSelect<R extends Row>(
  options: readonly R["operator"][],
): MatchConditionKind<Row>["renderOperator"] {
  return ({ condition, onChange }) => (
    <select
      aria-label="Comparison"
      value={condition.operator}
      onInput={(event) =>
        onChange({
          ...condition,
          operator: event.currentTarget.value,
        } as Row)
      }
    >
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}

function valueInput(
  type: "text" | "number",
): MatchConditionKind<Row>["renderValue"] {
  return ({ condition, onChange }) => (
    <input
      type={type}
      aria-label="Field value"
      value={condition.value}
      onInput={(event) =>
        onChange({ ...condition, value: event.currentTarget.value })
      }
    />
  );
}

/** A Title text field and a Pages number field, with their labels as data. */
const vocabulary: MatchVocabulary<Row> = {
  newKind: "pages",
  kinds: [
    {
      kind: "title",
      label: "Title",
      fresh: () => ({ kind: "title", operator: "contains", value: "" }),
      parse: (text) => {
        if (text.startsWith("title.contains(") && text.endsWith(")"))
          return {
            kind: "title",
            operator: "contains",
            value: JSON.parse(text.slice(15, -1)) as string,
          };
        return text.startsWith("title == ")
          ? {
              kind: "title",
              operator: "is",
              value: JSON.parse(text.slice(9)) as string,
            }
          : null;
      },
      format: (row) =>
        row.operator === "is"
          ? `title == ${JSON.stringify(row.value)}`
          : `title.contains(${JSON.stringify(row.value)})`,
      renderOperator: operatorSelect<TitleRow>(["contains", "is"]),
      renderValue: valueInput("text"),
    },
    {
      kind: "pages",
      label: "Pages",
      fresh: () => ({ kind: "pages", operator: ">", value: "0" }),
      parse: (text) => {
        const [field, operator, value, ...rest] = text.split(" ");
        return field === "pages" &&
          (operator === ">" || operator === "==") &&
          value !== undefined &&
          rest.length === 0
          ? { kind: "pages", operator, value }
          : null;
      },
      format: (row) => `pages ${row.operator} ${row.value}`,
      renderOperator: operatorSelect<PagesRow>([">", "=="]),
      renderValue: valueInput("number"),
    },
  ],
};

function Editor({
  initial,
  onChange,
}: {
  initial: MatchFilter | undefined;
  onChange: (next: MatchFilter | undefined) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <WorkbenchHostProvider host={fakeHost()}>
      <MatchEditor
        value={value}
        vocabulary={vocabulary}
        onChange={(next) => {
          onChange(next);
          setValue(next);
          return true;
        }}
      />
    </WorkbenchHostProvider>
  );
}

it("edits a condition through a caller's text and number fields into a Filter Expression", () => {
  const onChange = vi.fn<(next: MatchFilter | undefined) => void>();
  render(
    <Editor
      initial={{ and: ['title.contains("Rome")'] }}
      onChange={onChange}
    />,
  );
  expect(screen.getByLabelText<HTMLInputElement>("Field value").value).toBe(
    "Rome",
  );
  const kind = screen.getByLabelText<HTMLSelectElement>(
    m.workbench_match_condition_kind(),
  );
  expect([...kind.options].map((option) => option.textContent)).toEqual([
    "Title",
    "Pages",
  ]);
  fireEvent.input(kind, { target: { value: "pages" } });
  expect(onChange).toHaveBeenLastCalledWith({ and: ["pages > 0"] });
  fireEvent.input(screen.getByLabelText("Comparison"), {
    target: { value: "==" },
  });
  fireEvent.input(screen.getByLabelText("Field value"), {
    target: { value: "12" },
  });
  expect(onChange).toHaveBeenLastCalledWith({ and: ["pages == 12"] });
  fireEvent.click(
    screen.getByRole("button", { name: m.workbench_match_add_condition() }),
  );
  expect(onChange).toHaveBeenLastCalledWith({
    and: ["pages == 12", "pages > 0"],
  });
});

it("shows an empty filter as only its add actions", () => {
  const onChange = vi.fn<(next: MatchFilter | undefined) => void>();
  render(<Editor initial={undefined} onChange={onChange} />);
  expect(document.querySelectorAll("[data-condition-row]")).toHaveLength(0);
  expect(screen.queryByText(m.workbench_match_remove())).toBeNull();
  fireEvent.click(screen.getByText(m.workbench_match_add_condition()));
  expect(document.querySelectorAll("[data-condition-row]")).toHaveLength(1);
  expect(onChange).toHaveBeenLastCalledWith({ and: ["pages > 0"] });
});

it("opens a None of the following group as one expression condition", () => {
  const onChange = vi.fn<(next: MatchFilter | undefined) => void>();
  render(
    <Editor
      initial={{
        and: [
          "pages > 3",
          {
            not: ['title.contains("Rome")', { and: ["pages == 1", "a || b"] }],
          },
        ],
      }}
      onChange={onChange}
    />,
  );
  const negated = '!((title.contains("Rome")) || ((pages == 1) && (a || b)))';
  expect(document.querySelectorAll("[data-condition-row]")).toHaveLength(2);
  expect(
    screen.getByLabelText<HTMLTextAreaElement>(m.workbench_match_expression())
      .value,
  ).toBe(negated);
  fireEvent.input(screen.getByLabelText("Field value"), {
    target: { value: "5" },
  });
  expect(onChange).toHaveBeenLastCalledWith({ and: ["pages > 5", negated] });
});

it("draws the expression input with the match theme of the provider it renders in", () => {
  render(
    <WorkbenchThemeProvider
      theme={{ classes: { match: { expression: "match-expression" } } }}
    >
      <MatchExpressionInput aria-label="Formula" defaultValue="date.year" />
    </WorkbenchThemeProvider>,
  );
  const input = screen.getByRole("textbox", { name: "Formula" });
  expect(input.classList.contains("match-expression")).toBe(true);
  expect(input.getAttribute("data-part")).toBe("expression");
});

/** What a browser hands a drag: enough for the editor to start and place one. */
function dataTransfer() {
  return {
    setData: vi.fn(),
    setDragImage: vi.fn(),
    effectAllowed: "",
    dropEffect: "",
  };
}

const handles = () =>
  screen.getAllByRole("button", { name: m.workbench_match_drag_to_reorder() });

const rowOf = (element: Element) => element.closest("[data-part=row]")!;

/** Drag `handle` over `target`, in its upper half or its lower half, and drop. */
function drag(handle: Element, target: Element, half: "upper" | "lower") {
  const transfer = dataTransfer();
  fireEvent.dragStart(handle, { dataTransfer: transfer });
  // happy-dom lays nothing out, so every row is a zero-height box at the
  // top, and its DragEvent drops `clientY`: a MouseEvent carries it instead.
  const over = new MouseEvent("dragover", {
    bubbles: true,
    cancelable: true,
    clientY: half === "upper" ? 0 : 1,
  });
  Object.defineProperty(over, "dataTransfer", { value: transfer });
  fireEvent(target, over);
  fireEvent.drop(target, { dataTransfer: transfer });
  fireEvent.dragEnd(handle, { dataTransfer: transfer });
}

it("drags a condition by its handle before or after another condition", () => {
  const onChange = vi.fn<(next: MatchFilter | undefined) => void>();
  render(
    <Editor
      initial={{ and: ["pages > 1", "pages > 2", "pages > 3"] }}
      onChange={onChange}
    />,
  );
  drag(handles()[0]!, rowOf(handles()[2]!), "lower");
  expect(onChange).toHaveBeenLastCalledWith({
    and: ["pages > 2", "pages > 3", "pages > 1"],
  });
  drag(handles()[2]!, rowOf(handles()[0]!), "upper");
  expect(onChange).toHaveBeenLastCalledWith({
    and: ["pages > 1", "pages > 2", "pages > 3"],
  });
});

it("drags a condition into a nested group, and a nested condition out to its parent", () => {
  const onChange = vi.fn<(next: MatchFilter | undefined) => void>();
  render(
    <Editor
      initial={{ and: ["pages > 1", { or: ["pages > 2"] }] }}
      onChange={onChange}
    />,
  );
  const nested = () =>
    document.querySelector("[data-part=group][data-state=nested]")!;
  drag(handles()[0]!, nested(), "lower");
  expect(onChange).toHaveBeenLastCalledWith({
    and: [{ or: ["pages > 2", "pages > 1"] }],
  });
  // Handles in document order: the group, then its two conditions.
  drag(handles()[2]!, rowOf(handles()[0]!), "upper");
  expect(onChange).toHaveBeenLastCalledWith({
    and: ["pages > 1", { or: ["pages > 2"] }],
  });
});

it("drops a condition into a group the drags emptied", () => {
  const onChange = vi.fn<(next: MatchFilter | undefined) => void>();
  render(
    <Editor
      initial={{ and: ["pages > 1", { or: ["pages > 2"] }] }}
      onChange={onChange}
    />,
  );
  drag(handles()[2]!, rowOf(handles()[0]!), "upper");
  expect(onChange).toHaveBeenLastCalledWith({
    and: ["pages > 2", "pages > 1", { or: [] }],
  });
  drag(
    handles()[0]!,
    document.querySelector("[data-part=group][data-state=nested]")!,
    "lower",
  );
  expect(onChange).toHaveBeenLastCalledWith({
    and: ["pages > 1", { or: ["pages > 2"] }],
  });
});

it("leaves the filter unchanged when a group is dropped into itself", () => {
  const onChange = vi.fn<(next: MatchFilter | undefined) => void>();
  render(
    <Editor
      initial={{ and: ["pages > 1", { or: ["pages > 2", "pages > 3"] }] }}
      onChange={onChange}
    />,
  );
  drag(handles()[1]!, rowOf(handles()[3]!), "lower");
  expect(onChange).not.toHaveBeenCalled();
});

it("moves a condition one place with Alt+ArrowDown and Alt+ArrowUp on its handle", () => {
  const onChange = vi.fn<(next: MatchFilter | undefined) => void>();
  render(
    <Editor
      initial={{ and: ["pages > 1", "pages > 2"] }}
      onChange={onChange}
    />,
  );
  fireEvent.keyDown(handles()[0]!, { key: "ArrowDown", altKey: true });
  expect(onChange).toHaveBeenLastCalledWith({
    and: ["pages > 2", "pages > 1"],
  });
  fireEvent.keyDown(handles()[1]!, { key: "ArrowUp", altKey: true });
  expect(onChange).toHaveBeenLastCalledWith({
    and: ["pages > 1", "pages > 2"],
  });
  // The first row has no place above it.
  fireEvent.keyDown(handles()[0]!, { key: "ArrowUp", altKey: true });
  expect(onChange).toHaveBeenCalledTimes(2);
});

it("offers no drag or keyboard move in a disabled editor", () => {
  const onChange = vi.fn<(next: MatchFilter | undefined) => boolean>(
    () => true,
  );
  render(
    <WorkbenchHostProvider host={fakeHost()}>
      <MatchEditor
        value={{ and: ["pages > 1", "pages > 2"] }}
        vocabulary={vocabulary}
        onChange={onChange}
        disabled
      />
    </WorkbenchHostProvider>,
  );
  expect(handles()[0]!.getAttribute("draggable")).not.toBe("true");
  fireEvent.keyDown(handles()[0]!, { key: "ArrowDown", altKey: true });
  drag(handles()[0]!, rowOf(handles()[1]!), "lower");
  expect(onChange).not.toHaveBeenCalled();
});
