import { type IconName } from "obsidian";
import { type ReactNode } from "react";

import { Button } from "@/components/obsidian/button";
import { Icon } from "@/components/obsidian/icon";
import { IconButton } from "@/components/obsidian/icon-button";
import * as m from "@/lib/i18n/generated/messages";
import { useSanitizedHtml } from "@/lib/sanitize-html";
import { tooltipAttrs } from "@/lib/utils";
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
    <div className="zt:flex zt:h-full zt:flex-col zt:overflow-y-auto zt:px-3 zt:py-2">
      <EngineSurface status={engine} />
      {entries.length === 0 ? (
        <div className="pane-empty">
          {dbReady ? m.references_empty() : m.references_db_unavailable()}
        </div>
      ) : (
        <ul className="zt:flex zt:flex-col zt:gap-3 zt:text-sm">
          {entries.map((entry) => (
            <Reference key={entry.indexedKey} entry={entry} />
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Hanging indent with the Reference Number flush in the outdent, so a wrapped
 * entry reads as one block under its number.
 */
function Reference({ entry }: { entry: ReferenceEntry }) {
  const actions = useReferenceActions();

  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        className="zt:cursor-pointer zt:pl-7 zt:-indent-7 zt:leading-normal"
        {...tooltipAttrs(m.references_go_to_occurrence())}
        onClick={() => actions.onSelect(entry)}
        onKeyDown={(e) => {
          if (e.key !== " " && e.key !== "Enter") return;
          e.preventDefault();
          actions.onSelect(entry);
        }}
      >
        <span className="zt:mr-1 zt:text-muted-foreground zt:tabular-nums">
          {entry.refNumber}.
        </span>
        <ReferenceBody entry={entry} />
      </div>
      <div className="zt:mt-1 zt:flex zt:gap-1 zt:pl-7">
        <EntryAction
          icon="file-text"
          label={m.references_open_note()}
          onClick={() => actions.onOpenNote(entry)}
        />
        {entry.kind !== "missing" && (
          <>
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
          </>
        )}
      </div>
    </li>
  );
}

function ReferenceBody({ entry }: { entry: ReferenceEntry }) {
  switch (entry.kind) {
    case "rendered":
      return <RenderedEntry html={entry.html} />;
    case "summary":
      return <span>{entry.source.summary}</span>;
    case "missing":
      return (
        <span className="zt:text-destructive">
          {m.references_item_missing({ linkpath: entry.linkpath })}
        </span>
      );
  }
}

function RenderedEntry({ html }: { html: string }) {
  return <span ref={useSanitizedHtml<HTMLSpanElement>(html)} />;
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
  return <IconButton icon={icon} onClick={onClick} {...tooltipAttrs(label)} />;
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
