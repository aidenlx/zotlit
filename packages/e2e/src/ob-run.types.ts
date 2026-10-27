import { obRun } from "./obsidian-cli.ts";

// Typecheck is the seam: these calls are compiled, never executed.
function proofs() {
  void obRun("vault", ({ zotlit }) =>
    zotlit.services.profile.getBuiltInSource(),
  );
  void obRun("vault", ({ zotlit }) => {
    // @ts-expect-error Removed service members must fail before a desktop run.
    return zotlit.services.noSuchService;
  });
  // @ts-expect-error Args follow the callback's declared input.
  void obRun("vault", (_, args: { path: string }) => args.path, { path: 1 });
  // @ts-expect-error A Map cannot cross the JSON transport.
  void obRun("vault", () => new Map<string, string>());
  // @ts-expect-error A function cannot cross the JSON transport.
  void obRun("vault", () => ({ action: () => true }));
}
void proofs;
