// The function registry of the Filter Expression evaluator. Validation,
// execution, and the Item Query Schema read the same entries, so a function,
// a method, or a property exists only here.
import { compareStrings } from "./collation";
import {
  compareStarts,
  dateOnly,
  datePart,
  formatDate,
  parseDate,
  parseDuration,
  relativeDate,
  timeOfDay,
  timestamp,
  today,
} from "./filter-dates";
import type { DateValue } from "./filter-dates";
import { errorValue, firstError } from "./filter-error";
import type { ErrorValue } from "./filter-error";
import {
  equals,
  isDate,
  isList,
  isRegexp,
  toText,
  truthy,
  typeOf,
} from "./filter-values";
import type {
  FilterValue,
  FilterValueType,
  RegexpValue,
} from "./filter-values";
import type { QueryClock } from "./query-clock";

/** The type a parameter takes. `any` also takes null. */
export type ParameterType =
  | "string"
  | "number"
  | "list"
  | "date"
  | "regexp"
  | "any";

export interface FunctionParameter {
  readonly name: string;
  /** One type, or each type the parameter takes. */
  readonly type: ParameterType | readonly ParameterType[];
  /** Present on a typed parameter that also takes null. */
  readonly nullable?: true;
  /** Present on a string parameter that takes only these texts. */
  readonly values?: readonly string[];
}

/**
 * One function or method. A call with a wrong argument count, or with an
 * argument whose type is known before execution and differs from the
 * parameter, fails the query; so does a string literal outside the `values`
 * of its parameter. At execution, a null argument of a typed parameter gives
 * null, and a wrongly typed argument or a text outside its `values` gives an
 * Error Value; `call` does not run. An Error Value argument is the result.
 */
export interface FunctionDefinition {
  /** Semantic eligibility for a diagnostic correction, checked with the signature. */
  readonly diagnosticCorrection?: "membership" | "conversion";
  /** The required parameters, in order. */
  readonly parameters: readonly FunctionParameter[];
  /** Parameters after the required ones that a call can omit. */
  readonly optional?: readonly FunctionParameter[];
  /** Present on a variadic function: the parameter of every further argument. */
  readonly rest?: FunctionParameter;
  /** The type of the result when it is not null; `null` when it varies. */
  readonly returns: Exclude<FilterValueType, "null"> | null;
  /**
   * Present on an element-expression method, a special form of the
   * evaluator: the names its first parameter can use. The evaluator runs the
   * expression once for each element with these names bound, so `call` does
   * not run.
   */
  readonly scope?: readonly string[];
  /**
   * `subject` is the value the method is called on, and null for a global
   * function. `clock` is the Query Clock of the query. A null result is
   * missing data; an Error Value is a value that this Item cannot compute.
   */
  readonly call: (
    subject: FilterValue,
    args: readonly FilterValue[],
    clock: QueryClock,
  ) => FilterValue;
}

/** A property of a value, read as `value.name`. */
export interface PropertyDefinition {
  /** The type of the result when it is not null. */
  readonly returns: Exclude<FilterValueType, "null">;
  readonly read: (subject: FilterValue, clock: QueryClock) => FilterValue;
}

type Registry<T> = ReadonlyMap<string, T>;

const functions = (
  entries: Record<string, FunctionDefinition>,
): Registry<FunctionDefinition> => new Map(Object.entries(entries));

const properties = (
  entries: Record<string, PropertyDefinition>,
): Registry<PropertyDefinition> => new Map(Object.entries(entries));

const NONE: readonly FunctionParameter[] = [];

const string = (name: string): FunctionParameter => ({ name, type: "string" });
const number = (name: string): FunctionParameter => ({ name, type: "number" });
const any = (name: string): FunctionParameter => ({ name, type: "any" });

/**
 * A number that `operation` gave; a result outside the finite numbers is an
 * Error Value.
 */
export function finite(value: number, operation: string): number | ErrorValue {
  return Number.isFinite(value)
    ? value
    : errorValue({ code: "not-finite", operation });
}

/**
 * Whether a conversion function reads `text` as missing data: an empty text,
 * or one of spaces alone, gives null, as null does.
 */
function blank(text: string): boolean {
  return text.trim() === "";
}

/** The Error Value of a text that a conversion function cannot read. */
function unparseable(
  callee: "number" | "date" | "duration",
  text: string,
): ErrorValue {
  return errorValue({ code: "unparseable-text", callee, text });
}

/** The Error Value of an argument outside the values its parameter takes. */
function outOfRange(
  callee: string,
  index: number,
  found: FilterValue | undefined,
): ErrorValue {
  return errorValue({
    code: "argument-out-of-range",
    callee,
    index,
    found:
      typeof found === "string" ? JSON.stringify(found) : toText(found ?? null),
  });
}

/** The largest count `repeat` takes: one query cannot exhaust the worker. */
const MAX_REPEAT = 10_000;

/** The longest text `repeat` gives, in UTF-16 code units. */
const MAX_REPEAT_LENGTH = 1_000_000;

/** The largest precision `toFixed` takes, as JavaScript's `toFixed`. */
const MAX_PRECISION = 100;

/** The largest `n` the native `split` takes: a larger one wraps to zero. */
const MAX_SPLIT_LIMIT = 0xff_ff_ff_ff;

/** Whether `value` is an integer from 0 to `max`. */
function isCount(value: FilterValue | undefined, max: number): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= max
  );
}

/** Whether `value` is a number from 0 to `max`. */
function inRange(value: FilterValue | undefined, max: number): value is number {
  return typeof value === "number" && value >= 0 && value <= max;
}

/** `min` and `max`: the pick among the numbers; null without a number. */
function extreme(pick: (...values: number[]) => number): FunctionDefinition {
  return {
    parameters: NONE,
    rest: { ...number("values"), nullable: true },
    returns: "number",
    call: (_subject, args) => {
      const numbers = args.filter((value) => typeof value === "number");
      return numbers.length === 0 ? null : pick(...numbers);
    },
  };
}

/**
 * The global functions, called as `name(...)`. `if` is a special form of the
 * evaluator: it evaluates only the branch that the condition selects.
 */
export const GLOBAL_FUNCTIONS: Registry<FunctionDefinition> = functions({
  number: {
    parameters: [any("value")],
    returns: "number",
    call: (_subject, [value = null], clock) => {
      if (value === null) return null;
      if (typeof value === "number") return value;
      if (typeof value === "boolean") return value ? 1 : 0;
      if (typeof value === "string") {
        if (blank(value)) return null;
        const parsed = Number.parseFloat(value);
        return Number.isNaN(parsed)
          ? unparseable("number", value)
          : finite(parsed, "number");
      }
      // A date is its Unix time in milliseconds, as its `timestamp` property.
      if (isDate(value)) return datePart(value, "timestamp", clock);
      return errorValue({
        code: "wrong-argument-type",
        callee: "number",
        index: 0,
        found: typeOf(value),
        expected: ["a number", "a string", "a boolean", "a date"],
      });
    },
  },
  min: extreme(Math.min),
  max: extreme(Math.max),
  // The Query Clock: every call in one query sees the same instant.
  now: {
    parameters: NONE,
    returns: "date",
    call: (_subject, _args, clock) => timestamp(clock.now),
  },
  today: {
    parameters: NONE,
    returns: "date",
    call: (_subject, _args, clock) => today(clock),
  },
  date: {
    diagnosticCorrection: "conversion",
    parameters: [{ name: "text", type: ["string", "date"] }],
    returns: "date",
    // A date stays as it is.
    call: (_subject, [text], clock) =>
      typeof text === "string"
        ? blank(text)
          ? null
          : (parseDate(text, clock) ?? unparseable("date", text))
        : text!,
  },
  duration: {
    diagnosticCorrection: "conversion",
    parameters: [string("text")],
    returns: "duration",
    call: (_subject, [text]) =>
      blank(text as string)
        ? null
        : (parseDuration(text as string) ??
          unparseable("duration", text as string)),
  },
  // A list stays as it is; null is the empty list; any other value is a
  // one-element list.
  list: {
    parameters: [any("value")],
    returns: "list",
    call: (_subject, [value = null]) =>
      value === null ? [] : isList(value) ? value : [value],
  },
});

/** The parameters of the `if` special form: `if(condition, then, else?)`. */
export const IF_FUNCTION = {
  parameters: [any("condition"), any("then")],
  optional: [any("else")],
} as const satisfies Pick<FunctionDefinition, "parameters" | "optional">;

const isEmpty = (
  empty: (subject: FilterValue) => boolean,
): FunctionDefinition => ({
  parameters: NONE,
  returns: "boolean",
  call: (subject) => empty(subject),
});

const rounding = (round: (value: number) => number): FunctionDefinition => ({
  parameters: NONE,
  returns: "number",
  call: (subject) => round(subject as number),
});

const includes = (
  list: readonly FilterValue[],
  value: FilterValue,
  clock: QueryClock,
): boolean => list.some((element) => equals(element, value, clock));

/** One list argument means its elements; otherwise the arguments themselves. */
const candidates = (args: readonly FilterValue[]): readonly FilterValue[] =>
  args.length === 1 && isList(args[0]!) ? args[0] : args;

/**
 * The group of each value type in the order of `sort`; Error Values come
 * before null, which comes last.
 */
const SORT_GROUPS: Readonly<Record<FilterValueType, number>> = {
  boolean: 0,
  number: 1,
  string: 2,
  date: 3,
  duration: 4,
  list: 5,
  regexp: 6,
  record: 7,
  error: 8,
  null: 9,
};

/**
 * The order of `sort`: numbers by value, texts in the Item Query string
 * order, dates by their start, booleans false first. Elements of different
 * types group in the order of {@link SORT_GROUPS}; durations, lists, and
 * regexps keep their order.
 */
function sortOrder(a: FilterValue, b: FilterValue, clock: QueryClock): number {
  const group = SORT_GROUPS[typeOf(a)] - SORT_GROUPS[typeOf(b)];
  if (group !== 0) return group;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "string" && typeof b === "string") {
    return compareStrings(a, b);
  }
  if (typeof a === "boolean" && typeof b === "boolean") {
    return Number(a) - Number(b);
  }
  if (isDate(a) && isDate(b)) return compareStarts(a, b, clock);
  return 0;
}

/**
 * An element-expression method of a list: `filter(expression)`,
 * `map(expression)`, and `reduce(expression, initial)`. The evaluator binds
 * `value` and `index` for each element, and `acc` in `reduce`.
 */
const elementMethod = (
  entry: Pick<FunctionDefinition, "returns" | "scope"> & {
    readonly after?: readonly FunctionParameter[];
  },
): FunctionDefinition => ({
  parameters: [any("expression"), ...(entry.after ?? [])],
  returns: entry.returns,
  scope: entry.scope,
  call: () => {
    throw new Error("An element expression runs in the evaluator.");
  },
});

/** The methods of each value type. A type also has {@link ANY_METHODS}. */
const METHODS: Readonly<Record<FilterValueType, Registry<FunctionDefinition>>> =
  {
    null: functions({ isEmpty: isEmpty(() => true) }),
    boolean: functions({}),
    record: functions({}),
    number: functions({
      isEmpty: isEmpty(() => false),
      round: {
        parameters: NONE,
        optional: [number("digits")],
        returns: "number",
        // A digit count whose power of ten is zero or not finite is out of
        // range.
        call: (subject, [digits]) => {
          const factor = typeof digits === "number" ? 10 ** digits : 1;
          if (factor === 0 || !Number.isFinite(factor)) {
            return outOfRange("round", 0, digits);
          }
          return finite(
            Math.round((subject as number) * factor) / factor,
            "round",
          );
        },
      },
      ceil: rounding(Math.ceil),
      floor: rounding(Math.floor),
      abs: rounding(Math.abs),
      // A text with `precision` decimals; a precision outside 0 to 100 is
      // out of range.
      toFixed: {
        parameters: [number("precision")],
        returns: "string",
        call: (subject, [precision]) =>
          inRange(precision, MAX_PRECISION)
            ? (subject as number).toFixed(precision)
            : outOfRange("toFixed", 0, precision),
      },
    }),
    string: functions({
      isEmpty: isEmpty((subject) => subject === ""),
      lower: {
        parameters: NONE,
        returns: "string",
        call: (subject) => (subject as string).toLowerCase(),
      },
      startsWith: {
        parameters: [string("prefix")],
        returns: "boolean",
        call: (subject, [prefix]) =>
          (subject as string).startsWith(prefix as string),
      },
      endsWith: {
        parameters: [string("suffix")],
        returns: "boolean",
        call: (subject, [suffix]) =>
          (subject as string).endsWith(suffix as string),
      },
      contains: {
        parameters: [string("text")],
        returns: "boolean",
        call: (subject, [text]) => (subject as string).includes(text as string),
      },
      containsAny: {
        parameters: NONE,
        rest: string("texts"),
        returns: "boolean",
        call: (subject, texts) =>
          texts.some((text) => (subject as string).includes(text as string)),
      },
      containsAll: {
        parameters: NONE,
        rest: string("texts"),
        returns: "boolean",
        call: (subject, texts) =>
          texts.every((text) => (subject as string).includes(text as string)),
      },
      trim: {
        parameters: NONE,
        returns: "string",
        call: (subject) => (subject as string).trim(),
      },
      // The first code point of each word that starts the text or follows
      // whitespace is upper-cased; the rest stays as it is.
      title: {
        parameters: NONE,
        returns: "string",
        call: (subject) =>
          (subject as string).replaceAll(
            /(^|\s)(\S)/gu,
            (_match, before: string, first: string) =>
              before + first.toUpperCase(),
          ),
      },
      // A count that is negative, not an integer, or above 10 000, or that
      // gives a result above 1 000 000 code units, is out of range.
      repeat: {
        parameters: [number("count")],
        returns: "string",
        call: (subject, [count]) =>
          isCount(count, MAX_REPEAT) &&
          (subject as string).length * count <= MAX_REPEAT_LENGTH
            ? (subject as string).repeat(count)
            : outOfRange("repeat", 0, count),
      },
      // By code point, so an emoji survives.
      reverse: {
        parameters: NONE,
        returns: "string",
        call: (subject) =>
          Array.from(subject as string)
            .reverse()
            .join(""),
      },
      // In code units, as `length` and index access.
      slice: {
        parameters: [number("start")],
        optional: [number("end")],
        returns: "string",
        call: (subject, [start, end]) =>
          (subject as string).slice(start as number, end as number | undefined),
      },
      // A text pattern: every occurrence, with the replacement as literal
      // text. A regexp pattern follows JavaScript: `g` decides whether the
      // first or every occurrence changes, and `$1` names a group.
      replace: {
        parameters: [
          { name: "pattern", type: ["string", "regexp"] },
          string("replacement"),
        ],
        returns: "string",
        call: (subject, [pattern = null, replacement]) => {
          if (isRegexp(pattern)) {
            pattern.regexp.lastIndex = 0;
            return (subject as string).replace(
              pattern.regexp,
              replacement as string,
            );
          }
          return (subject as string).replaceAll(
            pattern as string,
            () => replacement as string,
          );
        },
      },
      // `n` keeps the first `n` parts. A group of a regexp separator that
      // does not take part in the match is null.
      split: {
        parameters: [{ name: "separator", type: ["string", "regexp"] }],
        optional: [number("n")],
        returns: "list",
        call: (subject, [separator = null, n]) => {
          if (n !== undefined && !isCount(n, Infinity)) {
            return outOfRange("split", 1, n);
          }
          return (subject as string)
            .split(
              isRegexp(separator) ? separator.regexp : (separator as string),
              n === undefined ? undefined : Math.min(n, MAX_SPLIT_LIMIT),
            )
            .map((part) => part ?? null);
        },
      },
    }),
    list: functions({
      isEmpty: isEmpty(
        (subject) => (subject as readonly unknown[]).length === 0,
      ),
      contains: {
        diagnosticCorrection: "membership",
        parameters: [any("value")],
        returns: "boolean",
        call: (subject, [value = null], clock) =>
          includes(subject as readonly FilterValue[], value, clock),
      },
      containsAny: {
        parameters: NONE,
        rest: any("values"),
        returns: "boolean",
        call: (subject, args, clock) =>
          candidates(args).some((value) =>
            includes(subject as readonly FilterValue[], value, clock),
          ),
      },
      containsAll: {
        parameters: NONE,
        rest: any("values"),
        returns: "boolean",
        call: (subject, args, clock) =>
          candidates(args).every((value) =>
            includes(subject as readonly FilterValue[], value, clock),
          ),
      },
      // The list helpers of Bases that take no element expression.
      flat: {
        parameters: NONE,
        returns: "list",
        call: (subject) =>
          (subject as readonly FilterValue[]).flatMap((element) =>
            isList(element) ? element : [element],
          ),
      },
      join: {
        parameters: [string("separator")],
        returns: "string",
        call: (subject, [separator]) =>
          (subject as readonly FilterValue[])
            .map((element) => (element === null ? "" : toText(element)))
            .join(separator as string),
      },
      reverse: {
        parameters: NONE,
        returns: "list",
        call: (subject) => (subject as readonly FilterValue[]).toReversed(),
      },
      // The index rules of JavaScript: a negative index counts from the end.
      slice: {
        parameters: [number("start")],
        optional: [number("end")],
        returns: "list",
        call: (subject, [start, end]) =>
          (subject as readonly FilterValue[]).slice(
            start as number,
            end as number | undefined,
          ),
      },
      sort: {
        parameters: NONE,
        returns: "list",
        call: (subject, _args, clock) =>
          (subject as readonly FilterValue[]).toSorted((a, b) =>
            sortOrder(a, b, clock),
          ),
      },
      // The first of the elements that `==` makes equal stays.
      unique: {
        parameters: NONE,
        returns: "list",
        call: (subject, _args, clock) =>
          (subject as readonly FilterValue[]).reduce<FilterValue[]>(
            (kept, element) =>
              includes(kept, element, clock) ? kept : [...kept, element],
            [],
          ),
      },
      // The element expressions of Bases: each one evaluates its expression
      // once for each element.
      filter: elementMethod({ returns: "list", scope: ["value", "index"] }),
      map: elementMethod({ returns: "list", scope: ["value", "index"] }),
      reduce: elementMethod({
        returns: null,
        scope: ["value", "index", "acc"],
        after: [any("initial")],
      }),
      // A Collection element is its root-first path: `within` matches the
      // Collection at `path` and every Collection below it.
      within: {
        parameters: [string("path")],
        returns: "boolean",
        call: (subject, [path]) =>
          (subject as readonly FilterValue[]).some(
            (element) =>
              typeof element === "string" &&
              (element === path || element.startsWith(`${path as string}/`)),
          ),
      },
    }),
    date: functions({
      isEmpty: isEmpty(() => false),
      // The calendar day of a timestamp in the query time zone.
      date: {
        parameters: NONE,
        returns: "date",
        call: (subject, _args, clock) => dateOnly(subject as DateValue, clock),
      },
      time: {
        parameters: NONE,
        returns: "string",
        call: (subject, _args, clock) => timeOfDay(subject as DateValue, clock),
      },
      format: {
        parameters: [string("pattern")],
        returns: "string",
        call: (subject, [pattern], clock) =>
          formatDate(subject as DateValue, pattern as string, clock),
      },
      relative: {
        parameters: NONE,
        returns: "string",
        call: (subject, _args, clock) =>
          relativeDate(subject as DateValue, clock),
      },
    }),
    duration: functions({}),
    regexp: functions({
      // The match position is reset before each test, so g and y stay
      // deterministic.
      matches: {
        parameters: [string("text")],
        returns: "boolean",
        call: (subject, [text]) => {
          const { regexp } = subject as RegexpValue;
          regexp.lastIndex = 0;
          return regexp.test(text as string);
        },
      },
    }),
    // An Error Value has only the methods of every value.
    error: functions({}),
  };

/** The value types of the Filter Expression language. */
export const VALUE_TYPES = Object.keys(METHODS) as FilterValueType[];

/** The methods of every value, null included, called as `value.name(...)`. */
const ANY_METHODS: Registry<FunctionDefinition> = new Map<
  string,
  FunctionDefinition
>([
  [
    "toString",
    {
      parameters: NONE,
      returns: "string",
      call: (subject) => toText(subject),
    },
  ],
  [
    "isType",
    {
      parameters: [{ ...string("type"), values: ["any", ...VALUE_TYPES] }],
      returns: "boolean",
      call: (subject, [type]) => type === "any" || type === typeOf(subject),
    },
  ],
  [
    "isTruthy",
    {
      parameters: NONE,
      returns: "boolean",
      call: (subject) => truthy(subject),
    },
  ],
]);

const length: PropertyDefinition = {
  returns: "number",
  read: (subject) => (subject as string | readonly FilterValue[]).length,
};

const datePartProperty = (
  part: Parameters<typeof datePart>[1],
): PropertyDefinition => ({
  returns: "number",
  read: (subject, clock) => datePart(subject as DateValue, part, clock),
});

/** The properties of each value type. */
const PROPERTIES: Readonly<
  Record<FilterValueType, Registry<PropertyDefinition>>
> = {
  null: properties({}),
  boolean: properties({}),
  record: properties({}),
  number: properties({}),
  string: properties({ length }),
  list: properties({ length }),
  date: properties({
    year: datePartProperty("year"),
    month: datePartProperty("month"),
    day: datePartProperty("day"),
    hour: datePartProperty("hour"),
    minute: datePartProperty("minute"),
    second: datePartProperty("second"),
    millisecond: datePartProperty("millisecond"),
    timestamp: datePartProperty("timestamp"),
  }),
  duration: properties({}),
  error: properties({}),
  regexp: properties({}),
};

/** The method `name` of a value of `type`. */
export function methodOf(
  type: FilterValueType,
  name: string,
): FunctionDefinition | undefined {
  return METHODS[type].get(name) ?? ANY_METHODS.get(name);
}

/** A literal that a Set holds as {@link equals} compares it: by `===`. */
type Member = null | boolean | number | string;

/** NaN is the one scalar where `===` and a Set disagree. */
const isMember = (value: FilterValue): value is Member =>
  value === null ||
  typeof value === "boolean" ||
  typeof value === "string" ||
  (typeof value === "number" && !Number.isNaN(value));

/** The tests of each membership method, given the lookup of the list. */
const MEMBERSHIP: Readonly<
  Record<
    string,
    (has: (value: FilterValue) => boolean) => FunctionDefinition["call"]
  >
> = {
  contains:
    (has) =>
    (_subject, [value = null]) =>
      has(value),
  containsAny: (has) => (_subject, args) => candidates(args).some(has),
  containsAll: (has) => (_subject, args) => candidates(args).every(has),
};

/**
 * `contains`, `containsAny`, or `containsAll` of a list whose elements are
 * these literals, with the Set of the elements built once: a test is then
 * one lookup, not a scan of the list. Undefined for another method or when
 * an element is not a scalar, such as a date, which compares by the Query
 * Clock. A value that is not a scalar equals no scalar, so the Set answers
 * it as the scan does.
 */
export function literalMembership(
  name: string,
  elements: readonly FilterValue[],
): FunctionDefinition | undefined {
  const test = Object.hasOwn(MEMBERSHIP, name) ? MEMBERSHIP[name] : undefined;
  const method = METHODS.list.get(name);
  if (!test || !method || !elements.every(isMember)) return undefined;
  const members = new Set<FilterValue>(elements);
  return { ...method, call: test((value) => members.has(value)) };
}

/** Every method `name`, with the value type it belongs to. */
export function methodsNamed(
  name: string,
): readonly (readonly [FilterValueType, FunctionDefinition])[] {
  return VALUE_TYPES.flatMap((type) => {
    const method = methodOf(type, name);
    return method ? [[type, method] as const] : [];
  });
}

/** The property `name` of a value of `type`. */
export function propertyOf(
  type: FilterValueType,
  name: string,
): PropertyDefinition | undefined {
  return PROPERTIES[type].get(name);
}

/** Every property `name`, with the value type it belongs to. */
export function propertiesNamed(
  name: string,
): readonly (readonly [FilterValueType, PropertyDefinition])[] {
  return VALUE_TYPES.flatMap((type) => {
    const property = propertyOf(type, name);
    return property ? [[type, property] as const] : [];
  });
}

/** The names of the global functions, `if` included. */
export const GLOBAL_FUNCTION_NAMES: readonly string[] = [
  "if",
  ...GLOBAL_FUNCTIONS.keys(),
];

/** The names of every method, each one once. */
export const METHOD_NAMES: readonly string[] = [
  ...new Set([
    ...ANY_METHODS.keys(),
    ...VALUE_TYPES.flatMap((type) => [...METHODS[type].keys()]),
  ]),
];

/** The names of every property, each one once. */
export const PROPERTY_NAMES: readonly string[] = [
  ...new Set(VALUE_TYPES.flatMap((type) => [...PROPERTIES[type].keys()])),
];

/**
 * Every method with the value type it belongs to, for the Item Query Schema.
 * `any`: a method of every value, null included.
 */
export const METHOD_ENTRIES: readonly (readonly [
  FilterValueType | "any",
  string,
  FunctionDefinition,
])[] = [
  ...[...ANY_METHODS].map(([name, method]) => ["any", name, method] as const),
  ...VALUE_TYPES.flatMap((type) =>
    [...METHODS[type]].map(([name, method]) => [type, name, method] as const),
  ),
];

/** Every property with the value type it belongs to, for the Item Query Schema. */
export const PROPERTY_ENTRIES: readonly (readonly [
  FilterValueType,
  string,
  PropertyDefinition,
])[] = VALUE_TYPES.flatMap((type) =>
  [...PROPERTIES[type]].map(
    ([name, property]) => [type, name, property] as const,
  ),
);

/**
 * Call the function `name` with evaluated arguments. The first Error Value
 * among the arguments is the result. A null argument of a typed parameter
 * gives null; a wrongly typed argument, or a text outside the `values` of its
 * parameter, gives an Error Value.
 */
export function invoke(
  definition: FunctionDefinition,
  {
    name,
    subject,
    args,
  }: {
    readonly name: string;
    readonly subject: FilterValue;
    readonly args: readonly FilterValue[];
  },
  clock: QueryClock,
): FilterValue {
  const failed = firstError(args);
  if (failed !== undefined) return failed;
  for (const [index, value] of args.entries()) {
    const parameter = parameterAt(definition, index);
    if (!parameter) return null;
    if (value === null) {
      if (takesType(parameter, "null")) continue;
      return null;
    }
    if (!takesType(parameter, typeOf(value))) {
      return errorValue({
        code: "wrong-argument-type",
        callee: name,
        index,
        found: typeOf(value),
        expected: parameterTypes(parameter).map((type) => `a ${type}`),
      });
    }
    if (parameter.values && !parameter.values.includes(value as string)) {
      return outOfRange(name, index, value);
    }
  }
  const result = definition.call(subject, args, clock);
  return typeof result === "number" ? finite(result, name) : result;
}

/** Whether the parameter takes a value of `type`. */
export function takesType(
  parameter: FunctionParameter,
  type: FilterValueType,
): boolean {
  if (type === "null" && parameter.nullable) return true;
  return parameterTypes(parameter).some(
    (taken) => taken === "any" || taken === type,
  );
}

/** Each type the parameter takes. */
export function parameterTypes(
  parameter: FunctionParameter,
): readonly ParameterType[] {
  return typeof parameter.type === "string" ? [parameter.type] : parameter.type;
}

/** The parameter that the argument at `index` fills. */
export function parameterAt(
  definition: Pick<FunctionDefinition, "parameters" | "optional" | "rest">,
  index: number,
): FunctionParameter | undefined {
  const fixed = [...definition.parameters, ...(definition.optional ?? [])];
  return fixed[index] ?? definition.rest;
}
