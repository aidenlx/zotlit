import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { WorkbenchHostProvider } from "./host";
import type { WorkbenchInputSuggestionsRequest } from "./host";
import { MatchPane } from "./match";
import { TABS } from "./tabs";
import { fakeHost, renderWithMessages as render } from "./test-host";
import { m } from "./test-messages";

import { WorkbenchDocumentController } from "#/document/controller";
import { DEFAULT_PROFILE_SOURCE } from "#/render/default-profile";

const facts = {
  library: { type: "personal" as const },
  itemType: "book",
  tags: ["Read"],
  collections: [["Thesis", "Chapter 1"]],
};
afterEach(cleanup);
function open(match: string) {
  const source = DEFAULT_PROFILE_SOURCE.replace(
    "id: default",
    `id: Bk3Qn7XvT2Lp\n# Keep my comment\nmatch: ${match}`,
  );
  const controller = new WorkbenchDocumentController(source);
  const view = render(
    <WorkbenchHostProvider host={fakeHost()}>
      <MatchPane controller={controller} facts={facts} />
    </WorkbenchHostProvider>,
  );
  return { controller, source, ...view };
}

it("places Match between Name and Profile on both hosts", () => {
  expect(TABS).toEqual([
    "note",
    "properties",
    "annotation",
    "name",
    "match",
    "profile",
  ]);
});

it("keeps nested expression rows as written while a labelled row changes, and restores the source on undo", async () => {
  const { controller, source } = open(
    `{and: ['itemType == "book"', {or: ['tags.contains("Read") || tags.contains("Later")']}]}`,
  );
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toBe(
      m.workbench_match_result_yes(),
    ),
  );
  fireEvent.input(screen.getAllByLabelText(m.workbench_match_value())[0]!, {
    target: { value: "journalArticle" },
  });
  expect(controller.source).toContain("# Keep my comment");
  expect(controller.document?.manifest.match).toEqual({
    and: [
      'itemType == "journalArticle"',
      { or: ['tags.contains("Read") || tags.contains("Later")'] },
    ],
  });
  expect(screen.getByRole("status").textContent).toBe(
    m.workbench_match_result_no(),
  );
  act(() => {
    controller.undo();
  });
  expect(controller.source).toBe(source);
  expect(screen.getByRole("status").textContent).toBe(
    m.workbench_match_result_yes(),
  );
});

it("reports an unsupported expression and keeps it in source", async () => {
  const { controller } = open(`'tags.has("Read")'`);
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toContain("unevaluable"),
  );
  const expression = screen.getByLabelText<HTMLInputElement>(
    m.workbench_match_expression(),
  );
  fireEvent.input(expression, {
    target: { value: 'tags.contains("Read") || tags.contains("Later")' },
  });
  expect(controller.document?.manifest.match).toEqual({
    and: ['tags.contains("Read") || tags.contains("Later")'],
  });
  expect(screen.getByRole("status").textContent).toBe(
    m.workbench_match_result_yes(),
  );
});

it("commits free text chips from outside the host vocabulary", async () => {
  const { controller } = open(`'tags.containsAny("Read")'`);
  await waitFor(() =>
    expect(document.querySelector('option[value="methods"]')).not.toBeNull(),
  );
  const input = screen.getByLabelText<HTMLInputElement>(
    m.workbench_match_value(),
  );
  fireEvent.input(input, { target: { value: "Unlisted" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(controller.document?.manifest.match).toEqual({
    and: ['tags.containsAny("Read", "Unlisted")'],
  });
  fireEvent.click(
    screen.getByRole("button", { name: m.workbench_match_remove() }),
  );
  expect(controller.document?.manifest.match).toBeUndefined();
  act(() => {
    controller.undo();
  });
  expect(controller.document?.manifest.match).toEqual({
    and: ['tags.containsAny("Read", "Unlisted")'],
  });
});

it("refreshes suggestions when the snapshot revision changes through one stable host", async () => {
  const controller = new WorkbenchDocumentController(
    DEFAULT_PROFILE_SOURCE.replace(
      "id: default",
      "id: Bk3Qn7XvT2Lp\nmatch: 'tags.containsAny(\"Read\")'",
    ),
  );
  const host = fakeHost();
  let tags = ["First paper"];
  host.matchData.tags = async () => tags;
  const tree = (vocabularyRevision: string) => (
    <WorkbenchHostProvider host={host}>
      <MatchPane
        controller={controller}
        facts={facts}
        vocabularyRevision={vocabularyRevision}
      />
    </WorkbenchHostProvider>
  );
  const view = render(tree("first"));
  await waitFor(() =>
    expect(
      document.querySelector('option[value="First paper"]'),
    ).not.toBeNull(),
  );
  tags = ["Second paper"];
  view.rerender(tree("second"));
  await waitFor(() =>
    expect(
      document.querySelector('option[value="Second paper"]'),
    ).not.toBeNull(),
  );
  expect(document.querySelector('option[value="First paper"]')).toBeNull();
});

it("accepts native suggestions into text and array values and releases their popups on clear", async () => {
  const controller = new WorkbenchDocumentController(
    DEFAULT_PROFILE_SOURCE.replace("id: default", "id: Bk3Qn7XvT2Lp"),
  );
  controller.setMatch({
    and: ['collections.within("Thesis")', 'tags.containsAny("Read")'],
  });
  const requests: WorkbenchInputSuggestionsRequest[] = [];
  const close = vi.fn<() => void>();
  const host = {
    ...fakeHost(),
    inputSuggestions(request: WorkbenchInputSuggestionsRequest) {
      requests.push(request);
      return { close };
    },
  };
  host.matchData.tags = async () => ["Read", "Methods"];
  host.matchData.collections = async () => [["Thesis", "Chapter 1"]];
  render(
    <WorkbenchHostProvider host={host}>
      <MatchPane controller={controller} facts={facts} />
    </WorkbenchHostProvider>,
  );
  await waitFor(() =>
    expect(requests[1]?.getSuggestions("met")).toEqual([
      { id: "Methods", label: "Methods", hint: undefined },
    ]),
  );
  expect(document.querySelector("datalist")).toBeNull();
  expect(requests[0]!.getSuggestions("chapter")[0]?.id).toBe(
    "Thesis/Chapter 1",
  );
  act(() => {
    requests[0]!.onSelect("Thesis/Chapter 1");
  });
  act(() => {
    requests[1]!.onSelect("Methods");
  });
  expect(controller.document?.manifest.match).toEqual({
    and: [
      'collections.within("Thesis/Chapter 1")',
      'tags.containsAny("Read", "Methods")',
    ],
  });
  expect(requests).toHaveLength(2);
  expect(requests[1]!.input.value).toBe("");
  expect(requests[1]!.getSuggestions("")).toEqual([]);
  fireEvent.blur(requests[1]!.input);
  expect(controller.document?.manifest.match).toEqual({
    and: [
      'collections.within("Thesis/Chapter 1")',
      'tags.containsAny("Read", "Methods")',
    ],
  });
  fireEvent.click(
    screen.getByRole("button", { name: m.workbench_match_remove() }),
  );
  expect(document.querySelector("[data-condition-row]")).toBeNull();
  expect(close).toHaveBeenCalledTimes(2);
});

it("keeps a labelled expression in expression mode as the author types", async () => {
  const { controller } = open(`'itemType == "book"'`);
  fireEvent.click(
    screen.getByRole("button", {
      name: m.workbench_match_edit_as_expression(),
    }),
  );
  const input = screen.getByLabelText<HTMLInputElement>(
    m.workbench_match_expression(),
  );
  fireEvent.input(input, { target: { value: 'itemType == "journalArticle"' } });
  expect(screen.getByLabelText(m.workbench_match_expression())).toBe(input);
  expect(controller.document?.manifest.match).toEqual({
    and: ['itemType == "journalArticle"'],
  });
});

it("preserves line breaks in an authored expression when another row changes", () => {
  const { controller } = open(`'itemType == "book"'`);
  const expression = 'tags.contains("Read") ||\n  tags.contains("Later")';
  act(() => {
    controller.setMatch({ and: ['itemType == "book"', expression] });
  });
  expect(
    screen.getByLabelText<HTMLTextAreaElement>(m.workbench_match_expression())
      .value,
  ).toBe(expression);
  fireEvent.input(screen.getAllByLabelText(m.workbench_match_value())[0]!, {
    target: { value: "journalArticle" },
  });
  expect(controller.document?.manifest.match).toEqual({
    and: ['itemType == "journalArticle"', expression],
  });
});

it("rebinds the form when its host opens another Profile controller", async () => {
  const { controller: first, rerender } = open(`'itemType == "book"'`);
  const next = new WorkbenchDocumentController(
    DEFAULT_PROFILE_SOURCE.replace(
      "id: default",
      "id: Ar7Kd2QpX9Mn\nmatch: 'itemType == \"journalArticle\"'",
    ),
  );
  rerender(
    <WorkbenchHostProvider host={fakeHost()}>
      <MatchPane controller={next} facts={facts} />
    </WorkbenchHostProvider>,
  );
  await waitFor(() =>
    expect(
      screen.getByLabelText<HTMLSelectElement>(m.workbench_match_value()).value,
    ).toBe("journalArticle"),
  );
  fireEvent.input(screen.getByLabelText(m.workbench_match_value()), {
    target: { value: "report" },
  });
  expect(next.document?.manifest.match).toEqual({
    and: ['itemType == "report"'],
  });
  expect(first.document?.manifest.match).toBe('itemType == "book"');
});
