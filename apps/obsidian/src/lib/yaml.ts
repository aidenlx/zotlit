// Obsidian's `parseYaml` for Effect code: a parse failure is a typed error, not a throw.
import { parseYaml } from "obsidian";

import { Effect, Schema } from "@/lib/effect";

/** `parseYaml` threw; `cause` holds the parser's error. */
export class YamlError extends Schema.TaggedError<YamlError>()("YamlError", {
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

/** Parse YAML with Obsidian's parser. */
export function parseYamlEffect(
  source: string,
): Effect.Effect<unknown, YamlError> {
  return Effect.try({
    try: (): unknown => parseYaml(source),
    catch: (cause) =>
      new YamlError({
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });
}
