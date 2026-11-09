// The Partial Placeholder: the box a pane draws over every `render` or
// `include` call that names a Shared Partial outright, the preview that opens
// under it, and the short marker a call to a partial the vault holds no
// document for carries instead.
//
// One pane, one open preview. A call the reader's selection touches shows as
// the source it is, which is the rule every box in Basic mode follows.

import type {
  PartialRenderSite,
  WorkbenchDocumentController,
  WorkbenchSliceId,
} from "#/document/index";
import { MapMode, StateEffect } from "@codemirror/state";
import type { EditorState, Extension } from "@codemirror/state";
import { Decoration, ViewPlugin } from "@codemirror/view";
import type { DecorationSet, EditorView } from "@codemirror/view";
import { useAtomValue } from "@effect/atom-react";
import { Cause } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import type * as Atom from "effect/reactivity/Atom";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

import { useUniqueId } from "@zotlit/ui";

import { PreviewWidget, boxAt, boxField, boxRanges } from "./editor-boxes";
import { useTooltip, useWorkbenchHost, WorkbenchHostError } from "./host";
import { useWorkbenchMessages } from "./messages";
import { useIcon, useParts } from "./theme";

import { documentRevision } from "#/document/atoms";
import { partialCalls } from "#/document/index";

/** What a failed partial render shows: the host failure's own cause, whole. */
function failureMessage(cause: Cause.Cause<unknown>): string {
  const failure = Cause.squash(cause);
  const error = failure instanceof WorkbenchHostError ? failure.cause : failure;
  return error instanceof Error ? error.message : String(error);
}

/**
 * What a host answers for the Shared Partials one pane's calls name. Opening a
 * partial is the host's own file operation, and the render reads whatever data
 * the pane's slice is previewed with.
 */
export interface PartialPlaceholderHost {
  /**
   * The partials the last render could not resolve, which is what marks a call
   * as a problem: a missing partial is the engine's own render failure.
   * @see docs/adr/0055-the-citation-template-is-one-document-and-partials-are-files.md
   */
  readonly missing: readonly string[];
  /** Opens the Shared Partial's own editor. */
  readonly onEdit: (name: string) => void;
  /**
   * Reads the missing partial's own problem in the editor's Problems area,
   * which is where the explanation and its suggestion live.
   */
  readonly onShowProblem: (name: string) => void;
  /**
   * The text `name` produces for the caller this pane's slice supplies, as an
   * atom keyed by the name. It renders again when the partial's own text or
   * the data it reads changes, and stops when no open preview reads it.
   */
  readonly preview: (
    name: string,
  ) => Atom.Atom<AsyncResult.AsyncResult<string, unknown>>;
}

/** One pane's Partial Placeholders: the editor extension, and their contents. */
export interface PartialBoxes {
  /** Pass to the pane's editor, which draws a box over every call. */
  readonly extensions: Extension;
  /** Render beside the editor; each box is painted through a portal. */
  readonly boxes: ReactNode;
}

/**
 * The boxes one pane draws over its Shared Partial calls. Without a `host`
 * every call stays as source, which is what a pane that offers no partial
 * actions shows.
 */
export function usePartialBoxes(
  controller: WorkbenchDocumentController,
  slice: WorkbenchSliceId,
  host: PartialPlaceholderHost | undefined,
): PartialBoxes {
  useAtomValue(documentRevision(controller));
  const previewId = useUniqueId();
  const [opened, setOpened] = useState<{
    controller: WorkbenchDocumentController;
    /** The call's own start, in master offsets, so every pane moves it alike. */
    position: number;
  } | null>(null);
  const range = controller.sliceRange(slice);
  const sites = host
    ? partialCalls(controller.state.doc.toString(), range, controller.language)
    : [];
  // Stable portal hosts let CodeMirror move the shared preview below its call
  // while React keeps the rendered text alive. Each is made on first use, so
  // the calls are read once per draw rather than once here and once again.
  const boxes = useMemo(
    () => new Map<number, HTMLElement>(),
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- the deps are the reset key: fresh hosts when the pane changes document or slice, so a box never carries over to another editor's calls
    [controller, slice],
  );
  const previewHost = useMemo(() => document.createElement("div"), []);
  const pane = useRef<EditorView | null>(null);
  // A box is drawn by its host's portal, so a pane with no host draws none.
  const hasHost = host !== undefined;
  const extensions = useMemo(
    () =>
      hasHost ? partialBoxes(boxes, previewHost, { pane, controller }) : [],
    [hasHost, boxes, previewHost, controller],
  );
  const expanded =
    opened?.controller === controller
      ? (sites.find(({ call }) => call.from === opened.position) ?? null)
      : null;
  // The open call is held in master offsets, so an edit made in another pane
  // keeps the preview on the call it belongs to.
  useEffect(
    () =>
      controller.subscribe(({ transaction, docChanged }) => {
        if (!docChanged) return;
        setOpened((current) => {
          if (current?.controller !== controller) return current;
          const position = transaction.changes.mapPos(
            current.position,
            -1,
            MapMode.TrackDel,
          );
          return position === null ? null : { controller, position };
        });
      }),
    [controller],
  );
  const line =
    expanded === null
      ? null
      : (pane.current?.state.doc.lineAt(expanded.call.to - range.from).to ??
        null);
  useEffect(() => {
    pane.current?.dispatch({ effects: expandPartial.of(line) });
  }, [line, extensions]);
  return {
    extensions,
    boxes: host && (
      <>
        {sites.map((site, index) =>
          createPortal(
            <PartialPlaceholder
              site={site}
              host={host}
              missing={host.missing.includes(site.name)}
              expanded={expanded?.call.from === site.call.from}
              previewId={previewId}
              onToggle={(pressed) =>
                setOpened(
                  pressed ? { controller, position: site.call.from } : null,
                )
              }
            />,
            boxAt(boxes, index),
            String(index),
          ),
        )}
        {expanded !== null &&
          createPortal(
            <PartialPreview
              id={previewId}
              preview={host.preview(expanded.name)}
            />,
            previewHost,
          )}
      </>
    ),
  };
}

function PartialPlaceholder({
  site,
  host,
  missing,
  expanded,
  previewId,
  onToggle,
}: {
  site: PartialRenderSite;
  host: PartialPlaceholderHost;
  missing: boolean;
  expanded: boolean;
  previewId: string;
  onToggle: (pressed: boolean) => void;
}) {
  const m = useWorkbenchMessages();
  const part = useParts("notePane");
  const icon = useIcon();
  const previewTooltip = useTooltip(m.workbench_partial_preview());
  const editTooltip = useTooltip(m.workbench_partial_edit());
  return (
    <span
      data-partial-box
      {...part("partial-box", missing ? "missing" : "known")}
    >
      <span {...part("partial-name")}>{site.name}</span>
      {site.arguments && (
        <span {...part("partial-arguments")}>{site.arguments}</span>
      )}
      {missing && (
        // A short marker, not an explanation: the source line keeps its shape
        // and the Problems area carries the reader's guidance.
        <button
          type="button"
          aria-label={m.workbench_partial_missing_show({ name: site.name })}
          onClick={() => host.onShowProblem(site.name)}
          {...part("partial-problem")}
        >
          {m.workbench_partial_missing()}
        </button>
      )}
      <span {...part("annotation-actions")}>
        {missing ? null : (
          <>
            <button
              type="button"
              {...part("annotation-toggle", expanded ? "active" : "inactive")}
              aria-label={m.workbench_partial_preview()}
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
              aria-label={m.workbench_partial_edit()}
              {...editTooltip}
              onClick={() => host.onEdit(site.name)}
            >
              {icon("edit")}
            </button>
          </>
        )}
      </span>
    </span>
  );
}

/** The partial's own text, rendered for the caller this pane supplies. */
function PartialPreview({
  id,
  preview,
}: {
  id: string;
  preview: Atom.Atom<AsyncResult.AsyncResult<string, unknown>>;
}) {
  const m = useWorkbenchMessages();
  const part = useParts("notePane");
  const { markdown: Markdown } = useWorkbenchHost();
  const result = useAtomValue(preview);
  const state = AsyncResult.isSuccess(result)
    ? { kind: "text" as const, text: result.value }
    : AsyncResult.isFailure(result)
      ? { kind: "error" as const, message: failureMessage(result.cause) }
      : null;
  return (
    <div id={id} data-partial-preview {...part("annotation-preview")}>
      {state?.kind === "error" && (
        <p {...part("annotation-problem")}>{state.message}</p>
      )}
      {state?.kind === "text" && Markdown ? (
        <Suspense
          fallback={<p {...part("pending")}>{m.workbench_result_pending()}</p>}
        >
          <Markdown
            surface="partial"
            markdown={state.text}
            properties={[]}
            showMarkdown={false}
          />
        </Suspense>
      ) : (
        state?.kind !== "error" && (
          <p {...part("pending")}>{m.workbench_result_pending()}</p>
        )
      )}
    </div>
  );
}

/** The line the open preview sits under, in this pane's own offsets. */
const expandPartial = StateEffect.define<number | null>();

function partialBoxes(
  boxes: Map<number, HTMLElement>,
  previewHost: HTMLElement,
  {
    pane,
    controller,
  }: {
    readonly pane: { current: EditorView | null };
    /** Read live, so a document switched to Eta redraws its boxes in the Eta form. */
    readonly controller: WorkbenchDocumentController;
  },
): Extension {
  function build(
    { doc, selection }: EditorState,
    expanded: number | null,
  ): DecorationSet {
    const body = doc.toString();
    const calls = partialCalls(
      body,
      { from: 0, to: body.length },
      controller.language,
    ).map(({ call }) => call);
    const ranges = boxRanges(calls, boxes, selection);
    if (
      expanded !== null &&
      calls.some((call) => doc.lineAt(call.to).to === expanded)
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

  return [
    boxField(expandPartial, build),
    // The pane's own view, so the hook can open a preview under its line.
    ViewPlugin.define((view) => {
      pane.current = view;
      return {
        destroy: () => {
          if (pane.current === view) pane.current = null;
        },
      };
    }),
  ];
}
