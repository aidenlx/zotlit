// The pages of the Properties popover, as a Bases Properties menu steps from a
// row to its page: "Edit property", which sets a property's Display Name and,
// for a Formula, its Filter Expression; and "Add formula", which names a new
// Formula. A field saves when it loses focus, as Enter makes it; a Formula's
// text also saves a moment after the user stops typing, while it parses, so
// the view shows its values as the formula takes shape. The expression field
// is the Match editor's expression input, with a parse-only check: the engine
// plans the Formula when the view runs, and marks a mistake it finds at the
// Formula's row.
import { useMemo, useRef, useState } from "react";

import { parseExpression } from "@zotlit/filter-expression";
import { FORMULA_NAME, nameDictionary } from "@zotlit/item-query";
import type { PlacedFault } from "@zotlit/workbench/language";
import {
  MatchExpressionInput,
  WorkbenchThemeProvider,
} from "@zotlit/workbench/ui";

import {
  Chooser,
  useChooserPage,
  useChooserPageSave,
  useChooserPageText,
} from "@/components/chooser";
import type { ChooserPageMenuItem } from "@/components/chooser";
import { Button } from "@/components/obsidian/button";
import { Icon } from "@/components/obsidian/icon";
import { useObsidianApp } from "@/lib/app-context";
import * as m from "@/lib/i18n/generated/messages";
import { cn } from "@/lib/utils";
import { matchTheme } from "@/views/template-workbench/match-pane";
import { onKeymap } from "@/views/template-workbench/theme";

import { boundRecords } from "./context-hint";
import {
  expressionVocabulary,
  useViewCustomFields,
} from "./expression-vocabulary";
import { useQueryViewState } from "./model";
import { displayName, formulaProperty } from "./query-file";
import { formulaIssuesOf } from "./results";
import type { FormulaIssue } from "./results";
import type { QueryView } from "./view";
import { fieldLabel, useViewProperties } from "./view-properties";
import type { PropertyEntry } from "./view-properties";

/** How long a Formula's text rests before it saves while the user types. */
const FORMULA_SAVE_DELAY = 250;

/** Why a Formula name cannot be saved, or `null` when it can. */
export function formulaNameIssue(
  name: string,
  taken: Readonly<Record<string, string>>,
): string | null {
  if (name === "") return m.query_view_formula_name_empty();
  if (!FORMULA_NAME.test(name)) return m.query_view_formula_name_invalid();
  if (Object.hasOwn(taken, name)) return m.query_view_formula_name_taken();
  return null;
}

/** What the last run found in a Formula. */
export interface FormulaRunFault extends FormulaIssue {
  /** The Formula's saved text. */
  readonly saved: string;
}

/** What the Formula field reports, and the run's Fault it underlines. */
export interface FormulaCheck {
  /** What is wrong with the text, or `null` when nothing is. */
  readonly issue: string | null;
  /** Whether the text parses, apart from what the run found. */
  readonly syntax: "valid" | "invalid";
  /** Where the run found its Fault, while the text is the saved text. */
  readonly fault?: PlacedFault;
}

/**
 * @param run What the last run found in the Formula, or `null`.
 * @returns the text's Syntax Fault, else the run's Fault while the text is
 * the saved text. The field underlines both itself.
 */
export function formulaCheck(
  text: string,
  run: FormulaRunFault | null,
): FormulaCheck {
  if (text.trim() === "")
    return {
      issue: m.query_view_formula_expression_empty(),
      syntax: "invalid",
    };
  const { error } = parseExpression(text);
  if (error) {
    const expected = error.expected.join(", ");
    const issue =
      error.found === null
        ? m.query_view_formula_syntax_end({ expected })
        : m.query_view_formula_syntax({ found: error.found, expected });
    return { issue, syntax: "invalid" };
  }
  if (run === null || run.saved !== text)
    return { issue: null, syntax: "valid" };
  return {
    issue: run.message,
    syntax: "valid",
    ...(run.place && { fault: run.place }),
  };
}

/** The Syntax Fault of a Formula's text, or `null` when it parses. */
export function formulaSyntaxIssue(text: string): string | null {
  return formulaCheck(text, null).issue;
}

/** The header every page of the Properties popover wears. */
function PageHeader({
  title,
  menu,
}: {
  title: string;
  menu?: readonly ChooserPageMenuItem[];
}) {
  return (
    <Chooser.PageHeader
      title={title}
      backLabel={m.query_view_back()}
      closeLabel={m.query_view_close()}
      actions={
        menu && (
          <Chooser.PageMenu label={m.query_view_more_options()} items={menu} />
        )
      }
    />
  );
}

/** The Display Name field, as the property's page and "Add formula" show it. */
function DisplayNameField({
  property,
  value,
  onChange,
  onBlur,
}: {
  /** The property the name is for; its column header shows while the name is empty. */
  property: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
}) {
  return (
    <Chooser.PageField
      label={m.query_view_display_name()}
      description={m.query_view_display_name_desc({
        label: fieldLabel(property),
      })}
    >
      <input
        type="text"
        value={value}
        placeholder={fieldLabel(property)}
        data-query-display-name=""
        onInput={(event) => onChange(event.currentTarget.value)}
        onBlur={onBlur}
      />
    </Chooser.PageField>
  );
}

/**
 * The Formula field and the validity line under it, as the formula editor of
 * Bases shows them: an icon and the verdict, in the success or the error
 * colour. An empty field shows what to type instead.
 */
function ExpressionField({
  view,
  formula,
  value,
  onChange,
  onBlur,
  check: { issue, syntax, fault },
}: {
  /** The view whose Query Dataset the Formula reads. */
  view: QueryView;
  /** The Formula the text defines, which its completion leaves out; `null` for a new one. */
  formula: string | null;
  value: string;
  /** Called with the typed text and the window the field stands in. */
  onChange: (value: string, win: Window) => void;
  onBlur?: () => void;
  /** What the validity line reports and the field underlines. */
  check: FormulaCheck;
}) {
  const app = useObsidianApp();
  const properties = useViewProperties(view);
  const dataset = useQueryViewState(view, (s) => s.view?.from);
  const formulas = useQueryViewState(view, (s) => s.file?.formulas);
  const custom = useViewCustomFields();
  // A Formula reads no vault property, and naming itself is a cycle.
  const vocabulary = useMemo(
    () =>
      expressionVocabulary({
        dataset,
        properties,
        formulas: Object.fromEntries(
          Object.entries(formulas ?? {}).filter(([name]) => name !== formula),
        ),
        context: boundRecords(view.contextSource),
        custom,
      }),
    [dataset, properties, formulas, formula, view, custom],
  );
  return (
    <WorkbenchThemeProvider theme={onKeymap(matchTheme, app)}>
      <Chooser.PageField
        label={m.query_view_formula_expression()}
        description={value === "" && m.query_view_formula_expression_desc()}
        after={
          value !== "" && (
            <span
              className={cn(
                "zt:flex zt:items-start zt:gap-1 zt:text-xs",
                issue === null
                  ? "zt:text-(--text-success)"
                  : "zt:text-(--text-error)",
              )}
              data-query-formula-syntax={syntax}
            >
              {/* The icon keeps to the first line of a long message. */}
              <span className="zt:flex zt:h-lh zt:shrink-0 zt:items-center">
                <Icon
                  name={issue === null ? "circle-check" : "x-circle"}
                  size="xs"
                />
              </span>
              {issue === null ? (
                m.query_view_formula_valid()
              ) : (
                <span data-query-formula-message="">{issue}</span>
              )}
            </span>
          )
        }
      >
        <MatchExpressionInput
          vocabulary={vocabulary}
          lines={3}
          aria-invalid={value !== "" && issue !== null}
          value={value}
          fault={fault}
          data-query-formula-expression=""
          onChange={onChange}
          onBlur={onBlur}
        />
      </Chooser.PageField>
    </WorkbenchThemeProvider>
  );
}

/** A property's Display Name, saved when the field loses focus. */
function PropertyDisplayName({
  view,
  property,
  formula,
}: {
  view: QueryView;
  property: string;
  /** The name of the Formula the property shows, else `null`. */
  formula: string | null;
}) {
  const [name, setName, typed] = useChooserPageText(
    (() => {
      const file = view.state.getState().file;
      return (file && displayName(file, property)) ?? "";
    })(),
  );
  const save = () => {
    const file = view.state.getState().file;
    // A Formula removed from the page's menu takes its Display Name along.
    if (
      !file ||
      (formula !== null && !Object.hasOwn(file.formulas ?? {}, formula))
    )
      return;
    const now = displayName(file, property) ?? "";
    if (typed.current.trim() !== now)
      view.document.renameProperty(property, typed.current);
  };
  useChooserPageSave(save);
  return (
    <DisplayNameField
      property={property}
      value={name}
      onChange={setName}
      onBlur={save}
    />
  );
}

const ownEntry = <T,>(
  dictionary: Readonly<Record<string, T>>,
  name: string,
): T | undefined =>
  Object.hasOwn(dictionary, name) ? dictionary[name] : undefined;

/**
 * A Formula's text, saved while it parses: a moment after the user stops
 * typing, and when the field loses focus.
 */
function FormulaText({ view, name }: { view: QueryView; name: string }) {
  const saved = useQueryViewState(view, (s) => s.file?.formulas?.[name] ?? "");
  const issue = useQueryViewState(view, (s) =>
    ownEntry(formulaIssuesOf(s), name),
  );
  const [text, setText, typed] = useChooserPageText(saved);
  // The pending save, on the timers of the window the field stands in.
  const pending = useRef<{ win: Window; timer: number } | null>(null);
  const save = (next: string) => {
    if (pending.current)
      pending.current.win.clearTimeout(pending.current.timer);
    pending.current = null;
    const now = view.state.getState().file?.formulas?.[name];
    // A Formula removed from the page's menu stays removed.
    if (now !== undefined && next !== now && formulaSyntaxIssue(next) === null)
      view.document.saveFormula(name, next);
  };
  useChooserPageSave(() => save(typed.current));
  // What ZotLit Query found in the saved text, while it stays as saved.
  const check = useMemo(
    () => formulaCheck(text, issue === undefined ? null : { ...issue, saved }),
    [text, saved, issue],
  );
  return (
    <ExpressionField
      view={view}
      formula={name}
      value={text}
      check={check}
      onChange={(next, win) => {
        setText(next);
        if (pending.current)
          pending.current.win.clearTimeout(pending.current.timer);
        pending.current = {
          win,
          timer: win.setTimeout(() => save(next), FORMULA_SAVE_DELAY),
        };
      }}
      onBlur={() => save(typed.current)}
    />
  );
}

/**
 * "Edit property": the page a property's row opens. Its menu shows or hides
 * the property and removes a Formula.
 */
export function PropertyPage({
  view,
  entry,
  shown,
  onShownChange,
}: {
  view: QueryView;
  entry: PropertyEntry;
  /** Whether the view shows the property. */
  shown: boolean;
  onShownChange: (shown: boolean) => void;
}) {
  const { back } = useChooserPage();
  const formula = useQueryViewState(view, (s) =>
    entry.formula !== null &&
    Object.hasOwn(s.file?.formulas ?? {}, entry.formula)
      ? entry.formula
      : null,
  );
  const menu: ChooserPageMenuItem[] = [
    shown
      ? {
          title: m.query_view_property_hide(),
          icon: "eye-off",
          hook: "hide",
          onSelect: () => onShownChange(false),
        }
      : {
          title: m.query_view_property_show(),
          icon: "eye",
          hook: "show",
          onSelect: () => onShownChange(true),
        },
  ];
  if (formula !== null)
    menu.push({
      title: m.query_view_formula_remove(),
      icon: "trash-2",
      warning: true,
      hook: "remove-formula",
      onSelect: () => {
        if (view.document.removeFormula(formula)) back();
      },
    });
  return (
    <>
      <PageHeader
        title={m.query_view_property_edit_title({ name: entry.label })}
        menu={menu}
      />
      <Chooser.PageForm data-query-property-page={entry.path}>
        <PropertyDisplayName
          view={view}
          property={entry.path}
          formula={entry.formula}
        />
        {formula !== null && <FormulaText view={view} name={formula} />}
      </Chooser.PageForm>
    </>
  );
}

/**
 * "Add formula": a name, a Filter Expression and a Display Name for a new
 * Formula, which shows in the view on screen once saved. The page then
 * becomes the new Formula's "Edit property".
 */
export function NewFormulaPage({ view }: { view: QueryView }) {
  const { replacePage } = useChooserPage();
  const file = useQueryViewState(view, (s) => s.file);
  const formulas = file?.formulas ?? nameDictionary<string>();
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [label, setLabel] = useState("");
  const nameIssue = formulaNameIssue(name, formulas);
  const syntax = useMemo(() => formulaCheck(text, null), [text]);
  const syntaxIssue = syntax.issue;
  const save = () => {
    if (nameIssue !== null || syntaxIssue !== null) return;
    if (view.document.saveFormula(name, text, label))
      replacePage(formulaProperty(name));
  };
  return (
    <>
      <PageHeader title={m.query_view_formula_add()} />
      <Chooser.PageForm>
        <form
          className="zt:contents"
          data-query-formula-page=""
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <Chooser.PageField
            label={m.query_view_formula_name()}
            description={
              name !== "" && nameIssue !== null
                ? nameIssue
                : m.query_view_formula_name_desc({ name: name || "…" })
            }
            invalid={name !== "" && nameIssue !== null}
          >
            <input
              type="text"
              value={name}
              spellCheck={false}
              aria-invalid={name !== "" && nameIssue !== null}
              data-query-formula-name=""
              onInput={(event) => setName(event.currentTarget.value.trim())}
            />
          </Chooser.PageField>
          <ExpressionField
            view={view}
            formula={null}
            value={text}
            onChange={setText}
            check={syntax}
          />
          <DisplayNameField
            property={formulaProperty(name || "…")}
            value={label}
            onChange={setLabel}
          />
          <Button
            variant="cta"
            className="zt:self-end"
            disabled={nameIssue !== null || syntaxIssue !== null}
            data-query-formula-save=""
            onClick={save}
          >
            {m.query_view_formula_save()}
          </Button>
        </form>
      </Chooser.PageForm>
    </>
  );
}
