// Decodes the CliData of a zotlit:* command through its valibot schema; its
// hardcoded English text follows apps/obsidian/policies/cli-text.md.

import type { CliData } from "obsidian";
import * as v from "valibot";

type ParamsObject = v.StrictObjectSchema<
  v.ObjectEntries,
  v.ErrorMessage<v.StrictObjectIssue> | undefined
>;

/**
 * The parameters of one command, or of one variant of it: a `cliParams`
 * object, piped through any rule between its parameters and the reshape into
 * the request.
 */
export type CliParamsSchema =
  | ParamsObject
  | v.SchemaWithPipe<
      readonly [
        ParamsObject,
        // oxlint-disable-next-line typescript/no-explicit-any -- valibot's own pipe item bound.
        ...v.PipeItem<any, unknown, v.BaseIssue<unknown>>[],
      ]
    >;

type Variants = Readonly<Record<string, CliParamsSchema>>;

/** The parameters of a command whose variants take different parameters. */
export type CliVariantsSchema<TVariants extends Variants> = v.SchemaWithPipe<
  readonly [
    v.LazySchema<TVariants[keyof TVariants]>,
    v.MetadataAction<
      v.InferOutput<TVariants[keyof TVariants]>,
      { cliVariants: TVariants }
    >,
  ]
>;

// oxlint-disable-next-line typescript/no-explicit-any -- any variant set.
type CliSchema = CliParamsSchema | CliVariantsSchema<any>;

type KeysOf<T> = T extends unknown ? keyof T : never;

/**
 * The parameter names a schema accepts in any variant, to type the command's
 * `CliFlags`.
 */
export type CliParamName<TSchema extends CliSchema> = KeysOf<
  v.InferInput<TSchema>
> &
  string;

/** A decoded request, or the one parameter that made it invalid. */
export type CliRequest<T> = { kind: "valid"; value: T } | CliRejection;

export interface CliRejection {
  kind: "invalid";
  parameter: string;
  message: string;
  /** The first validation issue, at its path inside the CLI parameters. */
  issue?: {
    path: string;
    span?: { from: number; to: number };
    expected: string;
    received: string;
    keys?: readonly (string | number)[];
    input?: unknown;
    allowed?: readonly string[];
  };
  received?: readonly (readonly [string, string])[];
  shellSplit?: boolean;
  accepted?: readonly string[];
  /** The recovery action, when it differs from the code's own hint. */
  hint?: string;
}

/**
 * The object of a command's parameters, checked in the order of its entries.
 * An entry outside `v.optional` is required.
 *
 * @param missing the message for each required parameter the caller omits
 * @default missing `<name> is required.`
 */
export function cliParams<const TEntries extends v.ObjectEntries>(
  entries: TEntries,
  missing: Partial<Record<keyof TEntries, string>> = {},
) {
  return v.strictObject(entries, (issue) => {
    const key = String(issue.path?.[0]?.key);
    return issue.expected === "never"
      ? `${key} does not apply with the other parameters given.`
      : (missing[key] ?? `${key} is required.`);
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
  return v.pipe(v.optional(v.never(message)), v.metadata(NOT_APPLICABLE));
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
  return v.pipe(
    v.lazy((input) => variants[kindOf(input as CliData)]!),
    v.metadata({ cliVariants: variants }),
  );
}

/**
 * The rule that the caller gives at most one of `names`. The issue names the
 * second one given, which the caller removes.
 *
 * @param messages.many the message when the caller gives more than one
 * @param messages.none the message, on the first name, when the caller must
 *   give one and gives none
 */
export function cliOneOf<TInput extends Record<string, unknown>>(
  names: readonly (keyof TInput & string)[],
  messages: { many: string; none?: string },
) {
  return v.rawCheck<TInput>(({ dataset, addIssue }) => {
    if (!dataset.typed) return;
    const input = dataset.value;
    const given = names.filter((name) => input[name] !== undefined);
    const key =
      given.length > 1
        ? given[1]
        : given.length === 0 && messages.none !== undefined
          ? names[0]
          : undefined;
    if (key === undefined) return;
    addIssue({
      message: given.length > 1 ? messages.many : messages.none,
      path: [
        { type: "object", origin: "value", input, key, value: input[key] },
      ],
    });
  });
}

/** The parameters of a command that takes none. */
export const noCliParams = cliParams({});

const NOT_APPLICABLE = { cliNotApplicable: true } as const;
const SWITCH = { cliSwitch: true } as const;
const MAYBE_EMPTY = { cliMaybeEmpty: true } as const;

/**
 * A parameter named alone, as `full`. Obsidian passes it as "true"; `full=`
 * counts too.
 *
 * @param message the diagnostic for any other value
 */
export function cliSwitch(message: string) {
  return v.pipe(
    v.optional(
      v.pipe(
        v.picklist(["true", ""], message),
        v.transform((): true => true),
      ),
    ),
    v.metadata(SWITCH),
  );
}

/** An optional parameter whose value may be empty, as `existing=` for an empty baseline. */
export function cliMaybeEmpty() {
  return v.pipe(v.optional(v.string()), v.metadata(MAYBE_EMPTY));
}

/** Text with something beside whitespace. */
export function cliText(message: string) {
  return v.pipe(
    v.string(),
    v.check((text) => text.trim() !== "", message),
  );
}

function isSwitch(entry: v.ObjectEntries[string] | undefined): boolean {
  return entry !== undefined && v.getMetadata(entry).cliSwitch === true;
}

function takesEmpty(entry: v.ObjectEntries[string] | undefined): boolean {
  return (
    entry !== undefined &&
    (isSwitch(entry) || v.getMetadata(entry).cliMaybeEmpty === true)
  );
}

/**
 * A parameter that takes a value which is never the word "true": a bare
 * `key`, which Obsidian passes as "true", answers `<key> requires a value.`
 */
export function cliValue(parameter: string) {
  return v.pipe(
    v.string(),
    v.check((value) => value !== "true", `${parameter} requires a value.`),
  );
}

/** The Zotero source a call asserts; the handler compares it after decoding. */
export const expectSourceParam = v.optional(cliValue("expect-source"));

export interface CliCommand {
  /** The command name the messages use. */
  command: string;
  /** The message for an undeclared parameter that belongs to another command. */
  misplaced?: Readonly<Record<string, string>>;
}

/**
 * Decode `params` with `schema`, or answer the first invalid parameter: an
 * undeclared key, a `--` token, a `vault` after the command name, an empty
 * value, then the first issue of the schema in entry order.
 *
 * Obsidian builds `params` from the caller's tokens: `key=value` gives the
 * text after the first `=`, a bare `key` gives "true", `key=` gives "". A
 * `vault=` after the command name and every `--` token but Obsidian's own
 * `--copy` reach the handler. Obsidian checks a token against the declared
 * flags only for a `required` flag, which ZotLitPlugin.registerCliHandler
 * registers as optional, and for a `format` flag whose value is a bare
 * `a|b` list, which turns an `a` or `--a` token into `format=a`.
 *
 * @throws {Error} when a schema issue names no parameter: a rule between
 *   parameters needs `v.forward` to the parameter the caller changes.
 */
export function decodeCliParams<TSchema extends CliSchema>(
  params: CliData,
  schema: TSchema,
  options: CliCommand,
): CliRequest<v.InferOutput<TSchema>> {
  const entries = entriesOf(schema);
  const accepted = Object.keys(entries);

  for (const key of Object.keys(params)) {
    if (accepted.includes(key)) continue;
    return rejectToken(key, entries, {
      ...options,
      received: Object.entries(params),
    });
  }
  for (const key of Object.keys(params)) {
    if (params[key] === "" && !takesEmpty(entries[key])) {
      return invalid(key, `${key} requires a value.`);
    }
  }

  const result = v.safeParse(schema, params, { abortEarly: true });
  if (result.success) return { kind: "valid", value: result.output };
  const [issue] = result.issues;
  const parameter = issue.path?.[0]?.key;
  if (typeof parameter !== "string") {
    throw new Error(
      `The ${options.command} schema raised an issue without a parameter: ${issue.message}`,
    );
  }
  return {
    ...invalid(parameter, issue.message, {
      path: issuePath(issue.path),
      ...(issue.path?.at(-1)?.type === "unknown" &&
      typeof issue.path.at(-1)?.input === "string"
        ? {
            span: {
              from: Number(issue.path.at(-1)!.key),
              to: Number(issue.path.at(-1)!.key),
            },
          }
        : {}),
      expected:
        issue.expected ??
        (issue.type === "parse_json" ? "JSON" : issue.message),
      received: issue.received,
      keys: issue.path
        ?.slice(1)
        .map(({ key }: v.IssuePathItem) =>
          typeof key === "number" ? key : String(key),
        ),
      input: issue.input,
      allowed: allowedAt(entries[parameter], issue.path?.slice(1) ?? []),
    }),
    received: Object.entries(params),
  };
}

/** Read closed values from the schema, without parsing its display text. */
function allowedAt(
  entry: unknown,
  path: readonly v.IssuePathItem[],
): readonly string[] | undefined {
  if (!entry || typeof entry !== "object") return undefined;
  const node = entry as {
    options?: readonly unknown[];
    wrapped?: unknown;
    pipe?: readonly unknown[];
    entries?: Record<string, unknown>;
    item?: unknown;
  };
  if (node.wrapped) return allowedAt(node.wrapped, path);
  if (node.pipe) {
    for (const item of node.pipe) {
      const found = allowedAt(item, path);
      if (found) return found;
    }
    return undefined;
  }
  if (path.length) {
    const [head, ...tail] = path;
    return allowedAt(
      typeof head!.key === "number"
        ? node.item
        : node.entries?.[String(head!.key)],
      tail,
    );
  }
  return node.options?.every((value) => typeof value === "string")
    ? (node.options as readonly string[])
    : undefined;
}

/** A Valibot issue path in the form callers use to address the invalid value. */
function issuePath(path: readonly v.IssuePathItem[] | undefined): string {
  let formatted = "";
  for (const { key } of path ?? []) {
    formatted +=
      typeof key === "number"
        ? `[${key}]`
        : formatted === ""
          ? String(key)
          : `.${String(key)}`;
  }
  return formatted;
}

/**
 * Every parameter a schema takes in any variant, by name: the entry of a
 * variant it applies to, which carries its form.
 */
function entriesOf(schema: CliSchema): v.ObjectEntries {
  const { cliVariants: variants } = v.getMetadata(schema) as {
    cliVariants?: Variants;
  };
  const objects = variants
    ? Object.values(variants)
    : [schema as CliParamsSchema];
  const entries: Record<string, v.ObjectEntries[string]> = {};
  for (const object of objects) {
    const declared = "pipe" in object ? object.pipe[0].entries : object.entries;
    for (const [name, entry] of Object.entries(declared)) {
      if (!entries[name] || isNotApplicable(entries[name]))
        entries[name] = entry;
    }
  }
  return entries;
}

function isNotApplicable(entry: v.ObjectEntries[string]): boolean {
  return v.getMetadata(entry).cliNotApplicable === true;
}

/** The rejection as one text, for a transport with no field for a hint. */
export function rejectionText(rejection: CliRejection): string {
  return rejection.hint === undefined
    ? rejection.message
    : `${rejection.message} ${rejection.hint}`;
}

function rejectToken(
  key: string,
  entries: v.ObjectEntries,
  options: CliCommand & { received: readonly (readonly [string, string])[] },
): CliRejection {
  const { command, received } = options;
  const accepted = Object.keys(entries);
  if (key === "vault") return invalid("vault", VAULT_AFTER_COMMAND_MESSAGE);
  if (key.startsWith("--")) {
    const parameter = key.slice(2);
    if (accepted.includes(parameter)) {
      const form = isSwitch(entries[parameter])
        ? parameter
        : `${parameter}=<value>`;
      return {
        ...invalid(key, `Parameter '${key}' is not valid: use ${form}.`),
        hint: `Run the command with ${form}, without --.`,
      };
    }
    return {
      ...invalid(key, unknownMessage(key, accepted, command)),
      hint:
        accepted.length === 0
          ? `Remove '${key}'; ${command} takes no parameters.`
          : "Use a supported parameter as name=value, without --; see the command help for its parameters.",
    };
  }
  if (
    SHELL_SPLIT_INITIALS.has(key[0] ?? "") ||
    (key === "" &&
      received.some(([name, value]) => name === key && value.startsWith("=")))
  ) {
    return {
      ...invalid(
        key,
        `Unknown parameter '${key}': Obsidian received these parameters in order: ${received.map(([name]) => name || '""').join(", ")}.`,
      ),
      hint: "Quote the whole value as one shell argument.",
      received,
      shellSplit: true,
      accepted,
    };
  }
  return invalid(
    key,
    options.misplaced?.[key] ?? unknownMessage(key, accepted, command),
  );
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

function invalid(
  parameter: string,
  message: string,
  issue?: CliRejection["issue"],
): CliRejection {
  return {
    kind: "invalid",
    parameter,
    message,
    ...(issue === undefined ? {} : { issue }),
  };
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
