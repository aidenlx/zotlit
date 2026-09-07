// The sidebar follows one editor's Item and root, and sends insertion back to
// the slice that last held focus. Standalone exploration keeps its own Item.
import { useMemo, useSyncExternalStore } from "react";
import { useStore } from "zustand";

import type { DisplayNode } from "@zotlit/workbench/explorer";
import { restoreTemplateData } from "@zotlit/workbench/render";
import {
  DataExplorer,
  useDocumentRevision,
  useWorkbenchStore,
} from "@zotlit/workbench/ui";

import * as m from "@/lib/i18n/generated/messages";
import { tooltipAttrs } from "@/lib/utils";
import type { ProfileEditorView } from "@/views/profile-editor/view";

export function ProfileExplorer({
  editor,
  isEtaEnabled,
}: {
  editor: ProfileEditorView;
  isEtaEnabled: () => boolean;
}) {
  const preview = editor.preview!;
  const snapshot = useStore(preview.state, (state) => state.snapshot);
  const example = useStore(preview.state, (state) => state.example);
  const item = useWorkbenchStore((state) => state.item);
  const root = useWorkbenchStore((state) => state.root);
  const target = useSyncExternalStore(
    editor.subscribeInsertion,
    () => editor.insertTarget,
  );
  const controller = editor.controller;
  useDocumentRevision(controller);
  const region = target
    ? controller.templateRegions.find(
        (region) =>
          target.range.from >= region.from && target.range.to <= region.to,
      )
    : undefined;
  const mode = region?.expression
    ? "expression"
    : region?.language === "json-e"
      ? "json-e"
      : "template";
  const language =
    controller.document?.manifest.language === "eta" ? "eta" : "liquid";
  const data = useMemo(
    () =>
      snapshot
        ? root === "annotation"
          ? example
            ? restoreTemplateData(example.root, example.descriptors)
            : null
          : restoreTemplateData(
              snapshot.roots[root],
              snapshot.descriptors[root],
            )
        : null,
    [snapshot, root, example],
  );
  const annotationKey = (node: DisplayNode): string | null => {
    if (
      root !== "note" ||
      node.path.length !== 2 ||
      typeof node.path[1] !== "number" ||
      node.path[0] !== "annotations" ||
      node.kind !== "value" ||
      typeof node.value !== "object" ||
      node.value === null ||
      !("key" in node.value)
    )
      return null;
    return typeof node.value.key === "string" ? node.value.key : null;
  };
  return (
    <div className="zt:flex zt:h-full zt:min-h-0 zt:flex-col">
      <button
        className="zt:m-2 zt:min-w-0"
        {...tooltipAttrs(item?.title ?? m.profile_editor_choose_paper())}
        onClick={() => void editor.chooseItem()}
      >
        <span className="zt:min-w-0 zt:truncate">
          {item?.title ?? m.profile_editor_choose_paper()}
        </span>
      </button>
      <DataExplorer
        root={root}
        data={data}
        mode={mode}
        engine={language}
        engines={() => (isEtaEnabled() ? ["liquid", "eta"] : ["liquid"])}
        copy={(text) => navigator.clipboard.writeText(text)}
        disabled={target === null}
        onInsert={(snippet) => editor.insertField(snippet)}
        canExploreAnnotation={(node) =>
          controller.annotationSection !== null && annotationKey(node) !== null
        }
        onExploreAnnotation={(node) => {
          const key = annotationKey(node);
          if (key) editor.exploreAnnotation(key);
        }}
      />
    </div>
  );
}
