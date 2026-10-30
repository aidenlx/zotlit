import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import { noTacit } from "../../scripts/oxlint-plugin-effect-style";

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({
  languageOptions: { parserOptions: { lang: "ts" } },
});

const effect = 'import { Effect, Stream, Layer, Option } from "effect";\n';
const tacit = [{ messageId: "tacit" }];
const flow = [{ messageId: "flow" }];

// Failure modes: a function passed by name to a combinator's callback goes
// unflagged, or a value argument (an Effect, a Layer, a tag, a data-first
// `self`, an options object) is flagged as a callback.
tester.run("no-tacit", noTacit, {
  valid: [
    `${effect}effect.pipe(Effect.map((x) => fn(x)))`,
    `${effect}Effect.map(effect, (x) => fn(x))`,
    `${effect}Effect.forEach(items, (item, i) => save(item, i), { concurrency: 2 })`,
    `${effect}Stream.filter(service.changes, (event) => isReady(event))`,
    // Value arguments: an Effect, a Layer, a data-first `self`, a tag.
    `${effect}effect.pipe(Effect.andThen(next))`,
    `${effect}effect.pipe(Effect.tap(log))`,
    `${effect}layer.pipe(Layer.provide(base))`,
    `${effect}Effect.map(effect, (x) => x + 1)`,
    `${effect}effect.pipe(Effect.catchTag("NotFound", () => Effect.void))`,
    // A zero-argument thunk gets no argument to misread.
    `${effect}Effect.sync(compute)`,
    `${effect}Option.getOrElse(option, makeDefault)`,
    // Not an `effect` module: a global, a type-only import, a local name.
    "items.map(format)",
    "Array.from(items).map(format)",
    'import type { Effect } from "effect";\nEffect.map(fn)',
    'import { Effect } from "./effect";\nEffect.map(fn)',
    "const Effect = { map: (f) => f };\nEffect.map(fn)",
    // `pipe` is not `flow`.
    'import { pipe } from "effect";\npipe(x, (v) => f(v))',
    'import { flow } from "./flow";\nflow(f, g)',
  ],
  invalid: [
    {
      code: `${effect}effect.pipe(Effect.mapError(toDbUnavailable))`,
      errors: tacit,
    },
    { code: `${effect}fiber.pipe(Effect.flatMap(Fiber.join))`, errors: tacit },
    {
      code: `${effect}effect.pipe(Effect.flatMap(Effect.fail))`,
      errors: tacit,
    },
    {
      code: `${effect}effect.pipe(Effect.catchDefect(dieOfDefect))`,
      errors: tacit,
    },
    { code: `${effect}stream.pipe(Stream.runForEach(push))`, errors: tacit },
    { code: `${effect}stream.pipe(Stream.filter(Boolean))`, errors: tacit },
    // Data-first: the callback is still the last argument.
    { code: `${effect}Stream.filter(service.changes, isReady)`, errors: tacit },
    { code: `${effect}Effect.map(effect, this.format)`, errors: tacit },
    // The callback before an options object.
    {
      code: `${effect}Effect.forEach(items, save, { concurrency: 2 })`,
      errors: tacit,
    },
    { code: `${effect}Effect.forEach(save, { discard: true })`, errors: tacit },
    // The tag is a value; the handler after it is a callback.
    {
      code: `${effect}effect.pipe(Effect.catchTag("NotFound", recover))`,
      errors: tacit,
    },
    // A callback that receives an argument: the AbortSignal.
    { code: `${effect}Effect.promise(load)`, errors: tacit },
    // Renamed and namespace imports.
    {
      code: 'import { Array as Arr } from "effect";\nArr.map(items, format)',
      errors: tacit,
    },
    {
      code: 'import * as E from "effect/Effect";\neffect.pipe(E.map(format))',
      errors: tacit,
    },
    // flow from `effect` and from `effect/Function`.
    {
      code: 'import { flow } from "effect";\nconst g = flow(f, h)',
      errors: flow,
    },
    {
      code: 'import { flow as compose } from "effect/Function";\nconst g = compose(f, h)',
      errors: flow,
    },
    {
      code: 'import { Function } from "effect";\nconst g = Function.flow(f, h)',
      errors: flow,
    },
  ],
});
