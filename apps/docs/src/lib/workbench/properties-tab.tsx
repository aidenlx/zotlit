// The Properties tab: one row per Managed Frontmatter entry, each editing its
// own expression through a slice of the master document, and the result column
// that shows what every row produced beside the frontmatter the note gets.

import { useState } from "react";

import { entrySlice } from "@zotlit/workbench/document";
import type {
  ManagedEntrySource,
  WorkbenchDocumentController,
  WorkbenchSliceRange,
} from "@zotlit/workbench/document";
import type { RenderedProperty } from "@zotlit/workbench/render";

import { m } from "@/paraglide/messages.js";

import { PropertyList, propertyText } from "./reading-view";
import { SliceEditor } from "./slice-editor";
import type { FieldTrigger } from "./slice-editor";

const MERGE_LABEL: Record<string, () => string> = {
  replace: m.workbench_properties_merge_replace,
  append: m.workbench_properties_merge_append,
  keep: m.workbench_properties_merge_keep,
};

/** A strategy's own words, or the word the author wrote when it names none. */
function mergeLabel(merge: string): string {
  return Object.hasOwn(MERGE_LABEL, merge) ? MERGE_LABEL[merge]!() : merge;
}

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
  onFieldTrigger?: (trigger: FieldTrigger) => void;
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
  onFieldTrigger,
}: PropertiesPaneProps) {
  const [menu, setMenu] = useState<number | null>(null);
  const produced = byEntry(properties);
  const problems = Map.groupBy(
    diagnostics,
    (diagnostic) => diagnostic.position,
  );

  function act(run: () => void) {
    return () => {
      setMenu(null);
      run();
    };
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto">
      {entries.length === 0 && (
        <p className="text-sm text-fd-muted-foreground">
          {m.workbench_properties_empty()}
        </p>
      )}
      <ul className="flex flex-col gap-2">
        {entries.map((entry) => {
          const fields = produced.get(entry.position) ?? [];
          const raised = problems.get(entry.position) ?? [];
          const open = selected === entry.position;
          return (
            <li
              key={entry.position}
              className="border border-fd-border bg-fd-card"
            >
              <button
                type="button"
                aria-expanded={open}
                onClick={() => onSelect(open ? null : entry.position)}
                className="flex w-full cursor-pointer items-baseline gap-3 px-3 py-2 text-left"
              >
                <span className="font-mono text-[0.8rem] font-medium">
                  {entry.key ?? m.workbench_properties_spread()}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs text-fd-muted-foreground">
                  {summarize(entry, fields, fold)}
                </span>
                {raised.length > 0 && (
                  <span className="border border-fd-primary px-1.5 py-0.5 font-mono text-[0.6rem] font-semibold tracking-widest text-fd-primary uppercase">
                    {m.workbench_properties_row_problem()}
                  </span>
                )}
                <span className="font-mono text-[0.6rem] font-semibold tracking-widest text-fd-muted-foreground uppercase">
                  {mergeLabel(entry.merge)}
                </span>
              </button>
              {open && (
                <EntryForm
                  controller={controller}
                  entry={entry}
                  produced={fields}
                  diagnostics={raised}
                  menuOpen={menu === entry.position}
                  onMenu={(openMenu) =>
                    setMenu(openMenu ? entry.position : null)
                  }
                  act={act}
                  reveal={reveal}
                  onSelection={onSelection}
                  onFieldTrigger={onFieldTrigger}
                />
              )}
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() =>
            controller.editManagedEntry({ action: "add", kind: "property" })
          }
          className="cursor-pointer border border-fd-border px-3 py-1.5 text-sm"
        >
          {m.workbench_properties_add()}
        </button>
        <details className="relative">
          <summary className="cursor-pointer list-none px-2 py-1.5 text-sm text-fd-muted-foreground underline underline-offset-2">
            {m.workbench_properties_more_ways()}
          </summary>
          <div className="absolute left-0 z-10 mt-1 w-64 border border-fd-border bg-fd-card p-1 shadow-[4px_4px_0_0_var(--color-fd-border)]">
            <button
              type="button"
              onClick={() =>
                controller.editManagedEntry({ action: "add", kind: "spread" })
              }
              className="w-full cursor-pointer px-3 py-1.5 text-left text-sm hover:bg-fd-accent"
            >
              {m.workbench_properties_add_spread()}
            </button>
          </div>
        </details>
      </div>
    </div>
  );
}

interface EntryFormProps {
  controller: WorkbenchDocumentController;
  entry: ManagedEntrySource;
  produced: readonly RenderedProperty[];
  diagnostics: readonly EntryDiagnostic[];
  menuOpen: boolean;
  onMenu: (open: boolean) => void;
  act: (run: () => void) => () => void;
  reveal?: WorkbenchSliceRange | null;
  onSelection?: (selection: WorkbenchSliceRange) => void;
  onFieldTrigger?: (trigger: FieldTrigger) => void;
}

/**
 * The open row: one source editor over the entry's own expression, one merge
 * control, the read-only fields a spread produced, and the entry operations.
 * A `js` entry has no editor — the web host cannot run it.
 */
function EntryForm({
  controller,
  entry,
  produced,
  diagnostics,
  menuOpen,
  onMenu,
  act,
  reveal,
  onSelection,
  onFieldTrigger,
}: EntryFormProps) {
  const spread = entry.key === undefined;
  return (
    <div className="flex flex-col gap-2 border-t border-fd-border px-3 py-2.5">
      {entry.key !== undefined && (
        <label className="flex items-center gap-2 text-xs">
          <span className="text-fd-muted-foreground">
            {m.workbench_properties_name()}
          </span>
          <input
            key={entry.key}
            defaultValue={entry.key}
            onBlur={(event) => {
              const value = event.target.value.trim();
              if (value && value !== entry.key) {
                controller.editManagedEntry({
                  action: "set",
                  position: entry.position,
                  field: "key",
                  value,
                });
              }
            }}
            className="min-w-0 flex-1 border border-fd-border bg-fd-background px-2 py-1 font-mono text-[0.78rem]"
          />
        </label>
      )}
      {entry.language === "js" ? (
        <p className="text-xs text-fd-muted-foreground">
          {m.workbench_properties_javascript()}
        </p>
      ) : (
        <div className="border border-fd-border bg-fd-background">
          <SliceEditor
            controller={controller}
            slice={entrySlice(entry.position)}
            label={m.workbench_properties_expression()}
            language={entry.language === "value" ? "yaml" : "liquid"}
            reveal={reveal}
            onSelection={onSelection}
            onFieldTrigger={onFieldTrigger}
          />
        </div>
      )}
      {spread && (
        <>
          <PropertyList properties={produced} className="text-xs" />
          <p className="text-xs text-fd-muted-foreground">
            {m.workbench_properties_override_hint()}
          </p>
        </>
      )}
      {diagnostics.map((diagnostic, index) => (
        <p
          // The list is rebuilt whole on every render, and two fields of one
          // spread can raise the same words, so the row's own order is the key.
          key={index}
          className="border-l-2 border-fd-primary bg-fd-accent/40 px-3 py-2 text-xs"
        >
          {diagnostic.message}
        </p>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-xs">
          <span className="text-fd-muted-foreground">
            {m.workbench_properties_merge()}
          </span>
          <select
            value={entry.merge}
            onChange={(event) =>
              controller.editManagedEntry({
                action: "set",
                position: entry.position,
                field: "merge",
                value: event.target.value,
              })
            }
            className="border border-fd-border bg-fd-background px-2 py-1 text-xs"
          >
            {Object.entries(MERGE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label()}
              </option>
            ))}
          </select>
        </label>
        <div className="relative ml-auto">
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => onMenu(!menuOpen)}
            className="cursor-pointer border border-fd-border px-2 py-1 text-xs"
          >
            {m.workbench_properties_options()}
          </button>
          {menuOpen && (
            <div
              role="menu"
              aria-label={m.workbench_properties_options()}
              className="absolute right-0 z-10 mt-1 flex w-60 flex-col border border-fd-border bg-fd-card p-1 shadow-[4px_4px_0_0_var(--color-fd-border)]"
            >
              <MenuItem
                label={m.workbench_properties_add_override()}
                onClick={act(() => {
                  controller.editManagedEntry({
                    action: "add",
                    kind: "property",
                    after: entry.position,
                  });
                })}
              />
              {entry.language !== "js" && !spread && (
                <MenuItem
                  label={
                    entry.language === "expr"
                      ? m.workbench_properties_to_rule()
                      : m.workbench_properties_to_value()
                  }
                  onClick={act(() => {
                    controller.editManagedEntry({
                      action: "language",
                      position: entry.position,
                      language: entry.language === "expr" ? "value" : "expr",
                    });
                  })}
                />
              )}
              <MenuItem
                label={m.workbench_properties_move_up()}
                onClick={act(() => {
                  controller.editManagedEntry({
                    action: "move",
                    position: entry.position,
                    by: -1,
                  });
                })}
              />
              <MenuItem
                label={m.workbench_properties_move_down()}
                onClick={act(() => {
                  controller.editManagedEntry({
                    action: "move",
                    position: entry.position,
                    by: 1,
                  });
                })}
              />
              <MenuItem
                label={m.workbench_properties_remove()}
                onClick={act(() => {
                  controller.editManagedEntry({
                    action: "remove",
                    position: entry.position,
                  });
                })}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MenuItem({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="cursor-pointer px-3 py-1.5 text-left text-sm hover:bg-fd-accent"
    >
      {label}
    </button>
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
        <h3 className="font-mono text-[0.62rem] font-semibold tracking-widest text-fd-muted-foreground uppercase">
          {m.workbench_result_by_entry()}
        </h3>
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
      </section>
      <section>
        <h3 className="font-mono text-[0.62rem] font-semibold tracking-widest text-fd-muted-foreground uppercase">
          {m.workbench_result_fold()}
        </h3>
        <PropertyList properties={fold} className="mt-2 text-xs" />
      </section>
    </div>
  );
}
