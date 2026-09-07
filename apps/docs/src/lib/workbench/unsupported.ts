// What the web host refuses: the Profile problems and the bundled partials an
// Eta or JavaScript document carries, each as one line for the handoff screen.
// @see docs/adr/0033-web-workbench-is-public-and-standalone.md

import type { TemplateDependenciesResponse } from "@zotlit/workbench/bridge";
import type { WorkbenchProblem } from "@zotlit/workbench/document";

import { problemText } from "./problems";

/** One line of the refusal, in the words the reader gets. */
export interface UnsupportedReason {
  readonly id: string;
  readonly message: string;
}

/** The codes this screen answers, which are the web host's own three. */
export function unsupportedProblems(
  problems: readonly WorkbenchProblem[],
): readonly UnsupportedReason[] {
  return problems
    .filter(
      ({ code }) =>
        code === "unsupported-language" ||
        code === "unsupported-partial-language" ||
        code === "unsupported-js",
    )
    .map((problem) => ({
      id: `${problem.code}:${problem.range?.from ?? ""}`,
      message: problemText(problem).message,
    }));
}

/**
 * The same refusal for a partial the vault holds rather than the manifest: a
 * connected bundle is read before anything is compiled, so an Eta dependency
 * reaches this screen instead of the render that would have run it. A bridge
 * that refuses to hand such a partial over reports it as a diagnostic in the
 * same bundle, and its own sentence is the only wording that names it.
 */
export function unsupportedDependencies(
  dependencies: TemplateDependenciesResponse | undefined,
): readonly UnsupportedReason[] {
  return [
    ...(dependencies?.templates ?? [])
      .filter(({ language }) => language !== "liquid")
      .map(({ name }) => ({
        id: `partial:${name}`,
        message: problemText({
          code: "unsupported-partial-language",
          params: { name },
          slice: "advanced",
        }).message,
      })),
    ...(dependencies?.diagnostics ?? [])
      .filter(({ code }) => code === "unsupported-dependency")
      .map(({ message }) => ({ id: `dependency:${message}`, message })),
  ];
}
