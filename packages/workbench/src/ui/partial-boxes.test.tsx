import { EditorView } from "@codemirror/view";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { AnnotationPane } from "./annotation";
import { WorkbenchHostProvider } from "./host";
import { NotePane } from "./note-pane";
import type { PartialPlaceholderHost } from "./partial-boxes";
import { fakeHost, renderWithMessages as render } from "./test-host";
import { m } from "./test-messages";

import { WorkbenchDocumentController } from "#/document/controller";
import { DEFAULT_PROFILE_SOURCE } from "#/render/default-profile";

afterEach(cleanup);

const CALLS = [
  '{% render "authors" %}',
  "{% include 'venue-line' %}",
  "{% render partial_name %}",
].join("\n");

function placeholders(
  source: string,
  partials: Partial<PartialPlaceholderHost> = {},
) {
  const host = fakeHost();
  const controller = new WorkbenchDocumentController(source);
  const actions = {
    names: ["authors", "venue-line"],
    missing: [],
    onEdit: vi.fn<(name: string) => void>(),
    onCreate: vi.fn<(name: string) => void>(),
    onRender: vi.fn<(name: string) => Promise<string>>(() =>
      Promise.resolve("Smith, J., Doe, A."),
    ),
    ...partials,
  } satisfies PartialPlaceholderHost;
  const result = render(
    <WorkbenchHostProvider host={host}>
      <NotePane
        controller={controller}
        preview={null}
        formatProblem={null}
        onOpenAnnotation={() => {}}
        partials={actions}
      />
    </WorkbenchHostProvider>,
  );
  const view = EditorView.findFromDOM(
    result.container.querySelector(".cm-editor")!,
  )!;
  return { ...result, host, controller, view, actions };
}

/** The one call the built-in Default's note body does not carry. */
function withCalls(calls = CALLS) {
  return DEFAULT_PROFILE_SOURCE.replace(
    "# {{ zt.title }}",
    `# {{ zt.title }}\n\n${calls}`,
  );
}

it("boxes a plain quoted name and leaves every other call form as source", () => {
  const { container, view } = placeholders(withCalls());

  expect(
    [...container.querySelectorAll("[data-partial-box]")].map(
      (box) => box.querySelector('[data-part="partial-name"]')?.textContent,
    ),
  ).toEqual(["authors", "venue-line"]);
  expect(view.contentDOM.textContent).not.toContain('{% render "authors" %}');
  expect(view.contentDOM.textContent).not.toContain(
    "{% include 'venue-line' %}",
  );
  expect(view.contentDOM.textContent).toContain("{% render partial_name %}");
});

it("shows the arguments a call passes beside its name", () => {
  const { container } = placeholders(
    withCalls('{% render "authors" with zt.creators as zt %}'),
  );

  expect(
    container.querySelector('[data-part="partial-arguments"]')?.textContent,
  ).toBe("with zt.creators as zt");
});

it("reveals the raw call while the selection touches it", () => {
  const { view } = placeholders(withCalls());
  const at = view.state.doc.toString().indexOf('{% render "authors" %}');

  act(() => view.dispatch({ selection: { anchor: at + 4 } }));
  expect(view.contentDOM.textContent).toContain('{% render "authors" %}');
  act(() => view.dispatch({ selection: { anchor: 0 } }));
  expect(view.contentDOM.textContent).not.toContain('{% render "authors" %}');
});

it("opens the partial's own text under the call and routes Edit to its editor", async () => {
  const { actions } = placeholders(withCalls());
  const toggles = screen.getAllByRole("button", {
    name: m.workbench_partial_preview(),
  });

  fireEvent.click(toggles[0]!);
  expect(actions.onRender).toHaveBeenCalledWith("authors");
  expect((await screen.findByRole("document")).textContent).toBe(
    "Smith, J., Doe, A.",
  );
  expect(toggles[0]!.getAttribute("aria-pressed")).toBe("true");

  fireEvent.click(
    screen.getAllByRole("button", { name: m.workbench_partial_edit() })[1]!,
  );
  expect(actions.onEdit).toHaveBeenCalledWith("venue-line");
});

it("names the failure a partial preview came back with", async () => {
  placeholders(withCalls(), {
    onRender: () => Promise.reject(new Error("Unexpected tag")),
  });

  fireEvent.click(
    screen.getAllByRole("button", { name: m.workbench_partial_preview() })[0]!,
  );
  expect(await screen.findByText("Unexpected tag")).toBeTruthy();
});

it("offers Create and Pick another for a partial the last render could not find", () => {
  const { container, actions } = placeholders(withCalls(), {
    missing: ["venue-line"],
  });
  const missing = container.querySelectorAll("[data-partial-box]")[1]!;

  expect(missing.textContent).toContain(
    m.workbench_diagnostic_missing_partial({ name: "venue-line" }),
  );
  expect(
    missing.querySelector(`[aria-label="${m.workbench_partial_preview()}"]`),
  ).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: m.workbench_partial_create() }),
  );
  expect(actions.onCreate).toHaveBeenCalledWith("venue-line");
});

it("writes the partial Pick another chose into that call alone", async () => {
  const { host, controller } = placeholders(withCalls(), {
    missing: ["venue-line"],
  });
  host.suggester = (request) => {
    host.calls.suggesters.push(request);
    return Promise.resolve("authors");
  };

  fireEvent.click(
    screen.getByRole("button", { name: m.workbench_partial_pick() }),
  );
  await vi.waitFor(() =>
    expect(controller.source).toContain("{% include 'authors' %}"),
  );
  expect(host.calls.suggesters[0]?.groups[0]?.options).toEqual([
    { id: "authors", label: "authors" },
    { id: "venue-line", label: "venue-line" },
  ]);
  expect(controller.source).toContain('{% render "authors" %}');
});

it("boxes the calls inside the Annotation Section too", async () => {
  const host = fakeHost();
  const controller = new WorkbenchDocumentController(
    DEFAULT_PROFILE_SOURCE.replace(
      "{{ zt.imgLink | embed }}{{ zt.text }}",
      '{% render "authors" %}\n{{ zt.imgLink | embed }}{{ zt.text }}',
    ),
  );
  const onRender = vi.fn<(name: string) => Promise<string>>(() =>
    Promise.resolve("Page 12"),
  );
  render(
    <WorkbenchHostProvider host={host}>
      <AnnotationPane
        controller={controller}
        problem={null}
        partials={{
          names: ["authors"],
          missing: [],
          onEdit: () => {},
          onCreate: () => {},
          onRender,
        }}
      />
    </WorkbenchHostProvider>,
  );

  fireEvent.click(
    screen.getByRole("button", { name: m.workbench_partial_preview() }),
  );
  expect(onRender).toHaveBeenCalledWith("authors");
  expect((await screen.findByRole("document")).textContent).toBe("Page 12");
});
