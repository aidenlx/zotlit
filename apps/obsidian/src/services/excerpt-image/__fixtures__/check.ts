// The one condition check every browser trial runs: a failed check throws the
// statement that explains it out of the Electron renderer, where an assertion
// library's own report would not name the state that was measured. Trial
// entries are bundled for that renderer, so this imports nothing.
export function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
