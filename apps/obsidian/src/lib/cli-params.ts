// Decodes the CliData of a zotlit:* command through its Effect Schema; its
// hardcoded English text follows apps/obsidian/policies/cli-text.md.

import {
  Data,
  Effect,
  Schema,
  SchemaAST,
  SchemaGetter,
  SchemaIssue,
} from "effect";
import type { CliData } from "obsidian";

import { parseIndexedKey } from "@zotlit/db";

declare module "effect/Schema" {
  namespace Annotations {
    interface Annotations {
      /** {@link cliSwitch}: a parameter named alone. */
      readonly cliSwitch?: true | undefined;
      /** {@link cliMaybeEmpty}: a parameter whose value may be empty. */
      readonly cliMaybeEmpty?: true | undefined;
      /** {@link cliNotApplicable}: a parameter of another variant. */
      readonly cliNotApplicable?: true | undefined;
      /** {@link cliLiterals}: the closed values a parameter takes. */
      readonly cliAllowed?: readonly string[] | undefined;
    }
  }
}

/**
 * The parameters of one command, or of one variant of it: a {@link cliParams}
 * struct, checked by any rule between its parameters and reshaped into the
 * request with {@link cliMap}.
 */
export type CliParamsSchema = Schema.Top & {
  readonly Encoded: object;
  readonly DecodingServices: never;
};

type Variants = Readonly<Record<string, CliParamsSchema>>;

/** The parameters of a command whose variants take different parameters. */
export interface CliVariantsSchema<TVariants extends Variants> {
  readonly variants: TVariants;
  readonly kindOf: (params: CliData) => keyof TVariants;
}

// oxlint-disable-next-line typescript/no-explicit-any -- any variant set.
type CliSchema = CliParamsSchema | CliVariantsSchema<any>;

/** What a command's parameters decode to. */
export type CliOutput<TSchema extends CliSchema> =
  TSchema extends CliVariantsSchema<infer TVariants>
    ? TVariants[keyof TVariants]["Type"]
    : TSchema extends CliParamsSchema
      ? TSchema["Type"]
      : never;

type KeysOf<T> = T extends unknown ? keyof T : never;

/**
 * The parameter names a schema accepts in any variant, to type the command's
 * `CliFlags`.
 */
export type CliParamName<TSchema extends CliSchema> = KeysOf<
  TSchema extends CliVariantsSchema<infer TVariants>
    ? TVariants[keyof TVariants]["Encoded"]
    : TSchema extends CliParamsSchema
      ? TSchema["Encoded"]
      : never
> &
  string;

/** The first validation issue, at its path inside the CLI parameters. */
interface CliIssue {
  readonly path: string;
  readonly span?: { readonly from: number; readonly to: number };
  readonly expected: string;
  readonly received: string;
  readonly keys?: readonly (string | number)[];
  readonly input?: unknown;
  readonly allowed?: readonly string[];
}

/** The one parameter that made a request invalid. */
export class CliRejection extends Data.TaggedError("CliRejection")<{
  readonly parameter: string;
  readonly message: string;
  readonly issue?: CliIssue;
  readonly received?: readonly (readonly [string, string])[];
  readonly shellSplit?: boolean;
  readonly accepted?: readonly string[];
  /** The recovery action, when it differs from the code's own hint. */
  readonly hint?: string;
}> {}

/**
 * Answer a rejected request with the text `answer` renders for it. The error
 * channel is generic here, where `Effect.catchTag` needs its tags known, so
 * the rejection is told apart by class.
 */
export function catchRejection(answer: (rejection: CliRejection) => string) {
  return <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ): Effect.Effect<A | string, Exclude<E, CliRejection>, R> =>
    effect.pipe(
      Effect.catch((error) =>
        error instanceof CliRejection
          ? Effect.succeed(answer(error))
          : Effect.fail(error as Exclude<E, CliRejection>),
      ),
    );
}

type RejectionFields = ConstructorParameters<typeof CliRejection>[0];

/** `rejection` with `patch` over its fields, such as a recovery `hint`. */
export function amendRejection(
  rejection: CliRejection,
  patch: Partial<RejectionFields>,
): CliRejection {
  const { parameter, message, issue, received, shellSplit, accepted, hint } =
    rejection;
  const fields = { issue, received, shellSplit, accepted, hint, ...patch };
  return new CliRejection({
    parameter,
    message,
    ...Object.fromEntries(
      Object.entries(fields).filter(([, value]) => value !== undefined),
    ),
  });
}

/**
 * The struct of a command's parameters, checked in the order of its fields.
 * A field outside `Schema.optionalKey` is required.
 *
 * @param missing the message for each required parameter the caller omits
 * @default missing `<name> is required.`
 */
export function cliParams<const TFields extends Schema.Struct.Fields>(
  fields: TFields,
  missing: Partial<Record<keyof TFields, string>> = {},
): Schema.Struct<TFields> {
  const keyed = Object.fromEntries(
    Object.entries(fields).map(([name, field]) => [
      name,
      (field as Schema.Top).annotateKey({
        messageMissingKey: missing[name] ?? `${name} is required.`,
      }),
    ]),
  );
  return Schema.Struct(keyed as unknown as TFields);
}

/**
 * Reshape decoded parameters into the request. CLI parameters only decode,
 * so the reshape has no inverse.
 */
export function cliMap<TFrom extends Schema.Top, TTo>(
  f: (value: TFrom["Type"]) => TTo,
) {
  return cliMapEffect<TFrom, TTo>((value) => Effect.succeed(f(value)));
}

/** {@link cliMap} whose step can raise an issue of its own. */
export function cliMapEffect<TFrom extends Schema.Top, TTo>(
  f: (
    value: TFrom["Type"],
    options: SchemaAST.ParseOptions,
  ) => Effect.Effect<TTo, SchemaIssue.Issue>,
) {
  return (self: TFrom) =>
    self.pipe(
      Schema.decodeTo(
        Schema.declare(
          // oxlint-disable-next-line no-unused-vars -- The step's own output: nothing is left to check.
          (_value: unknown): _value is TTo => true,
        ),
        {
          decode: SchemaGetter.transformEffect(f),
          encode: SchemaGetter.forbidden(() => "CLI parameters only decode"),
        },
      ),
    );
}

/**
 * A rule between parameters, reported at `parameter`: the one the caller
 * changes to satisfy it.
 *
 * @param message the diagnostic, or a function of the parameters
 */
export function cliRule<T>(
  parameter: string,
  holds: (input: T) => boolean,
  message: string | ((input: T) => string),
) {
  return Schema.makeFilter<T>((input) =>
    holds(input)
      ? undefined
      : {
          path: [parameter],
          issue: typeof message === "string" ? message : message(input),
        },
  );
}

/**
 * An Indexed Key: an item key, and a group ID above zero when it has one.
 *
 * @param message the diagnostic for text that is not one
 */
export function cliIndexedKey(message: string | ((text: string) => string)) {
  return Schema.makeFilter((text: string) => {
    const parsed = parseIndexedKey(text);
    return (
      (parsed !== null && (parsed.groupID === null || parsed.groupID > 0)) ||
      (typeof message === "string" ? message : message(text))
    );
  });
}

/**
 * A parameter that another variant of the command takes and this one does
 * not. Declare it after the parameters its message depends on, and before
 * the ones it should be reported ahead of.
 *
 * @param message what the parameter applies to, and what to give instead
 */
export function cliNotApplicable(message: string) {
  return Schema.optionalKey(
    Schema.Never.annotate({ message, cliNotApplicable: true }),
  );
}

/**
 * The parameters of a command whose accepted parameters depend on the
 * others, as one variant for each case: the selector given, the kind of
 * Template named. Each variant lists the parameters that apply to it and
 * reshapes them into its branch of the request.
 *
 * @param kindOf names the variant from the caller's raw parameters
 */
export function cliVariants<const TVariants extends Variants>(
  kindOf: (params: CliData) => keyof TVariants,
  variants: TVariants,
): CliVariantsSchema<TVariants> {
  return { kindOf, variants };
}

/**
 * The rule that the caller gives at most one of `names`. The issue names the
 * second one given, which the caller removes.
 *
 * @param messages.many the message when the caller gives more than one
 * @param messages.none the message, on the first name, when the caller must
 *   give one and gives none
 */
export function cliOneOf<TInput extends Readonly<Record<string, unknown>>>(
  names: readonly (keyof TInput & string)[],
  messages: { many: string; none?: string },
) {
  return Schema.makeFilter<TInput>((input) => {
    const given = names.filter((name) => input[name] !== undefined);
    if (given.length > 1) return { path: [given[1]!], issue: messages.many };
    if (given.length === 0 && messages.none !== undefined)
      return { path: [names[0]!], issue: messages.none };
    return undefined;
  });
}

/** The parameters of a command that takes none. */
export const noCliParams = cliParams({});

/**
 * A parameter named alone, as `full`. Obsidian passes it as "true"; `full=`
 * counts too.
 *
 * @param message the diagnostic for any other value
 */
export function cliSwitch(message: string) {
  return Schema.optionalKey(
    Schema.String.check(
      Schema.makeFilter(
        (input: string) => input === "true" || input === "" || message,
        { cliAllowed: ["true", ""] },
      ),
    )
      .pipe(
        Schema.decodeTo(Schema.Literal(true), {
          decode: SchemaGetter.transform((): true => true),
          encode: SchemaGetter.transform(() => "true" as const),
        }),
      )
      .annotate({ cliSwitch: true }),
  );
}

/** An optional parameter whose value may be empty, as `existing=` for an empty baseline. */
export function cliMaybeEmpty() {
  return Schema.optionalKey(Schema.String.annotate({ cliMaybeEmpty: true }));
}

/**
 * An optional parameter, `encoded` when the caller omits it: the default
 * decodes as a given value would.
 */
export function cliDefault<TSchema extends Schema.Top>(
  schema: TSchema,
  encoded: TSchema["Encoded"],
) {
  return schema.pipe(Schema.withDecodingDefaultKey(Effect.succeed(encoded)));
}

/** Text with something beside whitespace. */
export function cliText(message: string) {
  return Schema.String.check(
    Schema.makeFilter((text: string) => text.trim() !== "" || message),
  );
}

/**
 * A parameter that takes a value which is never the word "true": a bare
 * `key`, which Obsidian passes as "true", answers `<key> requires a value.`
 */
export function cliValue(parameter: string) {
  return Schema.String.check(
    Schema.makeFilter(
      (value: string) => value !== "true" || `${parameter} requires a value.`,
    ),
  );
}

/**
 * A parameter of closed values.
 *
 * @param message the diagnostic for any other value, or a function of it
 * @default message `Invalid type: Expected ("a" | "b") but received "c"`
 */
export function cliLiterals<const TValues extends readonly string[]>(
  values: TValues,
  message: string | ((input: string) => string) = (input) =>
    `Invalid type: Expected ${expectedOf(Schema.Literals(values).ast)} but received ${JSON.stringify(input)}`,
) {
  return Schema.String.check(
    Schema.makeFilter(
      (input: string) =>
        values.includes(input) ||
        (typeof message === "string" ? message : message(input)),
      { cliAllowed: values, expected: expectedOf(Schema.Literals(values).ast) },
    ),
  ).pipe(cliMap((input) => input as TValues[number]));
}

/**
 * A parameter that carries JSON, decoded by `schema`. Text that is no JSON
 * answers `message`; valid JSON keeps the first issue `schema` raises.
 * `Schema.fromJsonString` reports its own parse error, so the parse is here.
 */
export function cliJson<TSchema extends Schema.Top>(
  message: string,
  schema: TSchema,
) {
  return Schema.String.pipe(
    cliMapEffect((text: string, options) => {
      try {
        return Effect.succeed(JSON.parse(text) as unknown);
      } catch {
        return Effect.fail(
          new SchemaIssue.InvalidValue(
            { message, expected: "JSON" },
            text,
            options,
          ),
        );
      }
    }),
    Schema.decodeTo(schema),
  );
}

/** The Zotero source a call asserts; the handler compares it after decoding. */
export const expectSourceParam = Schema.optionalKey(cliValue("expect-source"));

export interface CliCommand {
  /** The command name the messages use. */
  command: string;
  /** The message for an undeclared parameter that belongs to another command. */
  misplaced?: Readonly<Record<string, string>>;
}

/**
 * Decode `params` with `schema`, or fail with the first invalid parameter: an
 * undeclared key, a `--` token, a `vault` after the command name, an empty
 * value, then the first issue of the schema in field order.
 *
 * Obsidian builds `params` from the caller's tokens: `key=value` gives the
 * text after the first `=`, a bare `key` gives "true", `key=` gives "". A
 * `vault=` after the command name and every `--` token but Obsidian's own
 * `--copy` reach the handler. Obsidian checks a token against the declared
 * flags only for a `required` flag, which ZotLitPlugin.registerCliHandler
 * registers as optional, and for a `format` flag whose value is a bare
 * `a|b` list, which turns an `a` or `--a` token into `format=a`.
 *
 * Dies when a schema issue names no parameter: a rule between parameters
 * reports at the parameter the caller changes, through {@link cliRule}.
 */
export function decodeCliParams<TSchema extends CliSchema>(
  params: CliData,
  schema: TSchema,
  options: CliCommand,
): Effect.Effect<CliOutput<TSchema>, CliRejection> {
  return Effect.suspend(() => {
    const fields = fieldsOf(schema);
    const accepted = Object.keys(fields);
    const received = Object.entries(params);

    for (const key of Object.keys(params)) {
      if (accepted.includes(key)) continue;
      return Effect.fail(rejectToken(key, fields, { ...options, received }));
    }
    for (const key of Object.keys(params)) {
      if (params[key] === "" && !takesEmpty(fields[key])) {
        return Effect.fail(
          new CliRejection({
            parameter: key,
            message: `${key} requires a value.`,
          }),
        );
      }
    }

    const variant: CliParamsSchema = isVariants(schema)
      ? schema.variants[schema.kindOf(params)]!
      : (schema as CliParamsSchema);
    const decoded = Schema.decodeEffect(variant)(params, {
      errors: "first",
      reportInput: true,
    }) as Effect.Effect<CliOutput<TSchema>, Schema.SchemaError>;
    return decoded.pipe(
      Effect.catchTag("SchemaError", ({ issue }) => {
        const fault = firstFault(issue, []);
        const [parameter] = fault.path;
        if (typeof parameter !== "string") {
          return Effect.die(
            new Error(
              `The ${options.command} schema raised an issue without a parameter: ${fault.message}`,
            ),
          );
        }
        return Effect.fail(
          new CliRejection({
            parameter,
            message: fault.message,
            issue: {
              path: issuePath(fault.path),
              expected: fault.expected,
              received: fault.received,
              keys: fault.path
                .slice(1)
                .map((key) => (typeof key === "number" ? key : String(key))),
              input: fault.input,
              ...(fault.allowed === undefined
                ? {}
                : { allowed: fault.allowed }),
            },
            received,
          }),
        );
      }),
      Effect.tap(() => {
        // A struct drops a key it does not declare: one that only another
        // variant takes is rejected here, once the variant's own are valid.
        const own = Object.keys(structFields(variant));
        const stray = Object.keys(params).find((key) => !own.includes(key));
        return stray === undefined
          ? Effect.void
          : Effect.fail(
              new CliRejection({
                parameter: stray,
                message: `${stray} does not apply with the other parameters given.`,
                issue: {
                  path: stray,
                  expected: "never",
                  received: receivedText(params[stray]),
                  keys: [],
                  input: params[stray],
                },
                received,
              }),
            );
      }),
    );
  });
}

function isVariants(schema: CliSchema): schema is CliVariantsSchema<Variants> {
  return "variants" in schema && "kindOf" in schema;
}

/** The first leaf of an issue tree: where it is, and what it says. */
interface Fault {
  readonly path: readonly PropertyKey[];
  readonly message: string;
  readonly expected: string;
  readonly received: string;
  readonly input: unknown;
  readonly allowed?: readonly string[];
}

function firstFault(
  issue: SchemaIssue.Issue,
  path: readonly PropertyKey[],
  check?: SchemaIssue.Filter,
): Fault {
  switch (issue._tag) {
    case "Pointer":
      return firstFault(issue.issue, [...path, ...issue.path], check);
    case "Composite":
      return firstFault(issue.issues[0]!, path, check);
    case "Encoding":
      return firstFault(issue.issue, path, check);
    case "Filter":
      return firstFault(issue.issue, path, issue);
    case "AnyOf":
      if (issue.issues.length > 0)
        return firstFault(issue.issues[0]!, path, check);
      break;
    default:
      break;
  }
  const input = SchemaIssue.hasInput(issue)
    ? issue.input
    : check && SchemaIssue.hasInput(check)
      ? check.input
      : undefined;
  const annotations = check?.filter.annotations;
  const allowed = annotations?.cliAllowed;
  const leaf = leafFault(issue, path, input);
  const message =
    (check && SchemaIssue.defaultCheckHook(check)) ?? leaf.message;
  return {
    path,
    message,
    expected:
      (annotations?.expected as string | undefined) ??
      (check ? message : leaf.expected),
    received: leaf.received,
    input,
    ...(allowed === undefined ? {} : { allowed }),
  };
}

/**
 * What a leaf issue says where the schema gives no message of its own:
 * "Invalid type: Expected … but received …" and "Invalid key: …", the words
 * the Diagnostic Report has always used. Its text is the CLI's contract
 * (`apps/obsidian/policies/cli-text.md`).
 */
function leafFault(
  issue: SchemaIssue.Issue,
  path: readonly PropertyKey[],
  input: unknown,
): { message: string; expected: string; received: string } {
  const key = JSON.stringify(String(path.at(-1)));
  switch (issue._tag) {
    case "InvalidType":
    case "AnyOf": {
      const expected = expectedOf(issue.ast);
      const received = receivedText(input);
      return {
        message:
          messageOf(SchemaAST.resolve(issue.ast)) ??
          `Invalid type: Expected ${expected} but received ${received}`,
        expected,
        received,
      };
    }
    case "MissingKey":
      return {
        message:
          issue.annotations?.messageMissingKey ??
          `Invalid key: Expected ${key} but received undefined`,
        expected: key,
        received: "undefined",
      };
    case "UnexpectedKey":
      return {
        message: `Invalid key: Expected never but received ${key}`,
        expected: "never",
        received: key,
      };
    case "InvalidValue": {
      const message = SchemaIssue.defaultLeafHook(issue);
      return {
        message,
        expected:
          (issue.annotations?.expected as string | undefined) ?? message,
        received: receivedText(input),
      };
    }
    default: {
      const message = SchemaIssue.defaultLeafHook(issue as SchemaIssue.Leaf);
      return { message, expected: message, received: receivedText(input) };
    }
  }
}

function messageOf(
  annotations: Schema.Annotations.Annotations | undefined,
): string | undefined {
  const message = annotations?.message;
  return typeof message === "string" ? message : undefined;
}

/** The form a schema expects, as the Diagnostic Report names it. */
function expectedOf(ast: SchemaAST.AST): string {
  switch (ast._tag) {
    case "Literal":
      return JSON.stringify(ast.literal);
    case "Union":
      return `(${ast.types.map(expectedOf).join(" | ")})`;
    case "Objects":
      return "Object";
    case "Arrays":
      return "Array";
    default:
      return ast._tag.toLowerCase();
  }
}

/** A value as the Diagnostic Report quotes it. */
function receivedText(input: unknown): string {
  if (typeof input === "string") return JSON.stringify(input);
  if (input === null || typeof input !== "object") return String(input);
  return Array.isArray(input) ? "Array" : "Object";
}

/** An issue path in the form callers use to address the invalid value. */
function issuePath(path: readonly PropertyKey[]): string {
  let formatted = "";
  for (const key of path) {
    formatted +=
      typeof key === "number"
        ? `[${key}]`
        : formatted === ""
          ? String(key)
          : `.${String(key)}`;
  }
  return formatted;
}

type Field = Schema.Top;

/**
 * Every parameter a schema takes in any variant, by name: the field of a
 * variant it applies to, which carries its form.
 */
function fieldsOf(schema: CliSchema): Readonly<Record<string, Field>> {
  const structs = isVariants(schema)
    ? Object.values(schema.variants)
    : [schema];
  const fields: Record<string, Field> = {};
  for (const struct of structs) {
    for (const [name, field] of Object.entries(structFields(struct))) {
      if (!fields[name] || isNotApplicable(fields[name])) fields[name] = field;
    }
  }
  return fields;
}

/** The fields of the struct a {@link CliParamsSchema} decodes from. */
function structFields(schema: unknown): Readonly<Record<string, Field>> {
  let node = schema as { fields?: Schema.Struct.Fields; from?: unknown };
  while (node.fields === undefined) {
    if (node.from === undefined)
      throw new Error("A CLI parameters schema decodes from no cliParams");
    node = node.from as typeof node;
  }
  return node.fields as Readonly<Record<string, Field>>;
}

function annotationsOf(field: Field | undefined) {
  return field === undefined ? undefined : SchemaAST.resolve(field.ast);
}

function isSwitch(field: Field | undefined): boolean {
  return annotationsOf(field)?.cliSwitch === true;
}

function isNotApplicable(field: Field): boolean {
  return annotationsOf(field)?.cliNotApplicable === true;
}

function takesEmpty(field: Field | undefined): boolean {
  return isSwitch(field) || annotationsOf(field)?.cliMaybeEmpty === true;
}

/** The rejection as one text, for a transport with no field for a hint. */
export function rejectionText(rejection: CliRejection): string {
  return rejection.hint === undefined
    ? rejection.message
    : `${rejection.message} ${rejection.hint}`;
}

function rejectToken(
  key: string,
  fields: Readonly<Record<string, Field>>,
  options: CliCommand & { received: readonly (readonly [string, string])[] },
): CliRejection {
  const { command, received } = options;
  const accepted = Object.keys(fields);
  if (key === "vault")
    return new CliRejection({
      parameter: "vault",
      message: VAULT_AFTER_COMMAND_MESSAGE,
    });
  if (key.startsWith("--")) {
    const parameter = key.slice(2);
    if (accepted.includes(parameter)) {
      const form = isSwitch(fields[parameter])
        ? parameter
        : `${parameter}=<value>`;
      return new CliRejection({
        parameter: key,
        message: `Parameter '${key}' is not valid: use ${form}.`,
        hint: `Run the command with ${form}, without --.`,
      });
    }
    return new CliRejection({
      parameter: key,
      message: unknownMessage(key, accepted, command),
      hint:
        accepted.length === 0
          ? `Remove '${key}'; ${command} takes no parameters.`
          : "Use a supported parameter as name=value, without --; see the command help for its parameters.",
    });
  }
  if (
    SHELL_SPLIT_INITIALS.has(key[0] ?? "") ||
    (key === "" &&
      received.some(([name, value]) => name === key && value.startsWith("=")))
  ) {
    return new CliRejection({
      parameter: key,
      message: `Unknown parameter '${key}': Obsidian received these parameters in order: ${received.map(([name]) => name || '""').join(", ")}.`,
      hint: "Quote the whole value as one shell argument.",
      received,
      shellSplit: true,
      accepted,
    });
  }
  return new CliRejection({
    parameter: key,
    message: options.misplaced?.[key] ?? unknownMessage(key, accepted, command),
  });
}

function unknownMessage(
  key: string,
  accepted: readonly string[],
  command: string,
): string {
  return accepted.length === 0
    ? `Unknown parameter '${key}': ${command} takes no parameters.`
    : `Unknown parameter '${key}' for ${command}. Accepted parameters: ${accepted.join(", ")}.`;
}

const SHELL_SPLIT_INITIALS = new Set([
  "=",
  "!",
  "<",
  ">",
  "&",
  "|",
  "+",
  "-",
  "*",
  "/",
  "%",
  '"',
  "'",
  "`",
  "(",
  ")",
  "[",
  "]",
  "{",
  "}",
]);

const VAULT_AFTER_COMMAND_MESSAGE =
  "vault must come before the command name (obsidian vault=<name> zotlit:...); placed after, Obsidian ignores it and routes the call by working directory or focused window instead.";
