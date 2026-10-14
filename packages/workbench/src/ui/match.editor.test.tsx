import { cleanup, fireEvent, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { WorkbenchHostProvider } from "./host";
import { MatchEditor } from "./match";
import type { MatchConditionKind, MatchFilter, MatchVocabulary } from "./match";
import { fakeHost, renderWithMessages as render } from "./test-host";
import { m } from "./test-messages";

afterEach(cleanup);

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
  starterKind: "title",
  newKind: "pages",
  kinds: [
    {
      kind: "title",
      label: "Title",
      fresh: () => ({ kind: "title", operator: "contains", value: "" }),
      parse: (text) => {
        const contains = /^title\.contains\((".*")\)$/.exec(text);
        if (contains)
          return {
            kind: "title",
            operator: "contains",
            value: JSON.parse(contains[1]!) as string,
          };
        const is = /^title == (".*")$/.exec(text);
        return is
          ? {
              kind: "title",
              operator: "is",
              value: JSON.parse(is[1]!) as string,
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
        const found = /^pages (>|==) (\d+)$/.exec(text);
        return found
          ? {
              kind: "pages",
              operator: found[1] as PagesRow["operator"],
              value: found[2]!,
            }
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
