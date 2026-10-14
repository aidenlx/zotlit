// The Profile Match vocabulary: Library, Item type, Collection, and Tag rows.
import type { FlatCondition } from "#/match/condition";

import type { WorkbenchMessages } from "./generated/messages";
import {
  conditionIssue,
  freshCondition,
  visuallyEditable,
} from "./match.draft";
import type {
  ConditionKind,
  MatchConditionKind,
  MatchEditorDeps,
  MatchVocabulary,
} from "./match.draft";
import { ConditionOperator, ConditionValue } from "./match.rows";

import { compileCondition, formatCondition } from "#/match/condition";

/** The conditions a Profile Match offers, over the host's Libraries, Tags, and Collections. */
export function profileVocabulary(
  m: WorkbenchMessages,
  deps: MatchEditorDeps,
): MatchVocabulary<FlatCondition> {
  const kind = (
    kind: ConditionKind,
    label: string,
  ): MatchConditionKind<FlatCondition> => ({
    kind,
    label,
    fresh: () => freshCondition(kind, false),
    parse: (text) => {
      const { condition } = compileCondition(text);
      return condition && visuallyEditable(condition) && condition.kind === kind
        ? condition
        : null;
    },
    format: formatCondition,
    renderOperator: ({ condition, onChange }) => (
      <ConditionOperator condition={condition} onChange={onChange} />
    ),
    renderValue: ({ condition, onChange }) => (
      <ConditionValue condition={condition} onChange={onChange} deps={deps} />
    ),
  });
  return {
    kinds: [
      kind("library", m.workbench_match_condition_library()),
      kind("item-type", m.workbench_match_condition_item_type()),
      kind("collections", m.workbench_match_condition_collection()),
      kind("tags", m.workbench_match_condition_tag()),
    ],
    starterKind: "collections",
    newKind: "item-type",
    issue: (condition) => conditionIssue(m, condition, deps),
  };
}
