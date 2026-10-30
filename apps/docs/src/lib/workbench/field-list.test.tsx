// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { SAMPLE_ITEMS, SAMPLE_ANNOTATIONS } from "@zotlit/workbench/render";

import { m } from "@/paraglide/messages.js";

import { FieldList } from "./field-list";
import type { FieldListProps } from "./field-list";
import type { SampleItem } from "./fields";
import { WebTestHost } from "./test-host";

const base = SAMPLE_ITEMS[0]!;
const sample: SampleItem = {
  ...base,
  roots: {
    ...base.roots,
    note: { authors: ["Ada"], title: "A paper" },
    annotations: [],
  },
  descriptors: {
    ...base.descriptors,
    note: { temporalValues: [], graphReferences: [], stringCoercions: [] },
    annotations: [],
  },
};

beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterEach(() => vi.unstubAllGlobals());

function mount() {
  using cleanup = new DisposableStack();
  const container = cleanup.adopt(document.createElement("div"), (element) =>
    element.remove(),
  );
  document.body.appendChild(container);
  const root = cleanup.adopt(createRoot(container), (root) => {
    act(() => root.unmount());
  });
  const lifetime = cleanup.move();
  return {
    container,
    show(overrides: Partial<FieldListProps> = {}) {
      act(() =>
        root.render(
          <WebTestHost>
            <FieldList sample={sample} root="note" ready {...overrides} />
          </WebTestHost>,
        ),
      );
    },
    filter(value: string) {
      act(() => {
        const input = container.querySelector<HTMLInputElement>(
          'input[type="search"]',
        )!;
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )!.set!.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    },
    [Symbol.dispose]() {
      lifetime.dispose();
    },
  };
}
it("retains note navigation across editor modes and restores it after an annotation root", () => {
  using view = mount();
  const { container } = view;
  view.show();
  act(() =>
    container
      .querySelector<HTMLButtonElement>(
        `[aria-label="${m.workbench_explorer_toggle_node()}"]`,
      )!
      .click(),
  );
  expect(container.textContent).toContain("Ada");
  view.filter("title");
  expect(container.textContent).not.toContain("Ada");
  view.show({ mode: "expression", annotation: SAMPLE_ANNOTATIONS[1]! });
  expect(
    container.querySelector<HTMLInputElement>('input[type="search"]')!.value,
  ).toBe("title");
  view.filter("");
  expect(container.textContent).toContain("Ada");
  const annotation = SAMPLE_ANNOTATIONS[0]!;
  view.show({ root: "annotation", annotation });
  expect(container.textContent).toContain(annotation.root.text);
  view.show();
  expect(container.textContent).toContain("Ada");
  view.show({
    sample: { ...sample, item: { ...sample.item, indexedKey: "PAPER234" } },
  });
  expect(container.textContent).not.toContain("Ada");
});
it("owns restored data for each view and distinguishes no Item, pending data, and no annotations", () => {
  using first = mount();
  using second = mount();
  first.show();
  second.show();
  first.filter("title");
  first.show({
    sample: {
      ...sample,
      roots: { ...sample.roots, note: { title: "Updated title" } },
    },
  });
  expect(first.container.textContent).toContain("Updated title");
  expect(
    first.container.querySelector<HTMLInputElement>('input[type="search"]')!
      .value,
  ).toBe("title");
  expect(second.container.textContent).toContain("A paper");
  first.show({ sample: null });
  expect(first.container.textContent).toContain(
    m.workbench_fields_choose_item(),
  );
  first.show({ ready: false });
  expect(first.container.textContent).toContain(m.workbench_loading_item());
  first.show({ root: "annotation" });
  expect(first.container.textContent).toContain(
    m.workbench_fields_no_annotations(),
  );
  expect(first.container.textContent).not.toContain(m.workbench_loading_item());
  first.show({
    root: "annotation",
    annotation: SAMPLE_ANNOTATIONS[0]!,
    citation: "(Sample, 2026)",
  });
  expect(first.container.textContent).toContain("(Sample, 2026)");
});
