import { EditorView } from "@codemirror/view";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import {
  AnnotationPane,
  AnnotationPointer,
  AnnotationSampleBar,
} from "./annotation";
import { annotationSamples } from "./annotation-samples";
import { WorkbenchHostProvider } from "./host";
import { m } from "./paraglide/messages.js";
import { SampleSuggester } from "./sample-suggester";
import { fakeHost } from "./test-host";

import { WorkbenchDocumentController } from "#/document/controller";
import { DEFAULT_PROFILE_SOURCE } from "#/render/default-profile";
import { SAMPLE_ANNOTATIONS, SAMPLE_ITEMS } from "#/render/index";

afterEach(cleanup);

it("repairs a missing section and edits only its format through the master history", () => {
  const source = DEFAULT_PROFILE_SOURCE.slice(
    0,
    DEFAULT_PROFILE_SOURCE.indexOf("--- zotlit:annotation ---"),
  );
  const controller = new WorkbenchDocumentController(source);
  const { container } = render(
    <AnnotationPane controller={controller} problem={null} />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: m.workbench_section_repair() }),
  );
  const view = EditorView.findFromDOM(container.querySelector(".cm-editor")!)!;
  act(() =>
    view.dispatch({
      changes: { from: 0, insert: "{{ zt.comment }}" },
      userEvent: "input.type",
    }),
  );
  expect(controller.source).toBe(
    `${source}${source.endsWith("\n") ? "" : "\n"}--- zotlit:annotation ---\n{{ zt.comment }}`,
  );
  act(() => {
    controller.undo();
    controller.undo();
  });
  expect(controller.source).toBe(source);
  expect(
    screen.getByRole("button", { name: m.workbench_section_repair() }),
  ).toBeTruthy();
});

it("hands annotation choice to the host with current annotations first and empty-group copy", async () => {
  const host = fakeHost();
  host.suggester = (request) => {
    host.calls.suggesters.push(request);
    return Promise.resolve(SAMPLE_ANNOTATIONS[1]!.id);
  };
  const selected = vi.fn<(id: string) => void>();
  const example = SAMPLE_ANNOTATIONS[0]!;
  render(
    <WorkbenchHostProvider host={host}>
      <AnnotationSampleBar current={[]} example={example} onSelect={selected} />
    </WorkbenchHostProvider>,
  );
  const trigger = screen.getByRole("button", {
    name: m.workbench_choose_annotation(),
  });
  await act(async () => {
    fireEvent.click(trigger);
  });
  const request = host.calls.suggesters[0]!;
  expect(request.anchor).toBe(trigger);
  expect(request.selected).toBe(example.id);
  expect(request.groups[0]).toEqual({
    label: m.workbench_annotation_from_item(),
    empty: m.workbench_annotation_empty(),
    options: [],
  });
  expect(request.groups[1]?.options.map((option) => option.id)).toEqual(
    SAMPLE_ANNOTATIONS.map((option) => option.id),
  );
  expect(selected).toHaveBeenCalledWith(SAMPLE_ANNOTATIONS[1]!.id);
});

it("keeps Item selection unchanged when its host chooser is dismissed", async () => {
  const host = fakeHost();
  host.suggester = vi.fn<typeof host.suggester>(async () => null);
  const select = vi.fn<(id: string) => void>();
  render(
    <WorkbenchHostProvider host={host}>
      <SampleSuggester
        title="Choose Item"
        label="Item A"
        selected="a"
        groups={[
          {
            heading: "Items",
            options: [{ value: "a", label: "Item A", description: "Author A" }],
          },
        ]}
        onSelect={select}
      />
    </WorkbenchHostProvider>,
  );
  const trigger = screen.getByRole("button", { name: "Choose Item" });
  await act(async () => {
    fireEvent.click(trigger);
  });
  expect(select).not.toHaveBeenCalled();
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(trigger.getAttribute("aria-description")).toBe("Choose Item");
});

it("keeps bundled annotation identity when the Item changes and current identity when reordered", () => {
  const bundled = SAMPLE_ANNOTATIONS[2]!;
  expect(annotationSamples(SAMPLE_ITEMS[0]!, bundled.id).example).toBe(bundled);
  expect(annotationSamples(SAMPLE_ITEMS[1]!, bundled.id).example).toBe(bundled);
  const original = SAMPLE_ITEMS.find(
    (item) => item.roots.annotations.length > 0,
  )!;
  const sample = {
    ...original,
    roots: {
      ...original.roots,
      annotations: [
        original.roots.annotations[0]!,
        { ...original.roots.annotations[0]!, indexedKey: "second" },
      ],
    },
    descriptors: {
      ...original.descriptors,
      annotations: [
        original.descriptors.annotations[0]!,
        original.descriptors.annotations[0]!,
      ],
    },
  };
  const selection = annotationSamples(sample, null).current[1]!;
  const reordered = {
    ...sample,
    roots: {
      ...sample.roots,
      annotations: sample.roots.annotations.toReversed(),
    },
    descriptors: {
      ...sample.descriptors,
      annotations: sample.descriptors.annotations.toReversed(),
    },
  };
  expect(
    annotationSamples(reordered, selection.id).example.root.indexedKey,
  ).toBe(selection.root.indexedKey);
  expect(annotationSamples(reordered, selection.id).example.descriptors).toBe(
    selection.descriptors,
  );
});

it("delegates insertion to the host and uses distinct problem descriptions per pane", () => {
  const insert = vi.fn<() => void>();
  const { container } = render(
    <>
      <AnnotationPointer onInsert={insert} />
      {[1, 2].map((id) => (
        <AnnotationPane
          key={id}
          controller={new WorkbenchDocumentController(DEFAULT_PROFILE_SOURCE)}
          problem="Format problem"
        />
      ))}
    </>,
  );
  fireEvent.click(
    screen.getByRole("button", { name: m.workbench_annotation_insert() }),
  );
  expect(insert).toHaveBeenCalledOnce();
  const problems = [...container.querySelectorAll('[role="status"]')];
  expect(new Set(problems.map((p) => p.id)).size).toBe(2);
  expect(
    [...container.querySelectorAll(".cm-content")].map((p) =>
      p.getAttribute("aria-describedby"),
    ),
  ).toEqual(problems.map((p) => p.id));
});
