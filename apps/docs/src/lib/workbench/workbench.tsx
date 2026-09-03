// The standalone Template Workbench: one master Profile document behind a
// header, three columns, and the result the reader would get.

import { useEffect, useState } from "react";

import { WorkbenchDocumentController } from "@zotlit/workbench/document";
import type { WorkbenchSliceRange } from "@zotlit/workbench/document";
import {
  DEFAULT_PROFILE_SOURCE,
  SAMPLE_ITEMS,
  createRenderScheduler,
} from "@zotlit/workbench/render";
import type { ProfileRenderResult } from "@zotlit/workbench/render";

import { m } from "@/paraglide/messages.js";

import { PaperFields } from "./paper-fields";
import type { SampleItem } from "./paper-fields";
import { startRenderWorker } from "./render-client";
import { SliceEditor } from "./slice-editor";
import { ensureTemporal } from "./temporal";

export function Workbench() {
  const [controller] = useState(
    () => new WorkbenchDocumentController(DEFAULT_PROFILE_SOURCE),
  );
  const [result, setResult] = useState<ProfileRenderResult | null>(null);
  const [scheduler] = useState(() =>
    createRenderScheduler({
      startWorker: startRenderWorker,
      onResult: setResult,
    }),
  );
  const [revision, setRevision] = useState(0);
  const [sample, setSample] = useState<SampleItem>(SAMPLE_ITEMS[0]!);
  const [advanced, setAdvanced] = useState(false);
  const [reveal, setReveal] = useState<WorkbenchSliceRange | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [profile, setProfile] = useState<{
    name: string;
    description: string;
  }>({ name: m.workbench_title(), description: "" });

  useEffect(
    () => controller.subscribe(() => setRevision((n) => n + 1)),
    [controller],
  );
  useEffect(() => () => scheduler[Symbol.dispose](), [scheduler]);
  useEffect(() => {
    void ensureTemporal();
  }, []);

  useEffect(() => {
    scheduler.request({ source: controller.source, snapshot: sample });
  }, [scheduler, controller, sample, revision]);

  // The header keeps the last name the document parsed with, so repairing an
  // invalid draft does not blank the page it is on.
  const manifest = controller.document?.manifest;
  useEffect(() => {
    if (manifest) {
      setProfile({
        name: manifest.name,
        description: manifest.description ?? "",
      });
    }
  }, [manifest]);

  const problem = controller.problems[0];
  const previewProblem = result?.diagnostics[0];

  function download() {
    const url = URL.createObjectURL(
      new Blob([controller.source], { type: "text/markdown" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `zotlit-profile.${manifest?.id ?? "profile"}.md`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function act(run: () => void) {
    return () => {
      setMenuOpen(false);
      run();
    };
  }

  return (
    <div className="flex h-dvh flex-col bg-fd-background text-fd-foreground">
      <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-fd-border px-6 py-3">
        <h1 className="font-serif text-xl font-medium">{profile.name}</h1>
        <p className="text-fd-muted-foreground italic">{profile.description}</p>
        <div className="ml-auto flex items-center gap-2">
          <label
            htmlFor="workbench-sample"
            className="font-mono text-[0.68rem] font-semibold tracking-widest text-fd-muted-foreground uppercase"
          >
            {m.workbench_showing_label()}
          </label>
          <select
            id="workbench-sample"
            className="max-w-[22rem] truncate border border-fd-border bg-fd-card px-2 py-1.5 text-sm"
            value={sample.item.key}
            onChange={(event) => {
              setSample(
                SAMPLE_ITEMS.find(
                  (item) => item.item.key === event.target.value,
                )!,
              );
            }}
          >
            {SAMPLE_ITEMS.map((item) => (
              <option key={item.item.key} value={item.item.key}>
                {item.item.title ?? item.item.key}
              </option>
            ))}
          </select>
          <span className="border border-fd-border px-1.5 py-0.5 font-mono text-[0.6rem] font-semibold tracking-widest text-fd-muted-foreground uppercase">
            {m.workbench_sample_badge()}
          </span>
          <div className="relative">
            <button
              type="button"
              aria-label={m.workbench_more_actions()}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
              className="cursor-pointer border border-transparent px-2 py-1.5 text-fd-muted-foreground hover:border-fd-border"
            >
              <span aria-hidden>···</span>
            </button>
            {menuOpen && (
              <div
                role="menu"
                aria-label={m.workbench_more_actions()}
                className="absolute right-0 z-10 mt-1 flex w-56 flex-col border border-fd-border bg-fd-card p-1 shadow-[4px_4px_0_0_var(--color-fd-border)]"
              >
                <button
                  type="button"
                  role="menuitem"
                  disabled={!controller.canUndo}
                  onClick={act(() => controller.undo())}
                  className="cursor-pointer px-3 py-1.5 text-left text-sm hover:bg-fd-accent disabled:cursor-default disabled:text-fd-muted-foreground"
                >
                  {m.workbench_undo()}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={act(download)}
                  className="cursor-pointer px-3 py-1.5 text-left text-sm hover:bg-fd-accent"
                >
                  {m.workbench_download()}
                </button>
                <button
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={advanced}
                  onClick={act(() => {
                    // A reveal belongs to the problem the reader clicked, so
                    // reopening Advanced from here starts on the caret instead.
                    setReveal(null);
                    setAdvanced((on) => !on);
                  })}
                  className="cursor-pointer px-3 py-1.5 text-left text-sm hover:bg-fd-accent"
                >
                  {m.workbench_advanced()}
                </button>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={download}
            className="cursor-pointer bg-fd-primary px-4 py-1.5 text-sm font-medium text-fd-primary-foreground"
          >
            {m.workbench_download()}
          </button>
        </div>
      </header>

      <main className="grid min-h-0 flex-1 gap-5 px-6 py-5 lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)_minmax(0,26rem)]">
        <PaperFields snapshot={sample} />

        <section className="flex min-h-0 flex-col">
          {advanced ? (
            <>
              <h2 className="font-serif text-[1.06rem] font-medium">
                {m.workbench_advanced_heading()}
              </h2>
              <p className="mt-1 mb-2.5 text-xs text-fd-muted-foreground">
                {m.workbench_advanced_lede()}
              </p>
            </>
          ) : (
            <>
              <div
                role="tablist"
                aria-label={m.workbench_title()}
                className="flex gap-5 border-b border-fd-border"
              >
                <span
                  role="tab"
                  aria-selected
                  tabIndex={0}
                  className="-mb-px border-b-2 border-fd-primary pb-1.5 font-serif text-[1.06rem] font-medium"
                >
                  {m.workbench_tab_note()}
                </span>
                {[
                  m.workbench_tab_properties(),
                  m.workbench_tab_name_and_folder(),
                ].map((label) => (
                  <span
                    key={label}
                    role="tab"
                    aria-selected={false}
                    aria-disabled
                    className="-mb-px pb-1.5 font-serif text-[1.06rem] font-medium text-fd-muted-foreground/60"
                  >
                    {label}
                  </span>
                ))}
              </div>
              <p className="mt-2 mb-2.5 text-xs text-fd-muted-foreground">
                {m.workbench_note_lede()}
              </p>
            </>
          )}
          <div className="flex min-h-0 flex-1 flex-col border border-fd-border bg-fd-card">
            <SliceEditor
              key={advanced ? "advanced" : "note"}
              controller={controller}
              slice={advanced ? "advanced" : "note"}
              label={
                advanced
                  ? m.workbench_advanced_heading()
                  : m.workbench_tab_note()
              }
              reveal={advanced ? reveal : null}
            />
          </div>
        </section>

        <section className="flex min-h-0 flex-col">
          <h2 className="font-serif text-[1.06rem] font-medium">
            {m.workbench_result_heading()}
          </h2>
          <p className="mt-1 mb-2.5 text-xs text-fd-muted-foreground">
            {m.workbench_result_lede()}
          </p>
          <div className="min-h-0 flex-1 overflow-auto border border-fd-border bg-fd-card p-5 shadow-[6px_6px_0_0_var(--color-fd-border)]">
            {result ? (
              <>
                <p className="mb-3 font-mono text-xs text-fd-muted-foreground">
                  <span className="sr-only">
                    {m.workbench_result_filename()}:{" "}
                  </span>
                  {result.filename}
                </p>
                {previewProblem && (
                  <p className="mb-3 border-l-2 border-fd-primary bg-fd-accent/40 px-3 py-2 text-xs">
                    <strong className="font-medium">
                      {m.workbench_preview_problem()}
                    </strong>{" "}
                    {previewProblem.message}
                  </p>
                )}
                <pre
                  aria-label={m.workbench_result_body()}
                  className="font-mono text-[0.8rem] leading-relaxed whitespace-pre-wrap"
                >
                  {result.creationBody}
                </pre>
              </>
            ) : (
              <p className="text-sm text-fd-muted-foreground">
                {m.workbench_result_pending()}
              </p>
            )}
          </div>
        </section>
      </main>

      {problem && (
        <section
          aria-label={m.workbench_problems_heading()}
          className="shrink-0 border-t border-fd-border bg-fd-accent/40 px-6 py-3"
        >
          <p className="font-mono text-[0.68rem] font-semibold tracking-widest text-fd-primary uppercase">
            {m.workbench_problems_heading()}
          </p>
          <p className="mt-1 text-sm">
            {problem.message}{" "}
            <span className="text-fd-muted-foreground">{problem.recovery}</span>{" "}
            <button
              type="button"
              onClick={() => {
                setAdvanced(true);
                // A fresh object every time, so selecting the same problem
                // twice reveals it again.
                setReveal(problem.range ? { ...problem.range } : null);
              }}
              className="cursor-pointer underline underline-offset-2"
            >
              {m.workbench_problems_where_advanced()}
            </button>
          </p>
        </section>
      )}
    </div>
  );
}
