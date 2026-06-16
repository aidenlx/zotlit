import { useAtomValue, useSetAtom } from "jotai";
import { useContext, useState } from "react";

import { IconButton } from "@/components/obsidian/icon-button";
import { tooltipAttrs } from "@/lib/utils";
import * as m from "@/paraglide/messages";

import { AnnotActionsContext } from "./actions";
import { Annotation } from "./Annotation";
import {
  activeAttachmentAtom,
  annotationsAtom,
  attachmentIDAtom,
  attachmentsAtom,
  itemKeyAtom,
} from "./store";

export function AnnotView() {
  const itemKey = useAtomValue(itemKeyAtom);
  const attachments = useAtomValue(attachmentsAtom);
  const [collapsed, setCollapsed] = useState(false);

  const hasItem =
    itemKey !== null && attachments !== null && attachments.length > 0;

  return (
    <div className="zt:@container zt:flex zt:h-full zt:flex-col zt:overflow-hidden">
      <Toolbar
        hasItem={hasItem}
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((c) => !c)}
      />
      {itemKey === null ? (
        <div className="pane-empty zt:p-2">{m.annot_view_empty()}</div>
      ) : attachments === null ? (
        <div className="pane-empty zt:p-2">{m.annot_view_loading()}</div>
      ) : attachments.length === 0 ? (
        <div className="pane-empty zt:p-2">{m.annot_view_no_attachments()}</div>
      ) : (
        <AnnotList collapsed={collapsed} />
      )}
    </div>
  );
}

interface ToolbarProps {
  hasItem: boolean;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

function Toolbar({ hasItem, collapsed, onToggleCollapsed }: ToolbarProps) {
  const actions = useContext(AnnotActionsContext);

  return (
    <div className="nav-header zt:flex zt:flex-col zt:gap-2 zt:@sm:flex-row zt:@sm:items-center">
      <div className="nav-buttons-container zt:@sm:w-auto zt:@sm:shrink-0">
        {hasItem && (
          <>
            <IconButton
              className="nav-action-button"
              icon={collapsed ? "chevrons-up-down" : "chevrons-down-up"}
              active={collapsed}
              onClick={onToggleCollapsed}
              {...tooltipAttrs(
                collapsed
                  ? m.annot_view_expand_tooltip()
                  : m.annot_view_collapse_tooltip(),
              )}
            />
            <IconButton
              className="nav-action-button"
              icon="refresh-ccw"
              onClick={() => actions.onRefresh()}
              {...tooltipAttrs(m.annot_view_refresh_tooltip())}
            />
          </>
        )}
      </div>
      {hasItem && <AttachmentSelector />}
    </div>
  );
}

function AttachmentSelector() {
  const attachments = useAtomValue(attachmentsAtom);
  const active = useAtomValue(activeAttachmentAtom);
  const setAttachmentID = useSetAtom(attachmentIDAtom);

  if (!attachments || attachments.length <= 1) return null;

  return (
    <div className="zt:mx-auto zt:w-full zt:max-w-xs zt:min-w-0 zt:@sm:mx-0">
      <select
        className="dropdown zt:w-full zt:truncate"
        value={String(active?.itemID ?? "")}
        onChange={(e) => setAttachmentID(Number(e.currentTarget.value))}
      >
        {attachments.map((atch) => (
          <option key={atch.itemID} value={atch.itemID}>
            ({atch.annotCount}) {atch.path?.replace(/^storage:/, "")}
          </option>
        ))}
      </select>
    </div>
  );
}

function AnnotList({ collapsed }: { collapsed: boolean }) {
  const annotations = useAtomValue(annotationsAtom);
  const attachment = useAtomValue(activeAttachmentAtom);

  if (!annotations || !attachment) {
    return <div className="pane-empty zt:p-2">{m.annot_view_loading()}</div>;
  }

  return (
    <div className="annots-container zt:@container zt:min-h-0 zt:flex-1 zt:overflow-auto zt:px-3 zt:pt-1 zt:pb-8 zt:text-xs">
      <div className="zt:columns-1 zt:gap-2 zt:@md:columns-2 zt:@md:gap-3 zt:@2xl:columns-3 zt:@4xl:columns-4">
        {annotations.map((annot) => (
          <Annotation key={annot.itemID} annot={annot} collapsed={collapsed} />
        ))}
      </div>
    </div>
  );
}
