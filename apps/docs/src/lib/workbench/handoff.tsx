// The one screen an Eta or JavaScript Profile gets. The web host renders
// Liquid and JSON-e only, so such a document is neither edited nor rendered
// here: it is explained, offered back unchanged, and pointed at Obsidian.
// @see docs/adr/0033-web-workbench-is-public-and-standalone.md

import type { TemplateDependenciesResponse } from "@zotlit/workbench/bridge";
import type { WorkbenchProblem } from "@zotlit/workbench/document";

import { m } from "@/paraglide/messages.js";

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

export interface ProfileHandoffProps {
  /** Why the web host cannot take this Profile, one line per reason. */
  reasons: readonly UnsupportedReason[];
  /** Downloads the source as it was read, which is the only copy this page holds. */
  onDownload: () => void;
  onImport: () => void;
}

export function ProfileHandoff({
  reasons,
  onDownload,
  onImport,
}: ProfileHandoffProps) {
  return (
    <main className="flex h-dvh flex-col items-center justify-center bg-fd-background px-6 text-fd-foreground">
      <section
        aria-labelledby="workbench-handoff"
        className="flex w-full max-w-xl flex-col gap-4 border border-fd-border bg-fd-card p-6 shadow-[6px_6px_0_0_var(--color-fd-border)]"
      >
        <h1 id="workbench-handoff" className="font-serif text-xl font-medium">
          {m.workbench_unsupported_heading()}
        </h1>
        <p className="text-sm">{m.workbench_unsupported_lede()}</p>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-fd-muted-foreground">
          {reasons.map((reason) => (
            <li key={reason.id}>{reason.message}</li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onDownload}
            className="cursor-pointer bg-fd-primary px-4 py-1.5 text-sm font-medium text-fd-primary-foreground"
          >
            {m.workbench_unsupported_download()}
          </button>
          <button
            type="button"
            onClick={onImport}
            className="cursor-pointer border border-fd-border px-4 py-1.5 text-sm"
          >
            {m.workbench_import()}
          </button>
          <a
            href="/docs/concepts/javascript-templates"
            className="text-sm text-fd-primary underline underline-offset-2"
          >
            {m.workbench_unsupported_docs()}
          </a>
        </div>
      </section>
    </main>
  );
}
