// The editor captures the suggestion destination before entering the shared Effect flow.
import type { App, MarkdownFileInfo } from "obsidian";

import { observeExit } from "@zotlit/workbench/ui";

import { captureInsertion } from "@/views/annot-view/async-insert";
import { insertOutcomeMessage } from "@/views/annot-view/drag-insert";
import { startInsert } from "@/views/annot-view/insert-run";
import type { InsertFiber, InsertRunner } from "@/views/annot-view/insert-run";

import type { AnnotationHit } from "./annotation-search";

export interface AnnotationInsertDeps {
  app: App;
  workspace: Pick<App["workspace"], "on" | "offref">;
  /** Forks each insert on the plugin's lifetime: unload interrupts it. */
  runner: InsertRunner<never>;
  notify: (message: string | DocumentFragment) => void;
}

/**
 * Starts the insert of `hit` into the editor of `info` and shows its outcome.
 * Cancelling the destination or unloading the plugin interrupts the insert,
 * which shows nothing.
 *
 * @returns the insert in flight, or `undefined` where `info` holds no note.
 */
export function insertAnnotation(
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
): InsertFiber | undefined {
  const { editor, file } = info;
  if (!editor || !file) return;
  const fiber = startInsert(deps.runner, {
    hit,
    notePath: file.path,
    placement: { replacesTrigger: true },
    capture: () =>
      captureInsertion({
        editor,
        info,
        isCurrent,
        range,
        workspace: deps.workspace,
      }),
  });
  observeExit(fiber, {
    onSuccess: (outcome) => {
      const message = insertOutcomeMessage(deps.app, outcome);
      if (message !== null) deps.notify(message);
    },
  });
  return fiber;
}
