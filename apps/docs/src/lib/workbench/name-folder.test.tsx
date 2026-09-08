// @vitest-environment happy-dom
// The web completion adapter receives Filename Root through the shared pane.
import { EditorView } from "@codemirror/view";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";

import { WorkbenchDocumentController } from "@zotlit/workbench/document";
import { DEFAULT_PROFILE_SOURCE } from "@zotlit/workbench/render";
import { NameFolderPane } from "@zotlit/workbench/ui";

import { WebTestHost } from "./test-host";
const OWN_PROFILE = DEFAULT_PROFILE_SOURCE.replace(
  "id: default",
  `id: reading
folder: papers
importColoredHighlights: false`,
).replace("name: Default", "name: Reading notes");

interface OpenPane extends Disposable {
  controller: WorkbenchDocumentController;
  host: HTMLElement;
}

/** The tab mounted for real, so the editor and the confirmation both run. */
function openPane(source: string): OpenPane {
  const controller = new WorkbenchDocumentController(source);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      <WebTestHost>
        <NameFolderPane
          controller={controller}
          manifest={controller.document!.manifest}
          filename="Tufte1983Visual"
        />
      </WebTestHost>,
    );
  });
  return {
    controller,
    host,
    [Symbol.dispose]() {
      act(() => root.unmount());
      host.remove();
    },
  };
}

it("offers Filename Root fields while typing in the note name", async () => {
  using tab = openPane(OWN_PROFILE);
  const view = EditorView.findFromDOM(
    tab.host.querySelector<HTMLElement>(".cm-editor")!,
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
