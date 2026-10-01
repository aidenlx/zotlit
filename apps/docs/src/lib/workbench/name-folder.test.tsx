// @vitest-environment happy-dom
// The web completion adapter receives Filename Root through the shared pane.
import { EditorView } from "@codemirror/view";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { WorkbenchDocumentController } from "@zotlit/workbench/document";
import { DEFAULT_PROFILE_SOURCE } from "@zotlit/workbench/render";
import { NameFolderPane } from "@zotlit/workbench/ui";

import { m } from "@/paraglide/messages.js";

import { WebTestHost } from "./test-host";

beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterEach(() => vi.unstubAllGlobals());

const OWN_PROFILE = DEFAULT_PROFILE_SOURCE.replace(
  "id: default",
  `id: reading
folder: papers
importColoredHighlights: false`,
).replace("name: Default", "name: Reading notes");

it("offers Filename Root fields while typing in the note name", async () => {
  await using cleanup = new AsyncDisposableStack();
  const controller = new WorkbenchDocumentController(OWN_PROFILE);
  const host = cleanup.adopt(document.createElement("div"), (element) => {
    element.remove();
  });
  document.body.appendChild(host);
  const root = createRoot(host);
  cleanup.defer(() => act(async () => root.unmount()));
  await act(async () => {
    root.render(
      <WebTestHost>
        <NameFolderPane
          controller={controller}
          manifest={controller.document!.manifest}
          filename="Tufte1983Visual"
          notePath="Tufte1983Visual"
        />
      </WebTestHost>,
    );
  });
  const view = EditorView.findFromDOM(
    host.querySelector<HTMLElement>(".cm-editor")!,
  )!;
  await act(async () => {
    view.focus();
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: "{{ zt." },
      selection: { anchor: 6 },
      userEvent: "input.type",
    });
  });
  const options = [...document.querySelectorAll('[role="option"]')].map(
    (node) => node.textContent,
  );
  expect(options.some((text) => text?.includes("zt.citationKey"))).toBe(true);
  expect(options.some((text) => text?.includes("zt.annotations"))).toBe(false);
});

/** Mounts the Name and folder pane in the web theme over `source`. */
async function mountPane(
  cleanup: AsyncDisposableStack,
  source: string,
  notePath = "Tufte1983Visual",
) {
  const controller = new WorkbenchDocumentController(source);
  const host = cleanup.adopt(document.createElement("div"), (element) => {
    element.remove();
  });
  document.body.appendChild(host);
  const root = createRoot(host);
  cleanup.defer(() => act(async () => root.unmount()));
  const draw = () =>
    root.render(
      <WebTestHost>
        <NameFolderPane
          controller={controller}
          manifest={controller.document!.manifest}
          filename={notePath}
          notePath={notePath}
        />
      </WebTestHost>,
    );
  await act(async () => draw());
  return {
    controller,
    host,
    preview: () =>
      host.querySelector('[data-part="filename-output"]')?.textContent,
    /** The editable folder box, which a Default Profile has none of. */
    folder: () =>
      [...host.querySelectorAll<HTMLInputElement>("input")].find(
        (input) =>
          host.querySelector(`label[for="${CSS.escape(input.id)}"]`)
            ?.textContent === m.workbench_name_binding_folder(),
      ),
    redraw: () => act(async () => draw()),
  };
}

it("previews the full path under the built-in folder a Profile inherits", async () => {
  await using cleanup = new AsyncDisposableStack();
  const pane = await mountPane(
    cleanup,
    OWN_PROFILE.replace("folder: papers\n", ""),
    "1983/Tufte1983Visual",
  );
  expect(pane.folder()?.value).toBe("literatures");
  expect(pane.preview()).toBe("literatures/1983/Tufte1983Visual.md");
});

it("previews the full path under an overridden and a vault-root folder", async () => {
  await using cleanup = new AsyncDisposableStack();
  const pane = await mountPane(cleanup, OWN_PROFILE);
  expect(pane.preview()).toBe("papers/Tufte1983Visual.md");
  await act(async () => {
    pane.controller.setManifestKey("folder", "");
  });
  await pane.redraw();
  expect(pane.preview()).toBe("Tufte1983Visual.md");
});

it("shows the Default folder read-only beside the full-path preview", async () => {
  await using cleanup = new AsyncDisposableStack();
  const pane = await mountPane(cleanup, DEFAULT_PROFILE_SOURCE);
  expect(pane.folder()).toBeUndefined();
  expect(pane.host.textContent).toContain(
    m.workbench_name_folder_default_note(),
  );
  expect(pane.preview()).toBe("literatures/Tufte1983Visual.md");
});
