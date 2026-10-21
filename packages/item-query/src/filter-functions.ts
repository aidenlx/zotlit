// The function registry of the Filter Expression evaluator. Validation,
// execution, and the Query Schema read the same entries, so a function,
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
  /**
   * One English sentence, in the Query Schema vocabulary, that says what the
   * call yields. The Query Schema publishes it.
   */
  readonly description: string;
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
  /** One English sentence that says what the property reads. */
  readonly description: string;
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
function extreme(
  pick: (...values: number[]) => number,
  description: string,
): FunctionDefinition {
  return {
    description,
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
    description:
      "The value as a number: a text by the decimal number it starts with, a boolean as 1 or 0, and a date as its `timestamp`; an empty or blank text gives null, and a text that starts with no number an Error Value.",
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
  min: extreme(
    Math.min,
    "The smallest number among the arguments, or null when no argument is a number.",
  ),
  max: extreme(
    Math.max,
    "The largest number among the arguments, or null when no argument is a number.",
  ),
  now: {
    description:
      "The instant of the Query Clock as a date with a time, the same for every call in one query.",
    parameters: NONE,
    returns: "date",
    call: (_subject, _args, clock) => timestamp(clock.now),
  },
  today: {
    description:
      "The calendar day of the Query Clock in the query time zone, as a date.",
    parameters: NONE,
    returns: "date",
    call: (_subject, _args, clock) => today(clock),
  },
  date: {
    description:
      "The text read as a date, or a date unchanged; an empty or blank text gives null, and a text that is not a date an Error Value.",
    diagnosticCorrection: "conversion",
    parameters: [{ name: "text", type: ["string", "date"] }],
    returns: "date",
    call: (_subject, [text], clock) =>
      typeof text === "string"
        ? blank(text)
          ? null
          : (parseDate(text, clock) ?? unparseable("date", text))
        : text!,
  },
  duration: {
    description:
      'The text read as a duration, such as `"7d"` or `"PT1H30M"`; an empty or blank text gives null, and a text that is not a duration an Error Value.',
    diagnosticCorrection: "conversion",
    parameters: [string("text")],
    returns: "duration",
    call: (_subject, [text]) =>
      blank(text as string)
        ? null
        : (parseDuration(text as string) ??
          unparseable("duration", text as string)),
  },
  list: {
    description:
      "The value as a list: a list unchanged, null as the empty list, and any other value as a list of that one element.",
    parameters: [any("value")],
    returns: "list",
    call: (_subject, [value = null]) =>
      value === null ? [] : isList(value) ? value : [value],
  },
});

/** The parameters of the `if` special form: `if(condition, then, else?)`. */
export const IF_FUNCTION = {
  description:
    "The `then` value when the condition is truthy, otherwise the `else` value or null; only the selected branch is evaluated.",
  parameters: [any("condition"), any("then")],
  optional: [any("else")],
} as const satisfies Pick<
  FunctionDefinition,
  "description" | "parameters" | "optional"
>;

const isEmpty = (
  empty: (subject: FilterValue) => boolean,
  description: string,
): FunctionDefinition => ({
  description,
  parameters: NONE,
  returns: "boolean",
  call: (subject) => empty(subject),
});

const rounding = (
  round: (value: number) => number,
  description: string,
): FunctionDefinition => ({
  description,
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
  entry: Pick<FunctionDefinition, "description" | "returns" | "scope"> & {
    readonly after?: readonly FunctionParameter[];
  },
): FunctionDefinition => ({
  description: entry.description,
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
    null: functions({
      isEmpty: isEmpty(() => true, "True: null is empty."),
    }),
    boolean: functions({}),
    record: functions({}),
    number: functions({
      isEmpty: isEmpty(() => false, "False: a number is never empty."),
      round: {
        description:
          "The number rounded to the nearest integer, or to `digits` decimal places.",
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
      ceil: rounding(Math.ceil, "The number rounded up to an integer."),
      floor: rounding(Math.floor, "The number rounded down to an integer."),
      abs: rounding(Math.abs, "The absolute value of the number."),
      toFixed: {
        description: `The number as text with \`precision\` decimal places, from 0 to ${MAX_PRECISION}.`,
        parameters: [number("precision")],
        returns: "string",
        call: (subject, [precision]) =>
          inRange(precision, MAX_PRECISION)
            ? (subject as number).toFixed(precision)
            : outOfRange("toFixed", 0, precision),
      },
    }),
    string: functions({
      isEmpty: isEmpty(
        (subject) => subject === "",
        "Whether the text is the empty text.",
      ),
      lower: {
        description: "The text in lower case.",
        parameters: NONE,
        returns: "string",
        call: (subject) => (subject as string).toLowerCase(),
      },
      startsWith: {
        description: "Whether the text starts with `prefix`.",
        parameters: [string("prefix")],
        returns: "boolean",
        call: (subject, [prefix]) =>
          (subject as string).startsWith(prefix as string),
      },
      endsWith: {
        description: "Whether the text ends with `suffix`.",
        parameters: [string("suffix")],
        returns: "boolean",
        call: (subject, [suffix]) =>
          (subject as string).endsWith(suffix as string),
      },
      contains: {
        description: "Whether `text` occurs in the text.",
        parameters: [string("text")],
        returns: "boolean",
        call: (subject, [text]) => (subject as string).includes(text as string),
      },
      containsAny: {
        description: "Whether the text contains at least one of `texts`.",
        parameters: NONE,
        rest: string("texts"),
        returns: "boolean",
        call: (subject, texts) =>
          texts.some((text) => (subject as string).includes(text as string)),
      },
      containsAll: {
        description: "Whether the text contains every one of `texts`.",
        parameters: NONE,
        rest: string("texts"),
        returns: "boolean",
        call: (subject, texts) =>
          texts.every((text) => (subject as string).includes(text as string)),
      },
      trim: {
        description: "The text without its leading and trailing whitespace.",
        parameters: NONE,
        returns: "string",
        call: (subject) => (subject as string).trim(),
      },
      title: {
        description:
          "The text with its first code point and each code point after whitespace in upper case.",
        parameters: NONE,
        returns: "string",
        call: (subject) =>
          (subject as string).replaceAll(
            /(^|\s)(\S)/gu,
            (_match, before: string, first: string) =>
              before + first.toUpperCase(),
          ),
      },
      repeat: {
        description: `The text repeated \`count\` times, for a count from 0 to ${MAX_REPEAT} and a result of at most ${MAX_REPEAT_LENGTH} UTF-16 code units.`,
        parameters: [number("count")],
        returns: "string",
        call: (subject, [count]) =>
          isCount(count, MAX_REPEAT) &&
          (subject as string).length * count <= MAX_REPEAT_LENGTH
            ? (subject as string).repeat(count)
            : outOfRange("repeat", 0, count),
      },
      reverse: {
        description: "The text with its code points in reverse order.",
        parameters: NONE,
        returns: "string",
        call: (subject) =>
          Array.from(subject as string)
            .reverse()
            .join(""),
      },
      slice: {
        description:
          "The part of the text from index `start` up to, not including, `end`, counted in UTF-16 code units; a negative index counts from the end.",
        parameters: [number("start")],
        optional: [number("end")],
        returns: "string",
        call: (subject, [start, end]) =>
          (subject as string).slice(start as number, end as number | undefined),
      },
      // The replacement of a text pattern is literal text. Of a regexp
      // pattern, `g` decides whether the first or every occurrence changes,
      // and `$1` names a group.
      replace: {
        description:
          "The text with every occurrence of a text pattern replaced, or with the matches of a regexp pattern replaced as JavaScript does.",
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
      split: {
        description:
          "The list of the parts of the text between occurrences of `separator`, with the captures of a regexp separator between them (null for a group that does not take part), keeping the first `n` elements when `n` is given.",
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
        "Whether the list has no elements.",
      ),
      contains: {
        description: "Whether the list has an element equal to `value`.",
        diagnosticCorrection: "membership",
        parameters: [any("value")],
        returns: "boolean",
        call: (subject, [value = null], clock) =>
          includes(subject as readonly FilterValue[], value, clock),
      },
      containsAny: {
        description:
          "Whether the list has an element equal to at least one of the values, or of the elements of a single list argument.",
        parameters: NONE,
        rest: any("values"),
        returns: "boolean",
        call: (subject, args, clock) =>
          candidates(args).some((value) =>
            includes(subject as readonly FilterValue[], value, clock),
          ),
      },
      containsAll: {
        description:
          "Whether the list has an element equal to each of the values, or to each element of a single list argument.",
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
        description:
          "The list with each element that is a list replaced by its elements, one level deep.",
        parameters: NONE,
        returns: "list",
        call: (subject) =>
          (subject as readonly FilterValue[]).flatMap((element) =>
            isList(element) ? element : [element],
          ),
      },
      join: {
        description:
          "The elements of the list as text joined by `separator`, with null as the empty text.",
        parameters: [string("separator")],
        returns: "string",
        call: (subject, [separator]) =>
          (subject as readonly FilterValue[])
            .map((element) => (element === null ? "" : toText(element)))
            .join(separator as string),
      },
      reverse: {
        description: "The list with its elements in reverse order.",
        parameters: NONE,
        returns: "list",
        call: (subject) => (subject as readonly FilterValue[]).toReversed(),
      },
      slice: {
        description:
          "The elements of the list from index `start` up to, not including, `end`; a negative index counts from the end.",
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
        description:
          "The list in ascending order: numbers by value, texts in the ZotLit Query collation, dates by their start, false before true, and elements of different types grouped by type.",
        parameters: NONE,
        returns: "list",
        call: (subject, _args, clock) =>
          (subject as readonly FilterValue[]).toSorted((a, b) =>
            sortOrder(a, b, clock),
          ),
      },
      unique: {
        description:
          "The list with only the first of each group of equal elements.",
        parameters: NONE,
        returns: "list",
        call: (subject, _args, clock) =>
          (subject as readonly FilterValue[]).reduce<FilterValue[]>(
            (kept, element) =>
              includes(kept, element, clock) ? kept : [...kept, element],
            [],
          ),
      },
      // The element expressions of Bases.
      filter: elementMethod({
        description:
          "The elements of the list for which the expression, with `value` and `index` bound, is truthy.",
        returns: "list",
        scope: ["value", "index"],
      }),
      map: elementMethod({
        description:
          "The list of the results of the expression for each element, with `value` and `index` bound.",
        returns: "list",
        scope: ["value", "index"],
      }),
      reduce: elementMethod({
        description:
          "The result of the expression run on each element in turn, with `value`, `index`, and `acc` bound, where `acc` is the previous result, starting from `initial`.",
        returns: null,
        scope: ["value", "index", "acc"],
        after: [any("initial")],
      }),
      // A Collection element is its root-first path.
      within: {
        description:
          "Whether the list of Collection paths holds the Collection at `path` or a Collection below it.",
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
      isEmpty: isEmpty(() => false, "False: a date is never empty."),
      date: {
        description:
          "The calendar day of a timestamp in the query time zone, or a calendar date unchanged.",
        parameters: NONE,
        returns: "date",
        call: (subject, _args, clock) => dateOnly(subject as DateValue, clock),
      },
      time: {
        description:
          "The time of day of the date in the query time zone, as `HH:MM:SS` text.",
        parameters: NONE,
        returns: "string",
        call: (subject, _args, clock) => timeOfDay(subject as DateValue, clock),
      },
      format: {
        description:
          "The date as text, with the tokens `YYYY`, `MM`, `DD`, `HH`, `mm`, and `ss` of `pattern` replaced by its parts in the query time zone.",
        parameters: [string("pattern")],
        returns: "string",
        call: (subject, [pattern], clock) =>
          formatDate(subject as DateValue, pattern as string, clock),
      },
      relative: {
        description:
          "The date as text relative to the Query Clock, such as `3 days ago` or `in 2 hours`.",
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
        description:
          "Whether the regexp matches somewhere in `text`, or at its start for a regexp with the `y` flag.",
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
      description: "The value as text.",
      parameters: NONE,
      returns: "string",
      call: (subject) => toText(subject),
    },
  ],
  [
    "isType",
    {
      description:
        "Whether the value has the named value type; `any` names every type.",
      parameters: [{ ...string("type"), values: ["any", ...VALUE_TYPES] }],
      returns: "boolean",
      call: (subject, [type]) => type === "any" || type === typeOf(subject),
    },
  ],
  [
    "isTruthy",
    {
      description:
        "Whether the value is truthy: false for null, false, 0, the empty text, the empty list, an empty duration, and an Error Value.",
      parameters: NONE,
      returns: "boolean",
      call: (subject) => truthy(subject),
    },
  ],
]);

const length = (description: string): PropertyDefinition => ({
  description,
  returns: "number",
  read: (subject) => (subject as string | readonly FilterValue[]).length,
});

const datePartProperty = (
  part: Parameters<typeof datePart>[1],
  description: string,
): PropertyDefinition => ({
  description,
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
  string: properties({
    length: length("The number of UTF-16 code units in the text."),
  }),
  list: properties({ length: length("The number of elements in the list.") }),
  date: properties({
    year: datePartProperty(
      "year",
      "The year of the date, in the query time zone for a timestamp.",
    ),
    month: datePartProperty(
      "month",
      "The month of the date from 1 to 12, in the query time zone for a timestamp, or null for a date of only a year.",
    ),
    day: datePartProperty(
      "day",
      "The day of the month of the date, in the query time zone for a timestamp, or null for a date without a day.",
    ),
    hour: datePartProperty(
      "hour",
      "The hour of the date from 0 to 23 in the query time zone, 0 for a calendar date.",
    ),
    minute: datePartProperty(
      "minute",
      "The minute of the date in the query time zone, 0 for a calendar date.",
    ),
    second: datePartProperty(
      "second",
      "The second of the date in the query time zone, 0 for a calendar date.",
    ),
    millisecond: datePartProperty(
      "millisecond",
      "The millisecond of the date in the query time zone, 0 for a calendar date.",
    ),
    timestamp: datePartProperty(
      "timestamp",
      "The Unix time in milliseconds of a timestamp, or of the start of a calendar date in the query time zone.",
    ),
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
 * Every method with the value type it belongs to, for the Query Schema.
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

/** Every property with the value type it belongs to, for the Query Schema. */
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
