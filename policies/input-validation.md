# Input validation

Scope: text that reaches ZotLit from outside the process — Obsidian CLI parameters (`CliData`), Public URI Link queries, and HTTP request bodies and headers.

## One valibot schema per entry point

- Each command, protocol action, or route decodes its input through one valibot schema that names every parameter it accepts. The schema owns each parameter's form, its default, and the reshape into the typed request; the request type is `v.InferOutput` of that schema, declared nowhere else. Pattern: `protocolQuerySchema` and `protocolBatchQuerySchema` in `packages/protocol/src/url.ts`.
- Express each form inside the schema: `v.picklist` for a closed set of words, `v.regex` then `v.transform` for a number or structured text, `v.parseJson()` before the structural schema for a JSON-valued parameter, `v.optional(schema, default)` for a default.
- When the parameters that apply depend on another parameter — one of several selectors, a parameter that one kind of Template takes — declare one variant per case, each listing the parameters that apply to it and reshaping them into its branch of the request through one builder the variants share.
- Check order is entry order: the parameters that choose the variant first, then the parameters that do not apply, then the rest. A suggested correction then always leads to a valid request.
- Express a rule between parameters that all apply with `v.forward(v.partialCheck(...), [parameter])`, so the failure names the parameter the caller changes.
- A value form that more than one entry point accepts — Zotero item key, item id, Library selector, source id — has one schema or predicate, exported by the package that owns the concept. Each entry point imports it.

## Messages

- Attach the caller-facing message to the valibot action that checks it (`v.regex(pattern, message)`). The entry point answers the first issue: the parameter from the issue path, the message from the issue.
- CLI wording follows [CLI text](../apps/obsidian/policies/cli-text.md).

## Obsidian CLI

- Every `zotlit:*` command decodes `CliData` with `decodeCliParams` from `apps/obsidian/src/lib/cli-params.ts`, through a schema built with `cliParams` (`noCliParams` for a command that takes none), or with `cliVariants` over several `cliParams` variants. In a variant, `cliNotApplicable(message)` declares a parameter of another variant at its place in the check order; `cliOneOf(names, messages)` allows at most one of several parameters and names the second one given. The adapter owns the token rules — an undeclared key, a `--` token, `vault` after the command name, an empty value — and answers the first invalid parameter. The namespace wraps it in its own diagnostic, with the rejection's `hint` when it has one, or `rejectionText` where the response has no hint field. Pattern: `apps/obsidian/src/services/item-query/decode.ts`.
- A command that forwards its other parameters to a second command's decoder decodes its own parameters, `--` forms included, through `decodeCliParams`, and the forwarded ones through the second decoder, before it starts work; a rejection keeps its message and hint.
- A bare parameter arrives as `"true"`. Use `cliSwitch` for a parameter named alone, `cliValue` for one whose value is never `"true"`, and `expectSourceParam` for `expect-source`.
- Type each command's `CliFlags` with `CliParamName<typeof schema>`, so the help flags and the accepted parameters agree. Mark a required parameter `required: true`; `ZotLitPlugin.registerCliHandler` moves the mark into the help text, so the decoder reports a missing parameter. Give a `format` flag the bracketed `choices()` value, which keeps Obsidian from turning a `--json` token into `format=json`.
- Keep the decoded `CliRequest` to the handler; the handler reads `kind`.

## Review check

- A handler reads a raw parameter before the schema decodes it.
- A validity check on a raw parameter — `RegExp.test`, `JSON.parse`, `Number(...)`, a hand-written key allowlist — sits outside the schema.
- A diff declares a form that an existing export already validates.
- A CLI command carries its own copy of the token rules.
- A CLI command registers outside `ZotLitPlugin.registerCliHandler`, or a `format` flag value is a bare `a|b` list.
- A rule between parameters that decides which parameters apply is a check after the entries, not a variant.
- A request type is declared beside the schema that produces it.
- A changed entry point has no test that gives an invalid input and asserts the parameter and message it answers.
