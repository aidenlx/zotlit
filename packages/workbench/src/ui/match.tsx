import type { WorkbenchDocumentController } from "#/document/controller";
import type { ExpressionVocabulary } from "#/language/filter-expression-completion";
import { useEffect, useMemo, useState, useRef } from "react";

import { composeFilterTree } from "@zotlit/filter-expression";
import type { FilterPath } from "@zotlit/filter-expression";
import { ITEMS } from "@zotlit/item-query";
import type { MatchTree } from "@zotlit/templates/facade";
import { FIELD_LABELS } from "@zotlit/zotero-types/field-labels";

import { useWorkbenchStore } from "./editor";
import { ExampleActions } from "./example-state";
import { schemaLocale } from "./explorer-sections";
import { useWorkbenchHost } from "./host";
import type { WorkbenchMatchResult } from "./host";
import {
  appendAt,
  asExpression,
  asLabelled,
  freshGroup,
  freshRow,
  fitsVocabulary,
  fromFilter,
  isExpression,
  isGroup,
  placeholderRow,
  removeAt,
  replaceAt,
  placeKey,
  settle,
  storedFilter,
  storesFilter,
  updateGroup,
} from "./match.draft";
import type {
  ConditionGroup,
  ConditionPath,
  LabelledRow,
  MatchFilter,
  MatchVocabulary,
  RowCondition,
} from "./match.draft";
import { MatchExpressionInput } from "./match.expression";
import { filterVocabulary } from "./match.fields";
import type { FilterValues } from "./match.fields";
import { useMatchReorder } from "./match.reorder";
import type { MatchReorder } from "./match.reorder";
import { MatchSelect } from "./match.rows";
// One Match tree over the document controller; rows write through the master history.
import { useWorkbenchMessages } from "./messages";
import { useParts, useIcon } from "./theme";

import { datasetReceiver } from "#/language/expression-receiver";
import { datasetExpressionFields } from "#/language/filter-expression-completion";

export type {
  ConditionControlProps,
  ConditionPath,
  ExpressionCondition,
  LabelledRow,
  MatchConditionKind,
  MatchFilter,
  MatchVocabulary,
  RowCondition,
} from "./match.draft";

const NO_VALUES: FilterValues = { tags: [], collections: [], libraries: [] };

/** How the Items dataset types a receiver; one function for every Profile. */
const itemReceiver = datasetReceiver(ITEMS);

/**
 * What a Profile Match condition reads: the fields of an Item, labelled as
 * Zotero labels them. A Profile binds no Query Context, has no Formulas and
 * reads no vault property.
 */
function profileExpressions(locale: string): ExpressionVocabulary {
  const labels = FIELD_LABELS[schemaLocale(locale)];
  return {
    fields: datasetExpressionFields(ITEMS, (path) => labels[path]),
    context: false,
    formulas: [],
    receiver: itemReceiver,
  };
}

/**
 * The Match of the open Profile document: the Match editor with the
 * conditions of the Items dataset, and whether the example Item matches, as
 * the host tests it.
 */
export function MatchPane({
  controller,
  vocabularyRevision,
  exampleMessage,
  onRetry,
  onChooseItem,
}: {
  controller: WorkbenchDocumentController;
  /** Changes when the host has a new snapshot or database vocabulary. */
  vocabularyRevision?: string | number;
  exampleMessage?: string | null;
  onRetry?: () => void;
  onChooseItem?: () => void;
}) {
  const m = useWorkbenchMessages();
  const host = useWorkbenchHost();
  const part = useParts("match");
  const item = useWorkbenchStore((state) => state.item);
  const [match, setMatch] = useState<MatchTree | undefined>(
    controller.document?.manifest.match,
  );
  const [readable, setReadable] = useState(controller.document !== null);
  const [values, setValues] = useState<FilterValues>(NO_VALUES);
  const [writeProblem, setWriteProblem] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const read = () => {
      setReadable(controller.document !== null);
      if (controller.document) setMatch(controller.document.manifest.match);
    };
    read();
    return controller.subscribe(read);
  }, [controller]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    void Promise.all([
      host.matchData.tags(),
      host.matchData.collections(),
      host.matchData.libraries(),
    ]).then(
      ([tags, collections, libraries]) => {
        if (active) {
          setValues({
            tags,
            collections: collections.map((path) => path.join("/")),
            libraries: libraries.map(({ id, name }) => ({
              id,
              name: name ?? null,
            })),
          });
          setProblem(null);
          setLoading(false);
        }
      },
      () => {
        if (active) {
          setProblem(m.workbench_example_failed());
          setLoading(false);
        }
      },
    );
    return () => {
      active = false;
    };
  }, [host.matchData, vocabularyRevision, m, retry]);
  const filter = useMemo(
    () => (match === undefined ? null : composeFilterTree(match)),
    [match],
  );
  const test = useMatchTest(
    item?.id ?? null,
    filter?.text ?? null,
    `${vocabularyRevision ?? ""}:${retry}`,
  );
  const answer = typeof test === "object" ? test : null;
  // A mistake shows on the condition it is in, where it has a place.
  const span = answer?.kind === "problem" ? answer.span : undefined;
  const faulty = span
    ? filter?.leaves.find(({ from, to }) => span.from >= from && span.to <= to)
    : undefined;
  const locale = host.getLocale();
  const expression = useMemo(() => profileExpressions(locale), [locale]);
  const vocabulary = useMemo(
    () => ({
      ...filterVocabulary("items", {
        m,
        values,
        issue: (_, path) =>
          faulty &&
          answer?.kind === "problem" &&
          placeKey(path) === placeKey(faulty.path)
            ? answer.message
            : null,
      }),
      expression,
    }),
    [m, values, faulty, answer, expression],
  );
  function write(next: MatchTree | undefined) {
    const saved = controller.setMatch(next);
    setWriteProblem(saved ? null : m.workbench_match_source_only());
    return saved;
  }
  const reason =
    controller.document?.manifest.id === "default"
      ? m.workbench_match_default()
      : !readable
        ? m.workbench_match_source_only()
        : test === "failed"
          ? m.workbench_example_failed()
          : answer?.kind === "missing"
            ? m.workbench_match_missing_facts()
            : answer?.kind === "unavailable"
              ? m.workbench_match_example_unavailable()
              : answer?.kind === "problem" && !faulty
                ? answer.message
                : null;
  const matched = answer?.kind === "result" && answer.matched;
  const pending = filter !== null && test === undefined;
  const failed = problem ?? reason;
  const resultMessage = !item
    ? m.workbench_match_choose_item()
    : (exampleMessage ??
      (loading || pending ? m.workbench_loading_item() : null) ??
      (failed
        ? m.workbench_match_result_unavailable({ reason: failed })
        : matched
          ? m.workbench_match_result_yes()
          : m.workbench_match_result_no()));
  const resultState = !item
    ? "no-selection"
    : onRetry || (!loading && failed)
      ? "error"
      : exampleMessage || loading || pending
        ? "loading"
        : matched
          ? "match"
          : "no-match";
  return (
    <section
      {...part("pane")}
      onKeyDown={(event) => {
        if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
        // A popup the host draws in the pane, such as a select's search
        // field, keeps its own text editing.
        if ((event.target as Element).closest("[popover]")) return;
        if (
          event.key.toLowerCase() === "z" ||
          event.key.toLowerCase() === "y"
        ) {
          event.preventDefault();
          event.stopPropagation();
          if (event.shiftKey || event.key.toLowerCase() === "y")
            controller.redo();
          else controller.undo();
        }
      }}
    >
      <p>{m.workbench_match_conditions_desc()}</p>
      <MatchEditor
        value={match}
        vocabulary={vocabulary}
        onChange={write}
        disabled={
          controller.readOnly ||
          !readable ||
          controller.document?.manifest.id === "default"
        }
      />
      <div {...part("actions")}>
        <p role="status" {...part("result", resultState)}>
          {resultMessage}
        </p>
        <ExampleActions
          chooseLabel={m.workbench_choose_match_item()}
          onChooseItem={onChooseItem}
          onRetry={
            onRetry ??
            (problem || test === "failed"
              ? () => setRetry((value) => value + 1)
              : undefined)
          }
        />
      </div>
      {writeProblem && <p role="alert">{writeProblem}</p>}
    </section>
  );
}

/**
 * The host's test of the Item `indexedKey` against `filter`: `undefined`
 * while it runs, and `failed` when the host could not answer. A filter or an
 * Item of `null` is not tested. A new `revision` tests again.
 */
function useMatchTest(
  indexedKey: string | null,
  filter: string | null,
  revision: string,
): WorkbenchMatchResult | "failed" | undefined {
  const host = useWorkbenchHost();
  const key =
    indexedKey === null || filter === null
      ? null
      : JSON.stringify([indexedKey, filter, revision]);
  const [answer, setAnswer] = useState<{
    key: string;
    value: WorkbenchMatchResult | "failed";
  } | null>(null);
  useEffect(() => {
    if (key === null || indexedKey === null || filter === null) return;
    let active = true;
    void host.matchData.matches(indexedKey, filter).then(
      (value) => {
        if (active) setAnswer({ key, value });
      },
      () => {
        if (active) setAnswer({ key, value: "failed" });
      },
    );
    return () => {
      active = false;
    };
  }, [host.matchData, key, indexedKey, filter]);
  return answer?.key === key ? answer.value : undefined;
}

/**
 * A Match tree as "All" / "Any" / "None of the following are true" groups of
 * condition rows. The caller owns the stored filter and the conditions it
 * offers; `onChange` answers whether the caller kept the new filter.
 */
export function MatchEditor<Row extends LabelledRow>({
  value,
  onChange,
  vocabulary,
  disabled = false,
}: {
  value: MatchFilter | undefined;
  /** `undefined` when the author clears every condition. */
  onChange: (next: MatchTree | undefined) => boolean;
  vocabulary: MatchVocabulary<Row>;
  disabled?: boolean;
}) {
  const part = useParts("match");
  const [root, setRootState] = useState<ConditionGroup<Row>>(() =>
    fromFilter(value, vocabulary),
  );
  // The tree as last shown: a value it already stores is the editor's own
  // edit coming back, so an expression row the author is typing stays one.
  const shown = useRef(root);
  function setRoot(next: ConditionGroup<Row>) {
    shown.current = next;
    setRootState(next);
  }
  const latest = useRef(vocabulary);
  latest.current = vocabulary;
  useEffect(() => {
    if (
      fitsVocabulary(shown.current, latest.current) &&
      storesFilter(shown.current, value, latest.current)
    )
      return;
    setRoot(fromFilter(value, latest.current));
  }, [value]);
  // A new vocabulary — a view's dataset changed — may not offer the kinds
  // of the rows on screen; the stored filter then reads again under it.
  const fits = fitsVocabulary(root, vocabulary);
  const tree = fits ? root : fromFilter(value, vocabulary);
  useEffect(() => {
    if (!fits) setRoot(tree);
  });
  // A change that stores what the caller holds — a placeholder row, a row
  // with no value yet — stays on screen without a write.
  function change(next: ConditionGroup<Row>) {
    const settled = settle(next, vocabulary);
    setRoot(settled);
    const { filter } = storedFilter(settled, vocabulary);
    if (JSON.stringify(filter) === JSON.stringify(value)) return;
    if (!onChange(filter)) setRoot(fromFilter(value, vocabulary));
  }
  const { places } = storedFilter(tree, vocabulary);
  const reorder = useMatchReorder({ root: tree, disabled, onChange: change });
  return (
    <fieldset disabled={disabled} {...part("fieldset")} {...reorder.fieldset}>
      <Group
        root={tree}
        group={tree}
        path={[]}
        places={places}
        vocabulary={vocabulary}
        reorder={reorder}
        onChange={change}
      />
    </fieldset>
  );
}

function Group<Row extends LabelledRow>({
  root,
  group,
  path,
  places,
  vocabulary,
  reorder,
  onChange,
}: {
  root: ConditionGroup<Row>;
  group: ConditionGroup<Row>;
  path: ConditionPath;
  /** Where each row sits in the stored filter, as {@link storedFilter} finds it. */
  places: ReadonlyMap<string, FilterPath>;
  vocabulary: MatchVocabulary<Row>;
  reorder: MatchReorder;
  onChange: (root: ConditionGroup<Row>) => void;
}) {
  const m = useWorkbenchMessages();
  const part = useParts("match");
  const icon = useIcon();
  const host = useWorkbenchHost();
  // "Add condition" hands the focus to the new row's condition type.
  const rows = useRef<HTMLUListElement>(null);
  const focusAdded = useRef(false);
  useEffect(() => {
    if (!focusAdded.current) return;
    focusAdded.current = false;
    rows.current
      ?.querySelector<HTMLElement>(
        // The kind picker is a native select, or the host's own trigger.
        ":scope > li:last-child [data-condition-row] :is(select, button[aria-label])",
      )
      ?.focus();
  }, [group.conditions.length]);
  return (
    <div
      {...part("group", path.length ? "nested" : "root")}
      {...reorder.group(path, group.conditions.length)}
    >
      <div {...part("actions", "header")} {...reorder.header(path)}>
        <MatchSelect
          aria-label={m.workbench_match_match()}
          value={group.match}
          onChange={(value) =>
            onChange(
              updateGroup(root, path, (node) => ({
                ...node,
                match:
                  value === "any" ? "any" : value === "none" ? "none" : "all",
              })),
            )
          }
          options={[
            { value: "all", label: m.workbench_match_match_all() },
            { value: "any", label: m.workbench_match_match_any() },
            { value: "none", label: m.workbench_match_match_none() },
          ]}
        />
        {path.length > 0 && (
          <button
            {...part("icon-button")}
            type="button"
            aria-label={m.workbench_match_remove_group()}
            {...host.tooltip(m.workbench_match_remove_group())}
            onClick={() => onChange(removeAt(root, path))}
          >
            {icon("remove")}
          </button>
        )}
      </div>
      <ul ref={rows} {...part("rows")} {...reorder.rows(path)}>
        {group.conditions.map((node, index) => (
          <li
            key={index}
            {...part("row", isGroup(node) ? "group" : "condition")}
            {...reorder.row([...path, index], group.conditions.length)}
          >
            <span
              {...part("handle")}
              aria-label={m.workbench_match_drag_to_reorder()}
              {...host.tooltip(m.workbench_match_drag_to_reorder())}
              {...reorder.handle([...path, index], group.conditions.length)}
            >
              {icon("drag")}
            </span>
            {!isGroup(node) && (
              <span {...part("conjunction")}>
                {index === 0
                  ? m.workbench_match_conjunction_where()
                  : group.match === "all"
                    ? m.workbench_match_conjunction_and()
                    : m.workbench_match_conjunction_or()}
              </span>
            )}
            {isGroup(node) ? (
              <Group
                root={root}
                group={node}
                path={[...path, index]}
                places={places}
                vocabulary={vocabulary}
                reorder={reorder}
                onChange={onChange}
              />
            ) : (
              <Row
                condition={node}
                stored={places.get(placeKey([...path, index])) ?? null}
                vocabulary={vocabulary}
                onChange={(next) =>
                  onChange(replaceAt(root, [...path, index], next))
                }
                onRemove={() => onChange(removeAt(root, [...path, index]))}
              />
            )}
          </li>
        ))}
      </ul>
      <div {...part("actions", "footer")}>
        <button
          {...part("button")}
          type="button"
          onClick={() => {
            focusAdded.current = true;
            onChange(appendAt(root, path, placeholderRow(vocabulary)));
          }}
        >
          {icon("add")}
          {m.workbench_match_add_condition()}
        </button>
        <button
          {...part("button")}
          type="button"
          onClick={() => onChange(appendAt(root, path, freshGroup(vocabulary)))}
        >
          {icon("add")}
          {m.workbench_match_add_group()}
        </button>
      </div>
    </div>
  );
}

function Row<Row extends LabelledRow>({
  condition,
  stored,
  vocabulary,
  onChange,
  onRemove,
}: {
  condition: RowCondition<Row>;
  /** The row's place in the stored filter; `null` while it stores nothing. */
  stored: FilterPath | null;
  vocabulary: MatchVocabulary<Row>;
  onChange: (condition: RowCondition<Row>) => void;
  onRemove: () => void;
}) {
  const m = useWorkbenchMessages();
  const part = useParts("match");
  const icon = useIcon();
  const host = useWorkbenchHost();
  const issue =
    stored === null ? null : (vocabulary.issue?.(condition, stored) ?? null);
  const text = isExpression(condition) ? condition.text : null;
  const place = stored === null ? null : placeKey(stored);
  const findFaults = vocabulary.faults;
  const faults = useMemo(
    () =>
      text === null || stored === null ? undefined : findFaults?.(text, stored),
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- `place` stands for `stored`, a new array on each render
    [findFaults, text, place],
  );
  const labelled = isExpression(condition)
    ? asLabelled(condition, vocabulary)
    : null;
  const kind = isExpression(condition)
    ? undefined
    : vocabulary.kinds.find((entry) => entry.kind === condition.kind);
  return (
    <div {...part("condition")} data-condition-row="">
      <div {...part("statement", issue ? "error" : undefined)}>
        <div {...part("fields")}>
          {!isExpression(condition) && (
            <div {...part("predicate", kind?.icon ? "icon" : undefined)}>
              <MatchSelect
                searchable
                aria-label={m.workbench_match_condition_kind()}
                value={condition.kind}
                options={vocabulary.kinds.map((entry) => ({
                  value: entry.kind,
                  label: entry.label,
                  icon: entry.icon,
                  detail: entry.detail,
                }))}
                onChange={(next) =>
                  onChange(freshRow(vocabulary, next as Row["kind"]))
                }
              />
              {kind?.renderOperator?.({ condition, onChange })}
            </div>
          )}
          <div {...part("value")}>
            {isExpression(condition) ? (
              <MatchExpressionInput
                aria-label={m.workbench_match_expression()}
                aria-invalid={issue !== null}
                value={condition.text}
                vocabulary={vocabulary.expression}
                faults={faults}
                onChange={(text) => onChange({ kind: "expression", text })}
              />
            ) : (
              kind?.renderValue({ condition, onChange })
            )}
          </div>
        </div>
        <div {...part("actions")}>
          {isExpression(condition) ? (
            <button
              {...part("icon-button")}
              type="button"
              disabled={labelled === null}
              aria-label={m.workbench_match_edit_visually()}
              {...host.tooltip(m.workbench_match_edit_visually())}
              onClick={() => {
                if (labelled) onChange(labelled);
              }}
            >
              {icon("basic")}
            </button>
          ) : (
            <button
              {...part("icon-button")}
              type="button"
              aria-label={m.workbench_match_edit_as_expression()}
              {...host.tooltip(m.workbench_match_edit_as_expression())}
              onClick={() => onChange(asExpression(condition, vocabulary))}
            >
              {icon("advanced")}
            </button>
          )}
          <button
            {...part("icon-button")}
            type="button"
            aria-label={m.workbench_match_remove_condition()}
            {...host.tooltip(m.workbench_match_remove_condition())}
            onClick={onRemove}
          >
            {icon("remove")}
          </button>
        </div>
      </div>
      {issue && (
        <p role="alert" {...part("error")}>
          {issue}
        </p>
      )}
    </div>
  );
}
