// Normalize completed tool exchanges before measuring either agent.
export function parseEvents(jsonl) {
  return jsonl.split("\n").flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
}
export function codexCommands(events) {
  return events
    .filter(
      (e) =>
        e.type === "item.completed" && e.item?.type === "command_execution",
    )
    .map(({ item }) => ({
      id: item.id,
      command: item.command,
      output: item.aggregated_output ?? "",
      exitCode: item.exit_code,
    }));
}
const contentText = (content) =>
  typeof content === "string"
    ? content
    : (content ?? [])
        .map((block) => block.text ?? JSON.stringify(block))
        .join("\n");
export function claudeCommands(events) {
  const pending = new Map();
  const completed = [];
  for (const event of events) {
    for (const block of event.message?.content ?? []) {
      if (block.type === "tool_use" && block.name !== "StructuredOutput")
        pending.set(block.id, {
          id: block.id,
          command:
            block.name === "Bash"
              ? block.input.command
              : `${block.name} ${JSON.stringify(block.input)}`,
        });
      if (block.type === "tool_result" && pending.has(block.tool_use_id))
        completed.push({
          ...pending.get(block.tool_use_id),
          output: contentText(block.content),
          exitCode: block.is_error ? 1 : 0,
        });
    }
  }
  return completed;
}
function response(output) {
  try {
    return JSON.parse(output);
  } catch {
    /* wrappers may precede a JSON envelope */
  }
  const start = output.indexOf("{"),
    end = output.lastIndexOf("}");
  if (start >= 0)
    try {
      return JSON.parse(output.slice(start, end + 1));
    } catch {
      /* plain text */
    }
  return null;
}
function linkRedirectedResponses(commands) {
  const pending = new Map();
  for (const tool of commands) {
    const command = tool.command ?? "";
    if (response(tool.output)?.ok !== undefined) {
      for (const [path, original] of pending) {
        if (command.includes(path)) {
          original.responseOutput = tool.output;
          pending.delete(path);
          break;
        }
      }
    }
    if (
      /\bzotlit:(?:query|annotation-image)\b/.test(command) &&
      !response(tool.output)
    ) {
      const redirected = />\s*(?:"([^"\n]+)"|'([^'\n]+)'|([^\s;]+))/.exec(
        command,
      );
      const path = redirected?.[1] ?? redirected?.[2] ?? redirected?.[3];
      if (path) pending.set(path, tool);
    }
  }
}

export function measureEvents(jsonl, agent = "codex") {
  const result = {
    calls: 0,
    queryAttempts: 0,
    queryExitZero: 0,
    itemQueryAttempts: 0,
    itemQueryExitZero: 0,
    attachmentQueryAttempts: 0,
    attachmentQueryExitZero: 0,
    annotationQueryAttempts: 0,
    annotationQueryExitZero: 0,
    schemaAttempts: 0,
    guideAttempts: 0,
    imageAttempts: 0,
    imageExitZero: 0,
    queryRetries: 0,
    contextualBytes: 0,
    forbiddenReads: [],
    misreadings: [],
  };
  const commands =
    agent === "claude"
      ? claudeCommands(parseEvents(jsonl))
      : codexCommands(parseEvents(jsonl));
  const seen = new Set(),
    unresolved = [];
  linkRedirectedResponses(commands);
  for (const tool of commands) {
    if (tool.id !== undefined && seen.has(tool.id)) continue;
    seen.add(tool.id);
    const { command = "", output = "", exitCode } = tool;
    result.calls++;
    result.contextualBytes += Buffer.byteLength(output);
    if (
      /(?:oracle\.json|(?:skills\/zotlit-query\/)?evals\/|(?:^|[\s/])(?:check|prepare|run)\.(?:test\.)?mjs)/.test(
        command,
      )
    )
      result.forbiddenReads.push(command);
    const isCli =
      command.includes("obsidian-cli.ts") || /\bobsidian\b/.test(command);
    const surface =
      (isCli &&
        /\bzotlit:(query-schema|query-guide|query-cancel|annotation-image|query)(?=\s|["']|$)/.exec(
          command,
        )?.[1]) ||
      "tool";
    if (surface === "query-schema") result.schemaAttempts++;
    if (surface === "query-guide") result.guideAttempts++;
    if (surface === "annotation-image") {
      result.imageAttempts++;
      if (exitCode === 0) result.imageExitZero++;
    }
    const body = response(tool.responseOutput ?? output);
    const failed =
      exitCode !== 0 ||
      (surface !== "tool" &&
        (body?.ok === false ||
          /^\s*(?:Error|error|Exception|Vault not found)\b/.test(output)));
    const warnings = surface === "tool" ? [] : (body?.warnings ?? []);
    const sameAttempt = (entry) =>
      entry.surface === surface &&
      (surface !== "tool" || entry.command === command);
    const retry = unresolved.some(sameAttempt);
    const succeeded =
      !failed &&
      !warnings.length &&
      (body?.ok === true || surface === "query-guide" || surface === "tool");
    if (surface === "query") {
      const kind = /\bfrom=["']?annotations\b/.test(command)
        ? "annotation"
        : /\bfrom=["']?attachments\b/.test(command)
          ? "attachment"
          : "item";
      result.queryAttempts++;
      result[`${kind}QueryAttempts`]++;
      if (exitCode === 0) {
        result.queryExitZero++;
        result[`${kind}QueryExitZero`]++;
      }
      if (retry) result.queryRetries++;
    }
    if (succeeded) {
      for (const entry of unresolved.filter(sameAttempt)) {
        entry.recovered = true;
        entry.recoveryCommand = command;
      }
      for (let i = unresolved.length - 1; i >= 0; i--)
        if (sameAttempt(unresolved[i])) unresolved.splice(i, 1);
    }
    if (failed || warnings.length || retry) {
      const entry = {
        command,
        surface,
        failed,
        retry,
        diagnostic: body?.diagnostic ?? null,
        warnings,
        output: body ? null : output,
        recovered: succeeded,
        recoveryCommand: null,
      };
      result.misreadings.push(entry);
      if (failed || warnings.length) unresolved.push(entry);
    }
  }
  return result;
}
