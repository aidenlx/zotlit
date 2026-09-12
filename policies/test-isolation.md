# Test isolation

- **State:** Share immutable fixtures. Isolate mutations or restore the original state on every exit.
- **Lifetime:** Use [scoped disposal](resource-disposal.md). Restore global stubs after their last consumer closes, including sibling fixtures.
- **Setup cost:** Load only dependencies the assertion needs. Initialize shared infrastructure once and reset observations per test, unless initialization is the subject.
- **Order dependence:** Verify fixes in isolated and combined uncached runs, with reproducible shuffling and normal parallelism. Reserve serialization for a documented shared-resource constraint.
