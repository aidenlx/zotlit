import { EditorView } from "@codemirror/view";
import {
  act,
  cleanup,
  fireEvent,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { useDocumentRevision } from "./editor";
import { WorkbenchHostProvider } from "./host";
import { NameFolderPane } from "./name-folder";
import type { NameFolderPaneProps } from "./name-folder";
// The form writes only the chosen manifest value, alongside filename edits in one history.
import { fakeHost, renderWithMessages as render } from "./test-host";
import { m } from "./test-messages";

import { WorkbenchDocumentController } from "#/document/index";
import { DEFAULT_PROFILE_SOURCE } from "#/render/default-profile";

const SOURCE = DEFAULT_PROFILE_SOURCE.replace(
  "id: default",
  "id: reading\nfolder: papers\nimportColoredHighlights: false",
).replace("name: Default", "name: Reading notes");
afterEach(cleanup);

function ReactivePane({
  controller,
  filename = "Reading",
  notePath = "Reading",
  ...props
}: Omit<NameFolderPaneProps, "manifest" | "filename" | "notePath"> &
  Partial<Pick<NameFolderPaneProps, "filename" | "notePath">>) {
  useDocumentRevision(controller);
  return (
    <NameFolderPane
      {...props}
      controller={controller}
      manifest={controller.document?.manifest ?? null}
      filename={filename}
      notePath={notePath}
    />
  );
}

function open({
  source = SOURCE,
  ...props
}: Omit<Partial<NameFolderPaneProps>, "controller"> & {
  source?: string;
} = {}) {
  const controller = new WorkbenchDocumentController(source);
  const result = render(
    <WorkbenchHostProvider host={fakeHost()}>
      <ReactivePane {...props} controller={controller} />
    </WorkbenchHostProvider>,
  );
  return { ...result, controller };
}

function write(label: string, value: string) {
  const input = screen.getByLabelText<HTMLInputElement>(label);
  fireEvent.input(input, { target: { value } });
  fireEvent.focusOut(input);
}

it("commits identity on blur and restores the input on undo", () => {
  const { controller } = open({ section: "profile" });
  const name = screen.getByLabelText<HTMLInputElement>(
    m.workbench_name_field_name(),
  );
  fireEvent.input(name, { target: { value: "Methods notes" } });
  expect(controller.source).toBe(SOURCE);
  fireEvent.focusOut(name);
  expect(controller.source).toBe(
    SOURCE.replace("name: Reading notes", "name: Methods notes"),
  );
  act(() => {
    controller.undo();
  });
  expect(controller.source).toBe(SOURCE);
  expect(name.value).toBe("Reading notes");
});

it("keeps empty paths distinct from inheritance and restores each edit", () => {
  const { controller } = open();
  write(m.workbench_name_binding_folder(), "");
  expect(controller.document!.manifest.folder).toBe("");
  fireEvent.click(
    screen.getByRole("button", {
      name: m.workbench_name_use_default_for({
        name: m.workbench_name_binding_folder(),
      }),
    }),
  );
  expect(controller.document!.manifest.folder).toBeUndefined();
  expect(
    screen.getByLabelText<HTMLInputElement>(m.workbench_name_binding_folder())
      .value,
  ).toBe("literatures");
  act(() => {
    controller.undo();
  });
  expect(
    screen.getByLabelText<HTMLInputElement>(m.workbench_name_binding_folder())
      .value,
  ).toBe("");
  act(() => {
    controller.undo();
  });
  expect(controller.source).toBe(SOURCE);
});

it("edits inherited toggles directly, resets to inheritance, and undoes both", () => {
  const { controller } = open();
  const label = m.workbench_name_binding_annotation_template();
  const toggle = screen.getByRole<HTMLButtonElement>("switch", { name: label });
  const resetName = m.workbench_name_use_default_for({ name: label });
  expect(toggle.disabled).toBe(false);
  expect(screen.queryByRole("button", { name: resetName })).toBeNull();
  fireEvent.click(toggle);
  expect(controller.document!.manifest.importAnnotationsAsTemplate).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: resetName }));
  expect(
    controller.document!.manifest.importAnnotationsAsTemplate,
  ).toBeUndefined();
  expect(toggle.getAttribute("aria-checked")).toBe("false");
  expect(screen.queryByRole("button", { name: resetName })).toBeNull();
  act(() => {
    controller.undo();
  });
  expect(controller.document!.manifest.importAnnotationsAsTemplate).toBe(true);
  fireEvent.click(toggle);
  expect(controller.document!.manifest.importAnnotationsAsTemplate).toBe(false);
  expect(screen.getByRole("button", { name: resetName })).toBeDefined();
  act(() => {
    controller.undo();
    controller.undo();
  });
  expect(controller.source).toBe(SOURCE);
});

it("edits inherited citation styles and keeps an explicit null distinct from unset", () => {
  const { controller } = open({
    citationStyles: [
      { id: "apa", title: "American Psychological Association" },
      { id: "ieee", title: "IEEE" },
    ],
  });
  const label = m.workbench_name_binding_citation_style();
  const select = screen.getByLabelText<HTMLSelectElement>(label);
  expect(select.disabled).toBe(false);
  fireEvent.input(select, { target: { value: "ieee" } });
  expect(controller.document!.manifest.citationStyle).toBe("ieee");
  fireEvent.input(select, { target: { value: "" } });
  expect(controller.document!.manifest.citationStyle).toBeNull();
  fireEvent.click(
    screen.getByRole("button", {
      name: m.workbench_name_use_default_for({ name: label }),
    }),
  );
  expect(controller.document!.manifest.citationStyle).toBeUndefined();
  act(() => {
    controller.undo();
  });
  expect(controller.document!.manifest.citationStyle).toBeNull();
  act(() => {
    controller.undo();
  });
  expect(select.value).toBe("ieee");
  act(() => {
    controller.undo();
  });
  expect(controller.source).toBe(SOURCE);
});

it("creates a folder override on edit and keeps reset available when it equals the default", () => {
  const { controller } = open();
  const label = m.workbench_name_binding_import_folder();
  const resetName = m.workbench_name_use_default_for({ name: label });
  const input = screen.getByLabelText<HTMLInputElement>(label);
  expect(input.disabled).toBe(false);
  expect(screen.queryByRole("button", { name: resetName })).toBeNull();
  write(label, "Imported notes");
  expect(controller.document!.manifest.importFolder).toBe("Imported notes");
  write(label, "zotero_notes");
  expect(controller.document!.manifest.importFolder).toBe("zotero_notes");
  fireEvent.click(screen.getByRole("button", { name: resetName }));
  expect(controller.document!.manifest.importFolder).toBeUndefined();
  expect(input.value).toBe("zotero_notes");
  expect(screen.queryByRole("button", { name: resetName })).toBeNull();
});

it("selects the inherited citation style on open and after reset", () => {
  const { controller } = open({
    defaults: {
      folder: "literatures",
      citationStyle: "apa",
      importFolder: "zotero_notes",
      importColoredHighlights: false,
      importAnnotationsAsTemplate: false,
    },
    citationStyles: [
      { id: "apa", title: "APA" },
      { id: "ieee", title: "IEEE" },
    ],
  });
  const label = m.workbench_name_binding_citation_style();
  const select = screen.getByLabelText<HTMLSelectElement>(label);
  expect(select.value).toBe("apa");
  expect(controller.document!.manifest.citationStyle).toBeUndefined();
  fireEvent.input(select, { target: { value: "ieee" } });
  expect(select.value).toBe("ieee");
  fireEvent.click(
    screen.getByRole("button", {
      name: m.workbench_name_use_default_for({ name: label }),
    }),
  );
  expect(select.value).toBe("apa");
  expect(controller.document!.manifest.citationStyle).toBeUndefined();
});

it("retains a citation style absent from the installed list", () => {
  open({
    source: SOURCE.replace(
      "folder: papers",
      "folder: papers\ncitationStyle: chicago",
    ),
    citationStyles: [{ id: "ieee", title: "IEEE" }],
  });
  const select = screen.getByLabelText<HTMLSelectElement>(
    m.workbench_name_binding_citation_style(),
  );
  expect(select.value).toBe("chicago");
  expect(within(select).getByRole("option", { name: "chicago" })).toBeDefined();
});

it("changes only the language key after the inline confirmation", () => {
  const { controller } = open({ section: "profile" });
  const select = screen.getByLabelText<HTMLSelectElement>(
    m.workbench_name_language_heading(),
  );
  fireEvent.input(select, { target: { value: "eta" } });
  expect(controller.source).toBe(SOURCE);
  expect(screen.getByRole("alert").textContent).toContain(
    m.workbench_name_language_confirm_heading(),
  );
  fireEvent.click(
    screen.getByRole("button", { name: m.workbench_name_language_cancel() }),
  );
  expect(select.value).toBe("liquid");
  fireEvent.input(select, { target: { value: "eta" } });
  fireEvent.click(
    screen.getByRole("button", { name: m.workbench_name_language_confirm() }),
  );
  expect(controller.source).toBe(
    SOURCE.replace("language: liquid", "language: eta"),
  );
  act(() => {
    controller.undo();
  });
  expect(controller.source).toBe(SOURCE);
  expect(select.value).toBe("liquid");
});

it("shares undo between filename text and a form edit, and refuses newlines", () => {
  const { controller, container } = open();
  const view = EditorView.findFromDOM(
    container.querySelector<HTMLElement>(".cm-editor")!,
  )!;
  act(() => {
    view.dispatch({
      changes: { from: 0, insert: "Reading-" },
      userEvent: "input.type",
    });
  });
  const filenameSource = SOURCE.replace("filename: '", "filename: 'Reading-");
  expect(controller.source).toBe(filenameSource);
  write(m.workbench_name_binding_folder(), "Methods");
  act(() => {
    controller.undo();
  });
  expect(controller.source).toBe(filenameSource);
  act(() => {
    controller.undo();
  });
  expect(controller.source).toBe(SOURCE);
  act(() => {
    view.dispatch({
      changes: { from: 0, insert: "\n" },
      userEvent: "input.type",
    });
  });
  expect(controller.source).toBe(SOURCE);
  expect(screen.getByText("papers/Reading.md")).toBeDefined();
});

it("scopes problem navigation to the selected editor instance", () => {
  const first = new WorkbenchDocumentController(SOURCE);
  const second = new WorkbenchDocumentController(SOURCE);
  render(
    <>
      <ReactivePane section="profile" controller={first} />
      <ReactivePane
        section="profile"
        controller={second}
        focus={{ field: "name" }}
      />
    </>,
  );
  const fields = screen.getAllByLabelText<HTMLInputElement>(
    m.workbench_name_field_name(),
  );
  expect(fields[0]!.id).not.toBe(fields[1]!.id);
  expect(document.activeElement).toBe(fields[1]);
  expect(fields[1]!.closest("details")).toBeNull();
  expect(fields[0]!.closest("details")).toBeNull();
});

it("shows Default bindings as read-only inherited values", () => {
  const { container } = open({ source: DEFAULT_PROFILE_SOURCE });
  expect(container.textContent).not.toContain(m.workbench_name_override());
  expect(container.textContent).not.toContain(m.workbench_name_use_default());
  expect(screen.queryByRole("switch")).toBeNull();
  expect(
    screen.queryByRole("button", {
      name: m.workbench_name_override_for({
        name: m.workbench_name_binding_folder(),
      }),
    }),
  ).toBeNull();
  expect(screen.getByText("literatures")).toBeDefined();
  expect(screen.getByText(m.workbench_name_default_lede())).toBeDefined();
  expect(screen.getByText(m.workbench_name_value_no_style())).toBeDefined();
  expect(
    screen.queryByRole("button", { name: m.workbench_name_use_default() }),
  ).toBeNull();
});

it("shows identity, the live note name, and each binding's source", () => {
  open({ section: "profile" });
  open();
  expect(
    screen.getByLabelText<HTMLInputElement>(m.workbench_name_field_name())
      .value,
  ).toBe("Reading notes");
  expect(
    screen.getByLabelText<HTMLInputElement>(m.workbench_name_field_version())
      .value,
  ).toBe("1.0.0");
  expect(
    screen.getByLabelText<HTMLInputElement>(m.workbench_name_field_author())
      .value,
  ).toBe("ZotLit");
  expect(screen.getByText("papers/Reading.md")).toBeDefined();
  const folder = screen.getByLabelText<HTMLInputElement>(
    m.workbench_name_binding_folder(),
  );
  expect(folder.value).toBe("papers");
  expect(folder.closest('[data-part="binding-row"]')?.textContent).toContain(
    m.workbench_name_origin_profile(),
  );
  expect(
    screen.getByRole("button", {
      name: m.workbench_name_use_default_for({
        name: m.workbench_name_binding_folder(),
      }),
    }),
  ).toBeDefined();
  const inherited = screen.getByLabelText<HTMLInputElement>(
    m.workbench_name_binding_import_folder(),
  );
  expect(inherited.value).toBe("zotero_notes");
  expect(inherited.disabled).toBe(false);
  expect(inherited.closest('[data-part="binding-row"]')?.textContent).toContain(
    m.workbench_name_origin_default(),
  );
  expect(
    screen.queryByRole("button", {
      name: m.workbench_name_use_default_for({
        name: m.workbench_name_binding_import_folder(),
      }),
    }),
  ).toBeNull();
  const style = screen.getByLabelText<HTMLInputElement>(
    m.workbench_name_binding_citation_style(),
  );
  expect(style.tagName).toBe("INPUT");
  expect(style.placeholder).toBe(m.workbench_name_citation_style_placeholder());
});

it("shows the same Off value for explicit and inherited switches while naming their different origins", () => {
  const { controller } = open();
  const colored = screen.getByRole<HTMLButtonElement>("switch", {
    name: m.workbench_name_binding_colored_highlights(),
  });
  const inherited = screen.getByRole<HTMLButtonElement>("switch", {
    name: m.workbench_name_binding_annotation_template(),
  });
  expect(colored.closest('[data-part="binding-row"]')?.textContent).toContain(
    m.workbench_name_origin_profile(),
  );
  expect(inherited.closest('[data-part="binding-row"]')?.textContent).toContain(
    m.workbench_name_origin_default(),
  );
  for (const toggle of [colored, inherited]) {
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(toggle.closest('[data-part="binding-row"]')?.textContent).toContain(
      m.workbench_name_value_off(),
    );
  }
  fireEvent.click(colored);
  expect(controller.document!.manifest.importColoredHighlights).toBe(true);
  expect(inherited.disabled).toBe(false);
  expect(
    controller.document!.manifest.importAnnotationsAsTemplate,
  ).toBeUndefined();
});

it("opens the host settings from the configuration pane", () => {
  const onOpenSettings = vi.fn<() => void>();
  open({ onOpenSettings });
  fireEvent.click(
    screen.getByRole("button", { name: m.workbench_open_settings() }),
  );
  expect(onOpenSettings).toHaveBeenCalledOnce();
});

it("keeps read-only configuration selectable and disables binding changes", () => {
  const { controller } = open();
  render(<ReactivePane controller={controller} section="profile" />);
  act(() => controller.setReadOnly(true));
  expect(screen.getByLabelText(m.workbench_name_field_name())).toHaveProperty(
    "readOnly",
    true,
  );
  expect(
    screen.getByLabelText(m.workbench_name_binding_folder()),
  ).toHaveProperty("readOnly", true);
  expect(
    screen.getByRole("switch", {
      name: m.workbench_name_binding_colored_highlights(),
    }),
  ).toHaveProperty("disabled", true);
});

/** The full path the note path group previews, by its visible label. */
const preview = () =>
  screen.getByRole("status", { name: m.workbench_name_filename_result() })
    .textContent;

/** Every control of the note path group, in reading order. */
function notePathGroup() {
  return screen.getByRole("region", { name: m.workbench_name_path_heading() });
}

it("previews the note under the folder inherited from Default", () => {
  open({
    source: SOURCE.replace("folder: papers\n", ""),
    notePath: "2024/Reading",
  });
  const folder = within(notePathGroup()).getByLabelText<HTMLInputElement>(
    m.workbench_name_binding_folder(),
  );
  expect(folder.value).toBe("literatures");
  expect(folder.closest('[data-part="binding-row"]')?.textContent).toContain(
    m.workbench_name_origin_default(),
  );
  expect(preview()).toBe("literatures/2024/Reading.md");
});

it("follows a folder override, its reset, and a new Default folder", () => {
  const defaults = {
    folder: "literatures",
    citationStyle: null,
    importFolder: "zotero_notes",
    importColoredHighlights: false,
    importAnnotationsAsTemplate: false,
  };
  const { controller, rerender } = open({
    source: SOURCE.replace("folder: papers\n", ""),
    defaults,
  });
  expect(preview()).toBe("literatures/Reading.md");
  write(m.workbench_name_binding_folder(), "Reading/Methods");
  expect(controller.document!.manifest.folder).toBe("Reading/Methods");
  expect(preview()).toBe("Reading/Methods/Reading.md");
  fireEvent.click(
    screen.getByRole("button", {
      name: m.workbench_name_use_default_for({
        name: m.workbench_name_binding_folder(),
      }),
    }),
  );
  expect(controller.document!.manifest.folder).toBeUndefined();
  expect(preview()).toBe("literatures/Reading.md");
  rerender(
    <WorkbenchHostProvider host={fakeHost()}>
      <ReactivePane
        controller={controller}
        defaults={{ ...defaults, folder: "Zotero/Papers" }}
      />
    </WorkbenchHostProvider>,
  );
  expect(preview()).toBe("Zotero/Papers/Reading.md");
});

it("previews the name path alone for a vault-root folder", () => {
  open({ source: SOURCE.replace("folder: papers", "folder: ''") });
  expect(preview()).toBe("Reading.md");
});

it("says so when the note name resolves to empty", () => {
  open({ filename: "  ", notePath: null });
  expect(preview()).toContain(m.workbench_name_path_empty());
});

it("orders folder, note name template, and preview inside one labelled group", () => {
  open();
  const group = notePathGroup();
  const folder = within(group).getByLabelText(
    m.workbench_name_binding_folder(),
  );
  const template = within(group).getByRole("textbox", {
    name: m.workbench_name_filename_label(),
  });
  const result = within(group).getByRole("status", {
    name: m.workbench_name_filename_result(),
  });
  expect(
    folder.compareDocumentPosition(template) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(
    template.compareDocumentPosition(result) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  // The remaining bindings keep their own group.
  expect(
    within(group).queryByLabelText(m.workbench_name_binding_import_folder()),
  ).toBeNull();
  expect(
    within(
      screen.getByRole("region", { name: m.workbench_name_bindings_heading() }),
    ).getByLabelText(m.workbench_name_binding_import_folder()),
  ).toBeDefined();
});

it("focuses the folder control for a problem pinned to the folder key", () => {
  open({ focus: { field: "folder" } });
  expect(document.activeElement).toBe(
    within(notePathGroup()).getByLabelText(m.workbench_name_binding_folder()),
  );
});

it("shows the Default folder read-only and still previews the full path", () => {
  const onOpenSettings = vi.fn<() => void>();
  open({ source: DEFAULT_PROFILE_SOURCE, onOpenSettings });
  const group = notePathGroup();
  expect(
    within(group).queryByRole("textbox", {
      name: m.workbench_name_binding_folder(),
    }),
  ).toBeNull();
  expect(within(group).getByText("literatures")).toBeDefined();
  expect(
    within(group).getByText(m.workbench_name_binding_folder()),
  ).toBeDefined();
  expect(preview()).toBe("literatures/Reading.md");
  fireEvent.click(
    screen.getByRole("button", { name: m.workbench_open_settings() }),
  );
  expect(onOpenSettings).toHaveBeenCalledOnce();
});
