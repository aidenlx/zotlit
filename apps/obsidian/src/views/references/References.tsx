import { type IconName } from "obsidian";
import { type ReactNode } from "react";

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
 * A flat row: Reference Number, entry text (with an inline occurrence
 * counter and a hover/focus-revealed toolbar underneath), and a
 * hover-revealed chevron. Only the entry text is clickable, and it cycles the
 * entry's occurrences — the row around it is inert, so the toolbar and the
 * chevron are the only other targets and none of them overlap.
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
          <div>
            {/* A span rather than an anchor: Obsidian styles bare `a`
                globally and unlayered, which would impose its link colour and
                weight here and leave us fighting them. The affordance is the
                link cursor plus an underline on hover — the entry keeps normal
                text colour, since a whole bibliography entry in link purple
                would outshout the list. `hover:` already compiles under
                `@media (hover: hover)`, matching Obsidian's own link rule. */}
            <span
              role="link"
              tabIndex={0}
              className="zt:cursor-link zt:hover:underline"
              {...tooltipAttrs(m.references_go_to_occurrence())}
              onClick={() => actions.onSelect(entry)}
              onKeyDown={(e) => {
                if (e.key !== " " && e.key !== "Enter") return;
                e.preventDefault();
                actions.onSelect(entry);
              }}
            >
              <ReferenceBody entry={entry} />
            </span>
            {/* A bare number needs saying out loud — on its own it reads as
                part of the citation rather than as a count of citations. */}
            {occurrenceCount > 1 && (
              <span
                className="zt:ml-1.5 zt:cursor-help zt:text-xs zt:text-muted-foreground zt:tabular-nums"
                {...tooltipAttrs(
                  m.references_occurrence_count({ count: occurrenceCount }),
                )}
              >
                {occurrenceCount}
              </span>
            )}
          </div>
          {/* Collapsed to zero height as a class, never an inline style — an
              inline style on this element would outrank the hover/focus
              classes below and the toolbar could never open. The opening
              delay sits only on the hover variant (`group-hover:delay-100`),
              so collapsing and keyboard focus both stay instant. */}
          {entry.kind !== "missing" && (
            <div className="zt:grid zt:grid-rows-[0fr] zt:transition-[grid-template-rows] zt:delay-0 zt:duration-150 zt:ease-out zt:group-focus-within:grid-rows-[1fr] zt:group-hover:grid-rows-[1fr] zt:group-hover:delay-100">
              <div className="zt:overflow-hidden zt:opacity-0 zt:transition-opacity zt:delay-0 zt:duration-150 zt:group-focus-within:opacity-100 zt:group-hover:opacity-100 zt:group-hover:delay-100">
                <div className="zt:flex zt:items-center zt:gap-0.5 zt:pt-1">
                  <EntryAction
                    icon="external-link"
                    label={m.references_open_in_zotero()}
                    onClick={() => actions.onOpenInZotero(entry.source)}
                  />
                  <EntryAction
                    icon="paperclip"
                    label={m.references_open_attachment()}
                    onClick={() => actions.onOpenAttachment(entry.source)}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
        {/* Disabled rather than hidden on a missing entry, so the row keeps
            its shape and the tooltip carries the reason. The dimming comes
            from Obsidian's own `.clickable-icon[aria-disabled="true"]` rule,
            which `IconButton` triggers — a utility class cannot do it, since
            Obsidian's unlayered rules outrank the whole utilities layer. */}
        <div className="zt:flex zt:w-5 zt:shrink-0 zt:justify-center zt:self-start">
          <IconButton
            icon="chevron-right"
            disabled={isMissing}
            onClick={() => actions.onOpenNote(entry)}
            className="zt:opacity-0 zt:transition-opacity zt:group-hover:opacity-100"
            {...tooltipAttrs(
              isMissing
                ? m.references_open_note_missing()
                : m.references_open_note(),
            )}
          />
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
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
}) {
  return (
    <IconButton
      icon={icon}
      onClick={onClick}
      // A clickable-icon defaults to ribbon proportions — an 18px glyph in a
      // 30x26 box — which dwarfs the 13px entry text it sits under. Trim the
      // glyph and the box so the toolbar reads as a footnote to the entry.
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
