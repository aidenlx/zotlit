// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";

import { WorkbenchDocumentController } from "@zotlit/workbench/document";
import { DEFAULT_PROFILE_SOURCE } from "@zotlit/workbench/render";

import { m } from "@/paraglide/messages.js";

import { NotePane } from "./note-pane";

it("names the Managed Block instead of its raw tags", () => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  using _cleanup = new DisposableStack();
  _cleanup.defer(() => {
    act(() => root.unmount());
    host.remove();
  });
  act(() =>
    root.render(
      <NotePane
        controller={new WorkbenchDocumentController(DEFAULT_PROFILE_SOURCE)}
        preview={null}
        formatProblem={null}
        onOpenAnnotation={() => {}}
      />,
    ),
  );
  const note = host.querySelector(`[aria-label="${m.workbench_tab_note()}"]`)!;
  expect(note.textContent).toContain(m.workbench_managed_start());
  expect(note.textContent).toContain(m.workbench_managed_end());
  expect(note.textContent).not.toContain("{% managed %}");
  expect(note.querySelectorAll(".zt-managed").length).toBeGreaterThan(0);
});
