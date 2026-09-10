// Note placement: editable loops and Managed Blocks, with an example disclosure
// and a route to the shared format at every recognized annotation call.

import type {
  WorkbenchDocumentController,
  WorkbenchSliceRange,
} from "#/document/index";
import { MapMode, StateEffect } from "@codemirror/state";
import type { EditorState, Extension } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";
import { Suspense, useEffect, useId, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

import { useDocumentRevision } from "./editor";
import {
  PreviewWidget,
  boxAt,
  boxField,
  boxRanges,
  revealSourceOnClick,
} from "./editor-boxes";
import { useOptionalHost, useTooltip } from "./host";
import { useWorkbenchMessages } from "./messages";
import { usePartialBoxes } from "./partial-boxes";
import type { PartialPlaceholderHost } from "./partial-boxes";
import { SliceEditor } from "./slice-editor";
import type { SuggestionSource } from "./slice-editor";
import { useParts, useIcon } from "./theme";
import type { PartAttributes } from "./theme";

import { noteRegions } from "#/document/index";

export interface NotePaneProps {
  controller: WorkbenchDocumentController;
  reveal?: WorkbenchSliceRange | null;
  onSelection?: (selection: WorkbenchSliceRange) => void;
  suggest?: SuggestionSource;
  preview: string | null;
  /**
   * The choice the reader owes before a preview exists, which the example
   * region names in place of "Rendering…"; `null` while a render is on its way.
   */
  previewHint?: string | null;
  formatProblem: string | null;
  annotationSelector?: ReactNode;
  onOpenAnnotation: () => void;
  /** The Shared Partials this note's calls name; absent leaves them as source. */
  partials?: PartialPlaceholderHost;
}

export function NotePane({
  controller,
  reveal,
  onSelection,
  suggest,
  partials,
  ...example
}: NotePaneProps) {
  const m = useWorkbenchMessages();
  useDocumentRevision(controller);
  const part = useParts("notePane");
  const managedClass = part("managed-line").className;
  const labelClass = part("managed-label").className;
  const host = useRef<HTMLDivElement>(null);
  const previewId = useId();
  const [opened, setOpened] = useState<{
    controller: WorkbenchDocumentController;
    line: number;
  } | null>(null);
  const expanded = opened?.controller === controller ? opened.line : null;
  const localLine =
    expanded === null ? null : expanded - controller.sliceRange("note").from;
  // Stable portal hosts let CodeMirror move the shared preview below its call
  // while React keeps the selector and rendered example alive.
  const boxes = useMemo(
    () =>
      new Map<number, HTMLElement>(
        controller.noteRegions.annotationCalls.map((_, index) => [
          index,
          document.createElement("span"),
        ]),
      ),
    [controller],
  );
  const previewHost = useMemo(() => document.createElement("div"), []);
  const managedStart = m.workbench_managed_start();
  const managedEnd = m.workbench_managed_end();
  const partialBoxes = usePartialBoxes(controller, "note", partials);
  const noteExtensions = useMemo(
    () =>
      noteBoxes(boxes, previewHost, {
        labels: { start: managedStart, end: managedEnd },
        parts: {
          managed: { "data-part": "managed-line", className: managedClass },
          label: { "data-part": "managed-label", className: labelClass },
        },
      }),
    [boxes, previewHost, managedClass, labelClass, managedStart, managedEnd],
  );
  const extensions = useMemo(
    () => [noteExtensions, partialBoxes.extensions],
    [noteExtensions, partialBoxes.extensions],
  );
  // The active line lives in master offsets so both Note and Source edits move
  // it with the text. Every call on that line reads this one selection.
  useEffect(
    () =>
      controller.subscribe(({ transaction, docChanged }) => {
        if (!docChanged) return;
        const { doc } = transaction.state;
        const lines = new Set(
          controller.noteRegions.annotationCalls.map(
            ({ call }) => doc.lineAt(call.to).to,
          ),
        );
        setOpened((current) => {
          if (current?.controller !== controller) return current;
          const position = transaction.changes.mapPos(
            current.line,
            -1,
            MapMode.TrackDel,
          );
          const line = position === null ? null : doc.lineAt(position).to;
          return line !== null && lines.has(line) ? { controller, line } : null;
        });
      }),
    [controller],
  );
  useEffect(() => {
    const element = host.current?.querySelector<HTMLElement>(".cm-editor");
    const view = element && EditorView.findFromDOM(element);
    view?.dispatch({ effects: expandPreview.of(localLine) });
  }, [localLine, extensions]);
  useEffect(() => {
    const element = host.current?.querySelector<HTMLElement>(".cm-editor");
    if (element) EditorView.findFromDOM(element)?.requestMeasure();
  }, [example.preview, example.previewHint, example.formatProblem]);
  return (
    <div ref={host} {...part("note-pane")}>
      <SliceEditor
        controller={controller}
        slice="note"
        label={m.workbench_tab_note()}
        extensions={extensions}
        reveal={reveal}
        suggest={suggest}
        onSelection={onSelection}
      />
      {controller.noteRegions.annotationCalls.map(({ call }, index) => {
        const line = controller.state.doc.lineAt(call.to).to;
        return createPortal(
          <AnnotationPlaceholder
            expanded={expanded === line}
            previewId={previewId}
            onToggle={(pressed) =>
              setOpened(pressed ? { controller, line } : null)
            }
            onOpenAnnotation={example.onOpenAnnotation}
          />,
          boxAt(boxes, index),
          String(index),
        );
      })}
      {expanded !== null &&
        createPortal(
          <AnnotationPreview {...example} id={previewId} />,
          previewHost,
        )}
      {partialBoxes.boxes}
    </div>
  );
}

function AnnotationPlaceholder({
  expanded,
  previewId,
  onToggle,
  onOpenAnnotation,
}: {
  expanded: boolean;
  previewId: string;
  onToggle: (pressed: boolean) => void;
  onOpenAnnotation: () => void;
}) {
  const m = useWorkbenchMessages();
  const part = useParts("notePane");
  const icon = useIcon();
  const previewTooltip = useTooltip(m.workbench_annotation_preview());
  const editTooltip = useTooltip(m.workbench_annotation_edit_format());
  return (
    <span data-annotation-box {...part("annotation-box")}>
      <span {...part("annotation-label")}>{m.workbench_annotation_slot()}</span>
      <span {...part("annotation-actions")}>
        <button
          type="button"
          {...part("annotation-toggle", expanded ? "active" : "inactive")}
          aria-label={m.workbench_annotation_preview()}
          {...previewTooltip}
          aria-pressed={expanded}
          aria-controls={expanded ? previewId : undefined}
          onClick={() => onToggle(!expanded)}
        >
          {icon("preview")}
        </button>
        <button
          type="button"
          {...part("annotation-edit")}
          aria-label={m.workbench_annotation_edit_format()}
          {...editTooltip}
          onClick={onOpenAnnotation}
        >
          {icon("edit")}
        </button>
      </span>
    </span>
  );
}

function AnnotationPreview({
  id,
  preview,
  previewHint = null,
  formatProblem,
  annotationSelector,
}: Pick<
  NotePaneProps,
  "preview" | "previewHint" | "formatProblem" | "annotationSelector"
> & {
  id: string;
}) {
  const m = useWorkbenchMessages();
  const part = useParts("notePane");
  const Markdown = useOptionalHost()?.markdown;
  return (
    <div id={id} data-annotation-preview {...part("annotation-preview")}>
      <div {...part("annotation-selector")}>{annotationSelector}</div>
      {formatProblem !== null && (
        <p {...part("annotation-problem")}>{formatProblem}</p>
      )}
      {preview !== null && Markdown ? (
        <Suspense
          fallback={<p {...part("pending")}>{m.workbench_result_pending()}</p>}
        >
          <Markdown markdown={preview} properties={[]} showMarkdown={false} />
        </Suspense>
      ) : (
        formatProblem === null && (
          <p {...part("pending")}>
            {previewHint ?? m.workbench_result_pending()}
          </p>
        )
      )}
    </div>
  );
}

const expandPreview = StateEffect.define<number | null>();

function noteBoxes(
  boxes: Map<number, HTMLElement>,
  previewHost: HTMLElement,
  {
    parts,
    labels,
  }: {
    parts: { managed: PartAttributes; label: PartAttributes };
    labels: { start: string; end: string };
  },
): Extension {
  function build(
    { doc, selection }: EditorState,
    expanded: number | null,
  ): DecorationSet {
    const body = doc.toString();
    const { annotationCalls, managedBlock } = noteRegions(body, {
      from: 0,
      to: body.length,
    });
    const ranges = boxRanges(
      annotationCalls.map(({ call }) => call),
      boxes,
      selection,
    );
    const selected = ({ from, to }: WorkbenchSliceRange) =>
      selection.ranges.some((range) => range.from <= to && range.to >= from);
    if (managedBlock) {
      const last = doc.lineAt(managedBlock.range.to).number;
      for (
        let line = doc.lineAt(managedBlock.range.from).number;
        line <= last;
        line += 1
      ) {
        ranges.push(
          Decoration.line({
            attributes: {
              "data-part": parts.managed["data-part"],
              class: parts.managed.className ?? "",
            },
          }).range(doc.line(line).from),
        );
      }
      for (const [tag, label] of [
        [managedBlock.open, labels.start],
        [managedBlock.close, labels.end],
      ] as const) {
        if (selected(tag)) continue;
        ranges.push(
          Decoration.replace({
            widget: new LabelWidget(label, tag, parts.label),
          }).range(tag.from, tag.to),
        );
      }
    }
    if (
      expanded !== null &&
      annotationCalls.some(({ call }) => doc.lineAt(call.to).to === expanded)
    ) {
      ranges.push(
        Decoration.widget({
          widget: new PreviewWidget(previewHost),
          block: true,
          side: 1,
        }).range(expanded),
      );
    }
    return Decoration.set(ranges, true);
  }

  return boxField(expandPreview, build);
}

/** A beginner name in place of a raw tag the reader does not have to read. */
class LabelWidget extends WidgetType {
  constructor(
    readonly label: string,
    readonly range: WorkbenchSliceRange,
    readonly part: PartAttributes,
  ) {
    super();
  }

  eq(other: LabelWidget): boolean {
    return (
      other.label === this.label &&
      other.range.from === this.range.from &&
      other.range.to === this.range.to
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const element = document.createElement("span");
    element.dataset.part = this.part["data-part"];
    if (this.part.className) element.className = this.part.className;
    element.textContent = this.label;
    revealSourceOnClick(element, view, this.range);
    return element;
  }
}
