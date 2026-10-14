import type { WorkbenchDocumentController } from "#/document/controller";
import type { MatchItemFacts } from "#/match/condition";
import { useEffect, useMemo, useState, useRef } from "react";

import type { MatchTree } from "@zotlit/templates/facade";

import { useOptionalEditor, useWorkbenchStore } from "./editor";
import { ExampleActions } from "./example-state";
import { useWorkbenchHost } from "./host";
import { describeProblem } from "./match.diagnostic";
import {
  appendAt,
  asExpression,
  asLabelled,
  freshGroup,
  freshRow,
  fromFilter,
  isExpression,
  isGroup,
  removeAt,
  replaceAt,
  storesFilter,
  toFilter,
  updateGroup,
} from "./match.draft";
import type {
  ConditionGroup,
  ConditionPath,
  LabelledRow,
  MatchEditorDeps,
  MatchFilter,
  MatchVocabulary,
  RowCondition,
} from "./match.draft";
import { profileVocabulary } from "./match.profile";
import { MatchSelect } from "./match.rows";
// One Match tree over the document controller; rows write through the master history.
import { useWorkbenchMessages } from "./messages";
import { useParts, useIcon } from "./theme";

import { compileFilter, matchCondition } from "#/match/condition";

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

export function MatchPane({
  controller,
  facts,
  vocabularyRevision,
  exampleMessage,
  onRetry,
  onChooseItem,
}: {
  controller: WorkbenchDocumentController;
  facts: MatchItemFacts | null;
  /** Changes when the host has a new snapshot or database vocabulary. */
  vocabularyRevision?: string | number;
  exampleMessage?: string | null;
  onRetry?: () => void;
  onChooseItem?: () => void;
}) {
  const m = useWorkbenchMessages();
  const host = useWorkbenchHost();
  const part = useParts("match");
  const editor = useOptionalEditor();
  const item = useWorkbenchStore((state) => state.item);
  const hasItem = editor ? item !== null : facts !== null;
  const [match, setMatch] = useState<MatchTree | undefined>(
    controller.document?.manifest.match,
  );
  const [readable, setReadable] = useState(controller.document !== null);
  const [deps, setDeps] = useState<MatchEditorDeps>({
    tags: [],
    collections: [],
    libraries: [],
  });
  const vocabulary = useMemo(() => profileVocabulary(m, deps), [m, deps]);
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
          setDeps({
            tags,
            collections: collections.map((path) => ({ path })),
            libraries: libraries.map(({ id, name }) => ({
              selector:
                id === "personal"
                  ? { type: "personal" as const }
                  : { type: "group" as const, groupID: Number(id.slice(6)) },
              ...(name === undefined ? {} : { name }),
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
  function write(next: MatchTree | undefined) {
    const saved = controller.setMatch(next);
    setWriteProblem(saved ? null : m.workbench_match_source_only());
    return saved;
  }
  const compiled =
    match === undefined ? null : compileFilter(match, deps.libraries);
  const reason =
    controller.document?.manifest.id === "default"
      ? m.workbench_match_default()
      : !readable
        ? m.workbench_match_source_only()
        : compiled?.problem
          ? describeProblem(m, compiled.problem)
          : facts === null
            ? m.workbench_match_missing_facts()
            : null;
  const matched =
    compiled?.condition && facts
      ? matchCondition(compiled.condition, facts)
      : false;
  const failed = problem ?? reason;
  const resultMessage = !hasItem
    ? m.workbench_match_choose_item()
    : (exampleMessage ??
      (loading ? m.workbench_loading_item() : null) ??
      (failed
        ? m.workbench_match_result_unavailable({ reason: failed })
        : matched
          ? m.workbench_match_result_yes()
          : m.workbench_match_result_no()));
  const resultState = !hasItem
    ? "no-selection"
    : onRetry || (!loading && failed)
      ? "error"
      : exampleMessage || loading
        ? "loading"
        : matched
          ? "match"
          : "no-match";
  return (
    <section
      {...part("pane")}
      onKeyDown={(event) => {
        if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
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
            (problem ? () => setRetry((value) => value + 1) : undefined)
          }
        />
      </div>
      {writeProblem && <p role="alert">{writeProblem}</p>}
    </section>
  );
}

const emptyGroup = <Row extends LabelledRow>(): ConditionGroup<Row> => ({
  kind: "group",
  match: "all",
  conditions: [],
});

/**
 * A Match tree as "All of the following" / "Any of the following" groups of
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
  const [showStarter, setShowStarter] = useState(true);
  const [root, setRootState] = useState<ConditionGroup<Row>>(() =>
    value === undefined ? emptyGroup() : fromFilter(value, vocabulary),
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
    if (storesFilter(shown.current, value, latest.current)) return;
    setShowStarter(true);
    setRoot(
      value === undefined ? emptyGroup() : fromFilter(value, latest.current),
    );
  }, [value]);
  function write(next: MatchTree | undefined) {
    const saved = onChange(next);
    if (!saved)
      setRoot(
        value === undefined ? emptyGroup() : fromFilter(value, vocabulary),
      );
    else if (next === undefined) setRoot(emptyGroup());
    return saved;
  }
  return (
    <fieldset disabled={disabled} {...part("fieldset")}>
      <Group
        root={root}
        group={root}
        path={[]}
        vocabulary={vocabulary}
        showStarter={showStarter}
        onRemoveMatch={
          value === undefined && !showStarter
            ? undefined
            : () => {
                if (write(undefined)) setShowStarter(false);
              }
        }
        onChange={(next) => {
          setShowStarter(true);
          setRoot(next);
          write(toFilter(next, vocabulary));
        }}
      />
    </fieldset>
  );
}

function Group<Row extends LabelledRow>({
  root,
  group,
  path,
  vocabulary,
  onChange,
  onRemoveMatch,
  showStarter = false,
}: {
  root: ConditionGroup<Row>;
  group: ConditionGroup<Row>;
  path: ConditionPath;
  vocabulary: MatchVocabulary<Row>;
  onChange: (root: ConditionGroup<Row>) => void;
  onRemoveMatch?: () => void;
  showStarter?: boolean;
}) {
  const m = useWorkbenchMessages();
  const part = useParts("match");
  const icon = useIcon();
  const host = useWorkbenchHost();
  const starter = showStarter && group.conditions.length === 0;
  const conditions = starter
    ? [freshRow(vocabulary, vocabulary.starterKind)]
    : group.conditions;
  return (
    <div {...part("group", path.length ? "nested" : "root")}>
      <div {...part("actions")}>
        <MatchSelect
          aria-label={m.workbench_match_match()}
          value={group.match}
          onChange={(value) =>
            onChange(
              updateGroup(root, path, (node) => ({
                ...node,
                match: value === "all" ? "all" : "any",
              })),
            )
          }
        >
          <option value="all">{m.workbench_match_match_all()}</option>
          <option value="any">{m.workbench_match_match_any()}</option>
        </MatchSelect>
        {onRemoveMatch && (
          <button
            {...part("remove-button")}
            type="button"
            onClick={onRemoveMatch}
          >
            {m.workbench_match_remove()}
          </button>
        )}
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
      <ul {...part("rows")}>
        {conditions.map((node, index) => (
          <li
            key={index}
            {...part("row", isGroup(node) ? "group" : "condition")}
          >
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
                vocabulary={vocabulary}
                onChange={onChange}
              />
            ) : (
              <Row
                condition={node}
                path={[...path, index]}
                starter={starter}
                vocabulary={vocabulary}
                onChange={(next) =>
                  onChange(
                    starter
                      ? appendAt(root, path, next)
                      : replaceAt(root, [...path, index], next),
                  )
                }
                onRemove={() => {
                  if (!starter) onChange(removeAt(root, [...path, index]));
                }}
              />
            )}
          </li>
        ))}
      </ul>
      <div {...part("actions")}>
        <button
          {...part("button")}
          type="button"
          onClick={() =>
            onChange(
              appendAt(root, path, freshRow(vocabulary, vocabulary.newKind)),
            )
          }
        >
          {icon("add")}
          {m.workbench_match_add_condition()}
        </button>
        <button
          {...part("button")}
          type="button"
          onClick={() =>
            onChange(appendAt(root, path, freshGroup(group.match, vocabulary)))
          }
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
  path,
  starter = false,
  vocabulary,
  onChange,
  onRemove,
}: {
  condition: RowCondition<Row>;
  path: ConditionPath;
  starter?: boolean;
  vocabulary: MatchVocabulary<Row>;
  onChange: (condition: RowCondition<Row>) => void;
  onRemove: () => void;
}) {
  const m = useWorkbenchMessages();
  const part = useParts("match");
  const icon = useIcon();
  const host = useWorkbenchHost();
  const issue = starter ? null : (vocabulary.issue?.(condition, path) ?? null);
  const labelled = isExpression(condition)
    ? asLabelled(condition, vocabulary)
    : null;
  const kind = isExpression(condition)
    ? undefined
    : vocabulary.kinds.find((entry) => entry.kind === condition.kind);
  return (
    <div {...part("condition")} data-condition-row="">
      <div {...part("statement")}>
        <div {...part("fields")}>
          {!isExpression(condition) && (
            <div {...part("predicate")}>
              <MatchSelect
                aria-label={m.workbench_match_condition_kind()}
                value={condition.kind}
                onChange={(next) =>
                  onChange(freshRow(vocabulary, next as Row["kind"]))
                }
              >
                {vocabulary.kinds.map((entry) => (
                  <option key={entry.kind} value={entry.kind}>
                    {entry.label}
                  </option>
                ))}
              </MatchSelect>
              {kind?.renderOperator?.({ condition, onChange })}
            </div>
          )}
          <div {...part("value")}>
            {isExpression(condition) ? (
              <textarea
                rows={1}
                {...part("expression")}
                aria-label={m.workbench_match_expression()}
                aria-invalid={issue !== null}
                value={condition.text}
                onChange={(event) =>
                  onChange({
                    kind: "expression",
                    text: event.currentTarget.value,
                  })
                }
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
