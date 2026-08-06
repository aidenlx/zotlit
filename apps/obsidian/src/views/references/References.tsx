import { type IconName } from "obsidian";
import { type MouseEvent, type ReactNode } from "react";

import { Button } from "@/components/obsidian/button";
import { Icon } from "@/components/obsidian/icon";
import { IconButton } from "@/components/obsidian/icon-button";
import * as m from "@/lib/i18n/generated/messages";
import { useDomContent } from "@/lib/sanitize-html";
import { cn, tooltipAttrs } from "@/lib/utils";
import {
  type PandocEngineFailure,
  type PandocEngineStatus,
} from "@/services/pandoc/service";

import { useReferenceActions } from "./actions";
import { type ReferenceEntry } from "./entries";
import { useReferencesStore } from "./store";

/**
 * The pane: the engine surface above, the reference list below. The list is a
 * `ul` — a bare `ol` keeps Obsidian's own unlayered numbering, which would
 * double the Reference Numbers the entries already carry.
 */
export function References() {
  const entries = useReferencesStore((s) => s.entries);
  const engine = useReferencesStore((s) => s.engine);
  const dbReady = useReferencesStore((s) => s.dbReady);

  return (
    <div className="zt:flex zt:h-full zt:flex-col zt:overflow-y-auto">
      <div className="zt:px-3 zt:pt-2">
        <EngineSurface status={engine} />
      </div>
      {entries.length === 0 ? (
        <div className="pane-empty zt:p-2">
          {dbReady ? m.references_empty() : m.references_db_unavailable()}
        </div>
      ) : (
        <ul className="zt:flex zt:flex-col zt:text-sm">
          {entries.map((entry) => (
            <Reference key={entry.indexedKey} entry={entry} />
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Fades a secondary action in on hover or keyboard focus. The opening delay
 * sits only on the hover variant, so collapsing and keyboard focus both stay
 * instant. Shared, so every action in a row reveals on the same beat.
 */
const revealOnHover =
  "zt:opacity-0 zt:transition-opacity zt:delay-0 zt:duration-150 zt:group-focus-within:opacity-100 zt:group-hover:opacity-100 zt:group-hover:delay-100";

/**
 * A flat row: Reference Number, entry text with a hover/focus-revealed toolbar
 * underneath, and an action column on the right. The text is inert and
 * selectable — it renders what the engine formatted, so it can be copied out
 * whole. Nothing the reader can act on overlaps the text.
 */
function Reference({ entry }: { entry: ReferenceEntry }) {
  const actions = useReferenceActions();
  const isMissing = entry.kind === "missing";
  const occurrenceCount = entry.occurrences.length;

  return (
    <li>
      <div className="zt:group zt:flex zt:items-baseline zt:gap-2 zt:border-b zt:border-border zt:px-3 zt:py-2">
        <span
          className={cn(
            "zt:w-5 zt:shrink-0 zt:text-right zt:text-xs zt:text-muted-foreground zt:tabular-nums",
            isMissing && "zt:text-destructive",
          )}
        >
          {isMissing ? "⚠" : entry.refNumber}
        </span>
        <div className="zt:min-w-0 zt:flex-1">
          {/* Selectable, so a formatted entry can be copied out of the pane
              whole. Nothing else lives in this flow — the occurrence count
              rides with the jump button instead, where a selection cannot
              sweep it up. */}
          <div className="zt:select-text">
            <ReferenceBody entry={entry} />
          </div>
          {/* Collapsed to zero height as a class, never an inline style — an
              inline style on this element would outrank the hover/focus
              classes below and the toolbar could never open. */}
          {entry.kind !== "missing" && (
            <div className="zt:grid zt:grid-rows-[0fr] zt:transition-[grid-template-rows] zt:delay-0 zt:duration-150 zt:ease-out zt:group-focus-within:grid-rows-[1fr] zt:group-hover:grid-rows-[1fr] zt:group-hover:delay-100">
              <div className={cn("zt:overflow-hidden", revealOnHover)}>
                <div className="zt:flex zt:items-center zt:gap-0.5 zt:pt-1">
                  <EntryAction
                    icon="external-link"
                    label={m.references_open_in_zotero()}
                    onClick={() => actions.onOpenInZotero(entry.source)}
                  />
                  {/* Dropped outright when the Item stores nothing to open —
                      the row keeps "Open in Zotero" either way, so the toolbar
                      never empties. */}
                  {entry.source.attachments.length > 0 && (
                    <EntryAction
                      icon="paperclip"
                      label={m.references_open_attachment()}
                      onClick={(event) =>
                        actions.onOpenAttachment(entry.source, event)
                      }
                    />
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
        {/* The jump button leads and stays painted; the note button keeps its
            box underneath while unpainted, so neither target moves when hover
            reveals the second one. */}
        <div className="zt:flex zt:shrink-0 zt:flex-col zt:items-end zt:self-start">
          {/* Live even on a missing entry: the citation is still in the
              document, and jumping to it is how the reader goes to fix it. */}
          <div className="zt:relative">
            <EntryAction
              icon="chevron-right"
              label={m.references_go_to_occurrence({ count: occurrenceCount })}
              onClick={() => actions.onSelect(entry)}
            />
            {/* The count rides in the button's top-left corner, which a
                chevron leaves empty, rather than beside it — a badge in the
                flow would widen the column on every multiply-cited row. It is
                a visual echo only; the button's tooltip already says the
                count out loud, since a bare number reads as part of the
                citation rather than as a count of citations. */}
            {occurrenceCount > 1 && (
              <span
                aria-hidden
                className="zt:pointer-events-none zt:absolute zt:top-0 zt:left-0 zt:text-[0.625rem] zt:leading-none zt:text-muted-foreground zt:tabular-nums"
              >
                {occurrenceCount}
              </span>
            )}
          </div>
          {/* The fade rides a wrapper, never the button: Obsidian's unlayered
              `.clickable-icon[aria-disabled="true"] { opacity: .4 }` outranks
              the whole utilities layer, so on a missing entry an opacity class
              on the button itself loses and it would sit permanently visible.
              That same rule is what dims the button once revealed — disabled
              rather than hidden there, so the row keeps its shape and the
              tooltip carries the reason. */}
          <div className={revealOnHover}>
            <EntryAction
              icon="file-text"
              label={
                isMissing
                  ? m.references_open_note_missing()
                  : m.references_open_note()
              }
              disabled={isMissing}
              onClick={() => actions.onOpenNote(entry)}
            />
          </div>
        </div>
      </div>
    </li>
  );
}

function ReferenceBody({ entry }: { entry: ReferenceEntry }) {
  const textClass = "zt:font-content zt:text-sm zt:leading-snug";
  switch (entry.kind) {
    case "rendered":
      return (
        <RenderedEntry
          content={entry.content}
          className={cn(textClass, "zt:text-foreground")}
        />
      );
    case "summary":
      return (
        <span className={cn(textClass, "zt:text-foreground")}>
          {entry.source.summary}
        </span>
      );
    case "missing":
      return (
        <span className={cn(textClass, "zt:text-destructive")}>
          {m.references_item_missing({ linkpath: entry.linkpath })}
        </span>
      );
  }
}

function RenderedEntry({
  content,
  className,
}: {
  content: DocumentFragment;
  className?: string;
}) {
  return (
    <span className={className} ref={useDomContent<HTMLSpanElement>(content)} />
  );
}

function EntryAction({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: IconName;
  label: string;
  onClick: (event: MouseEvent<HTMLElement>) => void;
  disabled?: boolean;
}) {
  return (
    <IconButton
      icon={icon}
      onClick={onClick}
      disabled={disabled}
      // A clickable-icon defaults to ribbon proportions — an 18px glyph in a
      // 30x26 box — which dwarfs the 13px entry text it sits beside. Trim the
      // glyph and the box so an action reads as a footnote to the entry.
      className="zt:p-1 zt:[--icon-size:14px]"
      {...tooltipAttrs(label)}
    />
  );
}

/**
 * The one surface the engine speaks through: the dismissible install hint while
 * the engine is merely absent, and one named callout per genuine failure. Both
 * sit above the same reference list, which stays the sidebar's normal content.
 */
function EngineSurface({ status }: { status: PandocEngineStatus }) {
  const actions = useReferenceActions();

  switch (status.kind) {
    case "installed":
    case "declined":
      return null;
    case "absent":
      return (
        <Callout
          type="tip"
          icon="quote"
          title={m.references_engine_hint_title()}
          onDismiss={actions.onDismissEngineHint}
        >
          <p className="zt:mb-2">{m.references_engine_hint_body()}</p>
          <Button variant="cta" onClick={actions.onOpenEngineSettings}>
            {m.references_engine_open_settings()}
          </Button>
        </Callout>
      );
    case "installing":
      return (
        <Callout
          type="info"
          icon="download"
          title={m.notice_pandoc_engine_downloading()}
        >
          <p>{m.settings_citation_engine_status_installing()}</p>
        </Callout>
      );
    case "failed":
      return (
        <Callout
          type="warning"
          icon="alert-triangle"
          title={m.references_engine_failed_title()}
        >
          <p className="zt:mb-2">{failureSentence(status.failure)}</p>
          <Button variant="cta" onClick={actions.onOpenEngineSettings}>
            {m.references_engine_open_settings()}
          </Button>
        </Callout>
      );
  }
}

/** One sentence per arm, shared with the settings row that offers the fix. */
function failureSentence(failure: PandocEngineFailure): string {
  switch (failure.code) {
    case "download-failed":
      return m.settings_citation_engine_status_download_failed({
        detail: failure.detail,
      });
    case "hash-mismatch":
      return m.settings_citation_engine_status_hash_mismatch();
    case "init-failed":
      return m.settings_citation_engine_status_init_failed({
        detail: failure.detail,
      });
  }
}

/**
 * Obsidian's own callout markup, so the surface picks up the theme's callout
 * colors. `.callout` carries an unlayered `margin: 1em 0`; only an inline style
 * can pull the top edge back to the pane.
 */
function Callout({
  type,
  icon,
  title,
  onDismiss,
  children,
}: {
  type: string;
  icon: IconName;
  title: string;
  onDismiss?: () => void;
  children: ReactNode;
}) {
  return (
    <div className="callout" data-callout={type} style={{ marginTop: 0 }}>
      <div className="callout-title">
        <div className="callout-icon">
          <Icon name={icon} />
        </div>
        <div className="callout-title-inner">{title}</div>
        {onDismiss && (
          <IconButton
            className="zt:ml-auto"
            icon="x"
            onClick={onDismiss}
            {...tooltipAttrs(m.references_engine_hint_dismiss())}
          />
        )}
      </div>
      <div className="callout-content">{children}</div>
    </div>
  );
}
