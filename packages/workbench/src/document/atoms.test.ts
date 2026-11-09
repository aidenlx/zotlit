import * as Atom from "effect/reactivity/Atom";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { describe, expect, it } from "vitest";

import { workbenchDocumentAtoms } from "./atoms";
import { WorkbenchDocumentController } from "./controller";

const PROFILE = `---
name: Reading notes
id: reading
version: 1.0.0
contract: 2
filename: '{{ zt.citationKey }}'
language: liquid
frontmatter:
  - key: title
    expr: zt.title
    merge: replace
  - key: year
    expr: zt.year
    merge: replace
---
# {{ zt.title }}

--- zotlit:annotation ---
> {{ zt.text }}
`;

/** A registry that reads one controller's atoms, held the way a host holds them. */
function hold(controller: WorkbenchDocumentController) {
  const registry = AtomRegistry.make({
    defaultIdleTTL: 0,
    timeoutResolution: 1,
  });
  const current = Atom.make(controller);
  const atoms = workbenchDocumentAtoms(current);
  for (const atom of Object.values(atoms)) registry.mount(atom);
  registry.mount(current);
  return {
    registry,
    current,
    atoms,
    [Symbol.dispose]: () => registry.dispose(),
  };
}

function noteEdit(controller: WorkbenchDocumentController, insert: string) {
  const { from } = controller.sliceRange("note");
  controller.dispatch({ changes: { from, insert }, userEvent: "input.type" });
}

describe("workbenchDocumentAtoms", () => {
  it("publishes a read-only change alone, and the replacement's own", () => {
    const controller = new WorkbenchDocumentController(PROFILE);
    using held = hold(controller);
    const { registry, atoms, current } = held;
    const seen: boolean[] = [];
    registry.subscribe(atoms.readOnly, (readOnly) => seen.push(readOnly));

    controller.setReadOnly(true);
    controller.setReadOnly(false);
    registry.set(
      current,
      new WorkbenchDocumentController(PROFILE, { readOnly: true }),
    );

    expect(seen).toEqual([true, false, true]);
  });

  it("publishes the source after an edit", () => {
    const controller = new WorkbenchDocumentController(PROFILE);
    using held = hold(controller);
    const { registry, atoms } = held;
    const seen: string[] = [];
    registry.subscribe(atoms.source, (source) => seen.push(source));

    noteEdit(controller, "one ");

    expect(registry.get(atoms.source)).toContain("one # {{ zt.title }}");
    expect(seen).toHaveLength(1);
  });

  it("follows undo and redo, and stays put on an update that keeps the text", () => {
    const controller = new WorkbenchDocumentController(PROFILE);
    using held = hold(controller);
    const { registry, atoms } = held;
    noteEdit(controller, "one ");
    const seen: string[] = [];
    registry.subscribe(atoms.source, (source) => seen.push(source));

    controller.undo();
    expect(registry.get(atoms.source)).toBe(PROFILE);
    controller.setReadOnly(true);
    controller.setReadOnly(false);
    controller.redo();
    expect(registry.get(atoms.source)).toContain("one # {{ zt.title }}");

    expect(seen).toEqual([
      PROFILE,
      PROFILE.replace("# {{ zt.title }}", "one # {{ zt.title }}"),
    ]);
  });

  it("publishes the Properties rows and their slices in their new order", () => {
    const controller = new WorkbenchDocumentController(PROFILE);
    using held = hold(controller);
    const { registry, atoms } = held;

    expect(
      controller.editManagedEntry({ action: "move", position: 2, to: 1 }),
    ).toBe(true);

    const entries = registry.get(atoms.managedEntries);
    expect(entries?.map((entry) => entry.key)).toEqual(["year", "title"]);
    const source = registry.get(atoms.source);
    const slices = registry.get(atoms.slices);
    const text = (id: "entry:1" | "entry:2") => {
      const range = slices.get(id)!;
      return source.slice(range.from, range.to);
    };
    expect([text("entry:1"), text("entry:2")]).toEqual(["zt.year", "zt.title"]);
  });

  it("holds the last rows and names the problem while the draft does not parse", () => {
    const controller = new WorkbenchDocumentController(PROFILE);
    using held = hold(controller);
    const { registry, atoms } = held;
    const rows = registry.get(atoms.managedEntries);
    const year = controller.sliceRange("entry:2");

    controller.dispatch({ changes: { from: year.from, insert: "[" } });

    expect(registry.get(atoms.source)).toContain("expr: [zt.year");
    expect(registry.get(atoms.problems)).toHaveLength(1);
    expect(registry.get(atoms.problems)[0]).toMatchObject({ slice: "entry:2" });
    expect(registry.get(atoms.managedEntries)).toBe(rows);
    const row = registry.get(atoms.slices).get("entry:2")!;
    expect(registry.get(atoms.source).slice(row.from, row.to)).toBe("[zt.year");

    controller.undo();
    expect(registry.get(atoms.problems)).toEqual([]);
  });

  it("counts every update, the read-only toggle and history included", () => {
    const controller = new WorkbenchDocumentController(PROFILE);
    using held = hold(controller);
    const { registry, atoms } = held;
    const seen: number[] = [];
    registry.subscribe(atoms.revision, (revision) => seen.push(revision));

    controller.setReadOnly(true);
    expect(controller.canUndo).toBe(false);
    controller.setReadOnly(false);
    noteEdit(controller, "one ");
    controller.undo();

    expect(seen).toEqual([1, 2, 3, 4]);
  });

  it("holds the last manifest that parsed while the draft does not", () => {
    const controller = new WorkbenchDocumentController(PROFILE);
    using held = hold(controller);
    const { registry, atoms } = held;
    expect(registry.get(atoms.parsed)).toBe(true);
    const manifest = registry.get(atoms.manifest);
    expect(manifest?.name).toBe("Reading notes");

    const year = controller.sliceRange("entry:2");
    controller.dispatch({ changes: { from: year.from, insert: "[" } });
    expect(registry.get(atoms.parsed)).toBe(false);
    expect(registry.get(atoms.manifest)).toBe(manifest);

    controller.undo();
    expect(registry.get(atoms.parsed)).toBe(true);
    expect(registry.get(atoms.manifest)?.name).toBe("Reading notes");
  });

  it("names whether a plain document parses, and keeps no Profile manifest", () => {
    const controller = new WorkbenchDocumentController(
      "---\nlanguage: liquid\n---\n{{ zt.title }}",
      { kind: "citation" },
    );
    using held = hold(controller);
    const { registry, atoms } = held;
    expect(registry.get(atoms.kind)).toBe("citation");
    expect(registry.get(atoms.parsed)).toBe(true);
    expect(registry.get(atoms.manifest)).toBeNull();

    controller.dispatch({ changes: { from: 4, insert: "[" } });
    expect(registry.get(atoms.parsed)).toBe(false);
  });

  it("starts a loaded controller with no manifest of the one it replaced", () => {
    const first = new WorkbenchDocumentController(PROFILE);
    using held = hold(first);
    const { registry, current, atoms } = held;
    registry.set(current, new WorkbenchDocumentController("not a profile"));
    expect(registry.get(atoms.parsed)).toBe(false);
    expect(registry.get(atoms.manifest)).toBeNull();
  });

  it("reads the controller a host loads in place of the one it held", () => {
    const first = new WorkbenchDocumentController(PROFILE);
    using held = hold(first);
    const { registry, current, atoms } = held;
    const loaded = PROFILE.replace("# {{ zt.title }}", "# Loaded");
    const next = new WorkbenchDocumentController(loaded);

    registry.set(current, next);
    expect(registry.get(atoms.source)).toBe(loaded);

    noteEdit(first, "stale ");
    expect(registry.get(atoms.source)).toBe(loaded);
    noteEdit(next, "live ");
    expect(registry.get(atoms.source)).toContain("live # Loaded");
  });
});
