import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it } from "vitest";

import { useDocumentRevision } from "./editor";
import { WorkbenchHostProvider } from "./host";
import { m } from "./paraglide/messages.js";
import { PropertiesPane, PropertiesResult } from "./properties-tab";
import { fakeHost } from "./test-host";

import { WorkbenchDocumentController } from "#/document/controller";
import { DEFAULT_PROFILE_SOURCE } from "#/render/default-profile";
import { renderProfile, SAMPLE_ITEMS } from "#/render/index";

afterEach(cleanup);

function Pane({ controller }: { controller: WorkbenchDocumentController }) {
  useDocumentRevision(controller);
  const [selected, onSelect] = useState<number | null>(null);
  return (
    <PropertiesPane
      controller={controller}
      entries={controller.managedEntries ?? []}
      properties={[]}
      fold={[]}
      diagnostics={[]}
      selected={selected}
      onSelect={onSelect}
    />
  );
}

function setup() {
  const controller = new WorkbenchDocumentController(DEFAULT_PROFILE_SOURCE);
  const host = fakeHost();
  const result = render(
    <WorkbenchHostProvider host={host}>
      <Pane controller={controller} />
    </WorkbenchHostProvider>,
  );
  const press = (name: string, index = 0) =>
    fireEvent.click(screen.getAllByRole("button", { name })[index]!);
  return { ...result, controller, press };
}

it("adds an override, renames it, sets merge, moves and removes it through master history", () => {
  const { controller, press } = setup();
  press(m.workbench_properties_add_override());
  const name = screen.getByRole("textbox", {
    name: m.workbench_properties_name(),
  });
  expect(document.activeElement).toBe(name);
  fireEvent.input(name, { target: { value: "status" } });
  fireEvent.focusOut(name);
  expect(controller.source).toContain("key: status\n    expr:");
  fireEvent.input(
    screen.getByRole("combobox", { name: m.workbench_properties_merge() }),
    { target: { value: "keep" } },
  );
  expect(controller.managedEntries?.[1]).toMatchObject({
    key: "status",
    merge: "keep",
  });
  press(m.workbench_properties_move_down(), 1);
  expect(controller.managedEntries?.map((entry) => entry.key)).toEqual([
    "title",
    "related",
    "status",
    "collections",
    "citekey",
  ]);
  press(m.workbench_properties_remove(), 2);
  expect(controller.managedEntries?.map((entry) => entry.key)).toEqual([
    "title",
    "related",
    "collections",
    "citekey",
  ]);
  act(() => {
    controller.undo();
  });
  expect(controller.managedEntries?.[2]).toMatchObject({
    key: "status",
    merge: "keep",
  });
  act(() => {
    controller.undo();
  });
  expect(controller.managedEntries?.[1]).toMatchObject({
    key: "status",
    merge: "keep",
  });
});

it("adds properties and spreads, and confirms a format reset before changing source", () => {
  const { controller, press } = setup();
  press(m.workbench_properties_add());
  expect(controller.managedEntries?.[4]).toMatchObject({
    key: "property",
    language: "expr",
  });
  const before = controller.source;
  const format = screen.getByRole("combobox", {
    name: m.workbench_properties_format(),
  });
  fireEvent.input(format, { target: { value: "text" } });
  expect(controller.source).toBe(before);
  press(m.workbench_cancel());
  expect(controller.source).toBe(before);
  fireEvent.input(format, { target: { value: "text" } });
  press(m.workbench_properties_format_reset());
  expect(controller.source).toContain('key: property\n    value: ""');
  fireEvent.input(
    screen.getByRole("textbox", { name: m.workbench_properties_expression() }),
    { target: { value: "To read" } },
  );
  expect(controller.source).toContain('value: "To read"');
  act(() => {
    controller.undo();
    controller.undo();
  });
  expect(controller.source).toBe(before);
  press(m.workbench_properties_add_spread());
  expect(controller.managedEntries?.[5]).toMatchObject({
    language: "value",
    merge: "replace",
  });
  expect(controller.managedEntries?.[5]?.key).toBeUndefined();
});

it("keeps each pane's row controls and descriptions scoped to that pane", () => {
  const one = new WorkbenchDocumentController(DEFAULT_PROFILE_SOURCE);
  const two = new WorkbenchDocumentController(DEFAULT_PROFILE_SOURCE);
  const { container } = render(
    <>
      <Pane controller={one} />
      <Pane controller={two} />
    </>,
  );
  const panes = [...container.querySelectorAll('[data-part="pane"]')];
  for (const pane of panes)
    fireEvent.click(pane.querySelector('[data-part="edit"]')!);
  const forms = [...container.querySelectorAll('[data-part="form"]')];
  expect(forms).toHaveLength(2);
  expect(new Set(forms.map((form) => form.id)).size).toBe(2);
  for (const pane of panes)
    expect(
      pane.querySelector('[data-part="edit"]')?.getAttribute("aria-controls"),
    ).toBe(pane.querySelector('[data-part="form"]')?.id);
});

it("shows row diagnostics and the produced properties beside the final fold", () => {
  const controller = new WorkbenchDocumentController(DEFAULT_PROFILE_SOURCE);
  const result = renderProfile(DEFAULT_PROFILE_SOURCE, SAMPLE_ITEMS[0]!);
  const pane = render(
    <PropertiesPane
      controller={controller}
      entries={controller.managedEntries!}
      properties={result.properties}
      fold={result.fold}
      diagnostics={[{ position: 2, message: "The rule stopped." }]}
      selected={2}
      onSelect={() => {}}
    />,
  );
  const rows = [...pane.container.querySelectorAll('[data-part="row"]')];
  expect(rows[0]?.textContent).toContain(
    "Why Most Published Research Findings Are False",
  );
  expect(rows[1]?.textContent).toContain(m.workbench_properties_row_problem());
  expect(rows[1]?.textContent).toContain("The rule stopped.");
  expect(rows[0]?.textContent).not.toContain(
    m.workbench_properties_row_problem(),
  );
  const output = render(
    <PropertiesResult
      entries={controller.managedEntries!}
      properties={result.properties}
      fold={result.fold}
      frontmatterBlock={result.frontmatterBlock}
      showMarkdown={false}
    />,
  );
  expect(
    [...output.container.querySelectorAll("section dt")].map(
      (term) => term.textContent,
    ),
  ).toEqual(["title", "related", "collections", "citekey"]);
  output.rerender(
    <PropertiesResult
      entries={controller.managedEntries!}
      properties={result.properties}
      fold={result.fold}
      frontmatterBlock={result.frontmatterBlock}
      showMarkdown
    />,
  );
  expect(output.container.querySelector("pre")?.textContent).toContain(
    "title: Why Most Published Research Findings Are False",
  );
  expect(output.container.querySelector("dl")).toBeNull();
});
