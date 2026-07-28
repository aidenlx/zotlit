// Synchronous, eval-free interpreter for generated JSON Language Packs.

import { Temporal } from "@js-temporal/polyfill";

import {
  parseNumericLiteral,
  type Expression,
  type LanguagePack,
  type Message,
} from "./language-pack.js";
import { noopLogger, type StructuredLogger } from "./logger.js";

type Variables = Record<string, unknown>;

type RenderMessageOptions = {
  locale: string;
  inputs: Record<string, unknown>;
};

/** Each locale's bundled subset of Target-Locale Messages, keyed by locale. */
export type TargetLocaleMessages = Readonly<
  Record<string, Readonly<Record<string, Message>>>
>;

export type LanguagePackRuntime = {
  install(pack: LanguagePack): void;
  reset(): void;
  /** Routes runtime diagnostics to the consumer's logger; generated runtimes start with the no-op. */
  setLogger(logger: StructuredLogger): void;
  /** Selects the locale {@link LanguagePackRuntime.translateTarget} renders from. */
  setTargetLocale(locale: string): void;
  translate(messageId: string, inputs?: Record<string, unknown>): string;
  /**
   * Renders a Target-Locale Message from the bundled subset for the target
   * locale, never consulting the active Language Pack, then falls back per
   * message to the base locale and finally to the message ID.
   */
  translateTarget(messageId: string, inputs?: Record<string, unknown>): string;
};

export type CreateLanguagePackRuntimeOptions = {
  /** Subsets shipped with the plugin; absent locales render base-locale text. */
  targetLocaleMessages?: TargetLocaleMessages;
};

export type DatetimeInput =
  | string
  | number
  | Temporal.Instant
  | Temporal.PlainDate;

export function createLanguagePackRuntime(
  basePack: LanguagePack,
  { targetLocaleMessages = {} }: CreateLanguagePackRuntimeOptions = {},
): LanguagePackRuntime {
  let logger: StructuredLogger = noopLogger;
  let activePack = basePack;
  /** The rung {@link translateTarget} renders from; absent until a target locale with a bundled subset is set. */
  let target:
    | { locale: string; messages: Readonly<Record<string, Message>> }
    | undefined;
  /** Message IDs already reported as falling back, so a hot translate logs once per ID. */
  const reportedFallbacks = new Set<string>();

  const reportFallback = (
    messageId: string,
    reason: string,
    error?: unknown,
  ): void => {
    if (reportedFallbacks.has(messageId)) return;
    reportedFallbacks.add(messageId);
    logger.debug("Falling back to the base locale for {messageId}: {reason}", {
      messageId,
      reason,
      error,
    });
  };

  /**
   * Renders from one rung of the fallback ladder, or `undefined` to fall
   * through to the base locale. `source` names the rung in the fallback log;
   * omitting it silences reporting for a rung that is the base pack itself.
   */
  const renderFrom = (
    {
      messages,
      locale,
      source,
    }: {
      messages: Readonly<Record<string, Message>>;
      locale: string;
      source?: string;
    },
    messageId: string,
    inputs: Record<string, unknown>,
  ): string | undefined => {
    const message = messages[messageId];
    if (message === undefined) {
      if (source !== undefined) {
        reportFallback(messageId, `the ${source} does not translate it`);
      }
      return undefined;
    }
    try {
      const rendered = renderMessage(message, { locale, inputs });
      if (rendered !== undefined) return rendered;
      if (source !== undefined) {
        reportFallback(messageId, `no variant matched in the ${source}`);
      }
    } catch (error) {
      if (source !== undefined) {
        reportFallback(
          messageId,
          `the ${source} message failed to render`,
          error,
        );
      }
    }
    return undefined;
  };

  const renderFromBase = (
    messageId: string,
    inputs: Record<string, unknown>,
  ): string => {
    const baseMessage = basePack.messages[messageId];
    if (baseMessage === undefined) {
      logger.warn("No base-pack message for {messageId}", { messageId });
      return messageId;
    }
    try {
      const rendered = renderMessage(baseMessage, {
        locale: basePack.locale,
        inputs,
      });
      if (rendered !== undefined) return rendered;
      logger.warn("Base-pack message {messageId} matched no variant", {
        messageId,
        inputs,
      });
    } catch (error) {
      logger.warn("Base-pack message {messageId} failed to render", {
        messageId,
        inputs,
        error,
      });
    }
    return messageId;
  };

  const translate = (
    messageId: string,
    inputs: Record<string, unknown> = {},
  ): string =>
    renderFrom(
      {
        messages: activePack.messages,
        locale: activePack.locale,
        source: activePack === basePack ? undefined : "active pack",
      },
      messageId,
      inputs,
    ) ?? renderFromBase(messageId, inputs);

  const translateTarget = (
    messageId: string,
    inputs: Record<string, unknown> = {},
  ): string =>
    (target === undefined
      ? undefined
      : renderFrom(
          { ...target, source: "target-locale subset" },
          messageId,
          inputs,
        )) ?? renderFromBase(messageId, inputs);

  return {
    install(pack) {
      activePack = pack;
      reportedFallbacks.clear();
      logger.info(
        "Active Language Pack is {locale} with {messageCount} messages",
        {
          locale: pack.locale,
          messageCount: Object.keys(pack.messages).length,
        },
      );
    },
    reset() {
      activePack = basePack;
      target = undefined;
      reportedFallbacks.clear();
    },
    setLogger(nextLogger) {
      logger = nextLogger;
    },
    setTargetLocale(locale) {
      const messages = targetLocaleMessages[locale];
      target = messages === undefined ? undefined : { locale, messages };
      reportedFallbacks.clear();
    },
    translate,
    translateTarget,
  };
}

function renderMessage(
  message: Message,
  { locale, inputs }: RenderMessageOptions,
): string | undefined {
  if (typeof message === "string") return message;

  const variables: Variables = {};
  const inputNames = new Set(
    message.declarations
      .filter((declaration) => declaration.type === "input")
      .map((declaration) => declaration.name),
  );
  for (const name of inputNames) {
    variables[name] = inputs[name];
  }
  for (const declaration of message.declarations) {
    if (declaration.type === "local") {
      variables[declaration.name] = resolveExpression(
        declaration.value,
        locale,
        variables,
      );
    }
  }

  const variant = message.variants.find((candidate) =>
    candidate.matches.every(
      (match) =>
        match.type === "catchall" ||
        matchesLiteral(
          variables[match.key],
          match.value,
          inputNames.has(match.key),
        ),
    ),
  );
  return variant?.pattern
    .map((expression) =>
      String(resolveExpression(expression, locale, variables)),
    )
    .join("");
}

function matchesLiteral(
  value: unknown,
  literal: string,
  isInput: boolean,
): boolean {
  if (value === literal) return true;
  if (!isInput) return false;
  const numericLiteral = parseNumericLiteral(literal);
  return numericLiteral !== undefined && value === numericLiteral;
}

function resolveExpression(
  expression: Expression,
  locale: string,
  variables: Variables,
): unknown {
  switch (expression.type) {
    case "text":
    case "literal":
      return expression.value;
    case "variable":
      return variables[expression.name];
    case "formatter": {
      const argument = resolveExpression(
        expression.argument,
        locale,
        variables,
      );
      const options = Object.fromEntries(
        Object.entries(expression.options).map(([name, value]) => [
          name,
          resolveExpression(value, locale, variables),
        ]),
      );
      const formatterName = expression.name;
      switch (formatterName) {
        case "plural":
          return new Intl.PluralRules(
            locale,
            options as Intl.PluralRulesOptions,
          ).select(Number(argument));
        case "number":
          return new Intl.NumberFormat(
            locale,
            options as Intl.NumberFormatOptions,
          ).format(Number(argument));
        case "datetime":
          return new Intl.DateTimeFormat(
            locale,
            options as Intl.DateTimeFormatOptions,
          ).format(toEpochMilliseconds(argument));
        default:
          formatterName satisfies never;
          return undefined;
      }
    }
  }
}

/** Coerces a datetime formatter argument (epoch number or ISO 8601 string) to epoch milliseconds. */
function toEpochMilliseconds(argument: unknown): number {
  if (typeof argument === "number") return argument;
  const text = String(argument);
  try {
    return Temporal.Instant.from(text).epochMilliseconds;
  } catch {
    return Temporal.PlainDate.from(text).toZonedDateTime("UTC")
      .epochMilliseconds;
  }
}
