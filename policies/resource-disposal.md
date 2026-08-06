# Resource disposal

Explicit Resource Management is stage-4 and available in every runtime this repo targets.

`using` / `await using` for scope-bound lifetime. Manual `[Symbol.asyncDispose]()` for field-stored resources or conditional disposal. Prefix with underscore when the binding exists only for its disposal side-effect (`using _harness = harness`).

`DisposableStack` / `AsyncDisposableStack` for multi-resource coordination. Prefer `const x = stack.use(acquire())` over a separate acquisition and `void stack.use(x)`: the acquisition expression goes inside the call, tracked and bound in one statement. `void stack.use(held)` only when the resource is already held and needs no binding. `stack.adopt(value, onDispose)` for resources without a `@@dispose` method; `stack.defer(callback)` for bare cleanup callbacks. Safe-constructor pattern: `await using stack` locally, then `stack.move()` on the success path — partial construction rolls back automatically.

In tests: `using` / `await using` for routine cleanup; manual `[Symbol.dispose]()` calls only when exercising disposal behavior itself.

Gotcha: `await using` does not support destructuring — acquire first, then destructure (`await using h = …; const { a, b } = h;`).
