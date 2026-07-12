# Evaluation: Liquid / Handlebars as the main rendering engine (replacing Eta)

Status: resolved
Date: 2026-07-10
Prototype: `proto/liquid-proto.mjs` (liquidjs 10.27.2, runnable — `node liquid-proto.mjs`)

## Verdict

- **Handlebars: reject.** It does not deliver the safety premise. `Handlebars.compile()` at runtime generates JS source and instantiates it via `Function` — the same implied-eval class as Eta. The eval-free "runtime" package only executes **precompiled** template specs, and ZotLit templates are user-authored vault files loaded at runtime, so precompilation is structurally impossible. On top of that it is logicless in the wrong way: expressing even the current default templates needs a pile of `eq`/`and`/`join` helpers.
- **LiquidJS: viable, and the only real candidate.** Pure interpreter over an AST — zero `eval`/`new Function` anywhere in the render path. The prototype reproduces all four v2 default templates with output-equivalent results, keeps the existing link-helper data model unchanged, and even offers a typed, eval-free replacement for the frontmatter expression system. The cost is a hard expressiveness ceiling for power users and a full syntax migration.
- **Timing:** if the engine ever changes, the v2 alpha is the moment — the v1→v2 migration is already breaking, and no user has an investment in v2 Eta syntax yet. Post-2.0 this becomes a second breaking migration.

## What "safer" means here (threat model)

Obsidian does not CSP-block eval (Templater proves it), so this is not about the engine failing to run. The issue is that **templates are shareable content**: with Eta, any `.eta.md` copied from a forum post is a full-privilege script — vault I/O via `app`, network via `fetch`, Node/Electron on desktop. `#assertExpressionSyntax` and the compile step only gate syntax; the render path executes arbitrary code. With Liquid, the worst a malicious template can do is render wrong text. Obsidian's plugin review guidelines also flag `eval`/`new Function`.

Note: replacing Eta alone does **not** close the eval surface — `frontmatter.ts` compiles user expressions with `new Function` too. See "Frontmatter" below for the Liquid path.

## Requirement 1 — Markdown-friendly + pretty logic blocks

Parity with Eta, verified in the prototype:

| Eta | Liquid |
|---|---|
| `autoTrim: [false, false]` default | trimming off by default (`trimTagLeft/Right`, `trimOutputLeft/Right` all `false`) |
| per-tag `-` (trim one newline) | per-tag `{%- -%}` with engine `greedy: false` |
| per-tag `_` (slurp all whitespace) | per-tag `{%- -%}` with `greedy: true` — **engine-global, not per-tag** |
| pretty logic via `<% %>` lines + `-%>` | `{% liquid ... %}` statement block — **better than Eta**: fully indentable multi-line logic that emits nothing |

The `{% liquid %}` block is the standout: the cite template's filter/map/join pipeline renders byte-exact (`[@smith2024, p. 62; -@doe2021]`) from an indented 20-line logic block with zero whitespace leakage, no trim markers needed inside.

Gap: `greedy` is an engine option, so Eta's per-tag choice between "trim one newline" (`-`) and "slurp" (`_`) can't be mixed per tag. In practice `greedy: false` + `{% liquid %}` covered every default template.

## Requirement 2 — Feature equivalents (docs/template-v2)

All verified in the prototype unless noted:

- **autoFilter / filterFunction** → `outputEscape: (v) => ...` engine option. Same contract: `null`/`undefined` → `""`, Temporal.Instant → local date string, `toString()` coercion for creators/ItemDate.
- **datetime** → built-in `date` filter (strftime: `{{ zt.dateModified | date: "%Y-%m-%d" }}`) works on Date/ISO strings; add a small custom filter for Temporal-native formatting.
- **`bq()`** → custom `{% bq %}…{% endbq %}` block tag wrapping `formatBlockquote()`. Byte-identical output, and it removes the current footgun ("must be `<% %>`, never `<%~ %>`, or Eta compilation breaks") — a block tag can't be misused that way.
- **`include("name", data)`** → `{% render "annotation" with annotation as zt %}`. Isolated scope natively matches the direct-passthrough semantics. This **deletes `includeDataPlugin`** — the codegen-string-patching hack that `index.ts` documents as "the one irreducible coupling to eta", pinned to eta@4.6.0's exact generated source.
- **Link helpers (`fileLink()`, `noteLink()`, `imgLink()`)** → the data model ships unchanged. LiquidJS invokes zero-arg function properties on access: `{{ a.fileLink }}` renders the default link. Alias/subpath overrides become filters: `{{ a | file_link: "Open the PDF" }}`, `{{ zt | note_link: "See notes", "#Summary" }}`. Null-filtering pipelines become `{{ zt.attachments | map: "fileLink" | compact | join: " " }}` — `map` invokes the functions too.
- **`embed()`** → filter: `{{ zt.imgLink | embed }}` (verified, collapses to `""` when null).
- **`suffix()`** → filter emitting the same placeholder marker; marker resolution is post-render string work, engine-agnostic.
- **Managed region** → `transformRender` is a string wrap around named renders; ports directly.
- **Sync rendering** → `parseAndRenderSync` / `renderSync` (verified). Same caveat as Eta: keep filters/tags sync.
- **`#assertExpressionSyntax`** → deleted; Liquid parse errors are native, positioned, and don't require probing snippets through `new Function`.
- **Error surface** → `LiquidError` with line/col and template name; comparable to the current `pointToSyntaxError` output.

## Requirement 3 — Custom helpers

`registerFilter` (with args) and `registerTag` (block tags with captured content) cover every current helper. LiquidJS's extra array filters (`push`, `compact`, `where`, `map`, `group_by`, `sort`) absorb much of what currently requires inline JS.

## The expressiveness cliff (what users lose)

This is the real trade, and it's a product decision, not a technical one:

- **Arbitrary one-liners are gone.** `zt.citations.filter(...).map(c => \`...\`).join("; ")` becomes the 20-line `{% liquid %}` block. It works and reads fine, but it's a different ceiling: users can only compose what our filters expose. Templater-style scripting is impossible — which is exactly the point, but some v1 power users will hit the wall.
- **`?? fallback` chains** → `| default:` — close but not identical: `default` also replaces `""` and `false`, `??` doesn't. For the filename template (`citationKey ?? DOI ?? title ?? key`) the difference is benign-to-preferable.
- **Truthiness footgun:** in Liquid only `nil`/`false` are falsy — `""` and `0` are **truthy**. Zotero data is full of empty-string fields, so `{% if zt.comment %}` silently misfires. Verified: `where: "item.citationKey"` fails to drop empty keys for this reason. **Mitigation we control:** normalize `""` → `null` when building `zt` (we own the data layer), which makes Liquid truthiness match user intuition almost everywhere.
- **No method calls with arguments** on data (`c.path.join(" > ")` → `{{ c.path | join: " > " }}` — fine; but anything without a filter equivalent is unreachable).

## Frontmatter expressions (the other eval surface)

`frontmatter.ts` compiles user JS via `new Function` because fields need **verbatim typed values** (arrays/numbers), which `Eta.render` can't return. LiquidJS closes this: `engine.evalValueSync("zt.tags | map: 'name'", { zt })` returns a real `["ai","nlp"]` array; numbers stay numbers (verified). So the frontmatter system can move to Liquid value-expressions with types intact — same engine, same filter vocabulary as the templates, and the eval surface goes to zero across the plugin.

## Costs

- **Migration:** all of docs/template-v2 (syntax.md, defaults.md, migration.md), the embedded default templates, EtaSuggest autocomplete, the `.eta.md` naming/watcher convention, and the per-template autoTrim setting (→ trim options). The users' v1 templates were being rewritten anyway.
- **Performance:** interpreted rendering is slower than Eta's compiled functions, but rendering is not a hot path (on-demand note renders; even batch annotation imports are thousands of small renders — liquidjs handles that comfortably). Not a blocker.
- **Bundle:** liquidjs is ~40 KB min+gz vs eta/core's ~3 KB. Negligible for an Obsidian plugin.
- **Lost:** `setAutoTrim`'s per-tag `-`/`_` distinction (see Requirement 1 gap).

## Alternatives considered

- **Sandboxing Eta** (branch namesake): ShadowRealm isn't shipped in Electron/iOS WebKit consistently; SES/Compartment hardening is heavy and famously easy to get subtly wrong; QuickJS-wasm means shipping a second JS engine to mobile. All are far more machinery than swapping the template language, and all still expose a JS-language UX with a "why doesn't `fetch` work" support burden.
- **Nunjucks** compiles templates through `Function` like Handlebars — same disqualification. Mustache is eval-free but too weak (no filters/args). LiquidJS is effectively the only maintained, expressive, genuinely interpreted option.

## Dual-engine proposal: Liquid default + Eta behind explicit opt-in

Proposed 2026-07-10; context: Discord thread (`eval-discuss.txt`) — Obsidian scorecards flag
"Dynamic code execution"; the Tasks plugin was advised by the Obsidian team to ship JS execution
**off by default with a local, non-syncable opt-in** after an RCE report; an official sandboxed
eval API "with some permission structure" may come later.

**RATIFIED 2026-07-10** via grilling session — plan of record; see
`docs/adr/0004-liquid-default-eta-behind-javascript-templates-gate.md` and the glossary terms
(JavaScript Templates, Template, Filename Template) in `apps/obsidian/CONTEXT.md`.

- **Sequencing**: one milestone, pre-beta — Liquid engine + Liquid defaults + gated Eta land
  together; alpha users migrate once. No grandfathering: upgraded vaults with custom Eta
  templates see inert-with-Notice until the user consents.
- **Naming**: canonical term **JavaScript Templates** (toggle "Enable JavaScript templates");
  Liquid is just "templates", no qualifier.
- **One toggle** gates `.eta.md` templates AND frontmatter expressions. ~~The toggle *switches the
  frontmatter expression language* (JS ↔ Liquid `evalValueSync`, typed); per-field errors + the
  settings validator (checking the active language) absorb toggle flips.~~ **Superseded 2026-07-11:**
  each field declares a required `language` (`"liquid" | "javascript"`) and always evaluates in it;
  the gate only decides whether JavaScript fields run (inert + surfaced when off). Principle:
  no dynamic-code attempt of any kind while the gate is off, validation included. See the PRD's
  Managed Frontmatter decisions, issue 06, and the ADR 0004 amendment.
- **Gate UX**: flag via `app.saveLocalStorage` (per-vault, per-device, never syncs) + one-time
  confirmation modal on enable. Exception to the declarative settings bridge — needs a
  custom-bridged control.
- **Engine dispatch by extension** (`.liquid.md` / `.eta.md`). Both files for one name →
  **Liquid wins**, shadowed `.eta.md` gets a warning; effective template never depends on the
  device-local flag. Toggle off → `.eta.md` inert with a visible Notice.
- **Includes are name-based via TemplateService**, which dispatches per-name to the winning
  file/engine; mixed-language sets work. Retires `includeDataPlugin` as the semantics owner.
- **Filename template goes file-based** (`zotlit-filename.{liquid,eta}.md`, sixth named template) —
  closes the synced-JS-in-data.json hole. The old `template.filename` setting is **dropped with a
  release note** (user decision; no auto-migration code).
- **Defaults ship in Liquid only**; the v2 Eta defaults demote to docs reference. Eta users port
  from the ejected Liquid default + migration guide translation table.
- **Whitespace**: Liquid is markers-only, fixed (no trim, `greedy: false`) — templates are
  vault-portable. `autoTrim` survives unchanged, scoped under the JavaScript-templates group.
- **Editor UX**: Liquid autocomplete is a follow-up issue (user decision — accepted that the safe
  path debuts without suggest parity); EtaSuggest stays, active only in `.eta.md` files.
- **Sandbox seam**: a future official sandboxed-eval API (or SES) slots in behind the same toggle;
  the eval-sandbox exploration is deferred, not decided.

Accepted costs: the scorecard flag remains (static analysis keys on code presence, not toggles —
disclosure + off-by-default is the accepted posture per the thread); "enable advanced mode then
paste this" social engineering survives, mitigated only by the warning modal; docs and error
surfaces cover two syntaxes (Liquid-first docs, "JavaScript templates" appendix); dropping the
filename setting is the one place user-authored config is discarded (release note only).

## Prototype outputs (abridged)

Annotation (matches Eta byte-for-byte):

```markdown
> [!note] Page 57
>
> Second highlight
>
> My thoughts on this
```

Cite via `{% liquid %}`: `[@smith2024, p. 62; -@doe2021]`

Full note render (title, backlink + attachment links, Notes list, Annotations): output-equivalent to the v2 Eta defaults; see `node proto/liquid-proto.mjs`.
