// The Error Value of a Filter Expression: a typed fact about an evaluation
// that cannot be computed on one record, and the diagnoser's sentences for
// it. The sentences live here, not in `diagnose.ts`, because `toString()` of
// an Error Value renders it and `diagnose.ts` imports the value modules.
import type { FilterValue, FilterValueType } from "./filter-values";

/**
 * What went wrong in one evaluation: a code, the operation, and what was
 * found. It holds no sentence; {@link renderEvaluationFault} writes one.
 */
export type EvaluationFault =
  | {
      /** An operator met operands of types it does not take. */
      readonly code: "wrong-operand-type";
      readonly operator: string;
      readonly found: readonly FilterValueType[];
    }
  | {
      /** An argument of a type the parameter does not take. */
      readonly code: "wrong-argument-type";
      readonly callee: string;
      readonly index: number;
      readonly found: FilterValueType;
      readonly expected: readonly string[];
    }
  | {
      /** A method, property, element expression, or index on a type without it. */
      readonly code: "wrong-subject-type";
      readonly callee: string;
      readonly found: FilterValueType;
    }
  | {
      /** A calculation whose result is not a finite number. */
      readonly code: "not-finite";
      readonly operation: string;
    }
  | {
      /** A text that `number()`, `date()`, or `duration()` cannot read. */
      readonly code: "unparseable-text";
      readonly callee: "number" | "date" | "duration";
      readonly text: string;
    }
  | {
      /** An argument outside the values its parameter takes. */
      readonly code: "argument-out-of-range";
      readonly callee: string;
      readonly index: number;
      readonly found: string;
    }
  | {
      /** An index that is not an integer. */
      readonly code: "invalid-index";
      readonly found: string;
    }
  | {
      /** Date arithmetic that leaves the range of dates. */
      readonly code: "date-out-of-range";
      readonly operator: string;
    };

export type EvaluationErrorCode = EvaluationFault["code"];

/** The codes of an Error Value, for the Item Query Schema. */
export const EVALUATION_ERROR_CODES = [
  "wrong-operand-type",
  "wrong-argument-type",
  "wrong-subject-type",
  "not-finite",
  "unparseable-text",
  "argument-out-of-range",
  "invalid-index",
  "date-out-of-range",
] as const satisfies readonly EvaluationErrorCode[];

/** Compiles only while `EVALUATION_ERROR_CODES` names every code. */
type Exhaustive<Missing extends never> = Missing;
export type EvaluationErrorCodesExhaustive = Exhaustive<
  Exclude<EvaluationErrorCode, (typeof EVALUATION_ERROR_CODES)[number]>
>;

/** The value of an evaluation that cannot be computed on one record. */
export interface ErrorValue {
  readonly type: "error";
  readonly fault: EvaluationFault;
}

export function errorValue(fault: EvaluationFault): ErrorValue {
  return { type: "error", fault };
}

export function isError(value: FilterValue | undefined): value is ErrorValue {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (value as { type: string }).type === "error"
  );
}

/**
 * The first Error Value among the evaluated arguments of a call, which is the
 * result of the call; `undefined` when none is one.
 */
export function firstError(
  args: readonly FilterValue[],
): ErrorValue | undefined {
  return args.find((value) => isError(value));
}

/** A value type with its article: "a number", "an error". */
export function typeNoun(type: string): string {
  return `${/^[aeiou]/.test(type) ? "an" : "a"} ${type}`;
}

/**
 * The sentence of an operator that cannot use its operands, for an Error
 * Value and for the plan-time Fault alike.
 */
export function operandMessage(
  operator: string,
  found: readonly string[],
): string {
  return `The operator ${operator} cannot use ${found.map(typeNoun).join(" and ")}.`;
}

/** The message of an Error Value, from its fact. */
export function renderEvaluationFault(fault: EvaluationFault): string {
  switch (fault.code) {
    case "wrong-operand-type":
      return operandMessage(fault.operator, fault.found);
    case "wrong-argument-type":
      return `Argument ${fault.index + 1} of ${fault.callee} is ${typeNoun(fault.found)}; ${fault.callee} takes ${fault.expected.join(" or ")} there.`;
    case "wrong-subject-type":
      return `${fault.callee} does not apply to ${typeNoun(fault.found)}.`;
    case "not-finite":
      return `The result of ${fault.operation} is not a finite number.`;
    case "unparseable-text":
      return `${fault.callee}() cannot read ${JSON.stringify(fault.text)} as ${typeNoun(fault.callee)}.`;
    case "argument-out-of-range":
      return `Argument ${fault.index + 1} of ${fault.callee} is ${fault.found}, outside the values that ${fault.callee} takes.`;
    case "invalid-index":
      return `The index ${fault.found} is not an integer.`;
    case "date-out-of-range":
      return `The date arithmetic of ${fault.operator} gives a date outside the range of dates.`;
  }
}
