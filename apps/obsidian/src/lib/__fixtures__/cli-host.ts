// A CliHost for tests: it keeps each command a namespace registers, so a
// case reads its help and runs its handler as an Effect.
import type { CliCommand, CliHost } from "@/lib/cli-command";

export function fakeCliHost() {
  const commands = new Map<string, CliCommand>();
  const host: CliHost = {
    registerCliCommand: (name, command) => {
      commands.set(name, command);
    },
  };
  /** The command registered as `name`; throws when none is. */
  const command = (name: string): CliCommand => {
    const registered = commands.get(name);
    if (!registered) throw new Error(`${name} is not registered`);
    return registered;
  };
  return { host, commands, command };
}
