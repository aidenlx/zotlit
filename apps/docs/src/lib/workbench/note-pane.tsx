// The Your note tab: the note source, with the two boxes the reader meets in
// it. The Managed Block reads as the part a note update keeps up to date, and
// the first annotation render call holds the highlight editor — a second pane
// over the Annotation Section of the same document, so the format is edited
// where it is used. Every later call links back to that one editor.

import { StateField } from "@codemirror/state";
import type { EditorState, Extension, Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";

import { noteRegions } from "@zotlit/workbench/document";
import type {
  WorkbenchDocumentController,
  WorkbenchSliceRange,
} from "@zotlit/workbench/document";

import { m } from "@/paraglide/messages.js";

import { SliceEditor } from "./slice-editor";
import type { SuggestionSource } from "./slice-editor";

/** Which of the note tab's two editors the reader is in. */
export type NoteEditor = "note" | "annotation";

export interface NotePaneProps {
  controller: WorkbenchDocumentController;
  /** Master offsets to reveal in the note source. */
  reveal?: WorkbenchSliceRange | null;
  /** Master offsets to reveal in the highlight box, which also focuses it. */
  highlight?: WorkbenchSliceRange | null;
  onSelection?: (selection: WorkbenchSliceRange) => void;
  /** The contract both editors complete and explain against. */
  suggest?: SuggestionSource;
  /** A later render call, or the reader, asked for the highlight editor. */
  onOpenHighlight: () => void;
  onEditing: (editor: NoteEditor) => void;
}

export function NotePane({
  controller,
  reveal,
  highlight,
  onSelection,
  suggest,
  onOpenHighlight,
  onEditing,
}: NotePaneProps) {
  // One box for the life of the pane: the widget hands CodeMirror this element
  // and React paints into it, so the editor inside survives every redraw.
  const [box] = useState(() => document.createElement("div"));
  const open = useRef(onOpenHighlight);
  open.current = onOpenHighlight;
  const [extensions] = useState(() =>
    noteBoxes(controller, box, () => open.current()),
  );
  const hasBox =
    controller.annotationSection !== null &&
    controller.noteRegions.annotationCalls.length > 0;
  // Two editors report a caret, and the box's arrives last as it mounts. Only
  // the one the reader is in speaks for the pane, so the field list and Put in
  // note follow the editor on screen rather than the last one built.
  const active = useRef<NoteEditor>("note");
  const editing = (editor: NoteEditor) => {
    active.current = editor;
    onEditing(editor);
  };
  const selection = (editor: NoteEditor) => (range: WorkbenchSliceRange) => {
    if (active.current === editor) onSelection?.(range);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col border border-fd-border bg-fd-card [&_.zt-managed]:bg-fd-accent/40 [&_.zt-managed]:shadow-[inset_2px_0_0_0_var(--color-fd-primary)]">
      <SliceEditor
        controller={controller}
        slice="note"
        label={m.workbench_tab_note()}
        extensions={extensions}
        reveal={reveal}
        suggest={suggest}
        onSelection={selection("note")}
        onFocus={() => editing("note")}
      />
      {hasBox &&
        createPortal(
          <div className="my-1 flex flex-col border border-fd-primary bg-fd-card">
            <div className="flex flex-wrap items-baseline gap-x-3 border-b border-fd-border px-3 py-1.5">
              <h3 className="font-serif text-[0.95rem] font-medium">
                {m.workbench_highlight_heading()}
              </h3>
              <p className="text-xs text-fd-muted-foreground">
                {m.workbench_highlight_lede()}
              </p>
            </div>
            <div className="flex h-44 flex-col">
              <SliceEditor
                controller={controller}
                slice="annotation"
                label={m.workbench_highlight_label()}
                reveal={highlight}
                suggest={suggest}
                onSelection={selection("annotation")}
                onFocus={() => editing("annotation")}
              />
            </div>
          </div>,
          box,
        )}
    </div>
  );
}

/**
 * The note source's own decorations: the Managed Block as a marked box with a
 * beginner label in place of each raw tag, and every annotation render call
 * replaced — the first by the highlight box, the rest by a link to it. They are
 * read from the pane's own text, which is the note body, so they never lag the
 * keystroke that moved them. Block decorations belong to a state field.
 */
function noteBoxes(
  controller: WorkbenchDocumentController,
  box: HTMLElement,
  openHighlight: () => void,
): Extension {
  function build({ doc }: EditorState): DecorationSet {
    const body = doc.toString();
    const { annotationCalls, managedBlock } = noteRegions(body, {
      from: 0,
      to: body.length,
    });
    const ranges: Range<Decoration>[] = [];
    if (managedBlock) {
      const last = doc.lineAt(managedBlock.range.to).number;
      for (
        let line = doc.lineAt(managedBlock.range.from).number;
        line <= last;
        line += 1
      ) {
        ranges.push(
          Decoration.line({ class: "zt-managed" }).range(doc.line(line).from),
        );
      }
      for (const [tag, label] of [
        [managedBlock.open, m.workbench_managed_start()],
        [managedBlock.close, m.workbench_managed_end()],
      ] as const) {
        ranges.push(
          Decoration.replace({ widget: new LabelWidget(label) }).range(
            tag.from,
            tag.to,
          ),
        );
      }
    }
    // The section the first box edits has to exist; without one every call
    // links out instead, and the link opens the section in Advanced.
    const editable = controller.annotationSection !== null;
    for (const [index, { call, line }] of annotationCalls.entries()) {
      const target = line ?? call;
      ranges.push(
        Decoration.replace({
          block: line !== null,
          widget:
            index === 0 && editable
              ? new BoxWidget(box)
              : new LinkWidget(
                  m.workbench_highlight_later_call(),
                  openHighlight,
                ),
        }).range(target.from, target.to),
      );
    }
    return Decoration.set(ranges, true);
  }

  return StateField.define<DecorationSet>({
    create: build,
    update: (value, transaction) =>
      transaction.docChanged ? build(transaction.state) : value,
    provide: (field) => EditorView.decorations.from(field),
  });
}

/** A beginner name in place of a raw tag the reader does not have to read. */
class LabelWidget extends WidgetType {
  constructor(readonly label: string) {
    super();
  }

  eq(other: LabelWidget): boolean {
    return other.label === this.label;
  }

  toDOM(): HTMLElement {
    const element = document.createElement("span");
    element.className =
      "border border-fd-primary px-1.5 py-0.5 font-mono text-[0.6rem] font-semibold tracking-widest text-fd-primary uppercase";
    element.textContent = this.label;
    return element;
  }
}

/** A later render call: the same name, and the way back to the one editor. */
class LinkWidget extends WidgetType {
  constructor(
    readonly label: string,
    readonly open: () => void,
  ) {
    super();
  }

  eq(other: LinkWidget): boolean {
    return other.label === this.label && other.open === this.open;
  }

  toDOM(): HTMLElement {
    const element = document.createElement("button");
    element.type = "button";
    element.className =
      "cursor-pointer border border-dashed border-fd-primary px-2 py-0.5 text-left text-xs text-fd-primary";
    element.textContent = this.label;
    element.addEventListener("click", this.open);
    return element;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

/** The place the highlight box is painted into, held across every redraw. */
class BoxWidget extends WidgetType {
  constructor(readonly box: HTMLElement) {
    super();
  }

  eq(other: BoxWidget): boolean {
    return other.box === this.box;
  }

  toDOM(): HTMLElement {
    return this.box;
  }

  ignoreEvent(): boolean {
    return true;
  }
}
