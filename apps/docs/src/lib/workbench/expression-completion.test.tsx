// @vitest-environment happy-dom
import { EditorView } from "@codemirror/view";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";

import {
  MatchExpressionInput,
  WorkbenchThemeProvider,
} from "@zotlit/workbench/ui";

import { WEB_THEME } from "./theme";

beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));

it("offers a Match condition's Expression Completion with the signature and description in the web's look", async () => {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  await act(async () =>
    root.render(
      <WorkbenchThemeProvider theme={WEB_THEME}>
        <MatchExpressionInput
          value=""
          onChange={() => {}}
          vocabulary={{ fields: [], context: [], formulas: [] }}
        />
      </WorkbenchThemeProvider>,
    ),
  );
  try {
    const view = EditorView.findFromDOM(
      container.querySelector(".cm-editor")!,
    )!;
    view.dispatch({
      changes: { from: 0, insert: "mi" },
      selection: { anchor: 2 },
      userEvent: "input.type",
    });
    const row = await vi.waitFor(() => {
      const found = document.querySelector(
        ".cm-tooltip-autocomplete li[aria-selected]",
      );
      if (!found) throw new Error("no list yet");
      return found;
    });
    expect(row.querySelector(".cm-completionLabel")?.textContent).toBe("min");
    expect(row.textContent).toContain("min(…) → number");
    expect(row.textContent).toContain(
      "The smallest number among the arguments",
    );
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
