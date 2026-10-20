// @vitest-environment happy-dom
import { EditorState } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";
import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", async (importOriginal) => {
  const actual = await importOriginal<typeof import("obsidian")>();
  const { StateField } = await import("@codemirror/state");
  return {
    ...actual,
    editorInfoField: StateField.define({
      create: () => ({ file: { path: "drafts/chapter.md" } }),
      update: (value) => value,
    }),
  };
});

import { editorInfoField } from "obsidian";

import type { AnnotationHoverRequest } from "@/services/annotation-popover/service";
import { defaults } from "@/services/settings/schema";
import type { Settings } from "@/services/settings/schema";

import { CitekeyEditor } from "./service";

class SettingsStub {
  current: Readonly<Settings>;
  readonly ready = Promise.resolve();
  readonly #listeners = new Set<(settings: Readonly<Settings>) => void>();

  constructor(overrides: Partial<Settings> = {}) {
    this.current = { ...defaults, ...overrides };
  }

  subscribe(listener: (settings: Readonly<Settings>) => void): () => void {
    this.#listeners.add(listener);
    listener(this.current);
    return () => this.#listeners.delete(listener);
  }

  update(overrides: Partial<Settings>): void {
    this.current = { ...this.current, ...overrides };
    for (const listener of this.#listeners) listener(this.current);
  }
}

const DOC =
  "Quoted [p. 2](zotero://open/groups/42/items/RGRPDF24?annotation=FDRFQ7C2&page=2).";

/**
 * The service over Pandoc citations switched off, with every editor extension
 * it registered drawn into one Live Preview editor over {@link DOC}.
 */
async function hoverHarness(stack: AsyncDisposableStack) {
  const settings = new SettingsStub({ "citation.pandoc-citations": false });
  const registered: Extension[] = [];
  const shown: AnnotationHoverRequest[] = [];
  const service = stack.use(
    new CitekeyEditor({
      app: { workspace: { updateOptions: () => undefined } },
      plugin: {
        registerEditorExtension: (extension: Extension) => {
          registered.push(extension);
        },
        registerHoverLinkSource: () => undefined,
      },
      settings,
      citationLookup: { observe: () => ({ [Symbol.dispose]: () => {} }) },
      citationText: { on: () => () => {} },
      annotationPopover: {
        show: (request: AnnotationHoverRequest) => shown.push(request),
      },
    } as never),
  );
  await service.ready;
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc: DOC,
      extensions: [
        editorInfoField,
        // Obsidian's Markdown highlighter classes the link text this way.
        EditorView.decorations.of(
          Decoration.set([Decoration.mark({ class: "cm-link" }).range(8, 12)]),
        ),
        registered,
      ],
    }),
  });
  stack.defer(() => view.destroy());
  view.dom.classList.add("is-live-preview");
  vi.spyOn(view, "posAtCoords").mockReturnValue(10);
  const hover = (): void => {
    view.dom
      .querySelector(".cm-link")!
      .dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  };
  return { settings, shown, hover };
}

describe("CitekeyEditor annotation link hover", () => {
  it("shows the hovered link's annotation while Pandoc citations are off", async () => {
    await using stack = new AsyncDisposableStack();
    const run = await hoverHarness(stack);

    run.hover();

    expect(run.shown).toHaveLength(1);
    expect(run.shown[0]).toMatchObject({
      sourcePath: "drafts/chapter.md",
      link: {
        attachmentKey: "RGRPDF24",
        annotationKey: "FDRFQ7C2",
        pageLabel: "2",
        groupID: 42,
      },
    });
  });

  it("follows the Hover action as the settings change it", async () => {
    await using stack = new AsyncDisposableStack();
    const run = await hoverHarness(stack);

    run.settings.update({ "citation.hover-action": "off" });
    run.hover();
    expect(run.shown).toEqual([]);

    run.settings.update({ "citation.hover-action": "page-preview" });
    run.hover();
    expect(run.shown).toHaveLength(1);
  });
});
