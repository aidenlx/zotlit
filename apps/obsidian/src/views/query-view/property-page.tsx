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
import { useStore } from "zustand";

import { parseExpression } from "@zotlit/filter-expression";
import { FORMULA_NAME, nameDictionary } from "@zotlit/item-query";
import {
  MatchExpressionInput,
  WorkbenchThemeProvider,
} from "@zotlit/workbench/ui";
import type { ExpressionFault } from "@zotlit/workbench/ui";

import {
  Chooser,
  useChooserPage,
  useChooserPageSave,
  useChooserPageText,
} from "@/components/chooser";
import type { ChooserPageMenuItem } from "@/components/chooser";
import { Button } from "@/components/obsidian/button";
import { Icon } from "@/components/obsidian/icon";
import * as m from "@/lib/i18n/generated/messages";
import { cn } from "@/lib/utils";
import { matchTheme } from "@/views/template-workbench/match-pane";

import { syntaxFaultSpan } from "./expression-faults";
import type { PlacedFault } from "./expression-faults";
import { displayName, formulaProperty } from "./query-file";
import { formulaIssuesOf, formulaSpansOf } from "./results";
import type { QueryView } from "./view";
import { fieldLabel } from "./view-properties";
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
export interface FormulaRunFault {
  /** The Formula's saved text. */
  readonly saved: string;
  readonly message: string;
  /**
   * Where the Fault is in the text the run planned, where it names a place;
   * the field underlines it while that text is the saved text.
   */
  readonly span?: PlacedFault | undefined;
}

/** What the Formula field reports and underlines. */
export interface FormulaCheck {
  /** What is wrong with the text, or `null` when nothing is. */
  readonly issue: string | null;
  readonly faults: readonly ExpressionFault[];
}

/**
 * What is wrong with a Formula's text: its Syntax Fault, else the run's
 * Fault while the text is the saved text the run planned, each underlined at
 * its span.
 */
export function formulaCheck(
  text: string,
  run: FormulaRunFault | null,
): FormulaCheck {
  if (text.trim() === "")
    return { issue: m.query_view_formula_expression_empty(), faults: [] };
  const { error } = parseExpression(text);
  if (error) {
    const expected = error.expected.join(", ");
    const issue =
      error.found === null
        ? m.query_view_formula_syntax_end({ expected })
        : m.query_view_formula_syntax({ found: error.found, expected });
    const span = syntaxFaultSpan(text, error);
    return { issue, faults: span ? [{ ...span, message: issue }] : [] };
  }
  if (run === null || run.saved !== text) return { issue: null, faults: [] };
  return {
    issue: run.message,
    faults:
      run.span?.text === text
        ? [{ ...run.span.span, message: run.message }]
        : [],
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
  value,
  onChange,
  onBlur,
  check: { issue, faults },
}: {
  value: string;
  /** Called with the typed text and the window the field stands in. */
  onChange: (value: string, win: Window) => void;
  onBlur?: () => void;
  /** What the validity line reports and the field underlines. */
  check: FormulaCheck;
}) {
  return (
    <WorkbenchThemeProvider theme={matchTheme}>
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
              // Whether the text parses, apart from what the run found.
              data-query-formula-syntax={
                formulaSyntaxIssue(value) === null ? "valid" : "invalid"
              }
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
          lines={3}
          aria-invalid={value !== "" && issue !== null}
          value={value}
          faults={faults}
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

/** The entry of `name` in a dictionary, where it has one. */
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
  const saved = useStore(view.state, (s) => s.file?.formulas?.[name] ?? "");
  const issue = useStore(view.state, (s) => ownEntry(formulaIssuesOf(s), name));
  const span = useStore(view.state, (s) => ownEntry(formulaSpansOf(s), name));
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
    () =>
      formulaCheck(
        text,
        issue === undefined ? null : { saved, message: issue, span },
      ),
    [text, saved, issue, span],
  );
  return (
    <ExpressionField
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
  const formula = useStore(view.state, (s) =>
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
  const file = useStore(view.state, (s) => s.file);
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
          <ExpressionField value={text} onChange={setText} check={syntax} />
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
