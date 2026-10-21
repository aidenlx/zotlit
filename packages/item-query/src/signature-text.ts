// The text of a function's signature, one formatting for every surface that
// shows one: the Functions and methods reference page, an editor's
// completion list and its Signature Hint.
import type { FunctionParameter } from "./filter-functions";
import type { FilterValueType } from "./filter-values";

/** A parameter as the registry and the Query Schema both describe it. */
type Parameter = Pick<
  FunctionParameter,
  "name" | "type" | "nullable" | "values"
>;

/** A signature as the registry and the Query Schema both describe it. */
export interface SignatureShape {
  readonly parameters: readonly Parameter[];
  readonly optional?: readonly Parameter[] | undefined;
  readonly rest?: Parameter | null | undefined;
}

/** One parameter of a signature, in order, with its text. */
export interface ParameterText<P extends Parameter = Parameter> {
  readonly parameter: P;
  readonly optional: boolean;
  readonly rest: boolean;
  /** `name: type`, `name?: type` or `...name: type`. */
  readonly text: string;
}

/** The types a parameter takes, as one text: its texts, or its types, and null. */
export function parameterTypeText(parameter: Parameter): string {
  const types = parameter.values
    ? parameter.values.map((value) => JSON.stringify(value))
    : typeof parameter.type === "string"
      ? [parameter.type]
      : parameter.type;
  return [...types, ...(parameter.nullable ? ["null"] : [])].join(" | ");
}

/** The required, then the optional, then the rest parameter, each with its text. */
export function parameterTexts<P extends Parameter>(definition: {
  readonly parameters: readonly P[];
  readonly optional?: readonly P[] | undefined;
  readonly rest?: P | null | undefined;
}): ParameterText<P>[] {
  const entry = (parameter: P, optional: boolean, rest: boolean) => ({
    parameter,
    optional,
    rest,
    text: `${rest ? "..." : ""}${parameter.name}${optional && !rest ? "?" : ""}: ${parameterTypeText(parameter)}`,
  });
  return [
    ...definition.parameters.map((p) => entry(p, false, false)),
    ...(definition.optional ?? []).map((p) => entry(p, true, false)),
    ...(definition.rest ? [entry(definition.rest, true, true)] : []),
  ];
}

/** The type of a call's result; `any` when it varies. */
export const resultText = (
  returns: FilterValueType | null | undefined,
): string => returns ?? "any";

/** `name(param: type, optional?: type, ...rest: type) → type`. */
export function signatureText(
  name: string,
  definition: SignatureShape & {
    readonly returns?: FilterValueType | null | undefined;
  },
): string {
  const parameters = parameterTexts(definition).map(({ text }) => text);
  return `${name}(${parameters.join(", ")}) → ${resultText(definition.returns)}`;
}
