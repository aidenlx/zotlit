import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useRenderScheduler, useRenderState } from "./editor";
import { PreviewControls } from "./preview-controls";
import { mount } from "./test-host";
import type { Mounted } from "./test-host";
import { m } from "./test-messages";

import { SAMPLE_ANNOTATIONS, SAMPLE_ITEMS } from "#/render/index";

const PAPER = SAMPLE_ITEMS[0]!;
const OTHER_PAPER = SAMPLE_ITEMS[1]!;
const EXAMPLE = SAMPLE_ANNOTATIONS[0]!;
const OTHER_EXAMPLE = SAMPLE_ANNOTATIONS[1]!;

/** The controls a reader presses, beside what the result surfaces read. */
function Preview() {
  const scheduler = useRenderScheduler();
  const { result, busy, stale } = useRenderState();
  return (
    <>
      <PreviewControls busy={busy} onRun={() => scheduler.run()} />
      <div
        data-testid="result"
        data-busy={String(busy)}
        data-stale={String(stale)}
      >
        {result?.creationBody ?? ""}
      </div>
      <div data-testid="diagnostics">
        {(result?.diagnostics ?? [])
          .map(({ code, message }) => `${code}: ${message ?? ""}`)
          .join("\n")}
      </div>
    </>
  );
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** The tree mounted with a paper loaded, which is when rendering may start. */
function open({ live = true }: { live?: boolean } = {}): Mounted {
  const mounted = mount(<Preview />, {
    state: { preview: { mode: "create", live } },
  });
  render(mounted.ui);
  act(() =>
    mounted.scheduler.setInput({ snapshot: PAPER, annotation: EXAMPLE }),
  );
  return mounted;
}

const advance = (ms: number) =>
  act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

const output = () => screen.getByTestId("result");
const diagnostics = () => screen.getByTestId("diagnostics");
const press = (label: string) => fireEvent.click(screen.getByText(label));

/** Whatever the refresh setting is, the way a reader starts one render. */
const startRender = async (live: boolean) => {
  if (live) await advance(300);
  else press(m.workbench_preview_run());
};

it("renders after the quiet time and no sooner, and at once on Run", async () => {
  using mounted = open();
  const { host, controller } = mounted;
  await advance(299);
  expect(host.renders).toHaveLength(0);
  act(() => void controller.setManifestKey("name", "Revised"));
  await advance(299);
  expect(host.renders).toHaveLength(0);
  await advance(1);
  expect(host.renders).toHaveLength(1);
  expect(host.renders[0]!.request.source).toContain("name: Revised");
  expect(output().dataset["busy"]).toBe("true");
  await act(async () => host.renders[0]!.answer({ creationBody: "First" }));
  expect(output().textContent).toBe("First");
  expect(output().dataset["busy"]).toBe("false");
  fireEvent.input(screen.getByLabelText(m.workbench_preview_refresh()), {
    target: { value: "demand" },
  });
  press(m.workbench_preview_run());
  expect(host.renders).toHaveLength(2);
});

it("lets the render in flight finish after selecting On demand and starts no other", async () => {
  using mounted = open();
  const { host, controller } = mounted;
  await advance(300);
  expect(host.renders).toHaveLength(1);
  fireEvent.input(screen.getByLabelText(m.workbench_preview_refresh()), {
    target: { value: "demand" },
  });
  expect(screen.getByRole("status").textContent).toBe(
    m.workbench_preview_paused(),
  );
  // On demand pauses live rendering; the render already running is still running.
  expect(output().dataset["busy"]).toBe("true");
  // The refresh setting leaves the input alone, so that render still answers for it.
  await act(async () => host.renders[0]!.answer({ creationBody: "In flight" }));
  expect(output().textContent).toBe("In flight");
  expect(output().dataset["busy"]).toBe("false");
  act(() => void controller.setManifestKey("name", "Typed while paused"));
  await advance(1000);
  expect(host.renders).toHaveLength(1);
  expect(output().dataset["stale"]).toBe("true");
});

it("renders only on Run while the refresh setting is On demand", async () => {
  using mounted = open({ live: false });
  const { host, controller } = mounted;
  act(() => void controller.setManifestKey("name", "Held back"));
  await advance(1000);
  expect(host.renders).toHaveLength(0);
  press(m.workbench_preview_run());
  expect(host.renders).toHaveLength(1);
  expect(host.renders[0]!.request.source).toContain("name: Held back");
});

const SUPERSEDED: readonly {
  what: string;
  supersede: (mounted: Mounted) => void;
}[] = [
  {
    what: "source",
    supersede: ({ controller }) =>
      void controller.setManifestKey("name", "Newer"),
  },
  {
    what: "paper",
    supersede: ({ scheduler }) =>
      scheduler.setInput({ snapshot: OTHER_PAPER, annotation: EXAMPLE }),
  },
  {
    what: "annotation example",
    supersede: ({ scheduler }) =>
      scheduler.setInput({ snapshot: PAPER, annotation: OTHER_EXAMPLE }),
  },
  {
    what: "preview mode",
    supersede: ({ store }) => store.getState().setPreview({ mode: "update" }),
  },
];

it.each(
  SUPERSEDED.flatMap((entry) =>
    [true, false].map((live) => ({
      ...entry,
      live,
      mode: live ? "Live" : "On demand",
    })),
  ),
)(
  "never shows the result for a superseded $what in $mode",
  async ({ live, supersede }) => {
    using mounted = open({ live });
    await startRender(live);
    expect(mounted.host.renders).toHaveLength(1);
    act(() => supersede(mounted));
    // The render it was waiting on is dropped, so nothing is running any more.
    expect(output().dataset["busy"]).toBe("false");
    await act(async () =>
      mounted.host.renders[0]!.answer({ creationBody: "Superseded" }),
    );
    expect(output().textContent).toBe("");
    await startRender(live);
    expect(mounted.host.renders).toHaveLength(2);
    await act(async () =>
      mounted.host.renders[1]!.answer({ creationBody: "Current" }),
    );
    expect(output().textContent).toBe("Current");
  },
);

it.each([
  { live: true, mode: "Live" },
  { live: false, mode: "On demand" },
])(
  "reads a delivered result as stale once another annotation example is chosen in $mode",
  async ({ live }) => {
    using mounted = open({ live });
    await startRender(live);
    await act(async () =>
      mounted.host.renders[0]!.answer({ creationBody: "First example" }),
    );
    expect(output().textContent).toBe("First example");
    expect(output().dataset["stale"]).toBe("false");
    act(() =>
      mounted.scheduler.setInput({
        snapshot: PAPER,
        annotation: OTHER_EXAMPLE,
      }),
    );
    // The result still on screen describes the example the reader has left.
    expect(output().textContent).toBe("First example");
    expect(output().dataset["stale"]).toBe("true");
  },
);

it("starts no render and publishes no state once disposed", async () => {
  const mounted = open();
  const { host, controller, scheduler } = mounted;
  await advance(300);
  await act(async () => host.renders[0]!.answer({ creationBody: "Last" }));
  mounted[Symbol.dispose]();
  // Run pressed as the view closes arrives after the scheduler is disposed.
  act(() => scheduler.run());
  act(() => scheduler.setInput({ snapshot: null }));
  act(() => void controller.setManifestKey("name", "Typed after closing"));
  await advance(1000);
  expect(host.renders).toHaveLength(1);
  expect(output().textContent).toBe("Last");
  expect(output().dataset["busy"]).toBe("false");
});

it("shows a rejected render as a diagnostic carrying the engine's message", async () => {
  using mounted = open();
  await advance(300);
  await act(async () =>
    mounted.host.renders[0]!.reject(new Error("Unclosed tag on line 3")),
  );
  expect(diagnostics().textContent).toBe(
    "render-error: Unclosed tag on line 3",
  );
  expect(output().dataset["busy"]).toBe("false");
  // The failure names the source it was rendered for, so it does not read stale.
  expect(output().dataset["stale"]).toBe("false");
});

it("holds rendering on the host's word while the last result stands", async () => {
  using mounted = open();
  const { host, controller, scheduler } = mounted;
  await advance(300);
  await act(async () => host.renders[0]!.answer({ creationBody: "Good" }));
  act(() =>
    scheduler.setInput({ snapshot: PAPER, annotation: EXAMPLE, hold: true }),
  );
  expect(output().textContent).toBe("Good");
  expect(output().dataset["stale"]).toBe("true");
  act(() => void controller.setManifestKey("name", "Held"));
  await advance(1000);
  expect(host.renders).toHaveLength(1);
  act(() => scheduler.setInput({ snapshot: PAPER, annotation: EXAMPLE }));
  await advance(300);
  expect(host.renders).toHaveLength(2);
});
