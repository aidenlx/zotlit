# ZotLit owns the Filter Expression language

ZotLit defines and evolves the Filter Expression language. Its syntax takes inspiration from Obsidian Bases for user familiarity, while ZotLit tests specify the supported behavior. The initial contract keeps the existing grammar behavior, including its edge cases, and uses focused unit tests as the source of truth. This lets the grammar evolve with ZotLit query needs and keeps its contract independent of an Obsidian release or proprietary parser data.
