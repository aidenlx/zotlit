# Template Workbench review backlog

Deferred findings from the two-axis review of the Template Workbench CLI and Agent
Skill scope (spec #553, tickets #557–#563). The correctness and structure tiers
landed; the items below stay open, grouped by ticket, with a file:line anchor and
one line of rationale each.

## Generator / schema (#558)

- `packages/db/scripts/*` (helper emission) — `$inert` is appended to every helper
  variant, including helpers that never carry a placeholder. The marker belongs
  only on helpers a resolver can leave inert.
- `packages/db/src/contract/note.schema.json` — the orphan `TemplateParentItemData`
  `$defs` entry is 20,936 of 82,018 bytes (25.5% of the file) and nothing
  references it. `reachableTypes` walks the IR before reference substitution, so a
  type reachable only through a substituted reference is retained.
- `item-fields` path — the index-signature description is dropped, so the generated
  schema loses the prose that explains what an arbitrary field key means.
- `references` entry — hand maintained, and it carries a `path` that no validation
  step checks. Either validate the path or derive the entry.
- `extendsInterface` — matches an interface by string name, so a rename in the
  source types silently stops the extension from applying.

## Docs pipeline (#563)

- `generate:agent-skills` has no turbo task entry, so its outputs are neither
  declared nor cached.
- Codegen runs through `pre*` lifecycle hooks. Invoke it through turbo, so the
  dependency graph orders it.
- `apps/docs/.../index.json` carries no provenance marker, so a hand edit is
  indistinguishable from generated output.
- The generator emits unformatted output. Add an `oxfmt` post-pass.
- Index validation is hand written. valibot is already a dependency.
- The YAML frontmatter block is parsed by hand. Use a frontmatter parser.
- `apps/docs/AGENTS.md` does not document `skills/` as the source of the published
  Agent Skill.
- No docs page names the Skill install URL or the `npx skills add` flow.

## Polish

- `apps/obsidian/src/services/template-workbench/serialize.ts:49-54` — a helper
  invocation fault is absorbed and reported as `value: null`. Add an `error` field
  to the `$helper` marker: `serialize` runs only on the data path, so the fault has
  a place to surface without changing render behaviour.
- `apps/obsidian/src/services/template-workbench/data.ts:57` — the `compileErrors`
  entry in `TemplateDataDeps["templates"]` is read by no code in the data path.
- `_root` and the single-valued `format` parameter — both carry one possible value
  today, so each is a parameter that decides nothing.
- Accessor-path formatting exists in three copies (display tree, snippets,
  serializer). One formatter should own it.
- `resolveAnnotation` and `resolveNoteItem`
  (`apps/obsidian/src/services/template-workbench/data.ts:161,197`) repeat the same
  key classification. One classifier should serve both.
- An annotation whose attachment row is absent reports `KEY_NOT_FOUND`, which reads
  as "no such key". It deserves a distinct code.
- `apps/obsidian/src/services/template-workbench/register.ts` — `identity.vault.id`
  is the vault display name, which changes when the user renames the vault. A
  stable vault identifier would make `expect-vault` durable.
- `apps/obsidian/src/services/template/inert-placeholder.ts` — the helpers lost
  their JSDoc when they moved out of the display-tree module.
