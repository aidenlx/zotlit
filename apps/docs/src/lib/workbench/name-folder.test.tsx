// @vitest-environment happy-dom
// The web completion adapter receives Filename Root through the shared pane.
import { EditorView } from "@codemirror/view";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { WorkbenchDocumentController } from "@zotlit/workbench/document";
import { DEFAULT_PROFILE_SOURCE } from "@zotlit/workbench/render";
import { NameFolderPane } from "@zotlit/workbench/ui";

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
