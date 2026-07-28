// The minimal structured-logging port consumers adapt their own logger to.

export type LogProperties = Readonly<Record<string, unknown>>;

export type StructuredLogger = {
  debug(message: string, properties?: LogProperties): void;
  info(message: string, properties?: LogProperties): void;
  warn(message: string, properties?: LogProperties): void;
  error(message: string, properties?: LogProperties): void;
};

const ignore = (): void => {};

export const noopLogger: StructuredLogger = {
  debug: ignore,
  info: ignore,
  warn: ignore,
  error: ignore,
};
