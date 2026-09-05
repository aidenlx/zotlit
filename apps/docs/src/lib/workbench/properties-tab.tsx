// The Properties tab: one row per Managed Frontmatter entry, each editing its
// own expression through a slice of the master document, and the result column
// that shows what every row produced beside the frontmatter the note gets.

import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { entrySlice } from "@zotlit/workbench/document";
import type {
  ManagedEntrySource,
  WorkbenchDocumentController,
  WorkbenchSliceRange,
} from "@zotlit/workbench/document";
import type { RenderedProperty } from "@zotlit/workbench/render";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { m } from "@/paraglide/messages.js";

import { PropertyList, propertyText } from "./property-list";
import { SliceEditor } from "./slice-editor";
import type { SuggestionSource } from "./slice-editor";

const MERGE_LABEL: Record<string, () => string> = {
  replace: m.workbench_properties_merge_replace,
  append: m.workbench_properties_merge_append,
  keep: m.workbench_properties_merge_keep,
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
  entry: ManagedEntrySource,
  produced: readonly RenderedProperty[],
  fold: readonly RenderedProperty[],
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
  reveal,
  onSelection,
  suggest,
}: PropertiesPaneProps) {
  const produced = byEntry(properties);
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
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto pb-4">
      {entries.length === 0 && (
        <p className="rounded-md border border-dashed border-fd-border p-4 text-sm text-fd-muted-foreground">
          {m.workbench_properties_empty()}
        </p>
      )}
      <ul className="flex flex-col gap-3">
        {entries.map((entry) => {
          const fields = produced.get(entry.position) ?? [];
          const raised = problems.get(entry.position) ?? [];
          const open = selected === entry.position;
          return (
            <li
              key={entry.position}
              className="rounded-md border border-fd-border bg-fd-card"
            >
              <div className="grid grid-cols-[minmax(0,1fr)_auto] px-3 py-2">
                <button
                  type="button"
                  aria-expanded={open}
                  aria-controls={`property-${entry.position}`}
                  onClick={() => onSelect(open ? null : entry.position)}
                  className="col-span-2 col-start-1 row-start-1 grid min-w-0 cursor-pointer grid-cols-subgrid rounded-md text-start"
                >
                  <span className="col-start-1 row-start-1 flex min-h-7 min-w-0 items-center gap-2 pe-2">
                    <span className="min-w-0 flex-1 font-mono text-sm font-medium break-words">
                      {entry.key ?? m.workbench_properties_spread()}
                    </span>
                    {raised.length > 0 && (
                      <span className="text-xs font-medium">
                        {m.workbench_properties_row_problem()}
                      </span>
                    )}
                  </span>
                  {summarize(entry, fields, fold) && (
                    <span
                      className={`col-span-2 col-start-1 row-start-2 block min-w-0 text-sm break-words text-fd-muted-foreground ${open ? "" : "line-clamp-2"}`}
                      title={summarize(entry, fields, fold)}
                    >
                      {summarize(entry, fields, fold)}
                    </span>
                  )}
                </button>
                <div className="z-10 col-start-2 row-start-1 flex items-center gap-0.5 self-start">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 aria-pressed:bg-fd-muted"
                    aria-label={m.workbench_properties_edit()}
                    title={m.workbench_properties_edit()}
                    aria-pressed={open}
                    aria-expanded={open}
                    aria-controls={`property-${entry.position}`}
                    onClick={() => onSelect(open ? null : entry.position)}
                  >
                    <Pencil aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    aria-label={m.workbench_properties_add_override()}
                    title={m.workbench_properties_add_override()}
                    onClick={() => add("property", entry.position)}
                  >
                    <Plus aria-hidden />
                  </Button>
                  {([-1, 1] as const).map((by) => {
                    const label =
                      by === -1
                        ? m.workbench_properties_move_up()
                        : m.workbench_properties_move_down();
                    return (
                      <Button
                        key={by}
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        aria-label={label}
                        title={label}
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
                        {by === -1 ? (
                          <ArrowUp aria-hidden />
                        ) : (
                          <ArrowDown aria-hidden />
                        )}
                      </Button>
                    );
                  })}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    aria-label={m.workbench_properties_remove()}
                    title={m.workbench_properties_remove()}
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
                    <Trash2 aria-hidden />
                  </Button>
                </div>
              </div>
              {open && (
                <EntryForm
                  key={`${entry.position}:${entry.language}`}
                  controller={controller}
                  entry={entry}
                  produced={fields}
                  diagnostics={raised}
                  focusName={newRow === entry.position}
                  reveal={reveal}
                  onSelection={onSelection}
                  suggest={suggest}
                />
              )}
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={() => add("property")}>
          <Plus aria-hidden />
          {m.workbench_properties_add()}
        </Button>
        <Button variant="ghost" onClick={() => add("spread")}>
          <Plus aria-hidden />
          {m.workbench_properties_add_spread()}
        </Button>
      </div>
    </div>
  );
}

interface EntryFormProps {
  controller: WorkbenchDocumentController;
  entry: ManagedEntrySource;
  produced: readonly RenderedProperty[];
  diagnostics: readonly EntryDiagnostic[];
  focusName: boolean;
  reveal?: WorkbenchSliceRange | null;
  onSelection?: (selection: WorkbenchSliceRange) => void;
  suggest?: SuggestionSource;
}

/** Edit the name, value, and update behavior of a property. */
function EntryForm({
  controller,
  entry,
  produced,
  diagnostics,
  focusName,
  reveal,
  onSelection,
  suggest,
}: EntryFormProps) {
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
  const [name, setName] = useState(entry.key ?? "");
  useEffect(() => setName(entry.key ?? ""), [entry.key]);
  const spread = entry.key === undefined;
  const errorId = `property-${entry.position}-errors`;
  return (
    <div
      id={`property-${entry.position}`}
      className="flex flex-col gap-4 border-t border-fd-border p-4"
    >
      {entry.key !== undefined && (
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          {m.workbench_properties_name()}
          <Input
            autoFocus={focusName}
            value={name}
            onChange={(event) => setName(event.target.value)}
            onFocus={(event) => {
              if (focusName) event.target.select();
            }}
            onBlur={(event) => {
              const value = event.target.value.trim();
              if (value && value !== entry.key)
                controller.editManagedEntry({
                  action: "set",
                  position: entry.position,
                  field: "key",
                  value,
                });
            }}
            className="bg-fd-background font-mono"
          />
        </label>
      )}
      {entry.language === "js" ? (
        <p className="text-sm text-fd-muted-foreground">
          {m.workbench_properties_javascript()}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium">
              {m.workbench_properties_expression()}
            </span>
            {!spread && (
              <label className="flex min-w-0 items-center gap-2 text-sm">
                <span className="sr-only">
                  {m.workbench_properties_format()}
                </span>
                <NativeSelect
                  value={pendingLanguage ?? format}
                  onChange={(event) =>
                    setPendingLanguage(
                      event.target.value as "text" | "expr" | "value",
                    )
                  }
                  size="sm"
                >
                  <NativeSelectOption value="text">
                    {m.workbench_properties_format_text()}
                  </NativeSelectOption>
                  <NativeSelectOption value="expr">
                    {m.workbench_properties_format_value()}
                  </NativeSelectOption>
                  <NativeSelectOption value="value">
                    {m.workbench_properties_format_rule()}
                  </NativeSelectOption>
                </NativeSelect>
              </label>
            )}
          </div>
          <p className="text-sm leading-relaxed text-fd-muted-foreground">
            {format === "text"
              ? m.workbench_properties_text_hint()
              : entry.language === "expr"
                ? m.workbench_properties_value_hint()
                : m.workbench_properties_rule_hint()}
          </p>
          {pendingLanguage && pendingLanguage !== format && (
            <div className="space-y-2 rounded-md border border-fd-border bg-fd-muted p-3 text-sm">
              <p>{m.workbench_properties_format_confirm()}</p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
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
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setPendingLanguage(null)}
                >
                  {m.workbench_cancel()}
                </Button>
              </div>
            </div>
          )}
          {format === "text" ? (
            <Input
              aria-label={m.workbench_properties_expression()}
              value={fixedText ?? ""}
              onChange={(event) =>
                controller.dispatch({
                  changes: {
                    from: entry.expression.from,
                    to: entry.expression.to,
                    insert: JSON.stringify(event.target.value),
                  },
                  userEvent: "input.type",
                })
              }
              className="bg-fd-background"
            />
          ) : (
            <div className="flex min-h-28 flex-col rounded-md border border-fd-border bg-fd-background">
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
      {spread && <PropertyList properties={produced} className="text-sm" />}
      {diagnostics.length > 0 && (
        <div
          id={errorId}
          className="space-y-2 border-s-2 border-fd-foreground ps-3 text-sm"
        >
          {diagnostics.map((diagnostic, index) => (
            <p key={index}>{diagnostic.message}</p>
          ))}
        </div>
      )}
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5 text-sm">
          {m.workbench_properties_merge()}
          <NativeSelect
            value={entry.merge}
            onChange={(event) =>
              controller.editManagedEntry({
                action: "set",
                position: entry.position,
                field: "merge",
                value: event.target.value,
              })
            }
            className="w-full"
          >
            {Object.entries(MERGE_LABEL).map(([value, label]) => (
              <NativeSelectOption key={value} value={value}>
                {label()}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
        <p className="text-sm text-fd-muted-foreground">
          {m.workbench_properties_override_hint()}
        </p>
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
  if (showMarkdown) {
    return (
      <pre
        aria-label={m.workbench_result_markdown_body()}
        className="font-mono text-[0.8rem] leading-relaxed whitespace-pre-wrap"
      >
        {frontmatterBlock ?? m.workbench_properties_produced_none()}
      </pre>
    );
  }
  const produced = byEntry(properties);
  return (
    <div className="flex flex-col gap-4">
      <section>
        <h3 className="text-sm font-semibold">{m.workbench_result_fold()}</h3>
        <PropertyList properties={fold} className="mt-3 text-sm" />
      </section>
      <details>
        <summary className="cursor-pointer py-2 text-sm text-fd-muted-foreground">
          {m.workbench_result_by_entry()}
        </summary>
        <ul className="mt-2 flex flex-col gap-2">
          {entries.map((entry) => {
            const fields = produced.get(entry.position) ?? [];
            return (
              <li key={entry.position} className="text-xs">
                <p className="font-mono font-medium">
                  {entry.key ?? m.workbench_properties_spread()}
                </p>
                {fields.length === 0 ? (
                  <p className="text-fd-muted-foreground italic">
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
