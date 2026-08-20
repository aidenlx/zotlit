import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

import { runDocsAvailability } from "./docs-availability.ts";
import type {
  DocsAvailabilityPlan,
  DocsAvailabilityReview,
  DocsAvailabilityReviewBatch,
} from "./docs-availability.ts";

import { getWorkspaceRoot } from "#package-roots";

const execFileAsync = promisify(execFile);

class ControlledReview implements DocsAvailabilityReview {
  readonly batches: DocsAvailabilityReviewBatch[] = [];
  readonly plans: DocsAvailabilityPlan[] = [];

  constructor(
    readonly selectedPaths: ReadonlySet<string> = new Set(),
    readonly confirmed = true,
  ) {}

  reviewBatch(batch: DocsAvailabilityReviewBatch): readonly string[] {
    this.batches.push(batch);
    return batch.pages
      .filter(({ path }) => this.selectedPaths.has(path))
      .map(({ path }) => path);
  }

  confirm(plan: DocsAvailabilityPlan): boolean {
    this.plans.push(plan);
    return this.confirmed;
  }
}

interface GitRepository extends AsyncDisposable {
  root: string;
  commit(message: string): Promise<void>;
  readPage(path: string): Promise<string>;
  writePage(path: string, content: string): Promise<void>;
}

async function createGitRepository(): Promise<GitRepository> {
  await using stack = new AsyncDisposableStack();
  const workspaceRoot = await getWorkspaceRoot(import.meta.dirname);
  const scratch = join(workspaceRoot, "tmp");
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(join(scratch, "docs-availability-test-"));
  stack.defer(() => rm(root, { recursive: true, force: true }));

  await git(root, "init", "--initial-branch=main");
  await git(root, "config", "user.email", "tests@zotlit.invalid");
  await git(root, "config", "user.name", "ZotLit tests");
  const cleanup = stack.move();

  return {
    root,
    async commit(message) {
      await git(root, "add", ".");
      await git(root, "commit", "-m", message);
    },
    readPage: (path) => readFile(join(root, path), "utf-8"),
    async writePage(path, content) {
      const fullPath = join(root, path);
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, content);
    },
    async [Symbol.asyncDispose]() {
      await cleanup[Symbol.asyncDispose]();
    },
  };
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  return execFileAsync("git", args, { cwd }).then(({ stdout }) => stdout);
}

function page(title: string, body: string, availability = ""): string {
  const availabilityBlock = availability.length > 0 ? `${availability}\n` : "";
  return `---\ntitle: "${title}"\ndescription: "Test page."\n${availabilityBlock}---\n\n${body}\n`;
}

describe("docs availability workflow", () => {
  it("assigns a confirmed new page to the target Stable Release Line", async () => {
    await using repository = await createGitRepository();
    await repository.writePage(
      "apps/docs/content/docs/how-to/existing.mdx",
      page("Existing", "Baseline content."),
    );
    await repository.commit("baseline");
    await git(repository.root, "tag", "2.0.0");
    const newPath = "apps/docs/content/docs/how-to/new-page.mdx";
    await repository.writePage(newPath, page("New page", "New guidance."));
    await repository.commit("add page");
    const review = new ControlledReview();

    const result = await runDocsAvailability({
      cwd: repository.root,
      targetVersion: "2.1.0",
      review,
    });

    expect(result).toMatchObject({
      status: "completed",
      exitCode: 0,
      counts: { new: 1, updated: 0, declined: 0, skipped: 0, failed: 0 },
    });
    expect(review.batches).toEqual([]);
    expect(review.plans).toEqual([
      {
        newPages: [newPath],
        updatedPages: [],
        sectionIndexes: [],
      },
    ]);
    expect(await repository.readPage(newPath)).toContain(
      'description: "Test page."\nintroduced: "2.1.0"\nupdated: "2.1.0"',
    );
  });

  it("reviews changed pages in explicit batches and accumulates selections", async () => {
    await using repository = await createGitRepository();
    const paths = Array.from(
      { length: 6 },
      (_, index) =>
        `apps/docs/content/docs/how-to/changed-${String(index + 1).padStart(2, "0")}.mdx`,
    );
    for (const [index, path] of paths.entries()) {
      await repository.writePage(
        path,
        page(
          `Changed ${index + 1}`,
          "Baseline content.",
          'introduced: "2.0.0"\nupdated: "2.0.0"',
        ),
      );
    }
    await repository.commit("baseline");
    await git(repository.root, "tag", "2.0.0");
    for (const [index, path] of paths.entries()) {
      await repository.writePage(
        path,
        page(
          `Changed ${index + 1}`,
          `Material guidance ${index + 1}.`,
          'introduced: "2.0.0"\nupdated: "2.0.0"',
        ),
      );
    }
    await repository.commit("change pages");
    const review = new ControlledReview(new Set([paths[0]!, paths[5]!]));

    const result = await runDocsAvailability({
      cwd: repository.root,
      targetVersion: "2.1.0",
      review,
    });

    expect(review.batches.map(({ pages }) => pages.length)).toEqual([5, 1]);
    expect(
      review.batches.map(
        ({ initiallySelectedPaths }) => initiallySelectedPaths,
      ),
    ).toEqual([[], []]);
    expect(
      review.batches.map(({ pages }) => pages.map(({ number }) => number)),
    ).toEqual([[1, 2, 3, 4, 5], [1]]);
    expect(
      review.batches.flatMap(({ pages }) => pages.map(({ diff }) => diff)),
    ).toSatisfy((diffs: string[]) =>
      diffs.every((diff) => diff.includes("Material guidance")),
    );
    expect(result).toMatchObject({
      status: "completed",
      counts: { new: 0, updated: 2, declined: 4, skipped: 0, failed: 0 },
    });
    expect(review.plans).toHaveLength(1);
    expect(await repository.readPage(paths[0]!)).toContain('updated: "2.1.0"');
    expect(await repository.readPage(paths[1]!)).toContain('updated: "2.0.0"');
    expect(await repository.readPage(paths[5]!)).toContain('updated: "2.1.0"');
  });

  it("leaves the complete plan unchanged when final confirmation is declined", async () => {
    await using repository = await createGitRepository();
    const changedPath = "apps/docs/content/docs/how-to/changed.mdx";
    await repository.writePage(
      changedPath,
      page(
        "Changed",
        "Baseline content.",
        'introduced: "2.0.0"\nupdated: "2.0.0"',
      ),
    );
    await repository.commit("baseline");
    await git(repository.root, "tag", "2.0.0");
    const newPath = "apps/docs/content/docs/how-to/new.mdx";
    await repository.writePage(newPath, page("New", "New guidance."));
    await repository.writePage(
      changedPath,
      page(
        "Changed",
        "Material guidance.",
        'introduced: "2.0.0"\nupdated: "2.0.0"',
      ),
    );
    await repository.commit("change docs");
    const beforeNew = await repository.readPage(newPath);
    const beforeChanged = await repository.readPage(changedPath);
    const review = new ControlledReview(new Set([changedPath]), false);

    const result = await runDocsAvailability({
      cwd: repository.root,
      targetVersion: "2.1.0",
      review,
    });

    expect(result.status).toBe("cancelled");
    expect(review.plans).toEqual([
      {
        newPages: [newPath],
        updatedPages: [changedPath],
        sectionIndexes: [],
      },
    ]);
    expect(await repository.readPage(newPath)).toBe(beforeNew);
    expect(await repository.readPage(changedPath)).toBe(beforeChanged);
  });

  it("allows a batch with zero material-change selections", async () => {
    await using repository = await createGitRepository();
    const path = "apps/docs/content/docs/how-to/wording.mdx";
    const availability = 'introduced: "2.0.0"\nupdated: "2.0.0"';
    await repository.writePage(
      path,
      page("Wording", "Baseline wording.", availability),
    );
    await repository.commit("baseline");
    await git(repository.root, "tag", "2.0.0");
    await repository.writePage(
      path,
      page("Wording", "Corrected wording.", availability),
    );
    await repository.commit("correct wording");
    const before = await repository.readPage(path);
    const review = new ControlledReview();

    const result = await runDocsAvailability({
      cwd: repository.root,
      targetVersion: "2.1.0",
      review,
    });

    expect(review.batches).toHaveLength(1);
    expect(review.plans).toHaveLength(1);
    expect(result.counts).toMatchObject({ updated: 0, declined: 1 });
    expect(await repository.readPage(path)).toBe(before);
  });

  it("checks pending work without prompts or writes and passes after a committed plan", async () => {
    await using repository = await createGitRepository();
    const changedPath = "apps/docs/content/docs/how-to/changed.mdx";
    await repository.writePage(
      changedPath,
      page(
        "Changed",
        "Baseline content.",
        'introduced: "2.0.0"\nupdated: "2.0.0"',
      ),
    );
    await repository.commit("baseline");
    await git(repository.root, "tag", "1.9.0");
    await git(repository.root, "tag", "2.0.0");
    await git(repository.root, "tag", "2.1.0-beta.1");
    const newPath = "apps/docs/content/docs/concepts/new.mdx";
    await repository.writePage(newPath, page("New", "New guidance."));
    await repository.writePage(
      changedPath,
      page(
        "Changed",
        "Material guidance.",
        'introduced: "2.0.0"\nupdated: "2.0.0"',
      ),
    );
    await repository.commit("change docs");
    const beforeNew = await repository.readPage(newPath);
    const beforeChanged = await repository.readPage(changedPath);

    const pending = await runDocsAvailability({
      cwd: repository.root,
      targetVersion: "2.1.0",
      check: true,
    });

    expect(pending).toMatchObject({
      status: "pending",
      exitCode: 1,
      baselineTag: "2.0.0",
      counts: { new: 1, updated: 1, declined: 0, skipped: 0, failed: 0 },
      plan: {
        newPages: [newPath],
        updatedPages: [changedPath],
        sectionIndexes: [],
      },
    });
    expect(await repository.readPage(newPath)).toBe(beforeNew);
    expect(await repository.readPage(changedPath)).toBe(beforeChanged);

    await runDocsAvailability({
      cwd: repository.root,
      targetVersion: "2.1.0",
      review: new ControlledReview(new Set([changedPath])),
    });
    await repository.commit("record availability");

    const complete = await runDocsAvailability({
      cwd: repository.root,
      targetVersion: "2.1.0",
      check: true,
    });

    expect(complete).toMatchObject({
      status: "completed",
      exitCode: 0,
      counts: { new: 0, updated: 0, declined: 0, skipped: 2, failed: 0 },
    });
  });

  it("excludes routing and supporting content while reviewing a changed move", async () => {
    await using repository = await createGitRepository();
    const pureMoveBefore = "apps/docs/content/docs/how-to/pure-move.mdx";
    const pureMoveAfter = "apps/docs/content/docs/concepts/pure-move.mdx";
    const changedMoveBefore = "apps/docs/content/docs/how-to/changed-move.mdx";
    const changedMoveAfter = "apps/docs/content/docs/concepts/changed-move.mdx";
    const sectionIndexes = [
      "apps/docs/content/docs/(intro)/index.mdx",
      "apps/docs/content/docs/concepts/index.mdx",
      "apps/docs/content/docs/how-to/index.mdx",
      "apps/docs/content/docs/reference/index.mdx",
      "apps/docs/content/docs/reference/templates/index.mdx",
      "apps/docs/content/docs/tutorial/index.mdx",
    ];
    const availability = 'introduced: "2.0.0"\nupdated: "2.0.0"';
    for (const path of [pureMoveBefore, changedMoveBefore]) {
      await repository.writePage(
        path,
        page(
          "Moved",
          "Baseline guidance with enough text for rename detection.",
          availability,
        ),
      );
    }
    for (const path of sectionIndexes) {
      await repository.writePage(
        path,
        page("Index", "Routes readers.", availability),
      );
    }
    await repository.writePage(
      "apps/docs/content/docs/how-to/_partial.mdx",
      page("Partial", "Supporting content.", availability),
    );
    await repository.writePage(
      "apps/docs/content/docs/reference/templates/data.mdx",
      page("Generated", "Generated content.", availability),
    );
    await repository.writePage(
      "apps/docs/content/docs/how-to/deleted.mdx",
      page("Deleted", "Removed content.", availability),
    );
    await repository.commit("baseline");
    await git(repository.root, "tag", "2.0.0");
    await mkdir(join(repository.root, "apps/docs/content/docs/concepts"), {
      recursive: true,
    });
    await git(repository.root, "mv", pureMoveBefore, pureMoveAfter);
    await git(repository.root, "mv", changedMoveBefore, changedMoveAfter);
    await repository.writePage(
      changedMoveAfter,
      page(
        "Moved",
        "Material guidance with enough text for rename detection.",
        availability,
      ),
    );
    await repository.writePage(
      sectionIndexes[0]!,
      page("Index", "Routes readers to new destinations.", availability),
    );
    await repository.writePage(
      "apps/docs/content/docs/how-to/_partial.mdx",
      page("Partial", "Changed supporting content.", availability),
    );
    await repository.writePage(
      "apps/docs/content/docs/reference/templates/data.mdx",
      page("Generated", "Changed generated content.", availability),
    );
    await git(
      repository.root,
      "rm",
      "apps/docs/content/docs/how-to/deleted.mdx",
    );
    await repository.commit("reorganize docs");
    const review = new ControlledReview(new Set([changedMoveAfter]));

    const result = await runDocsAvailability({
      cwd: repository.root,
      targetVersion: "2.1.0",
      review,
    });

    expect(review.batches).toHaveLength(1);
    expect(review.batches[0]!.pages).toMatchObject([
      {
        kind: "moved",
        path: changedMoveAfter,
        previousPath: changedMoveBefore,
      },
    ]);
    expect(review.plans[0]!.sectionIndexes).toEqual(sectionIndexes);
    expect(await repository.readPage(pureMoveAfter)).toContain(availability);
    expect(await repository.readPage(changedMoveAfter)).toContain(
      'updated: "2.1.0"',
    );
    for (const path of sectionIndexes) {
      expect(await repository.readPage(path)).not.toContain("introduced:");
      expect(await repository.readPage(path)).not.toContain("updated:");
    }
    expect(result.counts).toMatchObject({ new: 0, updated: 1, failed: 0 });
  });

  it("rejects invalid inputs before discovery", async () => {
    await using repository = await createGitRepository();
    await repository.writePage(
      "apps/docs/content/docs/how-to/page.mdx",
      page("Page", "Content."),
    );
    await repository.commit("initial");

    const prereleaseResult = await runDocsAvailability({
      cwd: repository.root,
      targetVersion: "2.1.0-beta.1",
      check: true,
    });
    expect(prereleaseResult).toMatchObject({ status: "failed", exitCode: 1 });

    const noTagResult = await runDocsAvailability({
      cwd: repository.root,
      targetVersion: "2.1.0",
      check: true,
    });
    expect(noTagResult.errors[0]).toContain("No previous stable release tag");

    await git(repository.root, "tag", "2.0.0");
    await repository.writePage(
      "apps/docs/content/docs/how-to/page.mdx",
      page("Page", "Uncommitted content."),
    );
    const dirtyResult = await runDocsAvailability({
      cwd: repository.root,
      targetVersion: "2.1.0",
      check: true,
    });
    expect(dirtyResult.errors[0]).toContain("Working tree is not clean");
  });

  it.each([
    {
      name: "duplicate fields",
      availability:
        'introduced: "2.0.0"\nintroduced: "2.0.0"\nupdated: "2.0.0"',
      error: "duplicate introduced field",
    },
    {
      name: "malformed field syntax",
      availability: 'introduced: 2.0.0\nupdated: "2.0.0"',
      error: "malformed introduced field",
    },
    {
      name: "malformed version",
      availability: 'introduced: "two"\nupdated: "2.0.0"',
      error: "malformed introduced version",
    },
    {
      name: "missing required field",
      availability: 'updated: "2.0.0"',
      error: "missing required introduced field",
    },
    {
      name: "Updated Release before Introduced Release",
      availability: 'introduced: "2.0.0"\nupdated: "1.9.0"',
      error: "Updated Release is before the Introduced Release",
    },
  ])(
    "rejects $name during full-plan preflight",
    async ({ availability, error }) => {
      await using repository = await createGitRepository();
      const path = "apps/docs/content/docs/how-to/invalid.mdx";
      await repository.writePage(
        path,
        page(
          "Invalid",
          "Baseline content.",
          'introduced: "2.0.0"\nupdated: "2.0.0"',
        ),
      );
      await repository.commit("baseline");
      await git(repository.root, "tag", "2.0.0");
      await repository.writePage(
        path,
        page("Invalid", "Material guidance.", availability),
      );
      await repository.commit("invalid page");
      const before = await repository.readPage(path);

      const result = await runDocsAvailability({
        cwd: repository.root,
        targetVersion: "2.1.0",
        check: true,
      });

      expect(result).toMatchObject({
        status: "failed",
        exitCode: 1,
        counts: { failed: 1 },
      });
      expect(result.errors[0]).toContain(path);
      expect(result.errors[0]).toContain(error);
      expect(await repository.readPage(path)).toBe(before);
    },
  );

  it("rejects a new page when its planned transformation would be a no-op", async () => {
    await using repository = await createGitRepository();
    await repository.writePage(
      "apps/docs/content/docs/how-to/existing.mdx",
      page("Existing", "Baseline content."),
    );
    await repository.commit("baseline");
    await git(repository.root, "tag", "2.0.0");
    const path = "apps/docs/content/docs/how-to/unsafe.mdx";
    const content = "---\nslug: unsafe\n---\n\nUnsafe page.\n";
    await repository.writePage(path, content);
    await repository.commit("unsafe page");

    const result = await runDocsAvailability({
      cwd: repository.root,
      targetVersion: "2.1.0",
      check: true,
    });

    expect(result.errors[0]).toContain(path);
    expect(result.errors[0]).toContain("planned transformation made no change");
    expect(await repository.readPage(path)).toBe(content);
  });

  it("rejects a new page whose existing fields do not equal the target", async () => {
    await using repository = await createGitRepository();
    await repository.writePage(
      "apps/docs/content/docs/how-to/existing.mdx",
      page("Existing", "Baseline content."),
    );
    await repository.commit("baseline");
    await git(repository.root, "tag", "2.0.0");
    const path = "apps/docs/content/docs/how-to/new-with-history.mdx";
    await repository.writePage(
      path,
      page(
        "New with history",
        "New guidance.",
        'introduced: "2.0.0"\nupdated: "2.1.0"',
      ),
    );
    await repository.commit("add inconsistent new page");

    const result = await runDocsAvailability({
      cwd: repository.root,
      targetVersion: "2.1.0",
      check: true,
    });

    expect(result.status).toBe("failed");
    expect(result.errors[0]).toContain(path);
    expect(result.errors[0]).toContain(
      "a new page already has availability fields",
    );
  });

  it("truncates a large diff and provides a copy-paste full-diff command", async () => {
    await using repository = await createGitRepository();
    const path = "apps/docs/content/docs/(intro)/long page.mdx";
    const availability = 'introduced: "2.0.0"\nupdated: "2.0.0"';
    const baseline = Array.from(
      { length: 70 },
      (_, index) => `Baseline line ${index + 1}.`,
    ).join("\n");
    const changed = Array.from(
      { length: 70 },
      (_, index) => `Changed line ${index + 1}.`,
    ).join("\n");
    await repository.writePage(path, page("Long page", baseline, availability));
    await repository.commit("baseline");
    await git(repository.root, "tag", "2.0.0");
    await repository.writePage(path, page("Long page", changed, availability));
    await repository.commit("change long page");
    const review = new ControlledReview();

    await runDocsAvailability({
      cwd: repository.root,
      targetVersion: "2.1.0",
      review,
    });

    const diff = review.batches[0]!.pages[0]!.diff;
    expect(diff).toContain("more lines");
    expect(diff).toContain(
      "git diff -M '2.0.0' HEAD -- 'apps/docs/content/docs/(intro)/long page.mdx'",
    );
  });
});
