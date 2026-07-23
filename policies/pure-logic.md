# Deep modules

Default to one cohesive module. Prefer private functions before sibling files. If you split, re-export the public surface from the entry module.

Split when: file past ~250 lines with unrelated concerns, same logic in multiple modules, orchestration and branching too tangled to read together, or testing through the orchestrator requires awkward mocking. Pure helpers take all inputs as args, hold no state, perform no I/O, never import the orchestrator.
