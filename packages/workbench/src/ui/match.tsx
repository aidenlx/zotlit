import type { WorkbenchDocumentController } from "#/document/controller";
import type { MatchItemFacts } from "#/match/condition";
import { useEffect, useState, useRef } from "react";

import type { MatchTree } from "@zotlit/templates/facade";

import { useWorkbenchHost } from "./host";
import { describeProblem } from "./match.diagnostic";
import {
  appendAt,
  asExpression,
  asLabelled,
  conditionIssue,
  freshCondition,
  freshGroup,
  fromFilter,
  removeAt,
  replaceAt,
  toFilter,
  updateGroup,
} from "./match.draft";
import type {
  ConditionGroup,
  ConditionKind,
  ConditionPath,
  MatchEditorDeps,
  RowCondition,
} from "./match.draft";
import { ConditionOperator, ConditionValue, MatchSelect } from "./match.rows";
// One Match tree over the document controller; rows write through the master history.
import { useWorkbenchMessages } from "./messages";
import { useParts, useIcon } from "./theme";

import { compileFilter, matchCondition } from "#/match/condition";

export function MatchPane({
  controller,
  facts,
  vocabularyRevision,
}: {
  controller: WorkbenchDocumentController;
  facts: MatchItemFacts | null;
  /** Changes when the host has a new snapshot or database vocabulary. */
  vocabularyRevision?: string | number;
}) {
  const m = useWorkbenchMessages();
  const host = useWorkbenchHost();
  const part = useParts("match");
  const [match, setMatch] = useState<MatchTree | undefined>(
    controller.document?.manifest.match,
  );
  const ownEdit = useRef(false);
  const [root, setRoot] = useState<ConditionGroup>(() =>
    match === undefined
      ? { kind: "group", match: "all", conditions: [] }
      : fromFilter(match),
  );
  const [readable, setReadable] = useState(controller.document !== null);
  const [deps, setDeps] = useState<MatchEditorDeps>({
    tags: [],
    collections: [],
    libraries: [],
  });
  const [writeProblem, setWriteProblem] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    const read = () => {
      setReadable(controller.document !== null);
      if (controller.document) {
        const next = controller.document.manifest.match;
        setMatch(next);
        if (!ownEdit.current)
          setRoot(
            next === undefined
              ? { kind: "group", match: "all", conditions: [] }
              : fromFilter(next),
          );
      }
    };
    read();
    return controller.subscribe(read);
  }, [controller]);
  useEffect(() => {
    let active = true;
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
        }
      },
      () => {
        if (active) setProblem(m.workbench_match_missing_facts());
      },
    );
    return () => {
      active = false;
    };
  }, [host.matchData, vocabularyRevision, m]);
  function write(next: MatchTree | undefined) {
    ownEdit.current = true;
    const saved = controller.setMatch(next);
    ownEdit.current = false;
    if (!saved) {
      setRoot(
        match === undefined
          ? { kind: "group", match: "all", conditions: [] }
          : fromFilter(match),
      );
      setWriteProblem(m.workbench_match_source_only());
    } else {
      setWriteProblem(null);
      if (next === undefined)
        setRoot({ kind: "group", match: "all", conditions: [] });
    }
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
      <fieldset
        disabled={!readable || controller.document?.manifest.id === "default"}
        {...part("fieldset")}
      >
        <Group
          root={root}
          group={root}
          path={[]}
          deps={deps}
          onChange={(next) => {
            setRoot(next);
            write(toFilter(next));
          }}
        />
        {match !== undefined && (
          <button
            {...part("button")}
            type="button"
            onClick={() => write(undefined)}
          >
            {m.workbench_match_remove()}
          </button>
        )}
      </fieldset>
      <p role="status" {...part("result")}>
        {reason
          ? m.workbench_match_result_unavailable({ reason })
          : matched
            ? m.workbench_match_result_yes()
            : m.workbench_match_result_no()}
      </p>
      {(writeProblem ?? problem) && (
        <p role="alert">{writeProblem ?? problem}</p>
      )}
    </section>
  );
}

function Group({
  root,
  group,
  path,
  deps,
  onChange,
}: {
  root: ConditionGroup;
  group: ConditionGroup;
  path: ConditionPath;
  deps: MatchEditorDeps;
  onChange: (root: ConditionGroup) => void;
}) {
  const m = useWorkbenchMessages();
  const part = useParts("match");
  const icon = useIcon();
  const host = useWorkbenchHost();
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
        {group.conditions.map((node, index) => (
          <li key={index} {...part("row")}>
            {index > 0 && (
              <span {...part("conjunction")}>
                {group.match === "all"
                  ? m.workbench_match_conjunction_and()
                  : m.workbench_match_conjunction_or()}
              </span>
            )}
            {node.kind === "group" ? (
              <Group
                root={root}
                group={node}
                path={[...path, index]}
                deps={deps}
                onChange={onChange}
              />
            ) : (
              <Row
                condition={node}
                deps={deps}
                onChange={(next) =>
                  onChange(replaceAt(root, [...path, index], next))
                }
                onRemove={() => onChange(removeAt(root, [...path, index]))}
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
            onChange(appendAt(root, path, freshCondition("item-type", false)))
          }
        >
          {icon("add")}
          {m.workbench_match_add_condition()}
        </button>
        <button
          {...part("button")}
          type="button"
          onClick={() =>
            onChange(appendAt(root, path, freshGroup(group.match)))
          }
        >
          {icon("add")}
          {m.workbench_match_add_group()}
        </button>
      </div>
    </div>
  );
}

function Row({
  condition,
  deps,
  onChange,
  onRemove,
}: {
  condition: RowCondition;
  deps: MatchEditorDeps;
  onChange: (condition: RowCondition) => void;
  onRemove: () => void;
}) {
  const m = useWorkbenchMessages();
  const part = useParts("match");
  const icon = useIcon();
  const host = useWorkbenchHost();
  const issue = conditionIssue(m, condition, deps);
  const labelled =
    condition.kind === "expression" ? asLabelled(condition) : null;
  return (
    <div {...part("condition")} data-condition-row="">
      <div {...part("statement")}>
        {condition.kind === "expression" ? (
          <textarea
            rows={1}
            {...part("expression")}
            aria-label={m.workbench_match_expression()}
            aria-invalid={issue !== null}
            value={condition.text}
            onChange={(event) =>
              onChange({ kind: "expression", text: event.currentTarget.value })
            }
          />
        ) : (
          <>
            <MatchSelect
              aria-label={m.workbench_match_condition_kind()}
              value={condition.kind}
              onChange={(kind) =>
                onChange(freshCondition(kind as ConditionKind, false))
              }
            >
              <option value="library">
                {m.workbench_match_condition_library()}
              </option>
              <option value="item-type">
                {m.workbench_match_condition_item_type()}
              </option>
              <option value="collections">
                {m.workbench_match_condition_collection()}
              </option>
              <option value="tags">{m.workbench_match_condition_tag()}</option>
            </MatchSelect>
            <ConditionOperator condition={condition} onChange={onChange} />
            <ConditionValue
              condition={condition}
              onChange={onChange}
              deps={deps}
            />
          </>
        )}
        <div {...part("actions")}>
          {condition.kind === "expression" ? (
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
              onClick={() => onChange(asExpression(condition))}
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
