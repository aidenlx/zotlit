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
import { equals, isList, toText, typeOf } from "./filter-values";
import type { FilterValue, FilterValueType } from "./filter-values";
import type { QueryClock } from "./query-clock";

/** The type a parameter takes. `any` also takes null. */
export type ParameterType = "string" | "number" | "list" | "any";

export interface FunctionParameter {
  readonly name: string;
  readonly type: ParameterType;
}

/**
 * One function or method. A call with a wrong argument count, or with an
 * argument whose type is known before execution and differs from the
 * parameter, fails the query. At execution, a null or wrongly typed argument
 * of a typed parameter gives null and `call` does not run.
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

function extreme(pick: (...values: number[]) => number): FunctionDefinition {
  return {
    parameters: [number("value")],
    rest: number("values"),
    returns: "number",
    call: (_subject, args) => pick(...(args as readonly number[])),
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
    call: (_subject, [value = null]) => {
      if (typeof value === "number") return value;
      if (typeof value === "boolean") return value ? 1 : 0;
      if (typeof value === "string") return finite(Number.parseFloat(value));
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
    parameters: [string("text")],
    returns: "date",
    call: (_subject, [text], clock) => parseDate(text as string, clock),
  },
  duration: {
    parameters: [string("text")],
    returns: "duration",
    call: (_subject, [text]) => parseDuration(text as string),
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
      parameters: [string("type")],
      returns: "boolean",
      call: (subject, [type]) => type === "any" || type === typeOf(subject),
    },
  ],
]);

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
  };

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
};

const VALUE_TYPES = Object.keys(METHODS) as FilterValueType[];

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
    if (parameter.type !== "any" && typeOf(value) !== parameter.type) {
      return null;
    }
  }
  const result = definition.call(subject, args, clock);
  return typeof result === "number" ? finite(result) : result;
}

/** The parameter that the argument at `index` fills. */
export function parameterAt(
  definition: Pick<FunctionDefinition, "parameters" | "optional" | "rest">,
  index: number,
): FunctionParameter | undefined {
  const fixed = [...definition.parameters, ...(definition.optional ?? [])];
  return fixed[index] ?? definition.rest;
}
