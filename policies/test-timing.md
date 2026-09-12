# Test timing

- **Completion:** Await an operation's completion signal instead of fixed sleeps or counted microtask flushes.
- **Clocks:** Drive time-dependent behavior with fake time. Attach rejection assertions before advancing it.
- **Schedulers:** Await each subsystem's readiness separately. Advance timers inside the UI framework's test-update scope.
- **Polling:** Bound retries and throw the last assertion error on exhaustion. Check absence after the triggering operation completes.
- **Events:** Inject controlled events at the tested boundary; use real external delivery when delivery itself is the subject.
