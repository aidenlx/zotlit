// The editor captures the suggestion destination before entering the shared Effect flow.
import type { App, MarkdownFileInfo } from "obsidian";

import { valueOr } from "@/lib/effect-bridge";
import type { EffectBridge } from "@/lib/effect-bridge";
import type { AnnotationNoteActions } from "@/services/note-feature/view-actions";
import { captureInsertion } from "@/views/annot-view/async-insert";
import { insertOutcomeMessage } from "@/views/annot-view/drag-insert";

import type { AnnotationHit } from "./annotation-search";

export interface AnnotationInsertDeps {
  app: App;
  workspace: Pick<App["workspace"], "on" | "offref">;
  bridge: Pick<EffectBridge, "runPromiseExit" | "runSync">;
  annotationNotes: Pick<AnnotationNoteActions["Service"], "insert">;
  notify: (message: string | DocumentFragment) => void;
}

export async function insertAnnotation(
  deps: AnnotationInsertDeps,
  {
    hit,
    info,
    isCurrent,
    range,
  }: {
    hit: AnnotationHit;
    info: MarkdownFileInfo;
    isCurrent: () => boolean;
    range: { from: number; to: number };
  },
) {
  const { editor, file } = info;
  if (!editor || !file) return;
  using target = captureInsertion({
    editor,
    info,
    isCurrent,
    range,
    workspace: deps.workspace,
  });
  // The bridge takes a signal at this EditorSuggest edge.
  const cancelled = new AbortController();
  const release = target.onCancel(() => cancelled.abort());
  using _listener = { [Symbol.dispose]: release };
  const outcome = valueOr(
    await deps.bridge.runPromiseExit(
      deps.annotationNotes.insert({
        hit,
        target,
        notePath: file.path,
        placement: { replacesTrigger: true },
      }),
      { signal: cancelled.signal },
    ),
    undefined,
  );
  if (outcome) {
    const message = insertOutcomeMessage(deps.app, outcome);
    if (message !== null) deps.notify(message);
  }
  return outcome;
}
