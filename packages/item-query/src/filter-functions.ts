import { compareStrings } from "./collation";
// The function registry of the Filter Expression evaluator. Validation,
// execution, and the Item Query Schema read the same entries, so a function,
// a method, or a property exists only here.
import {
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
import {
  equals,
  isDate,
  isList,
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
 * of its parameter. At execution, a null or wrongly typed argument of a typed
 * parameter, or a text outside its `values`, gives null and `call` does not
 * run.
 */
export interface FunctionDefinition {
  /** The required parameters, in order. */
  readonly parameters: readonly FunctionParameter[];
  /** Parameters after the required ones that a call can omit. */
  readonly optional?: readonly FunctionParameter[];
  /** Present on a variadic function: the parameter of every further argument. */
  readonly rest?: FunctionParameter;
  /** The type of the result when it is not null; `null` when it varies. */
  readonly returns: Exclude<FilterValueType, "null"> | null;
  /**
   * `subject` is the value the method is called on, and null for a global
   * function. `clock` is the Query Clock of the query. A null result is a
   * failure that depends on the Item's data.
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

/** A number that a calculation gave; a result outside the finite numbers is null. */
export function finite(value: number): number | null {
  return Number.isFinite(value) ? value : null;
}

/** The largest count `repeat` takes: one query cannot exhaust the worker. */
const MAX_REPEAT = 10_000;

/** The largest precision `toFixed` takes, as JavaScript's `toFixed`. */
const MAX_PRECISION = 100;

/** Whether `value` is an integer from 0 to `max`. */
function isCount(value: FilterValue | undefined, max: number): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= max
  );
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
      if (typeof value === "number") return value;
      if (typeof value === "boolean") return value ? 1 : 0;
      if (typeof value === "string") return finite(Number.parseFloat(value));
      // A date is its Unix time in milliseconds, as its `timestamp` property.
      if (isDate(value)) return datePart(value, "timestamp", clock);
      return null;
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
    parameters: [{ name: "text", type: ["string", "date"] }],
    returns: "date",
    // A date stays as it is.
    call: (_subject, [text], clock) =>
      typeof text === "string" ? parseDate(text, clock) : text!,
  },
  duration: {
    parameters: [string("text")],
    returns: "duration",
    call: (_subject, [text]) => parseDuration(text as string),
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

/** The group of each value type in the order of `sort`; null comes last. */
const SORT_GROUPS: Readonly<Record<FilterValueType, number>> = {
  boolean: 0,
  number: 1,
  string: 2,
  date: 3,
  duration: 4,
  list: 5,
  regexp: 6,
  null: 7,
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
  if (isDate(a) && isDate(b)) {
    return datePart(a, "timestamp", clock)! - datePart(b, "timestamp", clock)!;
  }
  return 0;
}

/** The methods of each value type. A type also has {@link ANY_METHODS}. */
const METHODS: Readonly<Record<FilterValueType, Registry<FunctionDefinition>>> =
  {
    null: functions({ isEmpty: isEmpty(() => true) }),
    boolean: functions({}),
    number: functions({
      isEmpty: isEmpty(() => false),
      round: {
        parameters: NONE,
        optional: [number("digits")],
        returns: "number",
        call: (subject, [digits]) => {
          const factor = typeof digits === "number" ? 10 ** digits : 1;
          return finite(Math.round((subject as number) * factor) / factor);
        },
      },
      ceil: rounding(Math.ceil),
      floor: rounding(Math.floor),
      abs: rounding(Math.abs),
      // A text with `precision` decimals; a precision outside 0 to 100 is null.
      toFixed: {
        parameters: [number("precision")],
        returns: "string",
        call: (subject, [precision]) =>
          isCount(precision, MAX_PRECISION)
            ? (subject as number).toFixed(precision)
            : null,
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
      repeat: {
        parameters: [number("count")],
        returns: "string",
        call: (subject, [count]) =>
          isCount(count, MAX_REPEAT) ? (subject as string).repeat(count) : null,
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
      // Every occurrence of the pattern; the replacement is literal text.
      replace: {
        parameters: [string("pattern"), string("replacement")],
        returns: "string",
        call: (subject, [pattern, replacement]) =>
          (subject as string).replaceAll(
            pattern as string,
            () => replacement as string,
          ),
      },
      // `n` keeps the first `n` parts.
      split: {
        parameters: [string("separator")],
        optional: [number("n")],
        returns: "list",
        call: (subject, [separator, n]) => {
          if (n !== undefined && !isCount(n, Infinity)) return null;
          return (subject as string).split(
            separator as string,
            n as number | undefined,
          );
        },
      },
    }),
    list: functions({
      isEmpty: isEmpty(
        (subject) => (subject as readonly unknown[]).length === 0,
      ),
      contains: {
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
  regexp: properties({}),
};

/** The method `name` of a value of `type`. */
export function methodOf(
  type: FilterValueType,
  name: string,
): FunctionDefinition | undefined {
  return METHODS[type].get(name) ?? ANY_METHODS.get(name);
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
 * Call a function with evaluated arguments. A null or wrongly typed argument
 * of a typed parameter gives null.
 */
export function invoke(
  definition: FunctionDefinition,
  {
    subject,
    args,
  }: { readonly subject: FilterValue; readonly args: readonly FilterValue[] },
  clock: QueryClock,
): FilterValue {
  for (const [index, value] of args.entries()) {
    const parameter = parameterAt(definition, index);
    if (!parameter) return null;
    if (value === null && parameter.nullable) continue;
    if (!takesType(parameter, typeOf(value))) return null;
    if (parameter.values && !parameter.values.includes(value as string)) {
      return null;
    }
  }
  const result = definition.call(subject, args, clock);
  return typeof result === "number" ? finite(result) : result;
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
