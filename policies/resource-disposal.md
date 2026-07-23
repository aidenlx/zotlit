# Resource disposal

Explicit Resource Management is stage-4 and available in all target environments.

`using` / `await using` for scope-bound lifetime. Manual `[Symbol.asyncDispose]()` for field-stored resources or conditional disposal.

`DisposableStack` / `AsyncDisposableStack` for multi-resource coordination. Use the safe-constructor pattern: `await using stack` locally, then `stack.move()` on the success path, so partial construction rolls back.

In tests: `await using` for routine cleanup; manual calls only when exercising disposal behavior itself.

Gotcha: `await using` does not support destructuring — acquire first, then destructure (`await using h = …; const { a, b } = h;`).
