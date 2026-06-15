import { useAtomValue, useSetAtom } from "jotai";
import { useContext, useState } from "react";

import { IconButton } from "@/components/obsidian/icon-button";
import { tooltipAttrs } from "@/lib/utils";
import * as m from "@/paraglide/messages";

import { AnnotActionsContext } from "./actions";
import { Annotation } from "./Annotation";
import {
  activeAttachmentAtom,
  allAttachmentsAtom,
  annotationsAtom,
  attachmentIDAtom,
  docAtom,
  followAtom,
  tagsAtom,
} from "./store";

export function AnnotView() {
  const doc = useAtomValue(docAtom);
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <Toolbar
        hasDoc={doc !== null}
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((c) => !c)}
      />
      {doc === null ? (
        <div className="pane-empty p-2">{m.annot_view_empty()}</div>
      ) : (
        <AnnotList collapsed={collapsed} />
      )}
    </div>
  );
}

interface ToolbarProps {
  hasDoc: boolean;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

function Toolbar({ hasDoc, collapsed, onToggleCollapsed }: ToolbarProps) {
  const actions = useContext(AnnotActionsContext);
  const doc = useAtomValue(docAtom);

  return (
    <div className="nav-header">
      <div className="nav-buttons-container">
        {hasDoc && doc && (
          <>
            <IconButton
              className="nav-action-button"
              icon="info"
              onClick={() => actions.onShowDetails("doc-item", doc.itemID)}
              {...tooltipAttrs(m.annot_view_details_tooltip())}
            />
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
        <FollowButton />
      </div>
      {hasDoc && <AttachmentSelector />}
    </div>
  );
}

function FollowButton() {
  const follow = useAtomValue(followAtom);
  const actions = useContext(AnnotActionsContext);

  return (
    <span className="flex items-center">
      <IconButton
        className="nav-action-button"
        icon={follow === null ? "unlink" : "link"}
        active={follow === null}
        onClick={(e) => actions.onSetFollow(e)}
        {...tooltipAttrs(m.annot_view_follow_tooltip())}
      />
      {follow !== null && (
        <span className="ml-1 text-xs text-muted-foreground">
          {follow === "ob-note" ? "ob" : "zt"}
        </span>
      )}
    </span>
  );
}

function AttachmentSelector() {
  const attachments = useAtomValue(allAttachmentsAtom);
  const active = useAtomValue(activeAttachmentAtom);
  const setAttachmentID = useSetAtom(attachmentIDAtom);

  if (!attachments)
    return <span className="text-xs">{m.annot_view_loading()}</span>;
  if (attachments.length === 0) {
    return <span className="text-xs">{m.annot_view_no_attachments()}</span>;
  }
  if (attachments.length === 1) return null;

  return (
    <select
      className="dropdown"
      value={String(active?.itemID ?? "")}
      onChange={(e) => setAttachmentID(Number(e.currentTarget.value))}
    >
      {attachments.map((atch) => (
        <option key={atch.itemID} value={atch.itemID}>
          ({atch.annotCount}) {atch.path?.replace(/^storage:/, "")}
        </option>
      ))}
    </select>
  );
}

function AnnotList({ collapsed }: { collapsed: boolean }) {
  const annotations = useAtomValue(annotationsAtom);
  const tags = useAtomValue(tagsAtom);
  const attachment = useAtomValue(activeAttachmentAtom);

  if (!annotations || !attachment) {
    return <div className="pane-empty p-2">{m.annot_view_loading()}</div>;
  }

  return (
    <div className="annots-container @container min-h-0 flex-1 overflow-auto px-3 pt-1 pb-8 text-xs">
      <div className="columns-1 gap-2 @md:columns-2 @md:gap-3 @2xl:columns-3 @4xl:columns-4">
        {annotations.map((annot) => (
          <Annotation
            key={annot.itemID}
            annot={annot}
            tags={tags[annot.itemID] ?? []}
            collapsed={collapsed}
          />
        ))}
      </div>
    </div>
  );
}
