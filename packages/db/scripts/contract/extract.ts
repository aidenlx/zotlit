// Walks the `zt` contract types with ts-morph and records their serialized form as contract IR.
import {
  Node,
  type InterfaceDeclaration,
  type Signature,
  type Symbol as TypeSymbol,
  type Type,
} from "ts-morph";

import {
  type ContractAdditionalMembers,
  type ContractMember,
  type ContractNamedType,
  type ContractObject,
  type ContractRef,
  type ContractStringified,
  type ContractType,
} from "./ir.ts";

/** ts-morph's in-memory path for the lib file declaring the `Temporal` namespace. */
const TEMPORAL_LIB = "lib.esnext.temporal.d.ts";

/**
 * Non-enumerable on every contract shape that defines it, so it never reaches
 * serialized output.
 *
 * @see src/lib/to-string.ts
 */
const DROPPED_MEMBER = "toString";

/** Held by a named type while its own members are still being walked, so a cycle back to it resolves to a ref. */
const WALKING: ContractNamedType = { kind: "object", members: [] };

/** A named type together with the declaration its doc comment and member types resolve against. */
interface NamedType {
  name: string;
  declaration: Node;
}

export class ContractExtractor {
  readonly #srcDir: string;
  readonly #types = new Map<string, ContractNamedType>();
  readonly #registered = new Map<string, string>();

  /** @param srcDir Absolute path below which a declaration counts as part of the contract. */
  constructor(srcDir: string) {
    this.#srcDir = srcDir;
  }

  /** Every named type reached so far, keyed by its TypeScript name. */
  get types(): Record<string, ContractNamedType> {
    return Object.fromEntries(this.#types);
  }

  /** Record `declaration` as a contract root and return its {@link types} key. */
  addRoot(declaration: InterfaceDeclaration): string {
    return this.#register(declaration.getType(), {
      name: declaration.getName(),
      declaration,
    }).name;
  }

  /**
   * A `$defs` key is the bare TypeScript name, so two same-named declarations —
   * or two instantiations of one generic — would silently collapse into
   * whichever arrived first. Fail instead, per ADR 0015.
   */
  #register(type: Type, named: NamedType): ContractRef {
    const identity = type.getText();
    const registered = this.#registered.get(named.name);
    if (registered === undefined) {
      this.#registered.set(named.name, identity);
      this.#types.set(named.name, WALKING);
      this.#types.set(named.name, this.#define(type, named.declaration));
    } else if (registered !== identity) {
      throw new Error(
        `Two contract types claim the name ${named.name}: ${registered} and ${identity}`,
      );
    }
    return { kind: "ref", name: named.name };
  }

  #define(type: Type, declaration: Node): ContractNamedType {
    const description = jsDocOf(declaration);
    if (type.isUnion()) {
      return {
        kind: "union",
        description,
        options: this.#options(type, declaration),
      };
    }
    const { members, additional } = this.#object(type, declaration);
    return { kind: "object", description, members, additional };
  }

  #object(type: Type, location: Node): ContractObject {
    return {
      kind: "object",
      members: type
        .getProperties()
        .filter((property) => property.getName() !== DROPPED_MEMBER)
        .map((property) => this.#member(property, location)),
      additional: this.#additional(type, location),
    };
  }

  #member(property: TypeSymbol, location: Node): ContractMember {
    const name = property.getName();
    const type = property.getTypeAtLocation(location);
    return {
      name,
      description: jsDocOf(property.getValueDeclaration()),
      // A member that can hold `undefined` disappears from JSON output, which
      // is what an absent property means to a schema.
      optional: property.isOptional() || carriesUndefined(type),
      type: this.#memberType(name, type, location),
    };
  }

  /** A function-valued member serializes as a helper marker; every other member as its own value. */
  #memberType(name: string, type: Type, location: Node): ContractType {
    const [signature] = type.getCallSignatures();
    if (!signature) return this.#walk(type, location);
    return {
      kind: "helper",
      name,
      signature: renderSignature(signature),
      value: this.#walk(signature.getReturnType(), location),
    };
  }

  #walk(type: Type, location: Node): ContractType {
    if (type.isStringLiteral()) {
      return { kind: "literal", value: type.getLiteralValue() as string };
    }
    if (type.isNumberLiteral()) {
      return { kind: "literal", value: type.getLiteralValue() as number };
    }
    if (type.isBooleanLiteral()) {
      return { kind: "literal", value: type.getText() === "true" };
    }
    if (type.isString()) return { kind: "primitive", type: "string" };
    if (type.isNumber()) return { kind: "primitive", type: "number" };
    if (type.isBoolean()) return { kind: "primitive", type: "boolean" };
    if (type.isNull()) return { kind: "primitive", type: "null" };
    if (type.isAny() || type.isUnknown()) return { kind: "unknown" };
    if (type.isArray()) {
      const items = this.#walk(type.getArrayElementTypeOrThrow(), location);
      return { kind: "array", items };
    }

    const stringified = temporalOf(type);
    if (stringified) return stringified;

    const named = this.#nameOf(type);
    if (named) return this.#register(type, named);

    // A helper marker needs the member name, which only #memberType holds, so a
    // function reached any deeper has no truthful serialized form.
    if (type.getCallSignatures().length > 0) {
      throw new Error(
        `A function is only a contract helper as a direct member: ${type.getText()}`,
      );
    }

    if (type.isUnion()) {
      const options = this.#options(type, location);
      // Dropping `undefined` can leave one option; that is no longer a union.
      return options.length === 1 ? options[0]! : { kind: "union", options };
    }
    if (type.isObject() || type.isIntersection()) {
      const values = type.getStringIndexType();
      if (values && type.getProperties().length === 0) {
        return { kind: "record", values: this.#walk(values, location) };
      }
      return this.#object(type, location);
    }
    throw new Error(`Unsupported contract type: ${type.getText()}`);
  }

  /** `undefined` never survives JSON serialization; a nullable union reads best with `null` last. */
  #options(type: Type, location: Node): ContractType[] {
    const options = type
      .getUnionTypes()
      .filter((option) => !option.isUndefined())
      .map((option) => this.#walk(option, location));
    const nulls = options.filter(isNullOption);
    return [...options.filter((option) => !isNullOption(option)), ...nulls];
  }

  #additional(
    type: Type,
    location: Node,
  ): ContractAdditionalMembers | undefined {
    const values = type.getStringIndexType();
    if (!values) return undefined;
    return {
      description: indexSignatureDoc(type),
      type: this.#walk(values, location),
      itemFields: extendsInterface(type, "TemplateItemBaseData"),
    };
  }

  /** A type earns a named IR entry when it is declared inside this package; anonymous shapes inline. */
  #nameOf(type: Type): NamedType | undefined {
    const symbol = type.getAliasSymbol() ?? type.getSymbol();
    const name = symbol?.getName();
    const declaration = symbol?.getDeclarations()[0];
    if (!name || name.startsWith("__") || !declaration) return undefined;
    return declaration.getSourceFile().getFilePath().startsWith(this.#srcDir)
      ? { name, declaration }
      : undefined;
  }
}

function isNullOption(option: ContractType): boolean {
  return option.kind === "primitive" && option.type === "null";
}

function extendsInterface(type: Type, name: string): boolean {
  for (const declaration of type.getSymbol()?.getDeclarations() ?? []) {
    if (!Node.isInterfaceDeclaration(declaration)) continue;
    if (declaration.getName() === name) return true;
    for (const base of declaration.getBaseDeclarations()) {
      if (extendsInterface(base.getType(), name)) return true;
    }
  }
  return false;
}

function carriesUndefined(type: Type): boolean {
  return (
    type.isUndefined() || type.getUnionTypes().some((o) => o.isUndefined())
  );
}

function jsDocOf(declaration: Node | undefined): string | undefined {
  if (!declaration || !Node.isJSDocable(declaration)) return undefined;
  return declaration.getJsDocs().at(-1)?.getCommentText()?.trim() || undefined;
}

/** The doc comment on the index signature `type` carries, searched own-declaration first then up the `extends` chain. */
function indexSignatureDoc(type: Type): string | undefined {
  for (const declaration of type.getSymbol()?.getDeclarations() ?? []) {
    if (!Node.isInterfaceDeclaration(declaration)) continue;
    const found = interfaceIndexSignatureDoc(declaration);
    if (found) return found;
  }
  return undefined;
}

function interfaceIndexSignatureDoc(
  declaration: InterfaceDeclaration,
): string | undefined {
  const own = declaration.getIndexSignatures()[0];
  if (own) return jsDocOf(own);
  for (const base of declaration.getBaseDeclarations()) {
    if (!Node.isInterfaceDeclaration(base)) continue;
    const found = interfaceIndexSignatureDoc(base);
    if (found) return found;
  }
  return undefined;
}

function temporalOf(type: Type): ContractStringified | undefined {
  const symbol = type.getSymbol();
  const declaration = symbol?.getDeclarations()[0];
  if (
    !symbol ||
    !declaration?.getSourceFile().getFilePath().endsWith(TEMPORAL_LIB)
  ) {
    return undefined;
  }
  return { kind: "stringified", type: `Temporal.${symbol.getName()}` };
}

/** Reads the written syntax rather than the checker's text, so optional parameters keep their `?`. */
function renderSignature(signature: Signature): string {
  const declaration = signature.getDeclaration();
  if (!Node.isSignaturedDeclaration(declaration)) {
    throw new Error(`Unsupported helper signature: ${declaration.getText()}`);
  }
  const parameters = declaration.getParameters().map((parameter) => {
    const optional = parameter.hasQuestionToken() ? "?" : "";
    const type =
      parameter.getTypeNode()?.getText() ?? parameter.getType().getText();
    return `${parameter.getName()}${optional}: ${type}`;
  });
  const returns =
    declaration.getReturnTypeNode()?.getText() ??
    signature.getReturnType().getText();
  return `(${parameters.join(", ")}) => ${returns}`;
}
