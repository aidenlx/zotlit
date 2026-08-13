# Each `zotlit:*` namespace versions its own CLI Contract

Every `zotlit:*` command namespace — citations, Template Workbench, Pandoc
integration — versions the wire format it answers with, and reports that number
as `contractVersion` beside the `command` field that names the namespace. The
three numbers move on their own schedules, so citations answering 1 while the
Workbench answers 2 states two independent facts rather than a skew. Each
namespace owns its diagnostic codes and payload shape, so a change to one leaves
the other two untouched; the `command` field already identifies which namespace
a number belongs to, so the number needs no field of its own to say so.

The version reaches an agent through two paths. The envelope carries it at
runtime, so an installed plugin is always the authority on its own shape. Each
skill records the version it was written against, because a skill installs from
the docs site at a commit unrelated to the installed plugin, and nothing
re-checks it when the plugin updates. That pin is the piece that can go stale,
so it is the piece that carries the number, and a difference triggers one rule:
read the live guide again, and follow the guide over the skill.

## Consequences

- The Template Workbench envelope owns its version constant beside its envelope
  code, as the citations and Pandoc namespaces already do. It answers 2, the
  value it has shipped since 2.0.0-beta.4 — a pinnable version moves forward
  only.
- `@zotlit/db`'s `CONTRACT_VERSION` covers the Template Contract and the
  generated schema `$id` alone. The `zt` data shape and an answer's shape change
  for their own reasons, so each carries its own number.
- Each guide states the scope of its `contractVersion` and leaves the value to
  the envelope, which reports it at runtime on every call.
- A skill's pin is the one value a skill restates from the CLI on purpose, as
  the root CLI + skill pair policy states. A change that bumps a namespace's
  version moves the pin of every skill written against it, in the same change.
- An agent whose skill arrived from a different commit than the installed plugin
  sees the difference in the first answer it reads, and reaches the live guide
  from there.
