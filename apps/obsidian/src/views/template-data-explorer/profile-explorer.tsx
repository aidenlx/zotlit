// The sidebar follows one editor's Item and root, and sends insertion back to
// the slice that last held focus. Standalone exploration keeps its own Item.
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useStore } from "zustand";

import type { DisplayNode } from "@zotlit/workbench/explorer";
import {
  restoreTemplateData,
  SAMPLE_ANNOTATIONS,
} from "@zotlit/workbench/render";
import {
  DataExplorer,
  useDocumentRevision,
  useWorkbenchStore,
} from "@zotlit/workbench/ui";

import { Icon } from "@/components/obsidian/icon";
import { IconButton } from "@/components/obsidian/icon-button";
import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import { tooltipAttrs } from "@/lib/utils";
import { loadTemplateData } from "@/services/template-workbench/data";
import type { TemplateDataDeps } from "@/services/template-workbench/data";
import type { ProfileEditorView } from "@/views/profile-editor/view";

const logger = getLogger(["views", "template-data-explorer"]);

export function ProfileExplorer({
  editor,
  deps,
  isEtaEnabled,
}: {
  editor: ProfileEditorView;
  deps: TemplateDataDeps;
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
  const selection = useMemo(
    () => ({ snapshot, example, root, indexedKey: item?.id ?? null }),
    [snapshot, example, root, item?.id],
  );
  const [loaded, setLoaded] = useState<{
    selection: typeof selection;
    data: Record<string, unknown> | null;
  } | null>(null);
  useEffect(() => {
    let active = true;
    const { indexedKey, root, example, snapshot } = selection;
    if (!indexedKey || !snapshot || (root === "annotation" && !example)) return;
    void (async () => {
      const sample =
        root === "annotation" &&
        example &&
        SAMPLE_ANNOTATIONS.some(({ id }) => id === example.id);
      const key =
        root === "annotation" && !sample
          ? example?.root.indexedKey
          : indexedKey;
      if (typeof key !== "string") return;
      const result = await loadTemplateData(deps, key, sample ? "note" : root);
      const data =
        result.kind === "data"
          ? sample && example
            ? {
                ...restoreTemplateData(example.root, example.descriptors),
                parentItem: result.data,
              }
            : result.data
          : null;
      logger.trace("Loaded native Explorer context", {
        indexedKey: key,
        root,
        sample: Boolean(sample),
        applied: active,
        available: data !== null,
      });
      if (active)
        setLoaded({ selection, data: data as Record<string, unknown> | null });
    })().catch((error: unknown) => {
      logger.warn("Failed to load native Explorer context", {
        indexedKey,
        root,
        error,
      });
      if (active) setLoaded({ selection, data: null });
    });
    return () => {
      active = false;
    };
  }, [deps, selection]);
  const data = loaded?.selection === selection ? loaded.data : null;
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
      <div className="zt:flex zt:shrink-0 zt:items-center zt:gap-2 zt:border-b zt:border-border zt:px-3 zt:py-2">
        <Icon
          name="file-text"
          className="zt:shrink-0 zt:text-muted-foreground"
        />
        <span
          className="zt:line-clamp-2 zt:min-w-0 zt:flex-1 zt:text-sm zt:leading-normal"
          {...tooltipAttrs(item?.title ?? m.profile_editor_choose_paper())}
        >
          {item?.title ?? m.profile_editor_choose_paper()}
        </span>
        <IconButton
          icon="arrow-left-right"
          {...tooltipAttrs(m.profile_editor_choose_paper())}
          onClick={() => void editor.chooseItem()}
        />
      </div>
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
