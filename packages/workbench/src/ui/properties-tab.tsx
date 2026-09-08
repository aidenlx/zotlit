// The Properties tab: one row per Managed Frontmatter entry, each editing its
// own expression through a slice of the master document, and the result column
// that shows what every row produced beside the frontmatter the note gets.

import type {
  ManagedEntrySource,
  WorkbenchDocumentController,
  WorkbenchSliceRange,
} from "#/document/index";
import type { RenderedProperty } from "#/render/result";
import { useEffect, useState, useId, useRef } from "react";

import type { WorkbenchMessages } from "./generated/messages";
import { useOptionalHost } from "./host";
import type { WorkbenchMessageLabel } from "./messages";
import { useWorkbenchMessages } from "./messages";
import { PropertyList, propertyText } from "./property-list";
import { WorkbenchSelect, WorkbenchOption } from "./select";
import { SliceEditor } from "./slice-editor";
import type { SuggestionSource } from "./slice-editor";
import { useIcon, useParts } from "./theme";

import { entrySlice } from "#/document/index";

const MERGE_LABEL: Record<string, WorkbenchMessageLabel> = {
  replace: "workbench_properties_merge_replace",
  append: "workbench_properties_merge_append",
  keep: "workbench_properties_merge_keep",
};

/** A problem one row carries: the text to show, and the entry it names. */
export interface EntryDiagnostic {
  /** 1-based position of the Managed Frontmatter entry it belongs to. */
  readonly position: number;
  readonly message: string;
}

export interface PropertiesPaneProps {
  controller: WorkbenchDocumentController;
  /** The rows, in list order. */
  entries: readonly ManagedEntrySource[];
  /** What each entry produced on its own, from the current render. */
  properties: readonly RenderedProperty[];
  /** The frontmatter the note gets, which orders a spread's produced names. */
  fold: readonly RenderedProperty[];
  /** Every problem that names a row, from the render and from the parser. */
  diagnostics: readonly EntryDiagnostic[];
  /** The open row's position, or null while every row is folded. */
  selected: number | null;
  onSelect: (position: number | null) => void;
  /** A native host can edit JavaScript in its whole-document editor. */
  onOpenSource?: (range: WorkbenchSliceRange) => void;
  reveal?: WorkbenchSliceRange | null;
  onSelection?: (selection: WorkbenchSliceRange) => void;
  suggest?: SuggestionSource;
}

/** Produced fields under the entry that produced them, for either column. */
function byEntry(
  properties: readonly RenderedProperty[],
): Map<number, readonly RenderedProperty[]> {
  return Map.groupBy(properties, (property) => property.position);
}

/** A static entry shows its own value; a spread shows what it produced. */
function summarize(
  m: WorkbenchMessages,
  {
    entry,
    produced,
    fold,
  }: {
    entry: ManagedEntrySource;
    produced: readonly RenderedProperty[];
    fold: readonly RenderedProperty[];
  },
): string {
  if (entry.key !== undefined) {
    const property = produced[0];
    if (!property || property.missing) return m.workbench_property_unset();
    return property.value == null
      ? m.workbench_property_empty()
      : propertyText(property.value);
  }
  return produced.length === 0
    ? m.workbench_properties_produced_none()
    : m.workbench_properties_produced({
        count: produced.length,
        names: foldOrder(produced, fold).join(", "),
      });
}

/**
 * A spread's produced names the way the fold placed them, so the row reads in
 * the order the note gets. A name the fold dropped keeps the entry's own order,
 * at the end.
 */
function foldOrder(
  produced: readonly RenderedProperty[],
  fold: readonly RenderedProperty[],
): readonly string[] {
  const place = (key: string) => {
    const index = fold.findIndex((property) => property.key === key);
    return index === -1 ? fold.length : index;
  };
  return produced
    .map((property) => property.key)
    .toSorted((left, right) => place(left) - place(right));
}

export function PropertiesPane({
  controller,
  entries,
  properties,
  fold,
  diagnostics,
  selected,
  onSelect,
  onOpenSource,
  reveal,
  onSelection,
  suggest,
}: PropertiesPaneProps) {
  const m = useWorkbenchMessages();
  const part = useParts("properties");
  const produced = byEntry(properties);
  const icon = useIcon();
  const instanceId = useId();
  const host = useOptionalHost();
  const tooltip = (text: string) => host?.tooltip(text) ?? { title: text };
  const problems = Map.groupBy(
    diagnostics,
    (diagnostic) => diagnostic.position,
  );
  const [newRow, setNewRow] = useState<number | null>(null);

  function add(kind: "property" | "spread", after = entries.length) {
    if (controller.editManagedEntry({ action: "add", kind, after })) {
      setNewRow(after + 1);
      onSelect(after + 1);
    }
  }

  return (
    <div {...part("pane")}>
      {entries.length === 0 && (
        <p {...part("empty")}>{m.workbench_properties_empty()}</p>
      )}
      <ul {...part("rows")}>
        {entries.map((entry) => {
          const fields = produced.get(entry.position) ?? [];
          const raised = problems.get(entry.position) ?? [];
          const open = selected === entry.position;
          return (
            <li key={entry.position} {...part("row")}>
              <div {...part("row-header")}>
                <button
                  type="button"
                  aria-expanded={open}
                  aria-controls={`${instanceId}-property-${entry.position}`}
                  onClick={() => onSelect(open ? null : entry.position)}
                  {...part("row-toggle")}
                >
                  <span {...part("row-name")}>
                    <span {...part("key")}>
                      {entry.key ?? m.workbench_properties_spread()}
                    </span>
                    {raised.length > 0 && (
                      <span {...part("label")}>
                        {m.workbench_properties_row_problem()}
                      </span>
                    )}
                  </span>
                  {summarize(m, { entry, produced: fields, fold }) && (
                    <span
                      {...part("summary", open ? "open" : "closed")}
                      {...tooltip(
                        summarize(m, { entry, produced: fields, fold }),
                      )}
                    >
                      {summarize(m, { entry, produced: fields, fold })}
                    </span>
                  )}
                </button>
                <div {...part("row-actions")}>
                  <button
                    type="button"
                    {...part("edit")}
                    aria-label={m.workbench_properties_edit()}
                    {...tooltip(m.workbench_properties_edit())}
                    aria-pressed={open}
                    aria-expanded={open}
                    aria-controls={`${instanceId}-property-${entry.position}`}
                    onClick={() => onSelect(open ? null : entry.position)}
                  >
                    {icon("edit")}
                  </button>
                  <button
                    type="button"
                    {...part("row-action")}
                    aria-label={m.workbench_properties_add_override()}
                    {...tooltip(m.workbench_properties_add_override())}
                    onClick={() => add("property", entry.position)}
                  >
                    {icon("add")}
                  </button>
                  {([-1, 1] as const).map((by) => {
                    const label =
                      by === -1
                        ? m.workbench_properties_move_up()
                        : m.workbench_properties_move_down();
                    return (
                      <button
                        type="button"
                        {...part("row-action")}
                        key={by}
                        aria-label={label}
                        {...tooltip(label)}
                        disabled={
                          by === -1
                            ? entry.position === 1
                            : entry.position === entries.length
                        }
                        onClick={() => {
                          if (
                            controller.editManagedEntry({
                              action: "move",
                              position: entry.position,
                              by,
                            })
                          ) {
                            if (open) onSelect(entry.position + by);
                            else if (selected === entry.position + by)
                              onSelect(entry.position);
                          }
                        }}
                      >
                        {by === -1 ? icon("move-up") : icon("move-down")}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    {...part("row-action")}
                    aria-label={m.workbench_properties_remove()}
                    {...tooltip(m.workbench_properties_remove())}
                    onClick={() => {
                      controller.editManagedEntry({
                        action: "remove",
                        position: entry.position,
                      });
                      if (open) onSelect(null);
                      else if (selected !== null && selected > entry.position)
                        onSelect(selected - 1);
                    }}
                  >
                    {icon("remove")}
                  </button>
                </div>
              </div>
              {open && (
                <EntryForm
                  key={`${entry.position}:${entry.language}`}
                  controller={controller}
                  instanceId={instanceId}
                  entry={entry}
                  produced={fields}
                  diagnostics={raised}
                  focusName={newRow === entry.position}
                  onOpenSource={onOpenSource}
                  reveal={reveal}
                  onSelection={onSelection}
                  suggest={suggest}
                />
              )}
            </li>
          );
        })}
      </ul>
      <div {...part("actions")}>
        <button
          type="button"
          {...part("primary-action")}
          onClick={() => add("property")}
        >
          {icon("add")}
          {m.workbench_properties_add()}
        </button>
        <button
          type="button"
          {...part("secondary-action")}
          onClick={() => add("spread")}
        >
          {icon("add")}
          {m.workbench_properties_add_spread()}
        </button>
      </div>
    </div>
  );
}

interface EntryFormProps {
  instanceId: string;
  controller: WorkbenchDocumentController;
  entry: ManagedEntrySource;
  produced: readonly RenderedProperty[];
  diagnostics: readonly EntryDiagnostic[];
  focusName: boolean;
  onOpenSource?: (range: WorkbenchSliceRange) => void;
  reveal?: WorkbenchSliceRange | null;
  onSelection?: (selection: WorkbenchSliceRange) => void;
  suggest?: SuggestionSource;
}

/** Edit the name, value, and update behavior of a property. */
function EntryForm({
  instanceId,
  controller,
  entry,
  produced,
  diagnostics,
  focusName,
  onOpenSource,
  reveal,
  onSelection,
  suggest,
}: EntryFormProps) {
  const m = useWorkbenchMessages();
  const part = useParts("properties");
  const [pendingLanguage, setPendingLanguage] = useState<
    "text" | "expr" | "value" | null
  >(null);
  const authored =
    controller.document?.manifest.frontmatter?.[entry.position - 1];
  const fixedText =
    authored && "value" in authored && typeof authored.value === "string"
      ? authored.value
      : null;
  const format =
    entry.language === "value" && fixedText !== null ? "text" : entry.language;
  const nameInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focusName) nameInput.current?.focus();
  }, [focusName]);
  const [name, setName] = useState(entry.key ?? "");
  useEffect(() => setName(entry.key ?? ""), [entry.key]);
  const spread = entry.key === undefined;
  const errorId = `${instanceId}-property-${entry.position}-errors`;
  return (
    <div id={`${instanceId}-property-${entry.position}`} {...part("form")}>
      {entry.key !== undefined && (
        <label {...part("field")}>
          {m.workbench_properties_name()}
          <input
            ref={nameInput}
            value={name}
            onInput={(event) => setName(event.currentTarget.value)}
            onFocus={(event) => {
              if (focusName) event.currentTarget.select();
            }}
            onBlur={(event) => {
              const value = event.currentTarget.value.trim();
              if (value && value !== entry.key)
                controller.editManagedEntry({
                  action: "set",
                  position: entry.position,
                  field: "key",
                  value,
                });
            }}
            {...part("name-input")}
          />
        </label>
      )}
      {entry.language === "js" ? (
        <p {...part("hint")}>
          {onOpenSource ? (
            <>
              {m.workbench_properties_javascript_source()}{" "}
              <button
                type="button"
                {...part("secondary-action")}
                onClick={() => onOpenSource(entry.expression)}
              >
                {m.workbench_advanced()}
              </button>
            </>
          ) : (
            m.workbench_properties_javascript()
          )}
        </p>
      ) : (
        <div {...part("field-group")}>
          <div {...part("expression-header")}>
            <span {...part("label")}>
              {m.workbench_properties_expression()}
            </span>
            {!spread && (
              <label {...part("format-label")}>
                <span {...part("hidden-label")}>
                  {m.workbench_properties_format()}
                </span>
                <WorkbenchSelect
                  value={pendingLanguage ?? format}
                  onInput={(event) =>
                    setPendingLanguage(
                      event.currentTarget.value as "text" | "expr" | "value",
                    )
                  }
                >
                  <WorkbenchOption value="text">
                    {m.workbench_properties_format_text()}
                  </WorkbenchOption>
                  <WorkbenchOption value="expr">
                    {m.workbench_properties_format_value()}
                  </WorkbenchOption>
                  <WorkbenchOption value="value">
                    {m.workbench_properties_format_rule()}
                  </WorkbenchOption>
                </WorkbenchSelect>
              </label>
            )}
          </div>
          <p {...part("hint")}>
            {format === "text"
              ? m.workbench_properties_text_hint()
              : entry.language === "expr"
                ? m.workbench_properties_value_hint()
                : m.workbench_properties_rule_hint()}
          </p>
          {pendingLanguage && pendingLanguage !== format && (
            <div {...part("confirm")}>
              <p {...part("text")}>{m.workbench_properties_format_confirm()}</p>
              <div {...part("confirm-actions")}>
                <button
                  type="button"
                  {...part("primary-action")}
                  onClick={() => {
                    controller.editManagedEntry({
                      action: "language",
                      position: entry.position,
                      language:
                        pendingLanguage === "text" ? "value" : pendingLanguage,
                      ...(pendingLanguage === "text" ? { text: "" } : {}),
                    });
                    setPendingLanguage(null);
                  }}
                >
                  {m.workbench_properties_format_reset()}
                </button>
                <button
                  type="button"
                  {...part("secondary-action")}
                  onClick={() => setPendingLanguage(null)}
                >
                  {m.workbench_cancel()}
                </button>
              </div>
            </div>
          )}
          {format === "text" ? (
            <input
              aria-label={m.workbench_properties_expression()}
              value={fixedText ?? ""}
              onInput={(event) =>
                controller.dispatch({
                  changes: {
                    from: entry.expression.from,
                    to: entry.expression.to,
                    insert: JSON.stringify(event.currentTarget.value),
                  },
                  userEvent: "input.type",
                })
              }
              {...part("text-input")}
            />
          ) : (
            <div {...part("expression")}>
              <SliceEditor
                controller={controller}
                slice={entrySlice(entry.position)}
                label={m.workbench_properties_expression()}
                language={entry.language === "value" ? "json-e" : "expression"}
                invalid={diagnostics.length > 0}
                describedBy={diagnostics.length > 0 ? errorId : undefined}
                reveal={reveal}
                onSelection={onSelection}
                suggest={suggest}
              />
            </div>
          )}
        </div>
      )}
      {spread && <PropertyList properties={produced} variant="spread" />}
      {diagnostics.length > 0 && (
        <div id={errorId} {...part("diagnostics")}>
          {diagnostics.map((diagnostic, index) => (
            <p key={index} {...part("text")}>
              {diagnostic.message}
            </p>
          ))}
        </div>
      )}
      <div {...part("field-group")}>
        <label {...part("field")}>
          {m.workbench_properties_merge()}
          <WorkbenchSelect
            value={entry.merge}
            onInput={(event) =>
              controller.editManagedEntry({
                action: "set",
                position: entry.position,
                field: "merge",
                value: event.currentTarget.value,
              })
            }
          >
            {Object.entries(MERGE_LABEL).map(([value, label]) => (
              <WorkbenchOption key={value} value={value}>
                {m[label]()}
              </WorkbenchOption>
            ))}
          </WorkbenchSelect>
        </label>
        <p {...part("hint")}>{m.workbench_properties_override_hint()}</p>
      </div>
    </div>
  );
}

export interface PropertiesResultProps {
  entries: readonly ManagedEntrySource[];
  properties: readonly RenderedProperty[];
  /** The frontmatter the note gets once every entry has merged, in order. */
  fold: readonly RenderedProperty[];
  /** The fold as the note's own YAML block, for the Markdown toggle. */
  frontmatterBlock: string | null;
  showMarkdown: boolean;
}

/**
 * The result column while Properties is open: what each rule produced on its
 * own, grouped under the entry that produced it, beside the final ordered fold.
 * The Markdown toggle replaces both with the generated YAML the note carries.
 */
export function PropertiesResult({
  entries,
  properties,
  fold,
  frontmatterBlock,
  showMarkdown,
}: PropertiesResultProps) {
  const m = useWorkbenchMessages();
  const part = useParts("properties");
  if (showMarkdown) {
    return (
      <pre
        aria-label={m.workbench_result_markdown_body()}
        {...part("markdown")}
      >
        {frontmatterBlock ?? m.workbench_properties_produced_none()}
      </pre>
    );
  }
  const produced = byEntry(properties);
  return (
    <div {...part("result")}>
      <section>
        <h3 {...part("heading")}>{m.workbench_result_fold()}</h3>
        <PropertyList properties={fold} variant="fold" />
      </section>
      <details>
        <summary {...part("result-summary")}>
          {m.workbench_result_by_entry()}
        </summary>
        <ul {...part("result-rows")}>
          {entries.map((entry) => {
            const fields = produced.get(entry.position) ?? [];
            return (
              <li key={entry.position} {...part("result-row")}>
                <p {...part("result-key")}>
                  {entry.key ?? m.workbench_properties_spread()}
                </p>
                {fields.length === 0 ? (
                  <p {...part("result-empty")}>
                    {m.workbench_properties_produced_none()}
                  </p>
                ) : (
                  <PropertyList properties={fields} />
                )}
              </li>
            );
          })}
        </ul>
      </details>
    </div>
  );
}
