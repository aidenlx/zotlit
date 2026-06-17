import { useContext, useState } from "react";

import { IconButton } from "@/components/obsidian/icon-button";
import { tooltipAttrs } from "@/lib/utils";
import * as m from "@/paraglide/messages";

import { AnnotActionsContext } from "./actions";
import { Annotation } from "./Annotation";
import {
  selectActiveAttachment,
  useAnnotStore,
  useSetSelectedAttachmentID,
} from "./store";

export function AnnotView() {
  const itemKey = useAnnotStore((s) => s.itemKey);
  const attachments = useAnnotStore((s) => s.attachments);
  const followMode = useAnnotStore((s) => s.followMode);
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
      <ItemIdentityLabel />
      {itemKey === null ? (
        <div className="pane-empty zt:p-2">
          {followMode === "reader"
            ? m.annot_view_empty_reader()
            : followMode === "linked"
              ? m.annot_view_empty_linked()
              : m.annot_view_empty()}
        </div>
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
  const followMode = useAnnotStore((s) => s.followMode);

  return (
    <div className="nav-header zt:flex zt:flex-col zt:gap-2 zt:@sm:flex-row zt:@sm:items-center">
      <div className="nav-buttons-container zt:@sm:w-auto zt:@sm:shrink-0">
        <FollowControls />
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
      {hasItem && followMode !== "reader" && <AttachmentSelector />}
    </div>
  );
}

function FollowControls() {
  const actions = useContext(AnnotActionsContext);
  const followMode = useAnnotStore((s) => s.followMode);
  const serverAvailable = useAnnotStore((s) => s.serverAvailable);

  const followingReader = followMode === "reader";
  const isLinked = followMode === "linked";

  const readerTooltip = followingReader
    ? m.annot_view_follow_reader_active_tooltip()
    : serverAvailable
      ? m.annot_view_follow_reader_tooltip()
      : m.annot_view_follow_reader_disabled_tooltip();

  return (
    <>
      <IconButton
        className="nav-action-button zt:data-[active]:text-accent-foreground"
        icon="book-open"
        active={followingReader}
        data-active={followingReader ? "" : undefined}
        disabled={!serverAvailable && !followingReader}
        onClick={() => actions.onToggleFollowReader()}
        {...tooltipAttrs(readerTooltip)}
      />
      <IconButton
        className="nav-action-button zt:data-[active]:text-accent-foreground"
        icon={isLinked ? "unlink" : "link"}
        active={isLinked}
        data-active={isLinked ? "" : undefined}
        onClick={() =>
          isLinked ? actions.onUnlinkItem() : actions.onLinkItem()
        }
        {...tooltipAttrs(
          isLinked
            ? m.annot_view_unlink_tooltip()
            : m.annot_view_link_tooltip(),
        )}
      />
    </>
  );
}

function ItemIdentityLabel() {
  const followMode = useAnnotStore((s) => s.followMode);
  const label = useAnnotStore((s) => s.itemDisplayLabel);

  if (followMode === "note" || !label) return null;

  return (
    <div className="zt:truncate zt:px-3 zt:pb-1 zt:text-xs zt:text-muted-foreground">
      {label}
    </div>
  );
}

function AttachmentSelector() {
  const attachments = useAnnotStore((s) => s.attachments);
  const active = useAnnotStore(selectActiveAttachment);
  const setAttachmentID = useSetSelectedAttachmentID();

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
  const annotations = useAnnotStore((s) => s.annotations);
  const attachment = useAnnotStore(selectActiveAttachment);

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
