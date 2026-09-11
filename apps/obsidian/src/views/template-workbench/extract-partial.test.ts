import { EditorView } from "@codemirror/view";
// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import { extractSelection, partialCall } from "./extract-partial";

const SOURCE = "Venue: {{ zt.publicationTitle }} · 2019\n";
const SELECTION = { from: 7, to: 32 };

function open(): EditorView {
  const view = new EditorView({ doc: SOURCE });
  view.dispatch({ selection: { anchor: SELECTION.from, head: SELECTION.to } });
  return view;
}

describe("extractSelection", () => {
  it("writes the call over the selection", async () => {
    const view = open();

    await expect(
      extractSelection(view, async () => partialCall("venue", "liquid")),
    ).resolves.toBe("extracted");
    expect(view.state.doc.toString()).toBe(
      'Venue: {% render "venue" with zt as zt %} · 2019\n',
    );
  });

  it("keeps the document when the reader dismisses the name prompt", async () => {
    const view = open();

    await expect(extractSelection(view, async () => null)).resolves.toBe(
      "dismissed",
    );
    expect(view.state.doc.toString()).toBe(SOURCE);
  });

  it("keeps a document that changed while the name prompt was open", async () => {
    const view = open();

    // The prompt lasts as long as the reader takes; this edit lands first and
    // moves every offset the gesture measured before it.
    const outcome = await extractSelection(view, async () => {
      view.dispatch({ changes: { from: 0, insert: "# " } });
      return partialCall("venue", "liquid");
    });

    expect(outcome).toBe("stale");
    expect(view.state.doc.toString()).toBe(`# ${SOURCE}`);
  });
});
