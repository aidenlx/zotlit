---
status: accepted
---

# One Document Citation Set with independent controls

ZotLit derives one ordered Document Citation Set for each note and gives that same set to the References Sidebar, In-text Citation Rendering, numbering, and Citekey Navigation. The Citation Index stays an internal source of derived facts. Two source choices define membership: Pandoc Citations starts on, and Wikilink Citations starts off. Presentation and navigation are separate choices: Show Formatted Citations starts on across Live Preview and reading mode, while Open Pandoc Citations as Links starts off. This separation keeps numeric CSL results consistent and lets each setting change one user-visible effect.

This decision supersedes ADR-0020. Citation Key Links migrate to Open Pandoc Citations as Links. The managed `citekey` frontmatter field remains template output and has no role in citation resolution or membership.

## Consequences

- Eligible Wikilink Citations are unaliased Literature Note links with no fragment or a valid Citation Fragment. Heading links, block links, and malformed Citation Fragments keep their native Obsidian meaning.
- Both source choices can be off. Internal indexing and Reset Citation Index remain available.
- Source mode always shows Markdown. Live Preview and reading mode keep native source presentation while rendering is off, pending, unavailable, or unsuccessful.
- A Citation with an unresolved item stays whole and unchanged. Its resolved items still participate in the document-wide render context, so later numeric citations and sidebar entries keep consistent numbers.
- The References Sidebar remains independent from In-text Citation Rendering. It uses a minimal list when the Pandoc Engine or selected style cannot format references.
- The Citation and References Style applies to both in-text citations and sidebar references. A missing selected style keeps native in-text source, shows the minimal sidebar, warns in settings, and raises one actionable notice per plugin lifecycle.
- Citation insertion and built-in Pandoc export keep their own contracts. Source and presentation choices do not change them.
- Public theme hooks appear only while ZotLit supplies rendering or navigation for that source. Internal recognition alone has no visual effect.

## Considered options

- Preserve the existing coupled settings: rejected because the sidebar and in-text renderer can receive different citation membership and assign different numeric meanings.
- Add controls for every syntax, view, and interaction: rejected because the state space is difficult to explain and makes cross-surface consistency fragile.
- Use one membership switch for all citation syntax: rejected because Pandoc citations and Literature Note wikilinks need different defaults and independent opt-out choices.
