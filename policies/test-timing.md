# Test timing

- **Completion:** Await an operation's completion signal instead of fixed sleeps or counted microtask flushes.
- **Clocks:** Drive time-dependent behavior with fake time. Attach rejection assertions before advancing it. Advance once past a known deadline; poll only for an arrival whose time the test cannot name.
- **Schedulers:** Await each subsystem's readiness separately. Advance timers inside the UI framework's test-update scope.
- **Polling:** Poll until every field the assertion reads holds; bound the retries and throw the last assertion error on exhaustion. An internal completion signal (a refreshed, ready, or indexed promise) gates entry to the poll; the poll's own predicate ends it. Check absence after the triggering operation completes.
- **Events:** Inject controlled events at the tested boundary; use real external delivery when delivery itself is the subject.
- **Effect:** Time inside Effect is virtual: a fake that takes time sleeps on the `TestClock`, and the case advances it with `TestClock.adjust`. A `Queue` or `Deferred` the fake offers to is the completion signal; check absence after taking the signal of the operation that would have caused it. Let virtual work a case started finish before the case ends: a scope close waits for uninterruptible work, and the clock stops when the case does. `it.live` only when the subject is real external async.
