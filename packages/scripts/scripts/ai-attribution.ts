#!/usr/bin/env node

// Git hook entry for the AI-attribution rules in `#ai-attribution`.
//   message <file>   commit-msg: fail when the message credits an agent.
//   push <remote>    pre-push: fail when a pushed commit credits an agent or
//                    a ref sits in claude/*, codex/* or cursor/*. Reads the
//                    pre-push ref lines from stdin; deleting a ref is allowed.
import { readFile } from "node:fs/promises";
import { $ } from "zx";

import {
  attributionLines,
  isAgentBranch,
  isAgentIdentity,
} from "#ai-attribution";

const ZERO = /^0+$/;

async function checkMessage(file: string): Promise<string[]> {
  const lines = attributionLines(await readFile(file, "utf8"));
  return lines.length
    ? ["Commit message credits an AI agent:", ...lines.map((l) => `  ${l}`)]
    : [];
}

async function checkPush(remote: string): Promise<string[]> {
  const problems: string[] = [];
  const input = await new Promise<string>((resolve, reject) => {
    let text = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (text += chunk));
    process.stdin.on("end", () => resolve(text));
    process.stdin.on("error", reject);
  });
  for (const line of input.split("\n").filter(Boolean)) {
    const [localRef = "", localSha = "", remoteRef = "", remoteSha = ""] =
      line.split(" ");
    if (ZERO.test(localSha)) continue;
    if (isAgentBranch(remoteRef)) {
      problems.push(`Agent branch is local-only: ${remoteRef}`);
      continue;
    }
    const range = ZERO.test(remoteSha)
      ? [localSha, "--not", `--remotes=${remote}`]
      : [`${remoteSha}..${localSha}`];
    const shas = (await $`git rev-list ${range}`.quiet()).stdout
      .split("\n")
      .filter(Boolean);
    for (const sha of shas) {
      const out = (
        await $`git log -1 --format=${"%an%x00%ae%x00%cn%x00%ce%x00%s%x00%B"} ${sha}`.quiet()
      ).stdout;
      const [an = "", ae = "", cn = "", ce = "", subject = "", ...body] =
        out.split("\0");
      const credited =
        isAgentIdentity(an, ae) ||
        isAgentIdentity(cn, ce) ||
        attributionLines(body.join("\0")).length > 0;
      if (credited) {
        problems.push(
          `${sha.slice(0, 9)} credits an AI agent (${localRef}): ${subject}`,
        );
      }
    }
  }
  return problems;
}

const [mode, arg = ""] = process.argv.slice(2);
const problems =
  mode === "message"
    ? await checkMessage(arg)
    : mode === "push"
      ? await checkPush(arg)
      : [`Unknown mode: ${mode}`];

if (problems.length) {
  console.error(`\n${problems.join("\n")}\n`);
  console.error(
    mode === "message"
      ? "Remove the attribution lines and commit again."
      : "Rewrite those commits without the attribution, and keep agent branches local.",
  );
  process.exitCode = 1;
}
