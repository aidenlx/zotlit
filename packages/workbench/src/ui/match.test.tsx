// The Match pane's own undo: Mod+Z in the pane steps the document's history,
// and a popup the host draws in it keeps the key by stopping it at its edge.
import { act, cleanup, fireEvent } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { useWorkbenchController } from "./editor";
import { MatchPane } from "./match";
import { mount, renderWithMessages as render } from "./test-host";

import { DEFAULT_PROFILE_SOURCE } from "#/render/default-profile";

const SOURCE = DEFAULT_PROFILE_SOURCE.replace("id: default", "id: reading");

afterEach(cleanup);

function Pane() {
  return <MatchPane controller={useWorkbenchController()} />;
}

it("steps the Match history from Mod+Z in the pane, and leaves one a popup inside it stops", () => {
  using mounted = mount(<Pane />, { source: SOURCE });
  const { container } = render(mounted.ui);
  const { controller } = mounted;
  const before = controller.source;
  act(() => {
    controller.setMatch({ and: [] });
  });
  const written = controller.source;
  expect(written).not.toBe(before);
  const pane = container.querySelector("section")!;

  // A popup the host draws in the pane, as a select's search field, keeps
  // its own text undo by stopping the key at its edge.
  const popup = pane.appendChild(document.createElement("div"));
  popup.setAttribute("popover", "");
  popup.addEventListener("keydown", (event) => event.stopPropagation());
  const search = popup.appendChild(document.createElement("input"));
  act(() => {
    fireEvent.keyDown(search, { key: "z", ctrlKey: true });
  });
  expect(controller.source).toBe(written);

  // Anywhere else in the pane, Mod+Z and Mod+Shift+Z step the history, once.
  act(() => {
    fireEvent.keyDown(pane, { key: "z", metaKey: true });
  });
  expect(controller.source).toBe(before);
  act(() => {
    fireEvent.keyDown(pane, { key: "Z", metaKey: true, shiftKey: true });
  });
  expect(controller.source).toBe(written);
});
