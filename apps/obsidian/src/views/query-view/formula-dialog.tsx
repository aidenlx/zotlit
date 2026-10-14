// "Add formula" and "Edit formula": the name and the Filter Expression of one
// Formula of a Query File. The expression field is the Match editor's
// expression input, with a parse-only check: the engine plans the Formula
// when the view runs, and marks a mistake it finds at the Formula's row.
import { Modal } from "obsidian";
import type { App } from "obsidian";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { useStore } from "zustand";

import { parseExpression } from "@zotlit/filter-expression";
import { FORMULA_NAME, nameDictionary } from "@zotlit/item-query";
import {
  MatchExpressionInput,
  WorkbenchThemeProvider,
} from "@zotlit/workbench/ui";

import { Icon } from "@/components/obsidian/icon";
import * as m from "@/lib/i18n/generated/messages";
import { tooltipAttrs } from "@/lib/utils";
import { matchTheme } from "@/views/template-workbench/match-pane";

import { DisplayNameField } from "./display-name-dialog";
import { displayName, formulaProperty } from "./query-file";
import type { QueryView } from "./view";

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

/** The Syntax Fault of a Formula's text, or `null` when it parses. */
export function formulaSyntaxIssue(text: string): string | null {
  if (text.trim() === "") return m.query_view_formula_expression_empty();
  const { error } = parseExpression(text);
  if (!error) return null;
  const expected = error.expected.join(", ");
  return error.found === null
    ? m.query_view_formula_syntax_end({ expected })
    : m.query_view_formula_syntax({ found: error.found, expected });
}

function FormulaForm({
  view,
  editing,
  close,
}: {
  view: QueryView;
  /** The name of the Formula to edit; `null` adds one. */
  editing: string | null;
  close: () => void;
}) {
  const file = useStore(view.state, (s) => s.file);
  const formulas = file?.formulas ?? nameDictionary<string>();
  const issues = useStore(view.state, (s) => s.formulaIssues);
  const saved = editing === null ? undefined : formulas[editing];
  const [name, setName] = useState(editing ?? "");
  const [text, setText] = useState(saved ?? "");
  const [label, setLabel] = useState(
    () =>
      (editing !== null &&
        file &&
        displayName(file, formulaProperty(editing))) ||
      "",
  );
  const nameIssue = editing === null ? formulaNameIssue(name, formulas) : null;
  const syntaxIssue = formulaSyntaxIssue(text);
  // What ZotLit Query found in the saved text, while it stays as saved.
  const runIssue =
    editing !== null && text === saved && Object.hasOwn(issues, editing)
      ? issues[editing]!
      : null;
  const fieldIssue = syntaxIssue ?? runIssue;
  const save = () => {
    if (nameIssue !== null || syntaxIssue !== null) return;
    if (view.saveFormula(name, text, label)) close();
  };
  return (
    <form
      className="zt:flex zt:flex-col zt:gap-3"
      data-query-formula-dialog={editing ?? ""}
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <label className="zt:flex zt:flex-col zt:gap-1">
        <span className="zt:font-medium">{m.query_view_formula_name()}</span>
        <input
          type="text"
          value={name}
          disabled={editing !== null}
          spellCheck={false}
          aria-invalid={name !== "" && nameIssue !== null}
          data-query-formula-name=""
          onInput={(event) => setName(event.currentTarget.value.trim())}
        />
        <span className="zt:text-xs zt:text-(--text-muted)">
          {name !== "" && nameIssue !== null ? (
            <span className="zt:text-(--text-error)">{nameIssue}</span>
          ) : (
            m.query_view_formula_name_desc({ name: name || "…" })
          )}
        </span>
      </label>
      <WorkbenchThemeProvider theme={matchTheme}>
        <label className="zt:flex zt:flex-col zt:gap-1">
          <span className="zt:flex zt:items-center zt:gap-1 zt:font-medium">
            {m.query_view_formula_expression()}
            {text !== "" && (
              <span
                className={
                  fieldIssue === null
                    ? "zt:text-(--text-success)"
                    : "zt:text-(--text-error)"
                }
                data-query-formula-syntax={
                  syntaxIssue === null ? "valid" : "invalid"
                }
                {...tooltipAttrs(fieldIssue ?? m.query_view_formula_valid())}
              >
                <Icon
                  name={fieldIssue === null ? "check" : "alert-triangle"}
                  size={14}
                />
              </span>
            )}
          </span>
          <MatchExpressionInput
            rows={2}
            spellCheck={false}
            aria-invalid={text !== "" && fieldIssue !== null}
            value={text}
            data-query-formula-expression=""
            onInput={(event) => setText(event.currentTarget.value)}
          />
          <span className="zt:text-xs zt:text-(--text-muted)">
            {text !== "" && fieldIssue !== null ? (
              <span
                className="zt:text-(--text-error)"
                data-query-formula-message=""
              >
                {fieldIssue}
              </span>
            ) : (
              m.query_view_formula_expression_desc()
            )}
          </span>
        </label>
      </WorkbenchThemeProvider>
      <DisplayNameField
        property={formulaProperty(name || "…")}
        value={label}
        onChange={setLabel}
      />
      <div className="modal-button-container">
        {editing !== null && (
          <button
            type="button"
            className="mod-warning"
            data-query-formula-remove=""
            onClick={() => {
              if (view.removeFormula(editing)) close();
            }}
          >
            {m.query_view_formula_remove()}
          </button>
        )}
        <button
          type="submit"
          className="mod-cta"
          disabled={nameIssue !== null || syntaxIssue !== null}
          data-query-formula-save=""
        >
          {m.query_view_formula_save()}
        </button>
      </div>
    </form>
  );
}

export class FormulaModal extends Modal {
  #root: Root | null = null;
  readonly #view: QueryView;
  readonly #editing: string | null;

  constructor(app: App, view: QueryView, editing: string | null) {
    super(app);
    this.#view = view;
    this.#editing = editing;
    this.setTitle(
      editing === null
        ? m.query_view_formula_add()
        : m.query_view_formula_edit(),
    );
  }

  override onOpen(): void {
    this.modalEl.addClass("zt-query-formula-modal");
    this.contentEl.addClass("zt-root");
    this.#root = createRoot(this.contentEl);
    this.#root.render(
      <FormulaForm
        view={this.#view}
        editing={this.#editing}
        close={() => this.close()}
      />,
    );
  }

  override onClose(): void {
    this.#root?.unmount();
    this.#root = null;
  }
}
