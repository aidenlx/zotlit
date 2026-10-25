# Resource disposal

Explicit Resource Management is stage-4 and available in every runtime this repo targets.

`using` / `await using` for scope-bound lifetime. Manual `[Symbol.asyncDispose]()` for field-stored resources or conditional disposal. Prefix with underscore when the binding exists only for its disposal side-effect (`using _harness = harness`).

`Disposable` when cleanup is synchronous; `AsyncDisposable` only when disposal genuinely awaits. A synchronous body wrapped in `Promise.resolve()` just to satisfy `AsyncDisposable` is the smell — use `Symbol.dispose` and let `AsyncDisposableStack.use()` handle it.

`DisposableStack` / `AsyncDisposableStack` for multi-resource coordination. Prefer `const x = stack.use(acquire())` over a separate acquisition and `void stack.use(x)`: the acquisition expression goes inside the call, tracked and bound in one statement. `void stack.use(held)` only when the resource is already held and needs no binding. `stack.adopt(value, onDispose)` for resources without a `@@dispose` method; `stack.defer(callback)` for bare cleanup callbacks. Safe-constructor pattern: `await using stack` locally, then `stack.move()` on the success path — partial construction rolls back automatically.

## Effect code

Inside Effect, a resource's lifetime is its `Scope`. Acquire with `Effect.acquireRelease` (or `Layer.effect` for a service's resources), and register bare cleanup with `Effect.addFinalizer`. A `Disposable` from outside Effect, such as an Obsidian event registration, enters through `Effect.acquireDisposable` (wrap a synchronous acquire in `Effect.sync`, a Promise in `Effect.tryPromise`), which also takes an `AsyncDisposable`. A failed release reaches the code that closes the scope, which logs it, and the remaining finalizers still run. In `apps/obsidian`, `zotlit-services/effect-native-resources` rejects a stack, `using`, or manual dispose in an Effect generator's body; elsewhere the reviewer checks it.

Stacks and scopes meet only at the boundary where non-Effect code owns an Effect lifetime: `openScope()` and `buildRuntime()` put the scope's close, or the runtime's disposal, on the caller's stack (`stack.defer(…)`), and `serviceLayer` puts a legacy `Service`'s `[Symbol.asyncDispose]` on a scope.

In tests: `using` / `await using` for routine cleanup; manual `[Symbol.dispose]()` calls only when exercising disposal behavior itself.

Gotcha: `await using` does not support destructuring — acquire first, then destructure (`await using h = …; const { a, b } = h;`).
