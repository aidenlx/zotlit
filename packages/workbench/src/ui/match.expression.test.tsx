import { EditorView } from "@codemirror/view";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { MatchExpressionInput } from "./match.expression";
import { WorkbenchThemeProvider } from "./theme";

afterEach(cleanup);

it("mounts the extension the theme supplies for expression editors", () => {
  const { container } = render(
    <WorkbenchThemeProvider
      theme={{
        expressionExtension: () =>
          EditorView.editorAttributes.of({ class: "host-expression" }),
      }}
    >
      <MatchExpressionInput value="itemType == 'book'" onChange={() => {}} />
    </WorkbenchThemeProvider>,
  );
  expect(
    container
      .querySelector(".cm-editor")
      ?.classList.contains("host-expression"),
  ).toBe(true);
});
